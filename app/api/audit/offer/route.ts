import { NextRequest, NextResponse } from 'next/server'
import { logOfferSelected } from '@/lib/observability/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/audit/offer
 * Body: { planId, supplierName, planName, tdsp, userKey?, metadata? }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    if (!body?.planId) return NextResponse.json({ error: 'planId required' }, { status: 400 })
    await logOfferSelected(body, body.userKey, body.metadata)
    return NextResponse.json({ ok: true })
  } catch (err: any) {
    console.error('[audit/offer] error', err)
    return NextResponse.json({ ok: false, error: err?.message ?? 'unknown' }, { status: 500 })
  }
}
