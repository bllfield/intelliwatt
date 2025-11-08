import { NextRequest, NextResponse } from 'next/server'
import { computeBill } from '@/lib/cost/engine'
import { QuoteRequest } from '@/lib/cost/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/cost/quote
 * Body: QuoteRequest
 * Example body:
 * {
 *   "tdsp":"ONCOR",
 *   "periodStart":"2025-09-01",
 *   "periodEnd":"2025-10-01",
 *   "intervals":[{"start":"2025-09-01T00:00:00Z","kwh":0.25}, ...],
 *   "rateModel": { "type":"flat","termMonths":12,"energyCharges":[{"fromKwh":0,"rateCents":12.5}],"baseFeeCents":495 }
 * }
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as QuoteRequest
    if (!body?.intervals?.length) return NextResponse.json({ error: 'intervals required' }, { status: 400 })
    if (!body?.periodStart || !body?.periodEnd) return NextResponse.json({ error: 'periodStart/periodEnd required' }, { status: 400 })
    if (!body?.tdsp) return NextResponse.json({ error: 'tdsp required' }, { status: 400 })
    if (!body?.rateModel) return NextResponse.json({ error: 'rateModel required' }, { status: 400 })

    const { aggregation, breakdown } = await computeBill(body)
    return NextResponse.json({
      ok: true,
      periodStart: body.periodStart,
      periodEnd: body.periodEnd,
      tdsp: body.tdsp,
      kwh: aggregation.kwhTotal,
      breakdown
    })
  } catch (err: any) {
    console.error('[cost/quote] error', err)
    return NextResponse.json({ ok: false, error: err?.message ?? 'unknown' }, { status: 500 })
  }
}
