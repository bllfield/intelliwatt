export const dynamic = 'force-dynamic';

export const runtime = 'nodejs';

import { NextRequest } from 'next/server';

import { wbGet } from '@/lib/wattbuy/client';

import { retailRatesParams } from '@/lib/wattbuy/params';

import { deriveUtilityFromAddress } from '@/lib/wattbuy/derive';

import { inspectRetailRatesPayload } from '@/lib/wattbuy/inspect';

type Tried = { utilityID: string; utilityName?: string; status?: number; count?: number }[];

export async function GET(req: NextRequest) {
  if (req.headers.get('x-admin-token') !== process.env.ADMIN_TOKEN) {
    return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), { status: 401 });
  }

  const { searchParams } = new URL(req.url);

  const address = searchParams.get('address') || undefined;
  const city = searchParams.get('city') || undefined;
  const state = (searchParams.get('state') || '').toLowerCase() || undefined;
  const zip = searchParams.get('zip') || undefined;

  if (!zip) {
    return new Response(JSON.stringify({ ok: false, error: 'zip required' }), { status: 400 });
  }

  const derived = await deriveUtilityFromAddress({ address, city, state, zip });
  if (!derived || !derived.utilityID) {
    return new Response(JSON.stringify({
      ok: false,
      error: 'Unable to derive utilityID from address. Provide utilityID+state directly.',
      where: { address, city, state, zip }
    }), { status: 422 });
  }

  // 1) Try primary derived utility first
  const tried: Tried = [];
  let primaryParams = retailRatesParams({ utilityID: derived.utilityID, state: derived.state });
  let res = await wbGet('electricity/retail-rates', primaryParams, undefined, 1);
  let inspect = inspectRetailRatesPayload(res.data);
  tried.push({ utilityID: derived.utilityID, status: res.status, count: inspect.count });

  // 2) If 204/empty, try alternates from utility_list (deregulated first)
  if (res.status === 204 || inspect.count === 0) {
    const list = (derived.utilityList || []).filter(u => u?.type === 'deregulated' && u?.utility_eid);
    for (const u of list) {
      const altID = String(u.utility_eid);
      if (altID === derived.utilityID) continue;

      const altParams = retailRatesParams({ utilityID: altID, state: derived.state });
      const rr = await wbGet('electricity/retail-rates', altParams, undefined, 1);
      const insp = inspectRetailRatesPayload(rr.data);
      tried.push({ utilityID: altID, utilityName: u.utility_name, status: rr.status, count: insp.count });

      if (rr.ok && rr.status !== 204 && insp.count > 0) {
        // Return the first non-empty success
        return Response.json({
          ok: true,
          status: rr.status,
          where: altParams,
          headers: rr.headers,
          tried,
          topType: insp.topType,
          topKeys: insp.topKeys,
          foundListPath: insp.foundListPath,
          count: insp.count,
          sample: insp.sample,
          note: insp.message,
        });
      }
    }
  }

  // Default: return the primary result (even if empty) along with 'tried'
  return Response.json({
    ok: res.ok,
    status: res.status,
    where: primaryParams,
    headers: res.headers,
    tried,
    topType: inspect.topType,
    topKeys: inspect.topKeys,
    foundListPath: inspect.foundListPath,
    count: inspect.count,
    sample: inspect.sample,
    note: inspect.message || (res.status === 204 ? 'No content for this utility/state' : undefined),
  });
}
