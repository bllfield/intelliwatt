import { describe, it, expect } from 'vitest'
import { parseEflText } from '@/lib/wattbuy/efl/parse'
import { RateModel } from '@/lib/wattbuy/efl/types'

describe('EFL parser', () => {
  it('parses flat rate correctly', () => {
    const txt = `
      Electricity Facts Label
      Term: 12 months
      Energy Charge: 13.2 ¢ per kWh
      Base charge: $5
    `
    const res: RateModel = parseEflText(txt)
    expect(res.type).toBe('flat')
    expect(res.termMonths).toBe(12)
    expect(res.baseFeeCents).toBe(500)
    expect(res.energyCharges[0].rateCents).toBeCloseTo(13.2)
  })

  it('parses tiered rates', () => {
    const txt = `
      0-500 kWh: 9.1 ¢
      501-1000 kWh: 11.2 ¢
      1001-2000 kWh: 12.5 ¢
      Term: 24 months
    `
    const res = parseEflText(txt)
    expect(res.type).toBe('tiered')
    expect(res.termMonths).toBe(24)
    expect(res.energyCharges.length).toBe(3)
  })

  it('parses bill credits', () => {
    const txt = `
      Bill Credit: At 1000 kWh usage, receive $30 credit
      Term: 6 months
    `
    const res = parseEflText(txt)
    expect(res.billCredits?.[0].thresholdKwh).toBe(1000)
    expect(res.billCredits?.[0].creditCents).toBe(3000)
  })

  it('parses minimum usage fee', () => {
    const txt = `
      Minimum usage fee: $10
      Term: 12 months
    `
    const res = parseEflText(txt)
    expect(res.minUsageFeeCents).toBe(1000)
  })

  it('detects TOU', () => {
    const txt = `
      Time of Use Plan
      Peak hours: 5pm-9pm
      Off-peak: 7 ¢
    `
    const res = parseEflText(txt)
    expect(res.type).toBe('tou')
  })
})
