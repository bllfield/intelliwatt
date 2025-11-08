import { assertNodeRuntime } from '@/lib/node/_guard';

assertNodeRuntime();

export type Interval = {
  /** ISO string or Date for the start of the interval */
  start: string | Date
  /** kWh in this interval */
  kwh: number
}

export type Aggregation = {
  /** Inclusive start of billing window */
  periodStart: Date
  /** Exclusive end of billing window */
  periodEnd: Date
  /** Total kWh in window */
  kwhTotal: number
  /** By day (YYYY-MM-DD) */
  byDay: Record<string, number>
  /** By hour (YYYY-MM-DDTHH:00) */
  byHour: Record<string, number>
}

export type EnergyChargeTier = { fromKwh: number; toKwh?: number; rateCents: number }
export type BillCredit = { thresholdKwh: number; creditCents: number }

export type RateModel =
  | {
      type: 'flat'
      termMonths: number
      baseFeeCents?: number
      energyCharges: [EnergyChargeTier] // one flat tier
      billCredits?: BillCredit[]
      minUsageFeeCents?: number
      notes?: string[]
    }
  | {
      type: 'tiered'
      termMonths: number
      baseFeeCents?: number
      energyCharges: EnergyChargeTier[]
      billCredits?: BillCredit[]
      minUsageFeeCents?: number
      notes?: string[]
    }
  | {
      type: 'tou'
      termMonths: number
      baseFeeCents?: number
      /** For now we'll treat energyCharges as:
       *  - one "off-peak" (fromKwh=0)
       *  - one "peak" (fromKwh=0) distinguished by notes or order passed through config
       */
      energyCharges: EnergyChargeTier[]
      billCredits?: BillCredit[]
      minUsageFeeCents?: number
      notes?: string[]
    }
  | {
      type: 'unknown'
      termMonths: number
      energyCharges: EnergyChargeTier[]
      baseFeeCents?: number
      billCredits?: BillCredit[]
      minUsageFeeCents?: number
      notes?: string[]
    }

export type TdspDelivery = {
  monthlyFeeCents: number
  deliveryCentsPerKwh: number
  effectiveAt?: string
  notes?: string
}

export type TdspSnapshotLookup = (tdsp: string, at: Date) => Promise<TdspDelivery | null>

export type CostBreakdown = {
  kwh: number
  energyChargeCents: number
  baseFeeCents: number
  minUsageFeeCents: number
  billCreditsCents: number // negative number (applied as discount)
  tdspMonthlyFeeCents: number
  tdspVolumetricCents: number
  subtotalCents: number
  totalCents: number
  lines: Array<{ label: string; cents: number }>
}

export type QuoteRequest = {
  tdsp: 'ONCOR' | 'CENTERPOINT' | 'AEP_NORTH' | 'AEP_CENTRAL' | 'TNMP'
  /** Billing window inclusive start (YYYY-MM-DD) and exclusive end (YYYY-MM-DD) */
  periodStart: string
  periodEnd: string
  /** SMT intervals (15-min or hourly) */
  intervals: Interval[]
  /** MasterPlan.rateModel */
  rateModel: RateModel
}

export type QuoteResponse = {
  ok: true
  periodStart: string
  periodEnd: string
  tdsp: string
  kwh: number
  breakdown: CostBreakdown
}
