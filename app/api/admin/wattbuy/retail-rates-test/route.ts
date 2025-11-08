export const dynamic = 'force-dynamic';

export const runtime = 'nodejs';

import { NextRequest } from 'next/server';

import { wbGet } from '@/lib/wattbuy/client';

import { retailRatesParams } from '@/lib/wattbuy/params';

import { deriveUtilityFromAddress } from '@/lib/wattbuy/derive';

export async function GET(req: NextRequest) {
  if (req.headers.get('x-admin-token') !== process.env.ADMIN_TOKEN) {
    return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), { status: 401 });
  }

  const { searchParams } = new URL(req.url);

  let utilityID = searchParams.get('utilityID') || undefined;
  let state = (searchParams.get('state') || '').toLowerCase() || undefined;

  // Optionally allow address to auto-derive utilityID/state if not provided
  const address = searchParams.get('address') || undefined;
  const city = searchParams.get('city') || undefined;
  const zip = searchParams.get('zip') || undefined;
  const maybeDerive = !utilityID || !state;

  try {
    if (maybeDerive) {
      if (!zip) {
        return new Response(JSON.stringify({
          ok: false,
          error: 'utilityID+state required OR provide address/city/state/zip to derive utilityID',
          example: '/api/admin/wattbuy/retail-rates-test?utilityID=44372&state=tx  OR  ?address=...&city=...&state=tx&zip=75201'
        }), { status: 400 });
      }

      const derived = await deriveUtilityFromAddress({ address, city, state, zip });
      if (!derived) {
        return new Response(JSON.stringify({
          ok: false,
          error: 'Unable to derive utilityID from address; please provide utilityID+state explicitly',
          where: { address, city, state, zip }
        }), { status: 422 });
      }

      utilityID = derived.utilityID;
      state = derived.state;
    }

    // Build params and call retail-rates
    const params = retailRatesParams({ utilityID, state });

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

    return Response.json({
      ok: true,
      where: params,
      headers: res.headers,
      count: Array.isArray(res.data) ? res.data.length : undefined,
      sample: Array.isArray(res.data) ? res.data.slice(0, 3) : res.data
    });
  } catch (e: any) {
    return new Response(JSON.stringify({
      ok: false,
      status: 500,
      error: e?.message || 'Unhandled exception',
      where: { utilityID, state, address, city, zip }
    }), { status: 500 });
  }
}
