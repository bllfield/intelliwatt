// app/api/quote/route.ts
// Step 35: End-to-end Quote API
// - Accepts address + usage payload
// - Pulls offers from WattBuy
// - Matches each offer to a structured rate (from /data/rates) or falls back to WattBuy averages
// - Runs bill calculator and returns normalized quotes for the UI
//
// Notes:
// - Requires server runtime (fs access). Do NOT switch to edge.
// - Set WATTBUY_API_KEY in your environment.
// - This endpoint is idempotent and safe to call from the client.

import { NextRequest, NextResponse } from 'next/server';
import { WattBuyClient } from '@/lib/wattbuy/client';
import { matchOfferToRate, rateLikeFromOffer } from '@/lib/rates/store';
import { computeBill } from '@/lib/calc/bill';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ReqBody = {
  address: string;
  city: string;
  state: string; // 'TX'
  zip: string;
  usage:
    | { type: 'flat'; kwh: number }
    | { type: 'monthly'; months: Array<{ month: string; kwh: number }> }
    | { type: 'hourly'; hours: number[] };
};

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Partial<ReqBody>;

    // ---- Basic validation
    const address = String(body.address || '').trim();
    const city = String(body.city || '').trim();
    const state = String(body.state || '').trim().toUpperCase();
    const zip = String(body.zip || '').trim();

    if (!address || !city || !state || !zip) {
      return badRequest('Missing address, city, state, or zip.');
    }
    if (state !== 'TX') {
      // This build is focused on Texas for now.
      return badRequest('Only Texas (TX) addresses are supported in this environment.');
    }

    // ---- Normalize usage
    const usage = normalizeUsage(body.usage);
    if (usage.usageKwh <= 0) {
      return badRequest('Usage must be a positive number of kWh.');
    }

    // ---- Fetch offers from WattBuy
    const wb = new WattBuyClient();
    const offersRes = await wb.offersByAddress({ address, city, state, zip });
    const offers = Array.isArray(offersRes.offers) ? offersRes.offers : [];

    if (!offers.length) {
      return NextResponse.json(
        {
          meta: {
            address,
            city,
            state,
            zip,
            usage_kwh: usage.usageKwh,
            usage_type: usage.type,
            offer_count: 0,
          },
          quotes: [],
        },
        { status: 200 }
      );
    }

    // ---- Compute quotes
    const quotes = await Promise.all(
      offers.map(async (offer) => {
        // Try to match to structured local rate
        const { key, rate, parts } = await matchOfferToRate(offer);

        const rateLike = rate ?? rateLikeFromOffer(offer);
        const bill = computeBill({
          rate: rateLike,
          usageKwh: usage.usageKwh,
          hourlyKwh: usage.type === 'hourly' ? usage.hourly : undefined,
        });

        const od = offer?.offer_data || {};
        const links = {
          efl: od.efl ?? null,
          tos: od.tos ?? null,
          yrac: od.yrac ?? null,
        };

        return {
          offer_id: offer.offer_id,
          offer_name: offer.offer_name,
          supplier: od.supplier_name ?? od.supplier ?? null,
          tdsp: od.utility_name ?? od.utility ?? null,
          term: od.term ?? null,
          links,
          key: key ?? null,
          matched_rate: Boolean(rate),
          rate_parts: parts,
          totals: {
            total_cents: round2(bill.totalCents),
            total_dollars: round2(bill.totalCents / 100),
            eff_cents_per_kwh: round3(bill.effCentsPerKwh),
          },
          breakdown: bill.components,
          avg_prices: {
            p500: numOrNull(od.kwh500),
            p1000: numOrNull(od.kwh1000),
            p2000: numOrNull(od.kwh2000),
          },
        };
      })
    );

    // Sort by effective ¢/kWh asc, then total $
    quotes.sort((a, b) => {
      const d = a.totals.eff_cents_per_kwh - b.totals.eff_cents_per_kwh;
      if (Math.abs(d) > 1e-6) return d;
      return a.totals.total_dollars - b.totals.total_dollars;
    });

    return NextResponse.json(
      {
        meta: {
          address,
          city,
          state,
          zip,
          usage_kwh: usage.usageKwh,
          usage_type: usage.type,
          offer_count: quotes.length,
        },
        quotes,
      },
      { status: 200 }
    );
  } catch (err: any) {
    const msg = err?.message || 'Internal error';
    // Hide API key if it somehow sneaks into error text
    const sanitized = msg.replace(/(Bearer\s+)?[A-Za-z0-9-_]{20,}/g, '***');
    return NextResponse.json({ error: sanitized }, { status: 500 });
  }
}

// ------------- helpers ----------------

function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}

function normalizeUsage(u: ReqBody['usage'] | undefined): {
  type: 'flat' | 'monthly' | 'hourly';
  usageKwh: number;
  hourly?: number[];
} {
  if (!u) return { type: 'flat', usageKwh: 1000 };

  if (u.type === 'flat') {
    const kwh = Math.max(0, Number(u.kwh) || 0);
    return { type: 'flat', usageKwh: kwh || 1000 };
  }

  if (u.type === 'monthly') {
    const total = (u.months || []).reduce((sum, m) => sum + (Number(m.kwh) || 0), 0);
    // Interpret as last 12 months total / 12 (average month)
    const avg = (total || 0) / Math.max(1, (u.months || []).length || 12);
    return { type: 'monthly', usageKwh: Math.max(0, avg) || 1000 };
  }

  if (u.type === 'hourly') {
    const hours = Array.isArray(u.hours) ? u.hours.map((x) => Math.max(0, Number(x) || 0)) : [];
    const sum = hours.reduce((a, b) => a + b, 0);
    return { type: 'hourly', usageKwh: sum || 1000, hourly: hours };
  }

  return { type: 'flat', usageKwh: 1000 };
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
function round3(n: number) {
  return Math.round(n * 1000) / 1000;
}
function numOrNull(v: any) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}