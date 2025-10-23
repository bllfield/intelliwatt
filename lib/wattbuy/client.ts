// lib/wattbuy/client.ts
// Step 59: Hardened WattBuy client (timeouts, retries, 429 handling) + helpers
// ----------------------------------------------------------------------------
// Drop-in replacement for the previous client. Safe to paste over existing file.
//
// Exposes:
//  • getESIByAddress(addr)
//  • getUtilityInfo(addr)
//  • getOffersForAddress(addr)
//  • getOffersForESIID(esiid)
//  • getRetailRates({ utilityID, state, page })
//  • extractTdspSlug(any)
//
// Notes:
//  • Uses both `X-Api-Key` and `Authorization: Bearer` in case either is required.
//  • Retries 429/5xx with exponential backoff and honors Retry-After.
//  • Times out requests (default 12s) with AbortController.

export type Addr = { line1: string; city: string; state: string; zip: string };

const BASE = 'https://apis.wattbuy.com/v3';
const API_KEY = process.env.WATTBUY_API_KEY || process.env.NEXT_PUBLIC_WATTBUY_API_KEY;

if (!API_KEY) {
  // Do not crash at import time in Next; throw at call site with clear message.
  // eslint-disable-next-line no-console
  console.warn('[wattbuy/client] Missing WATTBUY_API_KEY env var.');
}

type FetchOpts = {
  timeoutMs?: number;
  retries?: number;
  retryOn?: (status: number) => boolean;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  signal?: AbortSignal;
};

async function safeFetchJSON<T = any>(url: string, opts: FetchOpts = {}): Promise<T> {
  const {
    timeoutMs = 12_000,
    retries = 3,
    retryOn = (s) => s === 429 || (s >= 500 && s < 600),
    method = 'GET',
    headers = {},
    signal,
  } = opts;

  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    attempt += 1;
    const ac = new AbortController();
    const tm = setTimeout(() => ac.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'IntelliWatt/1.0 (+admin-probe;+server)',
          'X-Api-Key': API_KEY ?? '',
          Authorization: `Bearer ${API_KEY ?? ''}`,
          ...headers,
        },
        signal: mergeSignals(signal, ac.signal),
        // Next.js: keep default cache for server actions; callers can set revalidate on their route
      });

      clearTimeout(tm);

      if (res.status === 204) {
        // @ts-expect-error intentionally return empty
        return {};
      }

      // Try to parse JSON either way
      let body: any = null;
      const text = await res.text();
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        body = text;
      }

      if (res.ok) return body as T;

      // Not OK — maybe retry?
      if (attempt <= retries && retryOn(res.status)) {
        const retryAfter = parseRetryAfter(res.headers.get('retry-after'));
        const backoffMs = retryAfter ?? backoff(attempt);
        await sleep(backoffMs);
        continue;
      }

      const err = new Error(
        `[WattBuy] ${res.status} ${res.statusText} at ${url} :: ${typeof body === 'string' ? body : JSON.stringify(body)}`
      );
      // @ts-expect-error tack on extras for callers
      err.status = res.status;
      throw err;
    } catch (e: any) {
      clearTimeout(tm);
      // Aborted or network error; optionally retry
      const transient = e?.name === 'AbortError' || e?.message?.includes('network');
      if (attempt <= retries && transient) {
        await sleep(backoff(attempt));
        continue;
      }
      throw e;
    }
  }
}

function backoff(attempt: number, base = 300): number {
  // Exponential with jitter
  const ms = Math.min(5_000, base * Math.pow(2, attempt - 1));
  return Math.round(ms * (0.75 + Math.random() * 0.5));
}

function parseRetryAfter(h: string | null): number | null {
  if (!h) return null;
  const n = Number(h);
  if (Number.isFinite(n)) return Math.max(0, n * 1000);
  const d = Date.parse(h);
  if (!Number.isNaN(d)) return Math.max(0, d - Date.now());
  return null;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function mergeSignals(a?: AbortSignal, b?: AbortSignal): AbortSignal | undefined {
  if (!a) return b;
  if (!b) return a;
  // Simple composite: abort if either aborts
  const ctl = new AbortController();
  const onAbort = () => ctl.abort();
  a.addEventListener('abort', onAbort, { once: true });
  b.addEventListener('abort', onAbort, { once: true });
  return ctl.signal;
}

function qs(params: Record<string, any>): string {
  const sp = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v === undefined || v === null) return;
    if (typeof v === 'object') {
      sp.set(k, JSON.stringify(v));
    } else {
      sp.set(k, String(v));
    }
  });
  const s = sp.toString();
  return s ? `?${s}` : '';
}

