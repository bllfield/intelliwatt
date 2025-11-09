import { NextRequest, NextResponse } from 'next/server';
import { getCorrelationId } from '@/lib/correlation';
import { prisma } from '@/lib/db';
import { wbGet } from '@/lib/wattbuy/client';
import { retailRatesParams } from '@/lib/wattbuy/params';
import { inspectRetailRatesPayload } from '@/lib/wattbuy/inspect';

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
  const q: RetailRatesQuery = {};
  // State must be lowercase per WattBuy test page
  if (sp.get('state')) q.state = sp.get('state')!.toLowerCase();
  // WattBuy API requires utilityID (camelCase, integer as string) per test page
  // Accept both utilityID and utility_id for backward compatibility
  const utilityIdParam = sp.get('utilityID') || sp.get('utility_id');
  if (utilityIdParam) {
    const utilityId = utilityIdParam;
    // Accept as string or number, convert to number for API
    q.utilityID = isNaN(Number(utilityId)) ? undefined : Number(utilityId);
  }
  if (sp.get('zip')) q.zip = sp.get('zip')!;
  if (sp.get('page')) q.page = Number(sp.get('page'));
  if (sp.get('page_size')) q.page_size = Number(sp.get('page_size'));
  sp.forEach((v, k) => {
    if (k in q) return;
    if (['state','utilityID','utility_id','zip','page','page_size'].includes(k)) return;
    (q as any)[k] = v;
  });
  try {
    // Build params using retailRatesParams helper
    const params = retailRatesParams({
      utilityID: q.utilityID ?? q.utility_id,
      state: q.state,
      zip: q.zip,
    });
    if (typeof q.page === 'number') params.page = q.page;
    if (typeof q.page_size === 'number') params.page_size = q.page_size;

    const res = await wbGet('electricity/retail-rates', params, undefined, 1);

    if (!res.ok) {
      return NextResponse.json({
        ok: false,
        corrId,
        status: res.status,
        headers: res.headers,
        where: params,
        error: res.text || 'Upstream non-OK without body',
      }, { status: 502 });
    }

    // Persist raw response to database
    await (prisma as any).rawWattbuyRetailRate.create({
      data: {
        state: q.state ?? null,
        utility: q.utilityID ? String(q.utilityID) : (q.utility_id ? String(q.utility_id) : null),
        zip5: q.zip ?? null,
        page: typeof q.page === 'number' ? q.page : null,
        pageSize: typeof q.page_size === 'number' ? q.page_size : null,
        upstreamStatus: res.status,
        raw: res.data,
      } as any,
    });

    const inspect = inspectRetailRatesPayload(res.data);

    return NextResponse.json({
      ok: true,
      corrId,
      status: res.status,
      query: q,
      where: params,
      headers: res.headers,
      topType: inspect.topType,
      topKeys: inspect.topKeys,
      foundListPath: inspect.foundListPath,
      count: inspect.count,
      sample: inspect.sample,
      note: inspect.message,
      rawTextPreview: res.text ? String(res.text).slice(0, 400) : undefined,
      data: res.data,
    }, { status: 200 });
  } catch (err: any) {
    const status = typeof err?.status === 'number' ? err.status : 502;
    return NextResponse.json({
      ok: false,
      corrId,
      status,
      error: status === 403 ? 'UPSTREAM_FORBIDDEN' : 'UPSTREAM_ERROR',
      message: err?.message || 'Unhandled exception',
    }, { status });
  }
}

