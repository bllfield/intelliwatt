import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth/admin';
import { getCorrelationId } from '@/lib/correlation';
import { getOffersForAddress, type OfferAddressInput } from '@/lib/wattbuy/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ProbeBody = {
  line1?: string;
  city?: string;
  state?: string;
  zip5?: string;
  zip?: string;
  tdsp?: string;
};

function cleanString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : undefined;
}

export async function POST(req: NextRequest) {
  const corrId = getCorrelationId(req.headers);
  const startedAt = Date.now();

  const gate = requireAdmin(req);
  if (!gate.ok) return NextResponse.json(gate.body, { status: gate.status });

  try {
    const body = (await req.json().catch(() => ({}))) as ProbeBody;
    const zipRaw = cleanString(body.zip5 ?? body.zip);
    const line1 = cleanString(body.line1);
    const city = cleanString(body.city);
    const state = cleanString(body.state)?.toLowerCase();
    const tdsp = cleanString(body.tdsp)?.toLowerCase();

    if (!zipRaw) {
      return NextResponse.json(
        { ok: false, corrId, error: 'MISSING_ZIP5', message: 'Provide zip5 or zip in request body.' },
        { status: 400 }
      );
    }
    if (state && state !== 'TX') {
      return NextResponse.json(
        { ok: false, corrId, error: 'UNSUPPORTED_STATE', message: 'Only Texas (TX) is supported for WattBuy offers.' },
        { status: 400 }
      );
    }

    const input: OfferAddressInput = { zip: zipRaw, line1, city, state, tdsp };

    const upstreamStarted = Date.now();
    try {
      const upstream = await getOffersForAddress(input);
      const tookMs = Date.now() - upstreamStarted;
      const count = Array.isArray(upstream?.offers) ? upstream.offers.length : 0;

      console.log(JSON.stringify({
        corrId,
        route: 'admin/wattbuy/probe-offers',
        status: 200,
        durationMs: Date.now() - startedAt,
        upstreamStatus: 200,
        query: { zip5: zipRaw, hasLine1: Boolean(line1), hasCity: Boolean(city), tdsp: tdsp || null },
        count,
      }));

      return NextResponse.json(
        {
          ok: true,
          corrId,
          upstream: { status: 200, tookMs, count },
          query: { zip5: zipRaw, hasLine1: Boolean(line1), hasCity: Boolean(city), tdsp: tdsp || null },
        },
        { status: 200 }
      );
    } catch (err: any) {
      const upstreamStatus = typeof err?.status === 'number' ? err.status : 500;
      const durationMs = Date.now() - startedAt;

      console.error(JSON.stringify({
        corrId,
        route: 'admin/wattbuy/probe-offers',
        status: upstreamStatus,
        durationMs,
        errorClass: upstreamStatus === 403 ? 'UPSTREAM_FORBIDDEN' : 'UPSTREAM_ERROR',
      }));

      const hint = upstreamStatus === 403 ? 'Likely API key scope, origin allow-list, or plan coverage issue.' : undefined;
      return NextResponse.json(
        { ok: false, corrId, error: upstreamStatus === 403 ? 'UPSTREAM_FORBIDDEN' : 'UPSTREAM_ERROR', status: upstreamStatus, hint },
        { status: upstreamStatus }
      );
    }
  } catch (err: any) {
    const durationMs = Date.now() - startedAt;
    console.error(JSON.stringify({
      corrId,
      route: 'admin/wattbuy/probe-offers',
      status: 500,
      durationMs,
      errorClass: 'BUSINESS_LOGIC',
      message: typeof err?.message === 'string' ? err.message.slice(0, 200) : 'JSON_PARSE',
    }));
    return NextResponse.json({ ok: false, corrId, error: 'PROBE_FAILED' }, { status: 500 });
  }
}

