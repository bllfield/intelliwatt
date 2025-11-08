import { NextRequest, NextResponse } from 'next/server';
import { getCorrelationId } from '@/lib/correlation';
import { prisma } from '@/lib/db';
import { fetchElectricityCatalog, type ElectricityCatalogQuery } from '@/lib/wattbuy/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function guard(req: NextRequest) {
  const expected = process.env.ADMIN_TOKEN || '';
  const token = req.headers.get('x-admin-token') || '';
  if (!expected || token !== expected) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  return null;
}

export async function GET(req: NextRequest) {
  const auth = guard(req);
  if (auth) return auth;
  const corrId = getCorrelationId(req.headers);
  const sp = req.nextUrl.searchParams;
  const q: ElectricityCatalogQuery = {};
  if (sp.get('state')) q.state = sp.get('state')!.toUpperCase();
  if (sp.get('utility')) q.utility = sp.get('utility')!;
  if (sp.get('zip')) q.zip = sp.get('zip')!;
  sp.forEach((v, k) => {
    if (k in q) return;
    if (['state','utility','zip'].includes(k)) return;
    (q as any)[k] = v;
  });
  try {
    const data = await fetchElectricityCatalog(q);
    await prisma.rawWattbuyElectricity.create({
      data: {
        state: q.state ?? null,
        utility: q.utility ?? null,
        zip5: q.zip ?? null,
        upstreamStatus: 200,
        raw: data,
      } as any,
    });
    return NextResponse.json({ ok: true, corrId, query: q, data }, { status: 200 });
  } catch (err: any) {
    const status = typeof err?.status === 'number' ? err.status : 502;
    return NextResponse.json({ ok: false, corrId, error: status === 403 ? 'UPSTREAM_FORBIDDEN' : 'UPSTREAM_ERROR' }, { status });
  }
}

