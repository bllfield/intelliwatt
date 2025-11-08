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
  if (!derived) {
    return new Response(JSON.stringify({
      ok: false,
      error: 'Unable to derive utilityID from address. Provide utilityID+state directly.',
      where: { address, city, state, zip }
    }), { status: 422 });
  }

  const params = retailRatesParams({ utilityID: derived.utilityID, state: derived.state });
  const res = await wbGet('electricity/retail-rates', params, undefined, 1);

  if (!res.ok) {
    return new Response(JSON.stringify({
      ok: false,
      status: res.status,
      error: res.text,
      headers: res.headers,
      where: params
    }), { status: 502 });
  }

  const inspect = inspectRetailRatesPayload(res.data);

  return Response.json({
    ok: true,
    where: params,
    headers: res.headers,
    topType: inspect.topType,
    topKeys: inspect.topKeys,
    foundListPath: inspect.foundListPath,
    count: inspect.count,
    sample: inspect.sample,
    note: inspect.message,
  });
}

