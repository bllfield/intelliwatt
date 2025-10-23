import { describe, it, expect } from 'vitest'
import { normalizeTdspMap } from '@/lib/tdsp/fetch'

describe('normalizeTdspMap', () => {
  it('normalizes valid structure', () => {
    const raw = {
      ONCOR: { effectiveAt: '2025-09-01', monthlyFeeCents: 395, deliveryCentsPerKwh: 3.287, notes: 'TCRF incl.' },
      TNMP:  { monthlyFeeCents: 599, deliveryCentsPerKwh: 3.9 }
    }
    const norm = normalizeTdspMap(raw)
    expect(norm.ONCOR?.monthlyFeeCents).toBe(395)
    expect(norm.ONCOR?.deliveryCentsPerKwh).toBeCloseTo(3.287)
    expect(norm.TNMP?.monthlyFeeCents).toBe(599)
  })

  it('rejects invalid numbers', () => {
    expect(() => normalizeTdspMap({
      ONCOR: { monthlyFeeCents: -1, deliveryCentsPerKwh: 3.2 }
    })).toThrow()
  })
})
