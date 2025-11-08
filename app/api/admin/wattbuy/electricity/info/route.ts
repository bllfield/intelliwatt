import { NextRequest, NextResponse } from 'next/server';
import { getCorrelationId } from '@/lib/correlation';
import { prisma } from '@/lib/db';
import { fetchElectricityInfo, type ElectricityInfoQuery } from '@/lib/wattbuy/client';

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
  const q: ElectricityInfoQuery = {};
  // Required: zip (5-digit)
  if (sp.get('zip')) q.zip = sp.get('zip')!.trim();
  // Optional: address, city, state
  if (sp.get('address')) q.address = sp.get('address')!;
  if (sp.get('city')) q.city = sp.get('city')!;
  if (sp.get('state')) q.state = sp.get('state')!.toLowerCase(); // API expects lowercase
  // Optional: housing_chars, utility_list
  if (sp.get('housing_chars')) {
    const val = sp.get('housing_chars')!;
    q.housing_chars = val === 'true' || val === '1' ? 'true' : val;
  }
  if (sp.get('utility_list')) {
    const val = sp.get('utility_list')!;
    q.utility_list = val === 'true' || val === '1' ? 'true' : val;
  }
  // Pass through any other query params
  sp.forEach((v, k) => {
    if (k in q) return;
    if (['address','city','state','zip','housing_chars','utility_list'].includes(k)) return;
    (q as any)[k] = v;
  });
  try {
    const data = await fetchElectricityInfo(q);
    await prisma.rawWattbuyElectricityInfo.create({
      data: {
        state: q.state ? q.state.toUpperCase() : null, // Store uppercase in DB
        zip5: q.zip ?? null,
        address: q.address ?? null,
        city: q.city ?? null,
        upstreamStatus: 200,
        raw: data,
      } as any,
    });
    // Extract useful metadata from response
    const esiid = (data as any)?.esiid || null;
    const exactMatch = (data as any)?.exact_match ?? null;
    const type = (data as any)?.type || null;
    const hasUtilityInfo = Boolean((data as any)?.utility_info?.length);
    const hasHousingChars = Boolean((data as any)?.housing_chars);
    const hasUtilityList = Boolean((data as any)?.utility_list?.length);
    const wattkey = (data as any)?.wattkey || null;
    
    return NextResponse.json({ 
      ok: true, 
      corrId, 
      query: q, 
      data,
      meta: {
        esiid,
        exactMatch,
        type,
        hasUtilityInfo,
        hasHousingChars,
        hasUtilityList,
        wattkey,
      }
    }, { status: 200 });
  } catch (err: any) {
    const status = typeof err?.status === 'number' ? err.status : 502;
    return NextResponse.json({ ok: false, corrId, error: status === 403 ? 'UPSTREAM_FORBIDDEN' : 'UPSTREAM_ERROR' }, { status });
  }
}

