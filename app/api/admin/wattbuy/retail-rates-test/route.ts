export const dynamic = 'force-dynamic';

export const runtime = 'nodejs';

import { NextRequest } from 'next/server';

import { wbGet } from '@/lib/wattbuy/client';

import { normalizeRetailRateParams } from '@/lib/wattbuy/params';

export async function GET(req: NextRequest) {
  if (req.headers.get('x-admin-token') !== process.env.ADMIN_TOKEN) {
    return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), { status: 401 });
  }

  const { searchParams } = new URL(req.url);

  const zip = searchParams.get('zip') || '75201';

  const state = (searchParams.get('state') || 'TX').toUpperCase();

  const utility_id = searchParams.get('utility_id') || undefined;

  const params = normalizeRetailRateParams({ zip, state, utility_id });

  const rr = await wbGet('electricity/retail-rates', params);

  return Response.json({
    ok: rr.ok,
    status: rr.status,
    where: params,
    sampleCount: Array.isArray(rr.data) ? rr.data.length : undefined,
    preview: Array.isArray(rr.data) ? rr.data.slice(0, 2) : rr.data,
    errorText: rr.text
  });
}

