// app/api/offers/route.ts
// Step 41: Internal Offers Proxy (debug/ops-friendly)
// ---------------------------------------------------
// What it does
//   - Proxies to WattBuy /v3/offers with your server-side API key.
//   - Accepts either a full address (address, city, state, zip) or an esiid.
//   - Returns the raw WattBuy payload plus a slim "mini" view that's handy for QA.
//   - Light IP-based rate limiting to keep accidental spam in check.
//
// Why you want this
//   - Easier debugging (no CORS, no exposing your API key).
//   - Feeds admin tooling (you can fetch offers JSON directly from your app).
//
// Usage examples (GET):
//   /api/offers?address=8808%20Las%20Vegas%20Ct&city=White%20Settlement&state=TX&zip=76108
//   /api/offers?esiid=10443720004529147
//
// Env:
//   WATTBUY_API_KEY must be set.
//
// Notes:
//   - This endpoint is safe to call from the browser. The key never leaves the server.
//   - If you need POST for complex payloads, you can mirror the logic in a POST handler.

import { NextRequest, NextResponse } from 'next/server';
import { WattBuyClient } from '@/lib/wattbuy/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// naive in-memory limiter (per-process). OK for dev/preview; swap with Redis in prod.
const LIMIT_WINDOW_MS = 60_000; // 1 minute
const LIMIT_MAX = 60; // 60 req/min per IP
const buckets = new Map<
  string,
  { count: number; resetAt: number }
>();

export async function GET(req: NextRequest) {
  try {
    // --- rate limit
    const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'local';
    const bucket = buckets.get(ip);
    const now = Date.now();
    if (!bucket || now > bucket.resetAt) {
      buckets.set(ip, { count: 1, resetAt: now + LIMIT_WINDOW_MS });
    } else {
      if (bucket.count >= LIMIT_MAX) {
        const retrySec = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
        return NextResponse.json(
          { error: `Rate limit exceeded. Try again in ${retrySec}s.` },
          { status: 429, headers: { 'Retry-After': String(retrySec) } }
        );
      }
      bucket.count++;
    }

    // --- input
    const url = new URL(req.url);
    const address = (url.searchParams.get('address') || '').trim();
    const city = (url.searchParams.get('city') || '').trim();
    const state = (url.searchParams.get('state') || '').trim().toUpperCase();
    const zip = (url.searchParams.get('zip') || '').trim();
    const esiid = (url.searchParams.get('esiid') || '').trim();

    if (!process.env.WATTBUY_API_KEY) {
      return NextResponse.json(
        { error: 'WATTBUY_API_KEY not configured on server.' },
        { status: 500 }
      );
    }

    if (!esiid && !(address && city && state && zip)) {
      return NextResponse.json(
        {
          error:
            'Provide either esiid=<id> or address+city+state+zip (TX only).',
        },
        { status: 400 }
      );
    }
    if (state && state !== 'TX') {
      return NextResponse.json(
        { error: 'This proxy currently supports Texas (TX) only.' },
        { status: 400 }
      );
    }

    const wb = new WattBuyClient();

    // If only ESIID provided, we can call offers with esiid; otherwise use address fields
    const offersRes = esiid
      ? await wb.offersByEsiid({ esiid })
      : await wb.offersByAddress({ address, city, state, zip });

    const offers = Array.isArray(offersRes?.offers) ? offersRes.offers : [];

    // Build a slim "mini" for quick QA in the UI
    const mini = offers.map((o: any) => {
      const od = o?.offer_data || {};
      return {
        offer_id: o.offer_id,
        name: o.offer_name,
        supplier: od.supplier_name || od.supplier || null,
        tdsp: od.utility_name || od.utility || null,
        term: od.term ?? null,
        kwh500: numOrNull(od.kwh500),
        kwh1000: numOrNull(od.kwh1000),
        kwh2000: numOrNull(od.kwh2000),
        cost: numOrNull(o.cost), // effective ¢/kWh at the requested usage
        cancel_fee: od.cancel_notes || null,
        links: {
          efl: od.efl || null,
          tos: od.tos || null,
          yrac: od.yrac || null,
        },
      };
    });

    return NextResponse.json(
      {
        query: esiid
          ? { esiid }
          : { address, city, state, zip },
        count: offers.length,
        mini,
        raw: offersRes,
      },
      { status: 200 }
    );
  } catch (err: any) {
    const msg = (err?.message || 'Internal error').replace(
      /(Bearer\s+)?[A-Za-z0-9-_]{20,}/g,
      '***'
    );
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

function numOrNull(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
