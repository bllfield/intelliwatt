export const dynamic = 'force-dynamic';

export const runtime = 'nodejs';

import { NextRequest } from 'next/server';

import { wbGet } from '@/lib/wattbuy/client';

import { retailRatesParams } from '@/lib/wattbuy/params';

export async function GET(req: NextRequest) {
  if (req.headers.get('x-admin-token') !== process.env.ADMIN_TOKEN) {
    return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), { status: 401 });
  }

  const { searchParams } = new URL(req.url);

  const zip = searchParams.get('zip') || '75201';

  const params = retailRatesParams({ zip });

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
}