// --------------------- Public API ---------------------

export async function getESIByAddress(addr: Addr) {
  assertKey();
  const url = `${BASE}/electricity/info/esi${qs({
    address: addr.line1,
    city: addr.city,
    state: addr.state,
    zip: addr.zip,
  })}`;
  return safeFetchJSON<any>(url);
}

export async function getUtilityInfo(addr: Addr) {
  assertKey();
  const url = `${BASE}/electricity/info${qs({
    address: addr.line1,
    city: addr.city,
    state: addr.state,
    zip: addr.zip,
  })}`;
  return safeFetchJSON<any>(url);
}

export async function getOffersForAddress(addr: Addr) {
  assertKey();
  const url = `${BASE}/offers${qs({
    address: addr.line1,
    city: addr.city,
    state: addr.state,
    zip: addr.zip,
  })}`;
  return safeFetchJSON<any>(url);
}

export async function getOffersForESIID(esiid: string) {
  assertKey();
  const url = `${BASE}/offers${qs({ esiid })}`;
  return safeFetchJSON<any>(url);
}

export async function getRetailRates({
  utilityID,
  state,
  page = 1,
  verified_from,
  baseline_zone,
}: {
  utilityID: number;
  state: string;
  page?: number;
  verified_from?: number;
  baseline_zone?: string;
}) {
  assertKey();
  const url = `${BASE}/electricity/retail-rates${qs({
    utilityID,
    state,
    page,
    verified_from,
    baseline_zone,
  })}`;
  return safeFetchJSON<any>(url, { timeoutMs: 15_000 });
}

// Export WattBuyClient class for backward compatibility
export class WattBuyClient {
  static async getESIByAddress(addr: Addr) {
    return getESIByAddress(addr);
  }
  static async getUtilityInfo(addr: Addr) {
    return getUtilityInfo(addr);
  }
  static async getOffersForAddress(addr: Addr) {
    return getOffersForAddress(addr);
  }
  static async getOffersForESIID(esiid: string) {
    return getOffersForESIID(esiid);
  }
  static async getRetailRates(params: any) {
    return getRetailRates(params);
  }
}

// Export tdspToSlug for backward compatibility
export const tdspToSlug = extractTdspSlug;

// Helper used by probe & matchers to pull TDSP slug from various responses
export function extractTdspSlug(anyResp: any): string | null {
  // Cases:
  //  • info/esi -> addresses[0].utility ("oncor")
  //  • info -> utility_info[0].preferred_name ("Oncor"), .utility_id or .utility ("oncor")
  //  • offers -> offers[i].offer_data.utility ("oncor")
  const fromEsi =
    anyResp?.addresses?.[0]?.utility ||
    anyResp?.addresses?.[0]?.preferred_name ||
    null;
  const fromInfo =
    anyResp?.utility_info?.[0]?.utility ||
    anyResp?.utility_info?.[0]?.preferred_name ||
    null;
  const fromOffers = anyResp?.offers?.[0]?.offer_data?.utility || null;

  const raw = fromEsi || fromInfo || fromOffers;
  if (!raw) return null;
  return normalizeTdsp(String(raw));
}

function normalizeTdsp(x: string | null): string | null {
  if (!x) return null;
  const s = x.toLowerCase();
  if (s.includes('oncor')) return 'oncor';
  if (s.includes('centerpoint') || s.includes('cnp')) return 'centerpoint';
  if (s.includes('tnmp')) return 'tnmp';
  if (s.includes('aep') && s.includes('north')) return 'aep_n';
  if (s.includes('aep') && (s.includes('central') || s.includes('south'))) return 'aep_c';
  return s.replace(/[^\w]+/g, '');
}

// --------------------- Internals ----------------------

function assertKey() {
  if (!API_KEY) {
    throw new Error(
      'WATTBUY_API_KEY is not set. Add it to your environment (.env.local) and restart the dev server.'
    );
  }
}