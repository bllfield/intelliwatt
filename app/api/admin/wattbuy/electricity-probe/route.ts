export const dynamic = 'force-dynamic';

export const runtime = 'nodejs';

import { NextRequest } from 'next/server';
import { getElectricityRobust } from '@/lib/wattbuy/electricity';

export async function GET(req: NextRequest) {
  if (req.headers.get('x-admin-token') !== process.env.ADMIN_TOKEN) {
    return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const address = searchParams.get('address') || undefined;
  const city = searchParams.get('city') || undefined;
  const state = searchParams.get('state') || undefined;
  const zip = searchParams.get('zip') || undefined;

  if (!zip) {
    return new Response(JSON.stringify({ ok: false, error: 'zip required' }), { status: 400 });
  }

  const out = await getElectricityRobust({ address, city, state, zip: zip! });

  if (!out.ok) {
    return new Response(JSON.stringify({
      ok: false,
      status: out.status,
      headers: out.headers,
      error: out.text || 'UPSTREAM_ERROR',
      where: { address, city, state, zip },
    }), { status: 502 });
  }

  // Summarize shape for inspector-style visibility
  const d = out.data;
  const topType = d == null ? String(d) : Array.isArray(d) ? 'array' : typeof d;
  const keys = d && typeof d === 'object' ? Object.keys(d).slice(0, 20) : undefined;

  return Response.json({
    ok: true,
    status: out.status,
    headers: out.headers,
    where: { address, city, state, zip },
    shape: { topType, keys },
    usedWattkey: Boolean(d?.__used_wattkey),
    data: d,
  });
}

