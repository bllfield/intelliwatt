import { NextRequest, NextResponse } from 'next/server';
import { resolveLatestFromPage } from '@/lib/ercot/resolve';
import { fetchToTmp } from '@/lib/ercot/fetch';
import { ingestLocalFile } from '@/lib/ercot/ingest';
import { prisma } from '@/lib/db';

export const dynamic = 'force-dynamic';

function allowCron(req: NextRequest) {
  // Accept either x-cron-secret header or ?token=
  const headerToken = req.headers.get('x-cron-secret') || '';
  const qsToken = req.nextUrl.searchParams.get('token') || '';
  if (process.env.CRON_SECRET && (headerToken === process.env.CRON_SECRET || qsToken === process.env.CRON_SECRET)) return true;
  // Also accept Vercel managed cron (optional)
  if (req.headers.get('x-vercel-cron') === '1') return true;
  return false;
}

export async function GET(req: NextRequest) {
  if (!allowCron(req)) {
    return NextResponse.json({ ok: false, error: 'UNAUTHORIZED' }, { status: 401 });
  }

  const pageUrl = process.env.ERCOT_PAGE_URL;
  if (!pageUrl) return NextResponse.json({ ok: false, error: 'MISSING_ERCOT_PAGE_URL' }, { status: 500 });

  let candidates: string[] = [];
  let resolveError: string | undefined;
  try {
    candidates = await resolveLatestFromPage(pageUrl);
  } catch (e: any) {
    resolveError = e?.message || String(e);
    await prisma.ercotIngest.create({ 
      data: { 
        status: 'error', 
        note: 'cron', 
        fileUrl: pageUrl, 
        fileSha256: null,
        error: 'RESOLVE_ERROR',
        errorDetail: resolveError
      } 
    });
    return NextResponse.json({ 
      ok: false, 
      status: 'error', 
      reason: 'RESOLVE_ERROR', 
      error: resolveError,
      pageUrl 
    }, { status: 500 });
  }
  
  if (!candidates?.length) {
    await prisma.ercotIngest.create({ 
      data: { 
        status: 'error', 
        note: 'cron', 
        fileUrl: pageUrl, 
        fileSha256: null,
        error: 'NO_CANDIDATES',
        errorDetail: `No matching links found on page. Check ERCOT_PAGE_FILTER (current: ${process.env.ERCOT_PAGE_FILTER || 'TDSP'})`
      } 
    });
    return NextResponse.json({ 
      ok: true, 
      status: 'skipped', 
      reason: 'NO_CANDIDATES', 
      pageUrl,
      hint: `No links found matching filter. Check ERCOT_PAGE_FILTER env var (current: ${process.env.ERCOT_PAGE_FILTER || 'TDSP'})`
    });
  }

  // Absolute-ize relative links and try most recent candidate first
  const base = new URL(pageUrl);
  const absolute = candidates.map(href => {
    try {
      return new URL(href, base).toString();
    } catch {
      return href;
    }
  });

  const tried: any[] = [];
  for (let i = absolute.length - 1; i >= 0; i--) {
    const url = absolute[i];
    try {
      const { tmpPath, sha, headers } = await fetchToTmp(url);

      // Idempotence: skip if this sha already ingested
      const exists = await prisma.ercotIngest.findFirst({ where: { fileSha256: sha } });
      if (exists) {
        await prisma.ercotIngest.create({ data: { status: 'skipped', note: 'DUPLICATE', fileUrl: url, fileSha256: sha, headers } as any });
        tried.push({ url, sha, status: 'skipped-duplicate' });
        continue;
      }

      const tdspHint = /AEP/i.test(url) ? 'AEP' : /ONCOR/i.test(url) ? 'ONCOR' : /CENTERPOINT/i.test(url) ? 'CENTERPOINT' : undefined;
      const result = await ingestLocalFile(tmpPath, sha, url, tdspHint);
      return NextResponse.json({ ok: true, pageUrl, used: url, sha, result, tried });
    } catch (e: any) {
      tried.push({ url, error: e?.message?.slice(0, 200) || String(e).slice(0, 200) });
      continue;
    }
  }

  return NextResponse.json({ ok: false, error: 'ALL_CANDIDATES_FAILED', pageUrl, tried }, { status: 502 });
}
