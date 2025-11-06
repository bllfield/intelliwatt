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
//  • lookupEsiId(addr) - New: simplified ESIID lookup for address-first flow
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

// New: Hardened ESIID lookup for address-first flow
// - Tries multiple param shapes (address_line1 vs address, etc.)
// - Handles multiple response shapes (flat vs nested .data)
// - Retries on 429/5xx with small backoff
// - Emits concise debug logs on non-200s for troubleshooting
export type EsiLookupInput = { line1: string; city: string; state: string; zip: string };

export type EsiLookupResult = {
  esiid: string | null;
  utility?: string | null;
  territory?: string | null;
  raw?: any;
};

type ParamShape = Record<string, string>;

function buildCandidates(addr: EsiLookupInput): ParamShape[] {
  // According to WattBuy docs, the correct format is:
  // address_line1, address_city, address_state, address_zip
  return [
    // 1) Official format from WattBuy documentation
    {
      address_line1: addr.line1,
      address_city: addr.city,
      address_state: addr.state,
      address_zip: addr.zip,
    },
    // 2) Fallback: single address + city/state/zip (in case docs are outdated)
    {
      address: addr.line1,
      city: addr.city,
      state: addr.state,
      zip: addr.zip,
    },
  ];
}

function mapResponse(json: any): EsiLookupResult {
  // Known shapes:
  // flat: { esi: "...", utility: "...", territory: "..." }
  // alt:  { esiid: "...", utility: "...", territory: "..." }
  // nested: { data: { esi: "...", utility: "...", territory: "..." } }
  // addresses array: { addresses: [{ esi: "...", utility: "..." }] }
  const j = json || {};
  
  // Try addresses array first (common WattBuy response format)
  if (Array.isArray(j.addresses) && j.addresses.length > 0) {
    const addr = j.addresses[0];
    const esiid = addr.esi || addr.esiid || null;
    const utility = addr.utility ?? null;
    const territory = addr.territory ?? null;
    return { esiid, utility, territory, raw: json };
  }
  
  // Try nested data
  const src = j.data || j;
  const esiid = src.esi || src.esiid || null;
  const utility = src.utility ?? null;
  const territory = src.territory ?? null;
  
  // Log what we found for debugging
  if (!esiid) {
    console.error(
      JSON.stringify({
        route: 'wattbuy/mapResponse',
        message: 'No ESIID found in response',
        response_keys: Object.keys(j),
        response_preview: JSON.stringify(j).slice(0, 500),
      })
    );
  }
  
  return { esiid, utility, territory, raw: json };
}

async function doFetch(url: string, apiKey: string): Promise<{ ok: boolean; status: number; json: any; text: string }> {
  // According to WattBuy docs, only Authorization: Bearer header is needed
  // Ensure exact format: "Bearer <token>" with single space
  const authHeader = `Bearer ${apiKey.trim()}`;
  const headers: HeadersInit = { 
    'Authorization': authHeader,
  };
  
  // Log the exact request we're about to send
  console.error(
    JSON.stringify({
      route: 'wattbuy/doFetch-request',
      method: 'GET',
      url: url.replace(apiKey, '***'),
      header_present: Boolean(headers.Authorization),
      header_exact: authHeader.substring(0, 20) + '...' + authHeader.substring(authHeader.length - 4),
      header_starts_with: authHeader.startsWith('Bearer '),
      api_key_length: apiKey.length,
      api_key_has_spaces: apiKey.includes(' '),
    })
  );
  
  const res = await fetch(url, {
    method: 'GET',
    headers,
  });
  const text = await res.text();
  let json: any;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  
  // Log response
  console.error(
    JSON.stringify({
      route: 'wattbuy/doFetch-response',
      status: res.status,
      statusText: res.statusText,
      response_preview: text.slice(0, 200),
      response_full: text.length < 500 ? text : text.slice(0, 500) + '...',
    })
  );
  
  return { ok: res.ok, status: res.status, json, text };
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastErr: any;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e: any) {
      lastErr = e;
      // tiny backoff
      await new Promise(r => setTimeout(r, 250 * (i + 1)));
    }
  }
  throw lastErr;
}

export async function lookupEsiId(addr: EsiLookupInput): Promise<EsiLookupResult> {
  const apiKey = process.env.WATTBUY_API_KEY || process.env.NEXT_PUBLIC_WATTBUY_API_KEY;
  if (!apiKey) throw new Error('Missing WATTBUY_API_KEY');

  // Log API key presence (first/last 4 chars only for security)
  console.error(
    JSON.stringify({
      route: 'wattbuy/lookup-esi',
      api_key_present: Boolean(apiKey),
      api_key_length: apiKey?.length || 0,
      api_key_preview: apiKey ? `${apiKey.substring(0, 4)}...${apiKey.substring(apiKey.length - 4)}` : 'missing',
    })
  );

  const candidates = buildCandidates(addr);
  const endpoint = `${BASE}/electricity/info/esi`;

  // Try each param shape with retry on 429/5xx
  const errors: Array<{ status: number; body: string; qs: ParamShape }> = [];

  for (const qs of candidates) {
    // Use URLSearchParams for proper encoding (matches docs example)
    const url = `${endpoint}?${new URLSearchParams(qs).toString()}`;
    try {
      const out = await withRetry(async () => {
        const r = await doFetch(url, apiKey);
        if (!r.ok) {
          // Retry only on 429/ >=500
          if (r.status === 429 || r.status >= 500) {
            throw new Error(`Transient HTTP ${r.status}`);
          }
          // Non-retryable: record & move on to next shape
          errors.push({ status: r.status, body: r.text.slice(0, 500), qs });
          return r;
        }
        return r;
      });

      if (out.ok) {
        const mapped = mapResponse(out.json);
        if (mapped.esiid) return mapped; // success
        // 200 but no ESIID — record and try next
        errors.push({ status: 200, body: JSON.stringify(out.json).slice(0, 500), qs });
      }
    } catch (e: any) {
      // Retries exhausted — record
      errors.push({ status: -1, body: String(e?.message || e), qs });
    }
  }

  // If we got here, nothing yielded an ESIID. Emit a concise error with context.
  // NOTE: We include only small excerpts to avoid leaking full payloads into logs.
  console.error(
    JSON.stringify({
      route: 'wattbuy/lookup-esi',
      message: 'All param shapes failed to return an ESIID',
      attempts: errors.length,
      errors: errors.map(e => ({ status: e.status, qs: e.qs, body_excerpt: e.body })),
    })
  );

  // Return a structured failure (caller can render "no match" vs "error")
  return { esiid: null, raw: { attempts: errors.length, errors } };
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
  
  // Instance methods for backward compatibility
  async offersByEsiid({ esiid }: { esiid: string }) {
    return getOffersForESIID(esiid);
  }
  
  async offersByAddress({ address, city, state, zip }: { address: string; city: string; state: string; zip: string }) {
    return getOffersForAddress({ line1: address, city, state, zip });
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
