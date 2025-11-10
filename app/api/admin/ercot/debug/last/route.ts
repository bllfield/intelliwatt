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
  const status = req.nextUrl.searchParams.get('status') || undefined
  const tdsp = req.nextUrl.searchParams.get('tdsp') || undefined
  const row = await db.ercotIngest.findFirst({
    where: { status: status as any, tdsp: tdsp || undefined },
    orderBy: { createdAt: 'desc' },
  })
  return NextResponse.json({ ok: true, row })
}

