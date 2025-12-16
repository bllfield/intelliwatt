import { NextRequest, NextResponse } from 'next/server'
import { TdspCode } from '@prisma/client'
import { getLatestTdspSnapshots } from '@/lib/tdsp/fetch'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const ADMIN_TOKEN = process.env.ADMIN_TOKEN
  if (!ADMIN_TOKEN) {
    return NextResponse.json({ ok: false, error: 'ADMIN_TOKEN is not configured' }, { status: 500 })
  }
  const headerToken = req.headers.get('x-admin-token')
  if (!headerToken || headerToken !== ADMIN_TOKEN) {
    return NextResponse.json({ ok: false, error: 'Unauthorized (invalid admin token)' }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const tdsp = searchParams.get('tdsp') as TdspCode | null
  const rows = await getLatestTdspSnapshots(tdsp ?? undefined)
  return NextResponse.json({
    ok: true,
    count: rows.length,
    results: rows
  })
}
