import { NextRequest, NextResponse } from 'next/server'
import { recommendPlans } from '@/lib/recommend/recommend'
import { Interval } from '@/lib/cost/types'
import { TdspCode } from '@prisma/client'
import { logOffersShown } from '@/lib/observability/audit'
import { flagBool } from '@/lib/flags'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type EflPassStrength = 'STRONG' | 'WEAK' | 'INVALID'

function isEflSafeForUserPricing(args: {
  finalValidationStatus: string | null | undefined
  parseConfidence: number | null | undefined
  passStrength: EflPassStrength | null | undefined
}): { ok: boolean; reason?: string } {
  const status = args.finalValidationStatus ?? null
  const strength = args.passStrength ?? null
  const conf = typeof args.parseConfidence === 'number' ? args.parseConfidence : null

  // If we have no EFL metadata at all, treat this as "legacy/no-EFL-guard" and allow.
  // This guard becomes active once rate models begin carrying EFL validation metadata.
  if (!status && strength == null && conf == null) {
    return { ok: true }
  }

  if (status !== 'PASS') {
    return { ok: false, reason: 'NOT_PASS' }
  }

  if (strength && strength !== 'STRONG') {
    return { ok: false, reason: `PASS_BUT_${strength}` }
  }

  const minConfidenceRaw = process.env.EFL_MIN_PARSE_CONFIDENCE
  const minConfidence = minConfidenceRaw ? Number(minConfidenceRaw) : 0.8
  const confidence = conf ?? 1

  if (!Number.isFinite(confidence)) {
    return { ok: false, reason: 'CONFIDENCE_INVALID' }
  }

  if (confidence < minConfidence) {
    return {
      ok: false,
      reason: `CONFIDENCE_BELOW_THRESHOLD(${confidence.toFixed(2)}<${minConfidence.toFixed(2)})`,
    }
  }

  return { ok: true }
}

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

    // Apply EFL-based guard rails for user-facing pricing when metadata is present.
    const guarded = recommendations.filter((r: any) => {
      const meta = (r && (r as any).eflMeta) || null
      const finalValidationStatus = meta?.finalValidationStatus ?? null
      const parseConfidence = meta?.parseConfidence ?? null
      const passStrength = meta?.passStrength ?? null

      const guard = isEflSafeForUserPricing({
        finalValidationStatus,
        parseConfidence,
        passStrength,
      })

      return guard.ok
    })
    
    // Log offers shown for audit trail
    await logOffersShown(guarded.map(r => ({
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
    if (guarded.length === 0 && showFallback) {
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

    return NextResponse.json({ ok: true, count: guarded.length, results: guarded, filteredCount })
  } catch (err: any) {
    console.error('[recommendations] error', err)
    return NextResponse.json({ ok: false, error: err?.message ?? 'unknown' }, { status: 500 })
  }
}