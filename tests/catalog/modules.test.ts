import { describe, it, expect } from 'vitest'
import { modulesCatalog } from '@/lib/catalog/modules'

describe('modulesCatalog', () => {
  it('contains required fields', () => {
    for (const m of modulesCatalog) {
      expect(m).toHaveProperty('id')
      expect(m).toHaveProperty('name')
      expect(m).toHaveProperty('purpose')
      expect(Array.isArray(m.inputs)).toBe(true)
      expect(Array.isArray(m.outputs)).toBe(true)
      expect(typeof m.estDevTime).toBe('string')
    }
  })

  it('has unique IDs', () => {
    const ids = modulesCatalog.map(m => m.id)
    const uniqueIds = new Set(ids)
    expect(ids.length).toBe(uniqueIds.size)
  })

  it('has valid development time format', () => {
    for (const m of modulesCatalog) {
      expect(m.estDevTime).toMatch(/^\d+(\.\d+)?d$/)
    }
  })

  it('has non-empty inputs and outputs', () => {
    for (const m of modulesCatalog) {
      expect(m.inputs.length).toBeGreaterThan(0)
      expect(m.outputs.length).toBeGreaterThan(0)
    }
  })

  it('has valid endpoint format when present', () => {
    for (const m of modulesCatalog) {
      if (m.endpoint) {
        expect(m.endpoint).toMatch(/^(GET|POST|PUT|DELETE|PATCH)\s\/api\//)
      }
    }
  })

  it('has reasonable development time estimates', () => {
    for (const m of modulesCatalog) {
      const time = parseFloat(m.estDevTime.replace('d', ''))
      expect(time).toBeGreaterThan(0)
      expect(time).toBeLessThanOrEqual(5) // No module should take more than 5 days
    }
  })
})
