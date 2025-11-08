import { Prisma, type MasterPlan } from '@prisma/client';
import { prisma } from '@/lib/db';
import { normalizeOffer } from '@/lib/wattbuy/normalize';
import { assertNodeRuntime } from '@/lib/node/_guard';

assertNodeRuntime();

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

  // 2) plan_name + offer_id
  const row2 = await prisma.masterPlan.findFirst({
    where: {
      planName: n.plan_name,
      offerId: n.offer_id,
      ...(n.tdsp ? { tdsp: n.tdsp as any } : {}),
      ...(n.term_months ? { termMonths: n.term_months } : {})
    }
  })
  if (row2) {
    reasons.push('Matched by planName+offerId+tdsp+term')
    return { type: 'exact', plan: row2, reasons }
  }

  // 3) fuzzy: supplier + planName contains
  const row3 = await prisma.masterPlan.findFirst({
    where: {
      ...(n.supplier_name ? { supplierName: { contains: n.supplier_name, mode: 'insensitive' } } : {}),
      ...(n.plan_name ? { planName: { contains: n.plan_name, mode: 'insensitive' } } : {}),
      ...(n.term_months ? { termMonths: n.term_months } : {}),
      ...(n.tdsp ? { tdsp: n.tdsp as any } : {})
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
