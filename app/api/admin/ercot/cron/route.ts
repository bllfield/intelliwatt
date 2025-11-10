import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { resolveLatestFromPage } from '@/lib/ercot/resolve'
import { fetchToTmp } from '@/lib/ercot/fetch'
import { ingestLocalFile } from '@/lib/ercot/ingest'

function isCron(req: NextRequest) {
  // Vercel scheduled adds x-vercel-cron; allow ?token=CRON_SECRET for manual
  const v = req.headers.get('x-vercel-cron')
  if (v) return true
  const token = req.nextUrl.searchParams.get('token')
  if (process.env.CRON_SECRET && token === process.env.CRON_SECRET) return true
  // or header
  const h = req.headers.get('x-cron-secret')
  if (process.env.CRON_SECRET && h === process.env.CRON_SECRET) return true
  return false
}

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  if (!isCron(req)) {
    return NextResponse.json({ ok: false, error: 'UNAUTHORIZED' }, { status: 401 })
  }
  if (!process.env.ERCOT_PAGE_URL) {
    return NextResponse.json({ ok: false, error: 'MISSING_ERCOT_PAGE_URL' }, { status: 500 })
  }

  try {
    const { latest, candidates } = await resolveLatestFromPage(
      process.env.ERCOT_PAGE_URL,
      process.env.ERCOT_PAGE_FILTER || null,
      process.env.ERCOT_USER_AGENT
    )
    if (!latest) {
      await db.ercotIngest.create({
        data: { status: 'error', error: 'NO_CANDIDATES', note: 'cron' },
      })
      return NextResponse.json({ ok: false, error: 'NO_CANDIDATES', candidates }, { status: 500 })
    }

    const { tmpPath, sha256, headers } = await fetchToTmp(latest, process.env.ERCOT_USER_AGENT)

    const exists = await db.ercotIngest.findUnique({ where: { fileSha256: sha256 } })
    if (exists) {
      await db.ercotIngest.update({ where: { id: exists.id }, data: { status: 'skipped', note: 'cron' } })
      return NextResponse.json({ ok: true, status: 'skipped', sha256, latest, candidates, headers })
    }

    const rec = await ingestLocalFile(tmpPath, sha256, 'cron')
    await db.ercotIngest.update({
      where: { id: rec.id },
      data: { fileUrl: latest, headers },
    })
    return NextResponse.json({ ok: true, status: rec.status, sha256, rows: rec.rowCount, latest, candidates })
  } catch (e: any) {
    const msg = e?.message || 'ERR'
    await db.ercotIngest.create({
      data: { status: 'error', error: msg.slice(0, 500), errorDetail: String(e?.stack || ''), note: 'cron' },
    })
    return NextResponse.json({ ok: false, error: 'CRON_ERROR', detail: msg }, { status: 500 })
  }
}
