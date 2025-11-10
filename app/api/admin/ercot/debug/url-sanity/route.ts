import { NextRequest, NextResponse } from 'next/server'
import { resolveLatestFromPage } from '@/lib/ercot/resolve'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const pageUrl = process.env.ERCOT_PAGE_URL
  if (!pageUrl) return NextResponse.json({ ok: false, error: 'MISSING_ERCOT_PAGE_URL' }, { status: 500 })
  const filter = process.env.ERCOT_PAGE_FILTER || null
  const { latest, candidates } = await resolveLatestFromPage(pageUrl, filter, process.env.ERCOT_USER_AGENT)
  return NextResponse.json({ ok: true, pageUrl, filter, latest, candidates })
}

