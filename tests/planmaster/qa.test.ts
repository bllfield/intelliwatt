import { describe, it, expect } from 'vitest'
import { qaAnalyzePlan } from '@/lib/planmaster/qa'
import { MinimalPlanLike } from '@/lib/planmaster/qa.types'

function makePlan(partial: Partial<MinimalPlanLike> = {}): MinimalPlanLike {
  return {
    id: 'p1',
    supplierName: 'Test REP',
    planName: 'Saver 12',
    termMonths: 12,
    tdsp: 'ONCOR',
    eflUrl: 'https://example.com/efl.pdf',
    tosUrl: 'https://example.com/tos.pdf',
    yracUrl: 'https://example.com/yrac.pdf',
    hasBillCredit: false,
    docs: { marketing: 'some text' },
    rateModel: {
      type: 'flat',
      termMonths: 12,
      baseFeeCents: 0,
      energyCharges: [{ fromKwh: 0, rateCents: 13.2 }]
    },
    ...partial
  }
}

describe('qaAnalyzePlan', () => {
  it('flags missing disclosures', () => {
    const res = qaAnalyzePlan(makePlan({ eflUrl: null, tosUrl: null, yracUrl: null }))
    const codes = res.flags.map(f => f.code)
    expect(codes).toContain('missing_efl')
    expect(codes).toContain('missing_tos')
    expect(codes).toContain('missing_yrac')
  })

  it('flags unusual term', () => {
    const res = qaAnalyzePlan(makePlan({ termMonths: 11 }))
    const codes = res.flags.map(f => f.code)
    expect(codes).toContain('term_unusual')
  })

  it('flags base fee and large bill credit', () => {
    const res = qaAnalyzePlan(makePlan({
      rateModel: {
        type: 'tiered',
        termMonths: 12,
        baseFeeCents: 1200,
        energyCharges: [
          { fromKwh: 0, toKwh: 1000, rateCents: 9.1 },
          { fromKwh: 1001, toKwh: 2000, rateCents: 11.2 },
        ],
        billCredits: [{ thresholdKwh: 1000, creditCents: 3000 }]
      }
    }))
    const codes = res.flags.map(f => f.code)
    expect(codes).toContain('base_fee_high')
    expect(codes).toContain('bill_credit_present')
    expect(codes).toContain('bill_credit_large')
  })

  it('flags TOU/free nights hints', () => {
    const res = qaAnalyzePlan(makePlan({
      docs: { marketing: 'Free Nights and Weekends! Peak and Off-peak hours apply.' },
      rateModel: {
        type: 'tou',
        termMonths: 12,
        energyCharges: [{ fromKwh: 0, rateCents: 12.3 }],
        notes: ['time of use plan']
      }
    }))
    const codes = res.flags.map(f => f.code)
    expect(codes).toContain('tou_detected')
    expect(codes).toContain('free_periods')
  })

  it('flags zero/negative rates and missing model', () => {
    const a = qaAnalyzePlan(makePlan({
      rateModel: {
        type: 'tiered',
        termMonths: 12,
        energyCharges: [{ fromKwh: 0, toKwh: 500, rateCents: 0 }]
      }
    }))
    expect(a.flags.map(f => f.code)).toContain('rate_zero_or_negative')

    const b = qaAnalyzePlan(makePlan({ rateModel: null as any }))
    expect(b.flags.map(f => f.code)).toContain('missing_rate_model')
  })
})
