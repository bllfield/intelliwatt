// lib/wattbuy/client.ts

import { retailRatesParams, electricityParams, electricityInfoParams } from './params';
import { persistWattBuySnapshot } from "@/lib/wattbuy/persistSnapshot";

export const WB_BASE = 'https://apis.wattbuy.com/v3';

function buildUrl(path: string, params?: Record<string, unknown>): string {
  const url = new URL(path.startsWith('http') ? path : `${WB_BASE}/${path.replace(/^\/+/, '')}`);
  if (params) for (const [k, v] of Object.entries(params ?? {})) if (v != null) url.searchParams.set(k, String(v));
  return url.toString();
}

function apiKey(): string {
  const key = (process.env.WATTBUY_API_KEY || '').trim();
  if (!key) throw new Error('WATTBUY_API_KEY is not set');
  return key;
}

type WbResponse<T> = {
  ok: boolean;
  status: number;
  data?: T | null;
  text?: string; // raw text body if non-JSON or empty
  headers?: Record<string, string | null>;
};

function pickHeaders(res: Response) {
  return {
    'x-amzn-requestid': res.headers.get('x-amzn-requestid'),
    'x-documentation-url': res.headers.get('x-documentation-url'),
    'x-amz-apigw-id': res.headers.get('x-amz-apigw-id'),
    'content-type': res.headers.get('content-type'),
    'content-length': res.headers.get('content-length'),
  };
}

async function parseBody<T>(res: Response): Promise<{ data: T | null; text: string | undefined }> {
  const ct = res.headers.get('content-type') || '';
  // Read as text once; decide JSON vs raw
  const raw = await res.text().catch(() => '');
  if (!raw || raw.trim() === '') {
    return { data: null, text: '' };
  }
  if (ct.includes('application/json')) {
    try {
      const json = JSON.parse(raw) as T;
      return { data: json, text: undefined };
    } catch {
      // malformed JSON though advertised as JSON; return raw for debugging
      return { data: null, text: raw.slice(0, 2000) };
    }
  }
  // Non-JSON content
  return { data: null, text: raw.slice(0, 2000) };
}

async function doFetch<T>(url: string, init?: RequestInit): Promise<WbResponse<T>> {
  // WattBuy upstream can occasionally stall (cold starts / transient network issues).
  // IMPORTANT: never allow a single request to hang for minutes; callers often have their own
  // fallback caches and need a timely failure to proceed.
  const timeoutMs = 12_000;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    // If the caller supplied a signal, forward aborts to our controller.
    if (init?.signal) {
      try {
        if (init.signal.aborted) ctrl.abort();
        else init.signal.addEventListener("abort", () => ctrl.abort(), { once: true });
      } catch {
        // ignore
      }
    }

    const res = await fetch(url, {
      method: 'GET',
      headers: { 'x-api-key': apiKey(), 'Accept': 'application/json' },
      cache: 'no-store',
      ...init,
      signal: ctrl.signal,
    });

    const headers = pickHeaders(res);
    const { data, text } = await parseBody<T>(res);

    if (!res.ok) {
      return { ok: false, status: res.status, data, text, headers };
    }
    return { ok: true, status: res.status, data, text, headers };
  } finally {
    clearTimeout(t);
  }
}

async function doPostJson<T>(url: string, body: unknown, init?: RequestInit): Promise<WbResponse<T>> {
  const timeoutMs = 12_000;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    if (init?.signal) {
      try {
        if (init.signal.aborted) ctrl.abort();
        else init.signal.addEventListener("abort", () => ctrl.abort(), { once: true });
      } catch {
        // ignore
      }
    }

    const res = await fetch(url, {
      method: "POST",
      headers: { "x-api-key": apiKey(), Accept: "application/json", "content-type": "application/json" },
      cache: "no-store",
      ...init,
      body: JSON.stringify(body ?? {}),
      signal: ctrl.signal,
    });

    const headers = pickHeaders(res);
    const { data, text } = await parseBody<T>(res);

    if (!res.ok) {
      return { ok: false, status: res.status, data, text, headers };
    }
    return { ok: true, status: res.status, data, text, headers };
  } finally {
    clearTimeout(t);
  }
}

