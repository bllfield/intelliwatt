import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

function requireAdmin(req: NextRequest) {
  const token = req.headers.get('x-admin-token') || ''
  return !!process.env.ADMIN_TOKEN && token === process.env.ADMIN_TOKEN
}

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  if (!requireAdmin(req)) return NextResponse.json({ ok: false, error: 'UNAUTHORIZED' }, { status: 401 })
  const limit = Number(req.nextUrl.searchParams.get('limit') || 25)
  const rows = await db.ercotIngest.findMany({ orderBy: { createdAt: 'desc' }, take: limit })
  return NextResponse.json({ ok: true, rows })
}

