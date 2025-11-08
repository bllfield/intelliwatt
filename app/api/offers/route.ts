// app/api/offers/route.ts
// Internal WattBuy offers proxy — address/zip only (no ESIID). TX-only.
//
// - Proxies to WattBuy /v3/offers with server-side API key.
// - Accepts zip5 (or zip) + optional line1/city/state/tdsp.
// - Returns raw payload plus mini view for QA.
// - Light in-memory rate limit per IP.
//
// Env:
//   WATTBUY_API_KEY must be set.

import { NextRequest, NextResponse } from 'next/server';
import { getCorrelationId } from '@/lib/correlation';
import { getOffersForAddress, type OfferAddressInput } from '@/lib/wattbuy/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// naive in-memory limiter (per-process). OK for dev/preview; swap with Redis in prod.
const LIMIT_WINDOW_MS = 60_000; // 1 minute
const LIMIT_MAX = 60; // 60 req/min per IP
const buckets = new Map<string, { count: number; resetAt: number }>();

function numOrNull(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function GET(req: NextRequest) {
  const corrId = getCorrelationId(req.headers);
  const startedAt = Date.now();
  try {
    // --- rate limit
    const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'local';
    const now = Date.now();
    const bucket = buckets.get(ip) || { count: 0, resetAt: now + LIMIT_WINDOW_MS };
    if (now > bucket.resetAt) {
      bucket.count = 0;
      bucket.resetAt = now + LIMIT_WINDOW_MS;
    }
    if (bucket.count >= LIMIT_MAX) {
      const retrySec = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      return NextResponse.json(
        { ok: false, corrId, error: 'RATE_LIMIT', retryAfterSec: retrySec },
        { status: 429, headers: { 'Retry-After': String(retrySec) } }
      );
    }
    bucket.count++;
    buckets.set(ip, bucket);

    // --- input
    const url = new URL(req.url);
    const zip5 = (url.searchParams.get('zip5') || url.searchParams.get('zip') || '').trim();
    const line1 = (url.searchParams.get('line1') || url.searchParams.get('address') || '').trim();
    const city = (url.searchParams.get('city') || '').trim();
    const state = (url.searchParams.get('state') || '').trim().toUpperCase();
    const tdsp = (url.searchParams.get('tdsp') || url.searchParams.get('utility') || '').trim();

    if (!process.env.WATTBUY_API_KEY) {
      return NextResponse.json(
        { ok: false, corrId, error: 'SERVER_MISCONFIG', message: 'WATTBUY_API_KEY not configured on server.' },
        { status: 500 }
      );
    }

    if (!zip5) {
      return NextResponse.json(
        { ok: false, corrId, error: 'MISSING_ZIP5', message: 'Provide zip5 (or zip) parameter.' },
        { status: 400 }
      );
    }
    if (state && state !== 'TX' && state !== '') {
      return NextResponse.json(
        { ok: false, corrId, error: 'UNSUPPORTED_STATE', message: 'This proxy currently supports Texas (TX) only.' },
        { status: 400 }
      );
    }

    const input: OfferAddressInput = {
      zip: zip5,
      line1: line1 || undefined,
      city: city || undefined,
      state: state || undefined,
      tdsp: tdsp || undefined,
    };

    const offersRes = await getOffersForAddress(input);
    const offers = Array.isArray(offersRes?.offers) ? offersRes.offers : [];

    const mini = offers.map((o: any) => {
      const od = o?.offer_data || {};
      return {
        name: o?.offer || null,
        term_months: od.term || null,
        utility: od.utility || null,
        plan_type: od.plan_type || null,
        base_fee: numOrNull(od.base_fee),
        kwh500: numOrNull(od.kwh500),
        kwh1000: numOrNull(od.kwh1000),
        kwh2000: numOrNull(od.kwh2000),
        cost: numOrNull(o.cost),
        cancel_fee: od.cancel_notes || null,
        links: {
          efl: od.efl || null,
          tos: od.tos || null,
          yrac: od.your_rights || null,
          signup: od.signup_url || null,
        },
      };
    });

    const durationMs = Date.now() - startedAt;
    console.log(JSON.stringify({
      corrId,
      route: 'offers',
      status: 200,
      durationMs,
      upstreamStatus: 200,
      count: offers.length,
      query: { zip5, hasLine1: Boolean(line1), hasCity: Boolean(city), tdsp: tdsp || null },
    }));

    return NextResponse.json(
      {
        ok: true,
        corrId,
        query: {
          zip5,
          address: line1 || null,
          city: city || null,
          state: state || 'TX',
          tdsp: tdsp || null,
        },
        count: offers.length,
        mini,
        raw: offersRes,
      },
      { status: 200 }
    );
  } catch (err: any) {
    const durationMs = Date.now() - startedAt;
    const upstreamStatus = typeof err?.status === 'number' ? err.status : null;
    const sanitizedMessage = typeof err?.message === 'string'
      ? err.message.replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer ***')
      : 'Upstream request failed';

    console.error(JSON.stringify({
      corrId,
      route: 'offers',
      status: upstreamStatus ?? 500,
      durationMs,
      errorClass: upstreamStatus === 403 ? 'UPSTREAM_FORBIDDEN' : 'UPSTREAM_ERROR',
      message: sanitizedMessage.slice(0, 200),
    }));

    if (upstreamStatus === 403) {
      return NextResponse.json(
        { ok: false, corrId, error: 'UPSTREAM_FORBIDDEN', hint: 'WattBuy returned 403. Verify API key scope or plan coverage for the given ZIP.' },
        { status: 403 }
      );
    }
    const status = upstreamStatus && upstreamStatus >= 400 && upstreamStatus < 600 ? upstreamStatus : 502;
    const errorCode = status >= 500 ? 'UPSTREAM_ERROR' : 'UPSTREAM_BAD_REQUEST';
    return NextResponse.json({ ok: false, corrId, error: errorCode, status }, { status });
  }
}
