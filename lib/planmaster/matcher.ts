import { PrismaClient, MasterPlan } from '@prisma/client'
import { normalizeOffer } from '@/lib/wattbuy/normalize'

const prisma = new PrismaClient()

export interface MatchResult {
  type: 'exact' | 'fuzzy' | 'none'
  plan?: MasterPlan
  reasons: string[]
}

/**
 * Try to match a normalized offer against MasterPlan rows.
 * Hierarchy:
 *  1) Exact match by (source=wattbuy, offerId).
 *  2) Exact match by (nameId, planId, tdsp, termMonths).
 *  3) Fuzzy match by supplierName+planName+termMonths (ignoring minor differences).
 */
export async function matchOffer(offer: any): Promise<MatchResult> {
  const n = normalizeOffer(offer)
  const reasons: string[] = []

  // 1) OfferId exact
  if (n.offer_id) {
    const row = await prisma.masterPlan.findFirst({
      where: { source: 'wattbuy', offerId: n.offer_id }
    })
    if (row) {
      reasons.push('Matched by source=offerId')
      return { type: 'exact', plan: row, reasons }
    }
  }

  // 2) nameId + planId
  const row2 = await prisma.masterPlan.findFirst({
    where: {
      nameId: n.nameId,
      planId: n.planId,
      tdsp: n.tdsp,
      termMonths: n.term_months
    }
  })
  if (row2) {
    reasons.push('Matched by nameId+planId+tdsp+term')
    return { type: 'exact', plan: row2, reasons }
  }

  // 3) fuzzy: supplier + planName contains
  const row3 = await prisma.masterPlan.findFirst({
    where: {
      supplierName: { contains: n.supplier_name, mode: 'insensitive' },
      planName: { contains: n.plan_name, mode: 'insensitive' },
      termMonths: n.term_months,
      tdsp: n.tdsp
    }
  })
  if (row3) {
    reasons.push('Fuzzy supplier+planName match')
    return { type: 'fuzzy', plan: row3, reasons }
  }

  return { type: 'none', reasons: ['No match found'] }
}

/**
 * Batch matcher for multiple offers.
 */
export async function matchOffers(offers: any[]) {
  const results: MatchResult[] = []
  for (const o of offers) {
    results.push(await matchOffer(o))
  }
  return results
}
