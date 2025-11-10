export const dynamic = 'force-dynamic';

export const runtime = 'nodejs';

import { NextRequest } from 'next/server';

import { wbGet } from '@/lib/wattbuy/client';

import { retailRatesParams } from '@/lib/wattbuy/params';

import { deriveUtilityFromAddress } from '@/lib/wattbuy/derive';

import { inspectRetailRatesPayload } from '@/lib/wattbuy/inspect';

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

  // Build list of utilities to try: primary first, then alternates from utilityList
  const utilitiesToTry: Array<{ utilityID: string; utilityName?: string }> = [];
  
  // Add primary utility first
  utilitiesToTry.push({ utilityID: derived.utilityID });

  // Extract deregulated utilities from utilityList, prioritizing AEP Central
  const utilityList = derived.utilityList || [];
  const hardCodes: Record<string, string> = {
    'AEP Central': '3278',
    'AEP North': '20404',
    'Oncor Electric Delivery': '44372',
    'Oncor': '44372',
    'CenterPoint': '8901',
    'Texas New Mexico Power': '40051',
  };

  // Priority: AEP Central first, then other deregulated
  const priorityUtilities = ['AEP Central', 'AEP North'];
  const addedIds = new Set([derived.utilityID]);

  // Add priority utilities first
  for (const u of utilityList) {
    if (u.type === 'deregulated' && priorityUtilities.includes(u.utility_name || '')) {
      const utilityID = u.utility_eid ? String(u.utility_eid) : (hardCodes[u.utility_name || ''] || null);
      if (utilityID && !addedIds.has(utilityID)) {
        utilitiesToTry.push({ utilityID, utilityName: u.utility_name });
        addedIds.add(utilityID);
      }
    }
  }

  // Add other deregulated utilities
  for (const u of utilityList) {
    if (u.type === 'deregulated' && u.utility_eid && !addedIds.has(String(u.utility_eid))) {
      utilitiesToTry.push({ utilityID: String(u.utility_eid), utilityName: u.utility_name });
      addedIds.add(String(u.utility_eid));
    }
  }

  // Try each utility in order until we get a successful response with data
  const tried: Array<{ utilityID: string; utilityName?: string; status: number; count?: number }> = [];
  let lastRes: any = null;
  let lastParams: Record<string, string> | null = null;

  for (const util of utilitiesToTry) {
    const params = retailRatesParams({ utilityID: util.utilityID, state: derived.state });
    const res = await wbGet('electricity/retail-rates', params, undefined, 1);

    const inspect = inspectRetailRatesPayload(res.data);
    const count = inspect.count ?? 0;

    tried.push({
      utilityID: util.utilityID,
      utilityName: util.utilityName,
      status: res.status,
      count,
    });

    // If we got a successful response (200) with data, use it
    if (res.ok && res.status === 200 && count > 0) {
      return Response.json({
        ok: true,
        status: res.status,
        where: params,
        headers: res.headers,
        topType: inspect.topType,
        topKeys: inspect.topKeys,
        foundListPath: inspect.foundListPath,
        count: inspect.count,
        sample: inspect.sample,
        note: inspect.message,
        rawTextPreview: res.text ? String(res.text).slice(0, 400) : undefined,
        tried,
      });
    }

    // Keep the last response in case all utilities fail
    lastRes = res;
    lastParams = params;
  }

  // If we get here, all utilities were tried but none returned data
  // Return the last response (which might be 204 or error)
  if (!lastRes || !lastRes.ok) {
    return new Response(JSON.stringify({
      ok: false,
      status: lastRes?.status || 502,
      headers: lastRes?.headers,
      where: lastParams,
      error: lastRes?.text || 'Upstream non-OK without body',
      tried,
    }), { status: 502 });
  }

  // Last response was OK but had no data (e.g., 204)
  const inspect = inspectRetailRatesPayload(lastRes.data);
  return Response.json({
    ok: true,
    status: lastRes.status,
    where: lastParams,
    headers: lastRes.headers,
    topType: inspect.topType,
    topKeys: inspect.topKeys,
    foundListPath: inspect.foundListPath,
    count: inspect.count,
    sample: inspect.sample,
    note: inspect.message,
    rawTextPreview: lastRes.text ? String(lastRes.text).slice(0, 400) : undefined,
    tried,
  });
}

