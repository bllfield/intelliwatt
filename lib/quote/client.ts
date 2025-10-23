// lib/quote/client.ts
// Step 36: Lightweight client helper to call our Quote API from the UI
// - POSTs to /api/quote with address + usage
// - Strong runtime checks, abort support, and friendly error messages
// - No external deps (works with Next.js App Router)
//
// Usage:
//   import { fetchQuotes, makeFlatUsage } from '@/lib/quote/client';
//   const res = await fetchQuotes({ address, city, state:'TX', zip, usage: makeFlatUsage(1200) });
//
// Optional: pass an AbortSignal (e.g., from an AbortController) to cancel in-flight calls.

export type FlatUsage = { type: 'flat'; kwh: number };
export type MonthlyUsage = { type: 'monthly'; months: Array<{ month: string; kwh: number }> };
export type HourlyUsage = { type: 'hourly'; hours: number[] };
export type Usage = FlatUsage | MonthlyUsage | HourlyUsage;

export type QuoteRequest = {
  address: string;
  city: string;
  state: string; // 'TX'
  zip: string;
  usage: Usage;
};

export type QuoteBreakdown = {
  energyCents: number;
  deliveryCents: number;
  baseFeeCents: number;
  creditsCents: number;
};

export type QuoteItem = {
  offer_id: string;
  offer_name: string;
  supplier: string | null;
  tdsp: string | null;
  term: number | null;
  links: { efl: string | null; tos: string | null; yrac: string | null };
  key: string | null;
  matched_rate: boolean;
  rate_parts: any;
  totals: {
    total_cents: number;
    total_dollars: number;
    eff_cents_per_kwh: number;
  };
  breakdown: QuoteBreakdown;
  avg_prices: { p500: number | null; p1000: number | null; p2000: number | null };
};

export type QuoteResponse = {
  meta: {
    address: string;
    city: string;
    state: string;
    zip: string;
    usage_kwh: number;
    usage_type: 'flat' | 'monthly' | 'hourly';
    offer_count: number;
  };
  quotes: QuoteItem[];
};

export function makeFlatUsage(kwh: number): FlatUsage {
  return { type: 'flat', kwh: clampNum(kwh, 0, 200000) };
}
export function makeMonthlyUsage(months: Array<{ month: string; kwh: number }>): MonthlyUsage {
  return {
    type: 'monthly',
    months: (months || []).map((m) => ({
      month: String(m.month || '').slice(0, 16),
      kwh: clampNum(m.kwh, 0, 200000),
    })),
  };
}
export function makeHourlyUsage(hours: number[]): HourlyUsage {
  return {
    type: 'hourly',
    hours: (hours || []).map((h) => clampNum(h, 0, 50)), // 50 kWh/hr cap sanity check
  };
}

export async function fetchQuotes(
  input: QuoteRequest,
  opts?: { signal?: AbortSignal }
): Promise<QuoteResponse> {
  validateRequest(input);

  const res = await fetch('/api/quote', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    signal: opts?.signal,
    cache: 'no-store',
  });

  const text = await res.text();
  if (!res.ok) {
    // Try to surface JSON error if present
    try {
      const j = JSON.parse(text);
      throw new Error(j?.error || res.statusText);
    } catch {
      throw new Error(text || res.statusText);
    }
  }

  try {
    const data = JSON.parse(text) as QuoteResponse;
    // quick shape check
    if (!data || !data.meta || !Array.isArray(data.quotes)) {
      throw new Error('Unexpected response from /api/quote');
    }
    return data;
  } catch (e: any) {
    throw new Error(`Failed to parse quote response: ${e?.message || e}`);
  }
}

// ----------------- small helpers -----------------

function clampNum(n: any, min: number, max: number): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return min;
  if (v < min) return min;
  if (v > max) return max;
  return v;
}

function validateRequest(req: QuoteRequest) {
  if (!req) throw new Error('Missing quote payload');
  const address = String(req.address || '').trim();
  const city = String(req.city || '').trim();
  const state = String(req.state || '').trim().toUpperCase();
  const zip = String(req.zip || '').trim();

  if (!address || !city || !state || !zip) {
    throw new Error('Please provide address, city, state, and zip.');
  }
  if (state !== 'TX') {
    throw new Error('Only Texas (TX) addresses are supported right now.');
  }

  if (!req.usage || typeof req.usage !== 'object') {
    throw new Error('Missing usage payload.');
  }

  if (req.usage.type === 'flat') {
    const kwh = clampNum((req.usage as FlatUsage).kwh, 0, 200000);
    if (kwh <= 0) throw new Error('Flat usage must be greater than 0 kWh.');
  } else if (req.usage.type === 'monthly') {
    const months = (req.usage as MonthlyUsage).months || [];
    if (!months.length) throw new Error('Monthly usage requires at least one month entry.');
  } else if (req.usage.type === 'hourly') {
    const hours = (req.usage as HourlyUsage).hours || [];
    if (!hours.length) throw new Error('Hourly usage requires at least one hour.');
  } else {
    throw new Error('Unsupported usage type.');
  }
}