export async function wbGet<T = any>(
  path: string,
  params?: Record<string, unknown>,
  init?: Omit<RequestInit, 'headers'|'method'>,
  retries = 1,
  snapshotMeta?: {
    houseAddressId?: string | null;
    esiid?: string | null;
    wattkey?: string | null;
    requestKey?: string | null;
    endpoint?: string | null;
  }
): Promise<WbResponse<T>> {
  const url = buildUrl(path, params);
  let last: WbResponse<T> | undefined;
  for (let i = 0; i <= retries; i++) {
    try {
      const out = await doFetch<T>(url, init);
      // Best-effort auditing: persist the raw payload for key WattBuy endpoints.
      try {
        const upperPath = String(path).toLowerCase();
        const endpoint =
          snapshotMeta?.endpoint?.trim()
            ? String(snapshotMeta.endpoint)
            : upperPath === "electricity"
              ? "ELECTRICITY"
              : upperPath === "electricity/info"
                ? "ELECTRICITY_INFO"
                : upperPath === "offers"
                  ? "OFFERS"
                  : null;
        if (endpoint) {
          const wattkeyFromParams =
            typeof (params as any)?.wattkey === "string" ? String((params as any).wattkey) : null;
          const esiidFromParams =
            typeof (params as any)?.esiid === "string" ? String((params as any).esiid) : null;
          const requestKey =
            snapshotMeta?.requestKey ??
            (params ? `${upperPath}:${JSON.stringify(params)}` : upperPath);

          void persistWattBuySnapshot({
            endpoint,
            // Snapshot even when WattBuy returns empty / non-JSON / 204.
            // This is critical for the Admin Inspector audit trail.
            payload:
              out.data ??
              ({
                __wattbuyNonJsonOrEmpty: true,
                ok: out.ok,
                status: out.status,
                headers: out.headers ?? null,
                text: out.text ?? null,
                path: upperPath,
                params: params ?? null,
              } as any),
            houseAddressId: snapshotMeta?.houseAddressId ?? null,
            esiid: snapshotMeta?.esiid ?? esiidFromParams,
            wattkey: snapshotMeta?.wattkey ?? wattkeyFromParams,
            requestKey,
          });
        }
      } catch {
        // ignore snapshot errors
      }
      if (out.ok) return out;
      if (out.status < 500 || i === retries) return out;
      await new Promise(r => setTimeout(r, 300 * (i + 1)));
      last = out;
    } catch (err) {
      if (i === retries) throw err;
      await new Promise(r => setTimeout(r, 300 * (i + 1)));
    }
  }
  return last ?? { ok: false, status: 500, text: 'Unknown error (no response)' };
}

export type WattBuyRetailRate = Record<string, any>;
export type WattBuyElectricity = Record<string, any>;
export type WattBuyElectricityInfo = Record<string, any>;

// Legacy helper: qs for backward compatibility with existing function signatures
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

function assertKey() {
  if (!process.env.WATTBUY_API_KEY) {
    throw new Error(
      'WATTBUY_API_KEY is not set. Add it to your environment (.env.local) and restart the dev server.'
    );
  }
}

type Addr = { line1: string; city: string; state: string; zip: string };

type FetchOpts = {
  timeoutMs?: number;
  retries?: number;
  retryOn?: (status: number) => boolean;
  signal?: AbortSignal;
};

function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    u.searchParams.forEach((_, key) => {
      u.searchParams.set(key, '***');
    });
    const query = u.searchParams.toString();
    return `${u.origin}${u.pathname}${query ? `?${query}` : ''}`;
  } catch {
    const [base] = url.split('?');
    return `${base}?***`;
  }
}

function backoff(attempt: number) {
  // 200ms, 400ms, 800ms, 1600ms ...
  return Math.min(200 * Math.pow(2, attempt - 1), 4000);
}
function parseRetryAfter(v: string | null): number | undefined {
  if (!v) return;
  const s = parseInt(v, 10);
  return Number.isFinite(s) ? s * 1000 : undefined;
}

