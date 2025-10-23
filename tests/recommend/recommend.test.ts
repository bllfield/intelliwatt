import { describe, it, expect, vi } from 'vitest'
import { recommendPlans } from '@/lib/recommend/recommend'
import { TdspCode } from '@prisma/client'

// Mock prisma + computeBill
vi.mock('@prisma/client', () => {
  const mockFindMany = vi.fn()
  return {
    PrismaClient: vi.fn(() => ({
      masterPlan: { findMany: mockFindMany }
    })),
    TdspCode: { ONCOR: 'ONCOR' },
    __mockFindMany: mockFindMany
  }
})
vi.mock('@/lib/cost/engine', () => ({
  computeBill: vi.fn(async (req: any) => ({
    aggregation: { kwhTotal: 1000, byDay: {}, byHour: {}, periodStart: new Date(), periodEnd: new Date() },
    breakdown: {
      kwh: 1000,
      energyChargeCents: 10000,
      baseFeeCents: 0,
      minUsageFeeCents: 0,
      billCreditsCents: 0,
      tdspMonthlyFeeCents: 395,
      tdspVolumetricCents: 3200,
      subtotalCents: 13595,
      totalCents: 13595,
      lines: []
    }
  }))
}))

describe('recommendPlans', () => {
  it('ranks by cost ascending', async () => {
    const { __mockFindMany } = await import('@prisma/client') as any
    __mockFindMany.mockResolvedValue([
      { id: 'p1', supplierName: 'A', planName: 'Cheap Plan', termMonths: 12, tdsp: 'ONCOR', productType: 'fixed', cancelFeeCents: 0, hasBillCredit: false, eflUrl: 'efl', tosUrl: 'tos', yracUrl: 'yrac', rateModel: { type: 'flat', termMonths: 12, energyCharges: [{ fromKwh: 0, rateCents: 10 }] } },
      { id: 'p2', supplierName: 'B', planName: 'Expensive Plan', termMonths: 12, tdsp: 'ONCOR', productType: 'fixed', cancelFeeCents: 0, hasBillCredit: false, eflUrl: 'efl', tosUrl: 'tos', yracUrl: 'yrac', rateModel: { type: 'flat', termMonths: 12, energyCharges: [{ fromKwh: 0, rateCents: 20 }] } }
    ])
    const recs = await recommendPlans({
      tdsp: TdspCode.ONCOR,
      intervals: [{ start: '2025-09-01T00:00:00Z', kwh: 1 }],
      periodStart: '2025-09-01',
      periodEnd: '2025-10-01'
    })
    expect(recs.length).toBe(2)
    expect(recs[0].planName).toBe('Cheap Plan')
  })
})
