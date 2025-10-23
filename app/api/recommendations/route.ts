import { NextRequest, NextResponse } from 'next/server'
import { recommendPlans } from '@/lib/recommend/recommend'
import { Interval } from '@/lib/cost/types'
import { TdspCode } from '@prisma/client'
import { logOffersShown } from '@/lib/observability/audit'
import { flagBool } from '@/lib/flags'

export const runtime = 'nodejs'

/**
 * POST /api/recommendations
 * Body: {
 *   "tdsp":"ONCOR",
 *   "periodStart":"2025-09-01",
 *   "periodEnd":"2025-10-01",
 *   "intervals":[{"start":"2025-09-01T00:00:00Z","kwh":0.25}, ...],
 *   "limit":5
 * }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    if (!body?.tdsp) return NextResponse.json({ error: 'tdsp required' }, { status: 400 })
    if (!body?.intervals?.length) return NextResponse.json({ error: 'intervals required' }, { status: 400 })
    if (!body?.periodStart || !body?.periodEnd) return NextResponse.json({ error: 'periodStart/periodEnd required' }, { status: 400 })

    const tdsp = body.tdsp as TdspCode
    const intervals = body.intervals as Interval[]
    const limit = body.limit ? Number(body.limit) : 5
    const userKey = typeof body.userKey === 'string' ? body.userKey : undefined

    const { recommendations, filteredCount } = await recommendPlans({ tdsp, intervals, periodStart: body.periodStart, periodEnd: body.periodEnd, limit, userKey })
    
    // Log offers shown for audit trail
    await logOffersShown(recommendations.map(r => ({
      id: r.planId,
      supplierName: r.supplierName,
      planName: r.planName,
      tdsp: r.tdsp
    })), userKey, {
      tdsp,
      periodStart: body.periodStart,
      periodEnd: body.periodEnd,
      intervalCount: intervals.length,
      totalKwh: intervals.reduce((sum, i) => sum + (i.kwh || 0), 0)
    })
    
    // Fallback copy gated by flag
    const showFallback = await flagBool('ui.showNoOffersFallback', true)
    if (recommendations.length === 0 && showFallback) {
      return NextResponse.json({
        ok: true,
        count: 0,
        results: [],
        fallback: {
          title: "We don't have any offers to show right now",
          reason: filteredCount > 0
            ? `All ${filteredCount} available plans are currently hidden due to supplier controls or rollouts.`
            : 'We couldn\'t compute plan costs at this time.',
          actions: [
            'Try a different billing window or TDSP.',
            'Check back later as providers update their offers.',
            'Contact support if this persists.'
          ]
        }
      })
    }

    return NextResponse.json({ ok: true, count: recommendations.length, results: recommendations, filteredCount })
  } catch (err: any) {
    console.error('[recommendations] error', err)
    return NextResponse.json({ ok: false, error: err?.message ?? 'unknown' }, { status: 500 })
  }
}