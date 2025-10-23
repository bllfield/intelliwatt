import { describe, it, expect, vi } from 'vitest'
import * as matcher from '@/lib/planmaster/matcher'
import { PrismaClient } from '@prisma/client'

// Mock prisma for test isolation
vi.mock('@prisma/client', () => {
  const mockFindFirst = vi.fn()
  return {
    PrismaClient: vi.fn(() => ({
      masterPlan: { findFirst: mockFindFirst }
    })),
    __mockFindFirst: mockFindFirst
  }
})

describe('matchOffer', () => {
  it('returns exact match by offerId', async () => {
    // @ts-ignore - dynamic import for test mocking
    const { __mockFindFirst } = await import('@prisma/client') as any
    __mockFindFirst.mockResolvedValueOnce({ id: 'p1', planName: 'Saver 12' })
    const res = await matcher.matchOffer({ offer_id: '123' })
    expect(res.type).toBe('exact')
    expect(res.plan?.id).toBe('p1')
  })

  it('returns none when nothing found', async () => {
    // @ts-ignore - dynamic import for test mocking
    const { __mockFindFirst } = await import('@prisma/client') as any
    __mockFindFirst.mockResolvedValue(null)
    const res = await matcher.matchOffer({ supplier: 'Test', plan_name: 'Foo', term: 12 })
    expect(res.type).toBe('none')
  })
})
