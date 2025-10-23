export interface EnergyChargeTier {
  fromKwh: number
  toKwh?: number
  rateCents: number
}

export interface BillCredit {
  thresholdKwh: number
  creditCents: number
}

export interface RateModel {
  type: 'flat' | 'tiered' | 'tou' | 'unknown'
  termMonths: number
  baseFeeCents?: number
  energyCharges: EnergyChargeTier[]
  billCredits?: BillCredit[]
  minUsageFeeCents?: number
  notes?: string[]
}
