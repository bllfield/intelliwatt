import { NextRequest, NextResponse } from 'next/server'
import { matchOffer } from '@/lib/planmaster/matcher'

export const runtime = 'nodejs'

/**
 * POST /api/admin/match/offer
 * Body: { offer: WattBuyRawOffer }
 * Returns: { type, plan?, reasons }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    if (!body?.offer) {
      return NextResponse.json({ error: 'Missing offer' }, { status: 400 })
    }
    const res = await matchOffer(body.offer)
    return NextResponse.json({ ok: true, result: res })
  } catch (err: any) {
    console.error('[match/offer] error', err)
    return NextResponse.json({ ok: false, error: err?.message ?? 'unknown' }, { status: 500 })
  }
}
