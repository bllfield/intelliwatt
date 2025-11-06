// app/api/admin/address/resolve-esiid/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { lookupEsiId } from '@/lib/wattbuy/client';
import { getCorrelationId } from '@/lib/correlation';
import { requireAdmin } from '@/lib/auth/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const corrId = getCorrelationId(req.headers);
  const t0 = Date.now();

  const gate = requireAdmin(req);
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });

  try {
    const body = await req.json();
    const { line1, city, state, zip } = body || {};

    if (!line1 || !city || !state || !zip) {
      return NextResponse.json({ ok: false, corrId, error: 'MISSING_ADDRESS_FIELDS' }, { status: 400 });
    }

    const result = await lookupEsiId({ line1, city, state, zip });

    const durationMs = Date.now() - t0;
    console.log(
      JSON.stringify({
        corrId,
        route: 'admin/address/resolve-esiid',
        status: 200,
        durationMs,
        found: Boolean(result.esiid),
        utility: result.utility ?? null,
      })
    );
    return NextResponse.json({ ok: true, corrId, ...result }, { status: 200 });
  } catch (err: any) {
    const durationMs = Date.now() - t0;
    console.error(
      JSON.stringify({
        corrId,
        route: 'admin/address/resolve-esiid',
        status: 500,
        durationMs,
        errorClass: 'BUSINESS_LOGIC',
        message: err?.message,
      })
    );
    return NextResponse.json({ ok: false, corrId, error: 'ADDRESS_ESIID_RESOLVE_FAILED' }, { status: 500 });
  }
}

