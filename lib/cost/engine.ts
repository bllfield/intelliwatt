import { Aggregation, CostBreakdown, EnergyChargeTier, QuoteRequest, RateModel } from './types'
import { aggregateIntervals } from './smt'
import { getTdspForPeriod } from './tdsp'
import { TdspCode } from '@prisma/client'
import { DateTime } from 'luxon';
import { assertNodeRuntime } from '@/lib/node/_guard';

assertNodeRuntime();

/**
 * Core: calculate energy supply charges from a rate model and total kWh.
 */
function calcEnergyCentsFromTiers(kwh: number, tiers: EnergyChargeTier[]): number {
  if (tiers.length === 0) return 0
  // Normalize tiers by fromKwh ascending.
  const sorted = [...tiers].sort((a, b) => a.fromKwh - b.fromKwh)
  let remaining = kwh
  let totalCents = 0
  let lastUpper = 0
  for (const t of sorted) {
    const lower = t.fromKwh
    const upper = t.toKwh ?? Infinity
    const band = Math.max(0, Math.min(upper, kwh) - Math.max(lower, lastUpper))
    lastUpper = Math.max(lastUpper, upper)
    if (band > 0) {
      totalCents += band * t.rateCents
      remaining -= band
      if (remaining <= 0) break
    }
  }
  // If tiers don't cap at Infinity, any overflow uses the last tier's rate.
  if (remaining > 0) {
    const last = sorted[sorted.length - 1]
    totalCents += remaining * last.rateCents
  }
  // cents per kWh already, so return cents total
  return Math.round(totalCents)
}

function chooseTouRates(rm: Extract<RateModel, { type: 'tou' }>): {
  peakRateCents?: number
  offpeakRateCents?: number
} {
  // Very light heuristic: if two entries exist, treat the higher as PEAK, lower as OFF-PEAK.
  const charges = [...rm.energyCharges]
  if (charges.length >= 2) {
    const sorted = charges.sort((a, b) => a.rateCents - b.rateCents)
    return { offpeakRateCents: sorted[0].rateCents, peakRateCents: sorted[sorted.length - 1].rateCents }
  }
  return { offpeakRateCents: charges[0]?.rateCents, peakRateCents: charges[0]?.rateCents }
}

/**
 * Basic TOU splitter:
 * - Peak: 5pm–9pm local wall-clock (heuristic for Step 68; replace with plan-specific windows in Step 69).
 * - Off-peak: all other hours.
 */
function splitTouKwhByHour(byHour: Aggregation['byHour']): { peakKwh: number; offpeakKwh: number } {
  let peak = 0
  let off = 0
  for (const [hourIso, kwh] of Object.entries(byHour)) {
    // hourIso is UTC ISO like 2025-10-01T17:00Z; we'll use that hour (0-23) in UTC as a proxy.
    const hour = Number(hourIso.slice(11, 13))
    // Heuristic window 17:00–20:59 (5pm-9pm) → hours 17,18,19,20
    if (hour >= 17 && hour <= 20) peak += kwh
    else off += kwh
  }
  return { peakKwh: peak, offpeakKwh: off }
}

function applyBillCredits(kwh: number, credits?: RateModel['billCredits']): number {
  if (!credits || credits.length === 0) return 0
  // Sum all applicable credits where threshold <= kwh
  let total = 0
  for (const c of credits) if (kwh >= c.thresholdKwh) total += c.creditCents
  return -Math.round(total) // negative cents (discount)
}

export async function computeBill(req: QuoteRequest): Promise<{
  aggregation: Aggregation
  breakdown: CostBreakdown
}> {
  const periodStart = new Date(req.periodStart)
  const periodEnd = new Date(req.periodEnd)

  // 1) Aggregate usage
  const aggr = aggregateIntervals(req.intervals, periodStart, periodEnd)
  const kwh = aggr.kwhTotal

  // 2) Energy supply charges
  let energyChargeCents = 0
  let baseFeeCents = Math.round(req.rateModel.baseFeeCents || 0)
  let minUsageFeeCents = 0
  let billCreditsCents = 0

  if (req.rateModel.type === 'flat' || req.rateModel.type === 'tiered' || req.rateModel.type === 'unknown') {
    energyChargeCents = calcEnergyCentsFromTiers(kwh, req.rateModel.energyCharges)
    billCreditsCents = applyBillCredits(kwh, req.rateModel.billCredits)
    if (req.rateModel.minUsageFeeCents && kwh > 0 && kwh < (req.rateModel.energyCharges[0]?.fromKwh ?? 1000)) {
      // If plan specifies a min usage fee and our heuristic "low usage" is under first tier start (or <1000 default)
      minUsageFeeCents = Math.round(req.rateModel.minUsageFeeCents)
    }
  } else if (req.rateModel.type === 'tou') {
    const { peakRateCents, offpeakRateCents } = chooseTouRates(req.rateModel)
    const { peakKwh, offpeakKwh } = splitTouKwhByHour(aggr.byHour)
    const peakCents = Math.round((peakRateCents || 0) * peakKwh)
    const offCents = Math.round((offpeakRateCents || 0) * offpeakKwh)
    energyChargeCents = peakCents + offCents
    billCreditsCents = applyBillCredits(kwh, req.rateModel.billCredits)
    if (req.rateModel.minUsageFeeCents && kwh < 1000) {
      minUsageFeeCents = Math.round(req.rateModel.minUsageFeeCents)
    }
  }

  // 3) TDSP delivery
  const tdspSnap = await getTdspForPeriod(req.tdsp as unknown as TdspCode, periodStart)
  const tdspMonthlyFeeCents = Math.round(tdspSnap?.monthlyFeeCents || 0)
  const tdspVolumetricCents = Math.round((tdspSnap?.deliveryCentsPerKwh || 0) * kwh)

  // 4) Lines and totals
  const lines: CostBreakdown['lines'] = []
  if (baseFeeCents) lines.push({ label: 'REP base fee', cents: baseFeeCents })
  if (minUsageFeeCents) lines.push({ label: 'REP minimum usage fee', cents: minUsageFeeCents })
  if (billCreditsCents) lines.push({ label: 'Bill credits', cents: billCreditsCents }) // negative
  if (energyChargeCents) lines.push({ label: 'Energy charges (supply)', cents: energyChargeCents })
  if (tdspMonthlyFeeCents) lines.push({ label: 'TDSP monthly fee', cents: tdspMonthlyFeeCents })
  if (tdspVolumetricCents) lines.push({ label: 'TDSP delivery (per kWh)', cents: tdspVolumetricCents })

  const subtotalCents = lines.reduce((a, b) => a + b.cents, 0)
  const totalCents = subtotalCents // Taxes and PUC fees omitted here; add in later compliance step.

  const breakdown: CostBreakdown = {
    kwh,
    energyChargeCents,
    baseFeeCents,
    minUsageFeeCents,
    billCreditsCents,
    tdspMonthlyFeeCents,
    tdspVolumetricCents,
    subtotalCents,
    totalCents,
    lines
  }

  return { aggregation: aggr, breakdown }
}
