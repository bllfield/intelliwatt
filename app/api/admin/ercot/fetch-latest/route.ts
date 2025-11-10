import { NextRequest, NextResponse } from 'next/server';
import { fetchToTmp } from '@/lib/ercot/fetch';
import { ingestLocalFile } from '@/lib/ercot/ingest';

export const dynamic = 'force-dynamic';

function requireAdmin(req: NextRequest) {
  const token = req.headers.get('x-admin-token') || '';
  if (!process.env.ADMIN_TOKEN || token !== process.env.ADMIN_TOKEN) throw new Error('UNAUTHORIZED');
}

export async function GET(req: NextRequest) {
  try {
    requireAdmin(req);
    const url = req.nextUrl.searchParams.get('url') || process.env.ERCOT_TEST_URL;
    if (!url) return NextResponse.json({ ok: false, error: 'MISSING_URL' }, { status: 400 });

    const { tmpPath, sha, headers } = await fetchToTmp(url);
    const tdspHint = /AEP/i.test(url) ? 'AEP' : /ONCOR/i.test(url) ? 'ONCOR' : /CENTERPOINT/i.test(url) ? 'CENTERPOINT' : undefined;
    const result = await ingestLocalFile(tmpPath, sha, url, tdspHint);
    return NextResponse.json({ ok: true, url, sha, headers, result });
  } catch (err: any) {
    const msg = err?.message || String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: msg === 'UNAUTHORIZED' ? 401 : 500 });
  }
}

