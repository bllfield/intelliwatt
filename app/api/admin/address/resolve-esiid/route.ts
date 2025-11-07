// app/api/admin/address/resolve-esiid/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { lookupEsiId } from '@/lib/wattbuy/client';
import { getCorrelationId } from '@/lib/correlation';
import { requireAdmin } from '@/lib/auth/admin';
import { wattbuyEsiidDisabled } from '@/lib/flags';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const corrId = getCorrelationId(req.headers);
  const t0 = Date.now();

  const gate = requireAdmin(req);
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });

  if (wattbuyEsiidDisabled) {
    return NextResponse.json(
      {
        ok: false,
        corrId,
        error: 'DEPRECATED_WATTBUY_ESIID',
        message: 'WattBuy-based ESIID lookup is retired. Use ERCOT-derived ESIID data.',
      },
      { status: 410 }
    );
  }

  try {
    const body = await req.json();
    const { line1, city, state, zip } = body || {};

    if (!line1 || !city || !state || !zip) {
      return NextResponse.json({ ok: false, corrId, error: 'MISSING_ADDRESS_FIELDS' }, { status: 400 });
    }

    const result = await lookupEsiId({ line1, city, state, zip });

    const durationMs = Date.now() - t0;
    
    // The improved lookupEsiId returns structured results
    if (result.esiid) {
      console.log(
        JSON.stringify({
          corrId,
          route: 'admin/address/resolve-esiid',
          status: 200,
          durationMs,
          found: true,
          utility: result.utility ?? null,
        })
      );
      return NextResponse.json({ ok: true, corrId, ...result }, { status: 200 });
    } else {
      // No ESIID found - log detailed error info for debugging
      const errorDetails = result.raw?.errors || [];
      console.error(
        JSON.stringify({
          corrId,
          route: 'admin/address/resolve-esiid',
          status: 500,
          durationMs,
          found: false,
          attempts: result.raw?.attempts || 0,
          errors: errorDetails,
          address: { line1, city, state, zip },
        })
      );
      return NextResponse.json({ 
        ok: false, 
        corrId, 
        error: 'ADDRESS_ESIID_RESOLVE_FAILED',
        message: `No ESIID found after ${result.raw?.attempts || 0} attempts`,
        attempts: result.raw?.attempts,
        errors: errorDetails,
        raw: result.raw,
      }, { status: 500 });
    }
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
        stack: err?.stack?.split('\n').slice(0, 3).join('\n'),
      })
    );
    return NextResponse.json({ 
      ok: false, 
      corrId, 
      error: 'ADDRESS_ESIID_RESOLVE_FAILED',
      message: err?.message 
    }, { status: 500 });
  }
}

