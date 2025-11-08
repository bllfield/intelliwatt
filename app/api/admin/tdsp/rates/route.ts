import { NextRequest, NextResponse } from 'next/server'
import { TdspCode } from '@prisma/client'
import { getLatestTdspSnapshots } from '@/lib/tdsp/fetch'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const tdsp = searchParams.get('tdsp') as TdspCode | null
  const rows = await getLatestTdspSnapshots(tdsp ?? undefined)
  return NextResponse.json({
    ok: true,
    count: rows.length,
    results: rows
  })
}
