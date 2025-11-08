// lib/wattbuy/client.ts

import { retailRatesParams, electricityParams, electricityInfoParams } from './params';

export const WB_BASE = 'https://apis.wattbuy.com/v3';

function buildUrl(path: string, params?: Record<string, unknown>): string {
  const url = new URL(path.startsWith('http') ? path : `${WB_BASE}/${path.replace(/^\/+/, '')}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null) continue;
      url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

function apiKey(): string {
  const key = (process.env.WATTBUY_API_KEY || '').trim();
  if (!key) throw new Error('WATTBUY_API_KEY is not set');
  return key;
}

// Minimal GET with x-api-key header per WattBuy test page
export async function wbGet<T = any>(
  path: string,
  params?: Record<string, unknown>,
  init?: Omit<RequestInit, 'headers' | 'method'>
): Promise<{ ok: boolean; status: number; data?: T; text?: string }> {
  const res = await fetch(buildUrl(path, params), {
    method: 'GET',
    headers: {
      'x-api-key': apiKey(),
      'Accept': 'application/json',
    },
    cache: 'no-store',
    ...init,
  });
  const ct = res.headers.get('content-type') || '';
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    return { ok: false, status: res.status, text };
  }
  if (ct.includes('application/json')) return { ok: true, status: res.status, data: await res.json() as T };
  return { ok: true, status: res.status, text: await res.text() };
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
};

export async function getOffersForAddress(addr: OfferAddressInput) {
  assertKey();
  const params: Record<string, string> = { zip: addr.zip };
  if (addr.line1) params.address = addr.line1;
  if (addr.city) params.city = addr.city;
  params.state = (addr.state && addr.state.trim()) || 'TX';
  if (addr.tdsp) params.utility = addr.tdsp;
  // Compliance: WattBuy offers are requested without ESIID.
  const result = await wbGet('offers', params);
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
    state: q.state || 'tx', // required, lowercase per test page
  });
  if (q.zip) params.zip = String(q.zip);
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
  async offersByAddress({ address, city, state, zip, tdsp }: { address?: string; city?: string; state?: string; zip: string; tdsp?: string | null }) {
    return getOffersForAddress({ line1: address, city, state, zip, tdsp: tdsp ?? undefined });
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
