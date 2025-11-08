// app/api/retail-rates/route.ts
// Step 43: Internal proxy for WattBuy Retail Rate Database (/v3/electricity/retail-rates)
// --------------------------------------------------------------------------------------
// What it does
//   - Server-side proxy to WattBuy Retail Rate DB (tariffs + component rates)
//   - Accepts either utility_id=<EIA id> or tdsp=<oncor|centerpoint|aep_n|aep_c|tnmp>, plus state=TX
//   - Optional verified_from (epoch seconds or ISO); optional page (default 1)
//   - Keeps your API key on the server; adds a tiny rate limiter
//
// Why
//   - Lets us evaluate whether Retail Rate DB can replace (or complement) nightly EFL parsing.
//   - Enables building a parser/normalizer on top of a stable internal endpoint.
//
// Usage examples:
//   /api/retail-rates?tdsp=oncor&state=TX
//   /api/retail-rates?utility_id=44372&state=TX&page=2
//   /api/retail-rates?tdsp=centerpoint&state=TX&verified_from=2024-01-01
//
// Env:
//   WATTBUY_API_KEY must be set on the server.

import { NextRequest, NextResponse } from 'next/server';
import { wbGet } from '@/lib/wattbuy/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Minimal per-IP limiter (dev-friendly). Replace with Redis for prod.
const LIMIT_WINDOW_MS = 60_000;
const LIMIT_MAX = 60;
const buckets = new Map<string, { count: number; resetAt: number }>();

// EIA utility IDs for TX TDSPs (from your provided utility list)
// - oncor: 44372
// - centerpoint (CNP): 8901
// - aep_n (AEP Texas North): 20404
// - aep_c (AEP Texas Central / "AEP Central"): 3278
// - tnmp (Texas-New Mexico Power): 40051
const TDSP_TO_EIA: Record<string, number> = {
  oncor: 44372,
  centerpoint: 8901,
  aep_n: 20404,
  aep_c: 3278,
  tnmp: 40051,
};

export async function GET(req: NextRequest) {
  try {
    // ---- rate limit
    const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'local';
    const now = Date.now();
    const b = buckets.get(ip);
    if (!b || now > b.resetAt) {
      buckets.set(ip, { count: 1, resetAt: now + LIMIT_WINDOW_MS });
    } else {
      if (b.count >= LIMIT_MAX) {
        const retrySec = Math.max(1, Math.ceil((b.resetAt - now) / 1000));
        return NextResponse.json(
          { error: `Rate limit exceeded. Try again in ${retrySec}s.` },
          { status: 429, headers: { 'Retry-After': String(retrySec) } }
        );
      }
      b.count++;
    }

    // ---- input
    const url = new URL(req.url);
    const tdspRaw = (url.searchParams.get('tdsp') || '').toLowerCase().trim();
    const utilityIDParam = url.searchParams.get('utility_id');
    const state = (url.searchParams.get('state') || 'tx').toLowerCase();
    const pageParam = url.searchParams.get('page');
    const verifiedFromParam = url.searchParams.get('verified_from'); // epoch seconds OR ISO date string

    if (!process.env.WATTBUY_API_KEY) {
      return NextResponse.json({ error: 'WATTBUY_API_KEY not configured on server.' }, { status: 500 });
    }
    if (state !== 'tx') {
      return NextResponse.json({ error: 'This proxy currently supports Texas (TX) only.' }, { status: 400 });
    }

    // Resolve utility_id
    let utilityID: number | null = null;
    if (utilityIDParam) {
      const n = Number(utilityIDParam);
      if (!Number.isFinite(n)) {
        return NextResponse.json({ error: 'utility_id must be a number.' }, { status: 400 });
      }
      utilityID = n;
    } else if (tdspRaw) {
      const mapped = TDSP_TO_EIA[tdspRaw];
      if (!mapped) {
        return NextResponse.json(
          { error: `Unknown tdsp "${tdspRaw}". Use one of: ${Object.keys(TDSP_TO_EIA).join(', ')}` },
          { status: 400 }
        );
      }
      utilityID = mapped;
    } else {
      return NextResponse.json(
        { error: 'Provide either utility_id=<EIA id> or tdsp=<oncor|centerpoint|aep_n|aep_c|tnmp>.' },
        { status: 400 }
      );
    }

    // Parse page
    const page = Math.max(1, Number(pageParam || 1) || 1);

    // Parse verified_from -> epoch seconds (WattBuy default is ~1 year if omitted)
    let verified_from: number | undefined = undefined;
    if (verifiedFromParam) {
      const asNum = Number(verifiedFromParam);
      if (Number.isFinite(asNum) && asNum > 0) {
        verified_from = Math.floor(asNum);
      } else {
        const d = new Date(verifiedFromParam);
        if (!isNaN(d.valueOf())) {
          verified_from = Math.floor(d.getTime() / 1000);
        } else {
          return NextResponse.json(
            { error: 'verified_from must be epoch seconds or a valid date string (e.g., 2024-01-01).' },
            { status: 400 }
          );
        }
      }
    }

    // Build request using wbGet (clean headers, no internal header forwarding)
    const params: Record<string, unknown> = {
      utilityID: String(utilityID), // camelCase per WattBuy test page
      state, // lowercase
      page: String(page),
    };
    if (verified_from != null) params.verified_from = String(verified_from);

    const result = await wbGet('electricity/retail-rates', params);

    if (!result.ok) {
      const msg = (result.text || 'Upstream error')
        .toString()
        .replace(/(Bearer\s+)?[A-Za-z0-9-_]{20,}/g, '***');
      return NextResponse.json({ error: msg, upstreamStatus: result.status, upstream: result.text }, { status: 502 });
    }

    const json = result.data;

    // Provide a tiny "mini" summary for quick QA in the UI without knowing schema details
    const items = Array.isArray(json?.results || json?.data) ? (json.results || json.data) : [];
    const mini = items.slice(0, 100).map((it: any) => ({
      id: it?.id || it?.tariff_id || null,
      name: it?.name || it?.tariff_name || null,
      effective: it?.effective_date || it?.effective || null,
      expiration: it?.expiration_date || it?.expires || null,
      sector: it?.sector || it?.customer_class || null,
      components: summarizeComponents(it),
      source: it?.source || it?.source_url || null,
      verified_at: it?.verified_at || it?.last_verified || null,
    }));

    return NextResponse.json(
      {
        query: { utilityID, tdsp: tdspRaw || null, state, page, verified_from: verified_from ?? null },
        count: items.length,
        mini,
        raw: json,
      },
      { status: 200 }
    );
  } catch (err: any) {
    const msg = (err?.message || 'Internal error').replace(/(Bearer\s+)?[A-Za-z0-9-_]{20,}/g, '***');
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

function safeJson(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return { error: text };
  }
}

function summarizeComponents(it: any) {
  // Best-effort summary across possible shapes; keeps this endpoint resilient to schema shifts
  const comps = it?.components || it?.rates || it?.charges || [];
  if (!Array.isArray(comps)) return { count: 0 };
  const kinds = new Map<string, number>();
  for (const c of comps) {
    const k =
      c?.type ||
      c?.charge_type ||
      c?.name ||
      (c?.tou ? 'time_of_use' : c?.tier ? 'tier' : 'component') ||
      'component';
    kinds.set(String(k), (kinds.get(String(k)) || 0) + 1);
  }
  return {
    count: comps.length,
    kinds: Array.from(kinds.entries()).map(([k, v]) => ({ type: k, count: v })),
  };
}
