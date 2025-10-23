import { PrismaClient, TdspCode, MasterPlan } from '@prisma/client'
import { Interval, QuoteRequest, QuoteResponse, RateModel } from '@/lib/cost/types'
import { computeBill } from '@/lib/cost/engine'
import { allowSupplier } from '@/lib/suppliers/controls'
import { flagBool } from '@/lib/flags'

const prisma = new PrismaClient()

export type Recommendation = {
  planId: string
  supplierName: string
  planName: string
  termMonths: number
  tdsp: string
  productType: string
  cancelFeeCents?: number | null
  hasBillCredit: boolean
  disclosures: {
    eflUrl?: string | null
    tosUrl?: string | null
    yracUrl?: string | null
  }
  quote: QuoteResponse
}

export type RecommendOpts = {
  tdsp: TdspCode
  intervals: Interval[]
  periodStart: string
  periodEnd: string
  limit?: number
  userKey?: string
}

export type RecommendResult = {
  recommendations: Recommendation[]
  filteredCount: number        // how many plans were filtered out by controls
}

export async function recommendPlans(opts: RecommendOpts): Promise<RecommendResult> {
  const { tdsp, intervals, periodStart, periodEnd, userKey } = opts
  const limit = opts.limit ?? 10

  const enabled = await flagBool('recos.enabled', true)
  if (!enabled) return { recommendations: [], filteredCount: 0 }

  const plans = await prisma.masterPlan.findMany({
    where: { tdsp, expiresAt: null },
    orderBy: { createdAt: 'desc' },
    take: 300
  })

  const recs: Recommendation[] = []
  let filteredCount = 0

  for (const p of plans) {
    // Apply supplier controls
    const allowed = await allowSupplier({ supplierName: p.supplierName, userKey })
    if (!allowed) { filteredCount++; continue }
    if (!p.rateModel) continue

    const rateModel = p.rateModel as RateModel
    const req: QuoteRequest = { tdsp, intervals, periodStart, periodEnd, rateModel }
    try {
      const { breakdown } = await computeBill(req)
      recs.push({
        planId: p.id,
        supplierName: p.supplierName,
        planName: p.planName,
        termMonths: p.termMonths,
        tdsp: p.tdsp,
        productType: p.productType,
        cancelFeeCents: p.cancelFeeCents,
        hasBillCredit: p.hasBillCredit,
        disclosures: { eflUrl: p.eflUrl, tosUrl: p.tosUrl, yracUrl: p.yracUrl },
        quote: { ok: true, periodStart, periodEnd, tdsp, kwh: breakdown.kwh, breakdown }
      })
    } catch {
      // skip invalid rate models silently
      continue
    }
  }

  recs.sort((a, b) => a.quote.breakdown.totalCents - b.quote.breakdown.totalCents)
  return { recommendations: recs.slice(0, limit), filteredCount }
}
