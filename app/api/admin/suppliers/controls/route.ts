import { NextRequest, NextResponse } from 'next/server'
import { listSupplierControls, upsertSupplierControl } from '@/lib/suppliers/controls'

export const runtime = 'nodejs'

/**
 * GET  /api/admin/suppliers/controls          -> list
 * POST /api/admin/suppliers/controls          -> upsert { supplierName, isBlocked, rolloutPercent?, notes? }
 */
export async function GET() {
  const rows = await listSupplierControls()
  return NextResponse.json({ ok: true, results: rows })
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  if (!body?.supplierName) return NextResponse.json({ ok: false, error: 'supplierName required' }, { status: 400 })
  await upsertSupplierControl({
    supplierName: String(body.supplierName),
    isBlocked: Boolean(body.isBlocked),
    rolloutPercent: body.rolloutPercent == null ? null : Number(body.rolloutPercent),
    notes: body.notes == null ? null : String(body.notes)
  })
  return NextResponse.json({ ok: true })
}