// Legacy safeFetchJSON - now uses wbGet internally but maintains backward compatibility
async function safeFetchJSON<T = any>(url: string, opts: FetchOpts = {}): Promise<T> {
  const {
    timeoutMs = 12_000,
    retries = 2,
    retryOn = (s: number) => s >= 500 || s === 429,
    signal,
  } = opts;

  const ctrl = new AbortController();
  const id = setTimeout(() => ctrl.abort(), timeoutMs);
  const finalSignal = signal ?? ctrl.signal;

  let attempt = 0;
  while (true) {
    attempt++;
    // Use wbGet for clean headers, but extract path and params from full URL
    const urlObj = new URL(url);
    // Remove leading /v3/ if present, keep just the path after /v3/
    let path = urlObj.pathname.replace(/^\/v3\//, '').replace(/^\//, '');
    const params: Record<string, string> = {};
    urlObj.searchParams.forEach((v, k) => {
      params[k] = v;
    });
    
    const result = await wbGet(path, params, { signal: finalSignal });
    
    if (result.ok && result.data !== undefined) {
      clearTimeout(id);
      return result.data as T;
    }

    if (!result.ok) {
      const status = result.status;
      const body = result.text || '';

      if (status === 403) {
        const excerpt = typeof body === 'string' ? body.slice(0, 200) : JSON.stringify(body || {}).slice(0, 200);
        console.error(JSON.stringify({
          route: 'wattbuy/safeFetchJSON',
          status: 403,
          hint: 'Upstream forbidden. Verify WattBuy API key scope and plan coverage.',
          url: redactUrl(url),
          body_excerpt: excerpt,
        }));
      }

      if (attempt <= retries && retryOn(status)) {
        const backoffMs = backoff(attempt);
        await new Promise(r => setTimeout(r, backoffMs));
        continue;
      }

      clearTimeout(id);
      const err: any = new Error(`Upstream ${status}`);
      err.status = status;
      err.body = body;
      throw err;
    }

    // If ok but no data, treat as error
    clearTimeout(id);
    const err: any = new Error('Unexpected response format');
    err.status = result.status;
    throw err;
  }
}

export async function getESIByAddress(addr: Addr) {
  assertKey();
  const result = await wbGet('electricity/info/esi', {
    address: addr.line1,
    city: addr.city,
    state: addr.state,
    zip: addr.zip,
  });
  if (!result.ok) {
    const err: any = new Error(`Upstream ${result.status}`);
    err.status = result.status;
    err.body = result.text;
    throw err;
  }
  return result.data as any;
}

export async function getUtilityInfo(addr: Addr) {
  assertKey();
  const result = await wbGet('utility', {
    address: addr.line1,
    city: addr.city,
    state: addr.state,
    zip: addr.zip,
  });
  if (!result.ok) {
    const err: any = new Error(`Upstream ${result.status}`);
    err.status = result.status;
    err.body = result.text;
    throw err;
  }
  return result.data as any;
}

export type OfferAddressInput = {
  line1?: string | null;
  city?: string | null;
  state?: string | null;
  zip: string;
  tdsp?: string | null;
  is_renter?: boolean | string | null;
};

export async function getOffersForAddress(addr: OfferAddressInput) {
  assertKey();
  // Use the offers helper so we consistently include WattBuy defaults:
  // language=en, all=true, and (critically) is_renter=true/false for eligibility filtering.
  const result = await wbGetOffers({
    address: addr.line1 ?? undefined,
    city: addr.city ?? undefined,
    state: (addr.state && addr.state.trim()) || 'TX',
    zip: addr.zip,
    // WattBuy supports is_renter as a query param. Always include it (true/false) so
    // eligible plans are filtered upstream.
    is_renter: addr.is_renter ?? false,
    all: true,
    // Existing behavior: pass TDSP hint through when present.
    // The upstream param name we use here is `utility` (as historically used in this codepath).
    ...(addr.tdsp ? { utility: addr.tdsp } : {}),
  } as any);
  if (!result.ok) {
    const err: any = new Error(`Upstream ${result.status}`);
    err.status = result.status;
    err.body = result.text;
    throw err;
  }
  return result.data as any;
}

export type RetailRatesQuery = {
  state?: string;
  utilityID?: string | number; // API parameter: utilityID (integer as string) per test page
  utility_id?: string | number; // Legacy support, converts to utilityID
  zip?: string;
  page?: number;
  page_size?: number;
  [k: string]: any;
};

export async function fetchRetailRates(q: RetailRatesQuery = {}) {
  assertKey();
  const params: Record<string, unknown> = retailRatesParams({
    utilityID: q.utilityID ?? q.utility_id, // Accept both for backward compat
    state: q.state, // optional, lowercase per test page
    zip: q.zip,
  });
  if (typeof q.page === 'number') params.page = q.page;
  if (typeof q.page_size === 'number') params.page_size = q.page_size;
  for (const [k, v] of Object.entries(q)) {
    if (['state','utilityID','utility_id','zip','page','page_size'].includes(k)) continue;
    if (v === undefined || v === null) continue;
    params[k] = String(v);
  }
  const result = await wbGet('electricity/retail-rates', params);
  if (!result.ok) {
    const err: any = new Error(`Upstream ${result.status}`);
    err.status = result.status;
    err.body = result.text;
    throw err;
  }
  return result.data as any;
}

export async function getRetailRatesSafe(q: RetailRatesQuery = {}) {
  return fetchRetailRates(q);
}

// Backward compatibility
export async function getRetailRates(params: any) {
  return fetchRetailRates(params);
}

// --- New: electricity catalog fetcher (/v3/electricity)
export type ElectricityCatalogQuery = {
  address?: string; // Street address (URL encoded)
  city?: string; // City name
  state?: string; // Two-letter state code (e.g., "TX")
  zip?: string; // Required: 5-digit zip code
  utility_eid?: number; // Optional: EID of Utility
  wattkey?: string; // Optional: WattBuy identifier for the home
  [k: string]: any;
};

export async function fetchElectricityCatalog(q: ElectricityCatalogQuery = {}) {
  assertKey();
  if (!q.zip) throw new Error('zip is required for electricity catalog');
  const params: Record<string, unknown> = electricityParams({
    address: q.address,
    city: q.city,
    state: q.state,
    zip: q.zip,
  });
  // Optional: utility_eid (number)
  if (q.utility_eid !== undefined && q.utility_eid !== null) {
    params.utility_eid = Number(q.utility_eid);
  }
  // Optional: wattkey
  if (q.wattkey) params.wattkey = String(q.wattkey);
  // Pass through any other keys
  for (const [k, v] of Object.entries(q)) {
    if (['address','city','state','zip','utility_eid','wattkey'].includes(k)) continue;
    if (v === undefined || v === null) continue;
    params[k] = String(v);
  }
  const result = await wbGet('electricity', params);
  if (!result.ok) {
    const err: any = new Error(`Upstream ${result.status}`);
    err.status = result.status;
    err.body = result.text;
    throw err;
  }
  return result.data as any;
}

// --- New: electricity info fetcher (/v3/electricity/info)
export type ElectricityInfoQuery = {
  address?: string; // Street address (URL encoded)
  city?: string; // City name
  state?: string; // Two-letter state code (e.g., "tx")
  zip?: string; // Required: 5-digit zip code
  housing_chars?: string | boolean; // Optional: "true" to include housing characteristics
  utility_list?: string | boolean; // Optional: "true" to include utility list
  [k: string]: any;
};

export async function fetchElectricityInfo(q: ElectricityInfoQuery = {}) {
  assertKey();
  if (!q.zip) throw new Error('zip is required for electricity info');
  const params: Record<string, unknown> = electricityInfoParams({
    address: q.address,
    city: q.city,
    state: q.state,
    zip: q.zip,
    housing_chars: q.housing_chars,
    utility_list: q.utility_list,
  });
  // Pass through any other keys
  for (const [k, v] of Object.entries(q)) {
    if (['address','city','state','zip','housing_chars','utility_list'].includes(k)) continue;
    if (v === undefined || v === null) continue;
    params[k] = String(v);
  }
  const result = await wbGet('electricity/info', params);
  if (!result.ok) {
    const err: any = new Error(`Upstream ${result.status}`);
    err.status = result.status;
    err.body = result.text;
    throw err;
  }
  return result.data as any;
}

export function extractTdspSlug(anyVal: any): string | null {
  const raw = (anyVal || '').toString().toLowerCase();
  if (!raw) return null;
  if (raw.includes('oncor')) return 'oncor';
  if (raw.includes('centerpoint')) return 'centerpoint';
  if (raw.includes('aep') && raw.includes('texas')) return 'aep';
  if (raw.includes('tnmp')) return 'tnmp';
  return null;
}

// Export tdspToSlug for backward compatibility
export const tdspToSlug = extractTdspSlug;

export class WattBuyClient {
  static async getESIByAddress(addr: Addr) {
    return getESIByAddress(addr);
  }
  static async getUtilityInfo(addr: Addr) {
    return getUtilityInfo(addr);
  }
  static async getOffersForAddress(addr: OfferAddressInput) {
    return getOffersForAddress(addr);
  }
  static async getRetailRates(params: any) {
    return getRetailRates(params);
  }

  // Instance methods for backward compatibility
  async offersByAddress({
    address,
    city,
    state,
    zip,
    tdsp,
    is_renter,
  }: {
    address?: string;
    city?: string;
    state?: string;
    zip: string;
    tdsp?: string | null;
    is_renter?: boolean | string;
  }) {
    return getOffersForAddress({
      line1: address,
      city,
      state,
      zip,
      tdsp: tdsp ?? undefined,
      is_renter: is_renter ?? false,
    });
  }
}

// Deprecated: ESIID lookup via WattBuy (gated by wattbuyEsiidDisabled flag)
// This function is kept for backward compatibility but routes using it return 410 Gone.
export type EsiLookupInput = { line1: string; city: string; state: string; zip: string };
export type EsiLookupResult = {
  esiid: string | null;
  utility?: string | null;
  territory?: string | null;
  raw?: any;
};

export async function lookupEsiId(addr: EsiLookupInput): Promise<EsiLookupResult> {
  // This function is deprecated and should not be called when wattbuyEsiidDisabled is true.
  // Routes using this function check the flag first and return 410 Gone.
  const resp = await getESIByAddress(addr);
  const addresses = resp?.addresses || [];
  if (addresses.length > 0) {
    const addr = addresses[0];
    return {
      esiid: addr.esi || addr.esiid || null,
      utility: addr.utility || null,
      territory: addr.territory || null,
      raw: resp,
    };
  }
  return { esiid: null, raw: resp };
}

// --- OFFERS + ELECTRICITY (WattBuy) ---
// Notes:
// - Uses the already-working electricity details call (getElectricityRobust from electricity.ts).
// - For offers, we default to `all=true` to retrieve the complete plan list.
// - Offers can be queried via address OR via wattkey (preferred after electricity call).
// - Uses wbGet() for consistency with other WattBuy endpoints (retry logic, diagnostic headers).

// Electricity details - use getElectricityRobust from electricity.ts for robust fetching
// This is a thin wrapper that uses wbGet internally
export async function wbGetElectricity(params: {
  address?: string; city?: string; state: string; zip: string;
  wattkey?: string;
}) {
  // Use the robust electricity fetcher which handles retries and fallbacks
  const { getElectricityRobust } = await import('./electricity');
  if (params.wattkey) {
    // Direct wattkey lookup
    return await wbGet<any>('electricity', { wattkey: params.wattkey }, undefined, 1);
  }
  return await getElectricityRobust({
    address: params.address,
    city: params.city,
    state: params.state,
    zip: params.zip,
  });
}

// Electricity info - specifically for ESIID extraction
// Uses /v3/electricity/info endpoint which contains ESIID data
export async function wbGetElectricityInfo(params: {
  address?: string; city?: string; state: string; zip: string;
  housing_chars?: string | boolean;
  utility_list?: string | boolean;
}) {
  const { electricityInfoParams } = await import('./params');
  const queryParams = electricityInfoParams({
    address: params.address,
    city: params.city,
    state: params.state,
    zip: params.zip,
    housing_chars: params.housing_chars ?? 'true',
    utility_list: params.utility_list ?? 'true',
  });
  return await wbGet<any>('electricity/info', queryParams, undefined, 1);
}

// Offers: address-based OR wattkey-based.
// Uses wbGet() for consistency with other WattBuy endpoints
// Defaults: language='en', is_renter=false, all=true
export async function wbGetOffers(params: {
  address?: string; city?: string; state?: string; zip?: string;
  wattkey?: string;
  language?: 'en' | 'es';
  is_renter?: boolean;
  all?: boolean;
  utility_eid?: number;
  category?: string;
}) {
  const {
    language = 'en',
    is_renter = false,
    all = true,
    ...rest
  } = params ?? {};

  // WattBuy /v3/offers rejects boolean flags passed as query params (strings).
  // Use POST JSON so is_renter/all are real booleans.
  const url = buildUrl("offers");
  const body: Record<string, unknown> = {
    language: String(language),
    is_renter: Boolean(is_renter),
    all: Boolean(all),
  };
  for (const [k, v] of Object.entries(rest)) {
    if (v !== undefined && v !== null && String(v).length > 0) {
      body[k] = v;
    }
  }

  const out = await doPostJson<any>(url, body, undefined);

  // Best-effort auditing for inspector
  try {
    void persistWattBuySnapshot({
      endpoint: "OFFERS",
      payload:
        out.data ??
        ({
          __wattbuyNonJsonOrEmpty: true,
          ok: out.ok,
          status: out.status,
          headers: out.headers ?? null,
          text: out.text ?? null,
          path: "offers",
          body,
        } as any),
      houseAddressId: null,
      esiid: null,
      wattkey: typeof (body as any)?.wattkey === "string" ? String((body as any).wattkey) : null,
      requestKey: `offers:POST:${JSON.stringify(body)}`,
    });
  } catch {
    // ignore
  }

  return out;
}

// Utility helper to extract useful bits from electricity payload
export function extractElectricityKeys(e: any) {
  if (!e || typeof e !== 'object') return {};
  const wattkey = e.wattkey;
  const deregulated = e.deregulated;
  // Some accounts include an ESIID or can be looked up with another call.
  // We pass forward wattkey and let the backend SMT step fetch ESIID if present.
  return { wattkey, deregulated };
}
