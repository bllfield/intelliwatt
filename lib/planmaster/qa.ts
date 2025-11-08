import { QaFlag, QaResult, MinimalPlanLike } from './qa.types'
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { assertNodeRuntime } from '@/lib/node/_guard';

assertNodeRuntime();

/**
 * Heuristics for quirky plans. Stateless and deterministic.
 * NOTE: This does not decide "good/bad" — it only raises items for human QA.
 */
export function qaAnalyzePlan(plan: MinimalPlanLike): QaResult {
  const flags: QaFlag[] = []
  const rm = plan.rateModel || undefined

  // 1) Missing disclosures (EFL/TOS/YRAC)
  if (!plan.eflUrl) {
    flags.push({ code: 'missing_efl', message: 'Missing EFL URL.', severity: 'error' })
  }
  if (!plan.tosUrl) {
    flags.push({ code: 'missing_tos', message: 'Missing Terms of Service URL.', severity: 'warn' })
  }
  if (!plan.yracUrl) {
    flags.push({ code: 'missing_yrac', message: 'Missing Your Rights as a Customer URL.', severity: 'warn' })
  }

  // 2) Term sanity
  if (!plan.termMonths || plan.termMonths <= 0) {
    flags.push({ code: 'term_invalid', message: `Invalid term: ${plan.termMonths}`, severity: 'error' })
  } else if (![3, 6, 9, 12, 15, 18, 24, 36].includes(plan.termMonths)) {
    flags.push({ code: 'term_unusual', message: `Unusual term length: ${plan.termMonths} months`, severity: 'info' })
  }

  // 3) Rate model presence
  if (!rm) {
    flags.push({ code: 'missing_rate_model', message: 'No parsed rate model yet (Step 64 pending for this plan).', severity: 'warn' })
    return {
      planId: plan.id,
      supplierName: plan.supplierName,
      planName: plan.planName,
      termMonths: plan.termMonths,
      tdsp: plan.tdsp,
      flags
    }
  }

  // 4) Base fee
  if (typeof rm.baseFeeCents === 'number' && rm.baseFeeCents > 0) {
    if (rm.baseFeeCents >= 1000) {
      flags.push({
        code: 'base_fee_high',
        message: `High base fee: $${(rm.baseFeeCents / 100).toFixed(2)} / mo`,
        severity: 'warn',
        meta: { baseFeeCents: rm.baseFeeCents }
      })
    } else {
      flags.push({
        code: 'base_fee_present',
        message: `Base fee: $${(rm.baseFeeCents / 100).toFixed(2)} / mo`,
        severity: 'info',
        meta: { baseFeeCents: rm.baseFeeCents }
      })
    }
  }

  // 5) Min usage fee
  if (typeof rm.minUsageFeeCents === 'number' && rm.minUsageFeeCents > 0) {
    flags.push({
      code: 'min_usage_fee',
      message: `Minimum usage fee applies: $${(rm.minUsageFeeCents / 100).toFixed(2)}`,
      severity: 'warn',
      meta: { minUsageFeeCents: rm.minUsageFeeCents }
    })
  }

  // 6) Bill credits (magnitude / thresholds)
  if (Array.isArray(rm.billCredits) && rm.billCredits.length) {
    flags.push({
      code: 'bill_credit_present',
      message: `Bill credit structure detected (${rm.billCredits.length} threshold${rm.billCredits.length > 1 ? 's' : ''}).`,
      severity: 'info',
      meta: { billCredits: rm.billCredits }
    })
    for (const bc of rm.billCredits) {
      if (bc.creditCents >= 3000) {
        flags.push({
          code: 'bill_credit_large',
          message: `Large bill credit: $${(bc.creditCents / 100).toFixed(2)} at ${bc.thresholdKwh} kWh`,
          severity: 'warn',
          meta: bc
        })
      }
    }
  }

  // 7) Energy charges sanity: 0-rate or extreme rates
  if (!rm.energyCharges || rm.energyCharges.length === 0) {
    flags.push({ code: 'no_energy_charges', message: 'No energy charge tiers found.', severity: 'error' })
  } else {
    for (const t of rm.energyCharges) {
      const rc = t.rateCents
      if (rc <= 0) {
        flags.push({
          code: 'rate_zero_or_negative',
          message: `Zero/negative rate detected at tier starting ${t.fromKwh} kWh.`,
          severity: 'error',
          meta: t
        })
      } else if (rc > 40) {
        flags.push({
          code: 'rate_extreme_high',
          message: `Rate appears very high (${rc}¢/kWh) at tier starting ${t.fromKwh} kWh.`,
          severity: 'warn',
          meta: t
        })
      }
    }
  }

  // 8) TOU / Free nights or weekends (heuristic using docs or notes)
  const raw = JSON.stringify(plan.docs || {}).toLowerCase()
  const notes = (rm.notes || []).join(' ').toLowerCase()
  const blended = raw + ' ' + notes
  if (/\b(tou|time[-\s]*of[-\s]*use|peak|off[-\s]*peak)\b/.test(blended)) {
    flags.push({ code: 'tou_detected', message: 'Time-of-Use language detected.', severity: 'info' })
  }
  if (/(free\s+nights?|free\s+weekends?)\b/.test(blended)) {
    flags.push({ code: 'free_periods', message: 'Free nights/weekends style language detected.', severity: 'warn' })
  }

  // 9) Solar buyback / export clauses
  if (/\bsolar\b|\bexport\b|\bbuyback\b|\bnet\s*meter/.test(blended)) {
    flags.push({ code: 'solar_clause', message: 'Solar export/buyback language detected. Confirm details.', severity: 'info' })
  }

  // 10) Misc provider clauses that often matter
  if (/\bdemand\s+charge\b/.test(blended)) {
    flags.push({ code: 'demand_charge', message: 'Possible demand charge clause.', severity: 'warn' })
  }
  if (/\bminimum\s+term\s+fee\b|\bearly\s+termination\b|\bcancellation\s+fee\b/.test(blended)) {
    flags.push({ code: 'cancel_fee_clause', message: 'Early termination/cancellation fee clause present.', severity: 'info' })
  }

  // 11) Document availability within docs (URLs sometimes appear inside raw payload)
  if (!plan.eflUrl && /efl.*http/.test(blended)) {
    flags.push({ code: 'efl_url_in_docs', message: 'EFL URL appears in raw docs but not on record.', severity: 'info' })
  }

  return {
    planId: plan.id,
    supplierName: plan.supplierName,
    planName: plan.planName,
    termMonths: plan.termMonths,
    tdsp: plan.tdsp,
    flags
  }
}

/**
 * Batch helper for arrays.
 */
export function qaAnalyzePlans(plans: MinimalPlanLike[]) {
  return plans.map(qaAnalyzePlan)
}
