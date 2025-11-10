import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { fetchToTmp } from '@/lib/ercot/fetch'
import { ingestLocalFile } from '@/lib/ercot/ingest'

function requireAdmin(req: NextRequest) {
  const token = req.headers.get('x-admin-token') || ''
  if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) {
    return false
  }
  return true
}

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  if (!requireAdmin(req)) {
    return NextResponse.json({ ok: false, error: 'UNAUTHORIZED' }, { status: 401 })
  }
  try {
    const url = req.nextUrl.searchParams.get('url')
    const notes = req.nextUrl.searchParams.get('notes') || undefined
    if (!url) {
      return NextResponse.json({ ok: false, error: 'MISSING_URL' }, { status: 400 })
    }
    const { tmpPath, sha256, headers } = await fetchToTmp(url, process.env.ERCOT_USER_AGENT)
    const already = await db.ercotIngest.findUnique({ where: { fileSha256: sha256 } })
    if (already) {
      await db.ercotIngest.update({ where: { id: already.id }, data: { status: 'skipped', note: notes } })
      return NextResponse.json({ ok: true, status: 'skipped', sha256, headers })
    }
    const rec = await ingestLocalFile(tmpPath, sha256, notes)
    return NextResponse.json({ ok: true, status: rec.status, sha256, rows: rec.rowCount, headers })
  } catch (e: any) {
    const msg = e?.message || 'ERR'
    await db.ercotIngest.create({
      data: {
        status: 'error',
        error: msg.slice(0, 500),
        errorDetail: String(e?.stack || ''),
        note: 'fetch-latest',
      },
    })
    return NextResponse.json({ ok: false, error: 'INGEST_ERROR', detail: msg }, { status: 500 })
  }
}

