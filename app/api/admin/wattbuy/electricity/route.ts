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
  // Required: zip (5-digit)
  if (sp.get('zip')) q.zip = sp.get('zip')!.trim();
  // Optional: address, city, state
  if (sp.get('address')) q.address = sp.get('address')!;
  if (sp.get('city')) q.city = sp.get('city')!;
  if (sp.get('state')) q.state = sp.get('state')!.toLowerCase(); // API expects lowercase per test page
  // Optional: utility_eid (number)
  if (sp.get('utility_eid')) {
    const utilityEid = Number(sp.get('utility_eid')!);
    if (!isNaN(utilityEid)) q.utility_eid = utilityEid;
  }
  // Optional: wattkey
  if (sp.get('wattkey')) q.wattkey = sp.get('wattkey')!;
  // Pass through any other query params
  sp.forEach((v, k) => {
    if (k in q) return;
    if (['address','city','state','zip','utility_eid','wattkey'].includes(k)) return;
    (q as any)[k] = v;
  });
  try {
    const data = await fetchElectricityCatalog(q);
    await (prisma as any).rawWattbuyElectricity.create({
      data: {
        state: q.state ? q.state.toUpperCase() : null, // Store uppercase in DB
        utility: q.utility_eid ? String(q.utility_eid) : null, // Store utility_eid as string
        zip5: q.zip ?? null,
        upstreamStatus: 200,
        raw: data,
      },
    });
    // Extract useful metadata from response
    const hasEstimation = Boolean((data as any)?.estimation);
    const hasSolar = Boolean((data as any)?.solar);
    const hasCarbonFootprint = Boolean((data as any)?.carbon_footprint);
    const wattkey = (data as any)?.wattkey || null;
    const energyScore = (data as any)?.energy_score ?? null;
    const deregulated = (data as any)?.deregulated ?? null;
    
    return NextResponse.json({ 
      ok: true, 
      corrId, 
      query: q, 
      data,
      meta: {
        hasEstimation,
        hasSolar,
        hasCarbonFootprint,
        wattkey,
        energyScore,
        deregulated,
      }
    }, { status: 200 });
  } catch (err: any) {
    const status = typeof err?.status === 'number' ? err.status : 502;
    return NextResponse.json({ ok: false, corrId, error: status === 403 ? 'UPSTREAM_FORBIDDEN' : 'UPSTREAM_ERROR' }, { status });
  }
}

