export type QaSeverity = 'info' | 'warn' | 'error'

export interface QaFlag {
  code: string                     // machine-friendly
  message: string                  // human-readable
  severity: QaSeverity
  meta?: Record<string, unknown>   // optional details
}

export interface QaResult {
  planId: string                   // MasterPlan.id (uuid)
  supplierName: string
  planName: string
  termMonths: number
  tdsp: string
  flags: QaFlag[]
}

export interface MinimalPlanLike {
  id: string
  supplierName: string
  planName: string
  termMonths: number
  tdsp: string
  eflUrl?: string | null
  tosUrl?: string | null
  yracUrl?: string | null
  hasBillCredit?: boolean
  docs: any
  rateModel?: {
    type: 'flat' | 'tiered' | 'tou' | 'unknown'
    termMonths: number
    baseFeeCents?: number
    energyCharges: Array<{ fromKwh: number, toKwh?: number, rateCents: number }>
    billCredits?: Array<{ thresholdKwh: number, creditCents: number }>
    minUsageFeeCents?: number
    notes?: string[]
  } | null
}
