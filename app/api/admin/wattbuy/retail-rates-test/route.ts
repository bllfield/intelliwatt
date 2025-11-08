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

  const utilityID = searchParams.get('utilityID'); // e.g., 44372 for Oncor

  const state = (searchParams.get('state') || 'tx').toLowerCase();

  const params = retailRatesParams({ utilityID: utilityID ?? undefined, state });

  const res = await wbGet('electricity/retail-rates', params);

  if (!res.ok) {
    return new Response(JSON.stringify({ ok: false, status: res.status, error: res.text }), { status: 502 });
  }

  return Response.json({ ok: true, where: params, count: Array.isArray(res.data) ? res.data.length : undefined, data: res.data });
}
