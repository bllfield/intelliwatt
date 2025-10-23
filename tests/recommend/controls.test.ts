import { describe, it, expect, vi } from 'vitest'
import * as rec from '@/lib/recommend/recommend'

// Mock prisma + flags + controls
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
  computeBill: vi.fn(async () => ({
    aggregation: { kwhTotal: 1000, byDay: {}, byHour: {}, periodStart: new Date(), periodEnd: new Date() },
    breakdown: { kwh: 1000, energyChargeCents: 10000, baseFeeCents: 0, minUsageFeeCents: 0, billCreditsCents: 0, tdspMonthlyFeeCents: 0, tdspVolumetricCents: 0, subtotalCents: 10000, totalCents: 10000, lines: [] }
  }))
}))
vi.mock('@/lib/flags', () => ({
  flagBool: vi.fn(async (k: string) => true)
}))
vi.mock('@/lib/suppliers/controls', () => ({
  allowSupplier: vi.fn(async ({ supplierName }: any) => supplierName !== 'Blocked REP')
}))

describe('recommendPlans with supplier controls', () => {
  it('filters blocked suppliers and returns fallback when none allowed', async () => {
    const { __mockFindMany } = await import('@prisma/client') as any
    __mockFindMany.mockResolvedValue([
      { id: 'p1', supplierName: 'Blocked REP', planName: 'X', termMonths: 12, tdsp: 'ONCOR', productType: 'fixed', cancelFeeCents: 0, hasBillCredit: false, eflUrl: 'e', tosUrl: 't', yracUrl: 'y', rateModel: { type: 'flat', termMonths: 12, energyCharges: [{ fromKwh: 0, rateCents: 10 }] } },
    ])
    const { recommendations, filteredCount } = await rec.recommendPlans({
      tdsp: 'ONCOR' as any,
      intervals: [{ start: '2025-09-01T00:00:00Z', kwh: 1 }],
      periodStart: '2025-09-01', periodEnd: '2025-10-01'
    })
    expect(recommendations.length).toBe(0)
    expect(filteredCount).toBe(1)
  })

  it('allows non-blocked suppliers', async () => {
    const { __mockFindMany } = await import('@prisma/client') as any
    __mockFindMany.mockResolvedValue([
      { id: 'p2', supplierName: 'Open REP', planName: 'Saver 12', termMonths: 12, tdsp: 'ONCOR', productType: 'fixed', cancelFeeCents: 0, hasBillCredit: false, eflUrl: 'e', tosUrl: 't', yracUrl: 'y', rateModel: { type: 'flat', termMonths: 12, energyCharges: [{ fromKwh: 0, rateCents: 10 }] } },
    ])
    const { recommendations, filteredCount } = await rec.recommendPlans({
      tdsp: 'ONCOR' as any,
      intervals: [{ start: '2025-09-01T00:00:00Z', kwh: 1 }],
      periodStart: '2025-09-01', periodEnd: '2025-10-01'
    })
    expect(filteredCount).toBe(0)
    expect(recommendations.length).toBe(1)
    expect(recommendations[0].supplierName).toBe('Open REP')
  })
})
