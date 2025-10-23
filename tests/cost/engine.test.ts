import { describe, it, expect } from 'vitest'
import { computeBill } from '@/lib/cost/engine'
import { QuoteRequest } from '@/lib/cost/types'

// Mock TDSP lookup by monkey-patching getTdspForPeriod (simpler than full module mocks)
import * as tdspMod from '@/lib/cost/tdsp'
tdspMod.getTdspForPeriod = async () => ({ monthlyFeeCents: 395, deliveryCentsPerKwh: 3.2 })

function makeIntervals(kwhTotal: number, count = 100) {
  const per = kwhTotal / count
  const start = new Date('2025-09-01T00:00:00Z').getTime()
  return Array.from({ length: count }, (_, i) => ({
    start: new Date(start + i * 3600_000).toISOString(),
    kwh: per
  }))
}

describe('computeBill', () => {
  it('flat rate with base fee', async () => {
    const body: QuoteRequest = {
      tdsp: 'ONCOR',
      periodStart: '2025-09-01',
      periodEnd: '2025-10-01',
      intervals: makeIntervals(1000, 200),
      rateModel: {
        type: 'flat',
        termMonths: 12,
        energyCharges: [{ fromKwh: 0, rateCents: 12.5 }],
        baseFeeCents: 495
      }
    }
    const { breakdown } = await computeBill(body)
    expect(breakdown.kwh).toBeCloseTo(1000)
    expect(breakdown.energyChargeCents).toBeCloseTo(12500)
    expect(breakdown.baseFeeCents).toBe(495)
    expect(breakdown.tdspVolumetricCents).toBeCloseTo(3200)
    expect(breakdown.totalCents).toBeGreaterThan(12500)
  })

  it('tiered with bill credit and min usage fee', async () => {
    const body: QuoteRequest = {
      tdsp: 'ONCOR',
      periodStart: '2025-09-01',
      periodEnd: '2025-10-01',
      intervals: makeIntervals(800, 160),
      rateModel: {
        type: 'tiered',
        termMonths: 12,
        energyCharges: [
          { fromKwh: 0, toKwh: 1000, rateCents: 10.0 },
          { fromKwh: 1000, rateCents: 12.0 }
        ],
        billCredits: [{ thresholdKwh: 500, creditCents: 3000 }],
        minUsageFeeCents: 995
      }
    }
    const { breakdown } = await computeBill(body)
    expect(breakdown.kwh).toBeCloseTo(800)
    expect(breakdown.energyChargeCents).toBeCloseTo(8000)
    expect(breakdown.billCreditsCents).toBe(-3000)
    // min usage fee heuristic (kwh < first tier start? first tier starts at 0 so no)
    expect(breakdown.minUsageFeeCents).toBe(0)
    expect(breakdown.totalCents).toBeGreaterThan(0)
  })

  it('basic TOU split', async () => {
    const intervals = [
      // 3 kWh during 18:00 (peak)
      { start: '2025-09-10T18:00:00Z', kwh: 3 },
      // 7 kWh off-peak
      { start: '2025-09-10T03:00:00Z', kwh: 7 }
    ]
    const body: QuoteRequest = {
      tdsp: 'ONCOR',
      periodStart: '2025-09-01',
      periodEnd: '2025-10-01',
      intervals,
      rateModel: {
        type: 'tou',
        termMonths: 12,
        energyCharges: [
          { fromKwh: 0, rateCents: 8.0 },  // off-peak
          { fromKwh: 0, rateCents: 20.0 }  // peak
        ]
      }
    }
    const { breakdown } = await computeBill(body)
    // 3*20 + 7*8 = 60 + 56 = 116 cents energy charges
    expect(breakdown.energyChargeCents).toBe(116)
  })
})
