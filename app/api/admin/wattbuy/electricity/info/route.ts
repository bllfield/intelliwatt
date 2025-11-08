export const dynamic = 'force-dynamic';

export const runtime = 'nodejs';

import { NextRequest } from 'next/server';

import { wbGet } from '@/lib/wattbuy/client';

import { electricityInfoParams } from '@/lib/wattbuy/params';

export async function GET(req: NextRequest) {
  if (req.headers.get('x-admin-token') !== process.env.ADMIN_TOKEN) {
    return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), { status: 401 });
  }

  const { searchParams } = new URL(req.url);

  const address = searchParams.get('address') || undefined;

  const city = searchParams.get('city') || undefined;

  const state = (searchParams.get('state') || 'tx').toLowerCase();

  const zip = searchParams.get('zip');

  const housing_chars = searchParams.get('housing_chars') ?? 'true';

  const utility_list = searchParams.get('utility_list') ?? 'true';

  if (!zip) return new Response(JSON.stringify({ ok: false, error: 'zip required' }), { status: 400 });

  const params = electricityInfoParams({ address, city, state, zip, housing_chars, utility_list });

  const res = await wbGet('electricity/info', params);

  if (!res.ok) {
    return new Response(JSON.stringify({ ok: false, status: res.status, error: res.text }), { status: 502 });
  }

  return Response.json({ ok: true, where: params, data: res.data });
}
