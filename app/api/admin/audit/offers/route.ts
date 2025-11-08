import { NextRequest, NextResponse } from 'next/server'
import { listAudits } from '@/lib/observability/audit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/audit/offers?limit=50
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const limit = parseInt(searchParams.get('limit') || '50', 10)
    const rows = await listAudits({ limit })
    return NextResponse.json({ ok: true, count: rows.length, results: rows })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message ?? 'unknown' }, { status: 500 })
  }
}
