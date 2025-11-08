const BASE = 'https://apis.wattbuy.com/v3';

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
    const res = await fetch(url, { headers: { Authorization: `Bearer ${process.env.WATTBUY_API_KEY}` }, signal: finalSignal } as any);
    let body: any = null;
    try { body = await res.json(); } catch { body = await res.text().catch(() => null); }

    if (res.ok) {
      clearTimeout(id);
      return body as T;
    }

    if (res.status === 403) {
      const excerpt = typeof body === 'string' ? body.slice(0, 200) : JSON.stringify(body || {}).slice(0, 200);
      console.error(JSON.stringify({
        route: 'wattbuy/safeFetchJSON',
        status: 403,
        hint: 'Upstream forbidden. Verify WattBuy API key scope and plan coverage.',
        url: redactUrl(url),
        body_excerpt: excerpt,
      }));
    }

    if (attempt <= retries && retryOn(res.status)) {
      const retryAfter = parseRetryAfter(res.headers.get('retry-after'));
      const backoffMs = retryAfter ?? backoff(attempt);
      await new Promise(r => setTimeout(r, backoffMs));
      continue;
    }

    clearTimeout(id);
    const err: any = new Error(`Upstream ${res.status}`);
    err.status = res.status;
    err.body = body;
    throw err;
  }
}

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
  const url = `${BASE}/utility${qs({ address: addr.line1, city: addr.city, state: addr.state, zip: addr.zip })}`;
  return safeFetchJSON<any>(url);
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
  const query: Record<string, string> = { zip: addr.zip };
  if (addr.line1) query.address = addr.line1;
  if (addr.city) query.city = addr.city;
  query.state = (addr.state && addr.state.trim()) || 'TX';
  if (addr.tdsp) query.utility = addr.tdsp;
  // Compliance: WattBuy offers are requested without ESIID.
  const url = `${BASE}/offers${qs(query)}`;
  return safeFetchJSON<any>(url);
}

export type RetailRatesQuery = {
  state?: string;
  utilityID?: string | number; // Required: Numeric string of utilityID (EIA utility ID)
  zip?: string;
  page?: number;
  page_size?: number;
  [k: string]: any;
};

export async function fetchRetailRates(q: RetailRatesQuery = {}) {
  assertKey();
  const state = (q.state && String(q.state).trim().toUpperCase()) || 'TX';
  const query: Record<string, string> = { state };
  // WattBuy API requires utilityID as numeric string (EIA utility ID)
  if (q.utilityID !== undefined && q.utilityID !== null) {
    query.utilityID = String(q.utilityID);
  }
  if (q.zip) query.zip = String(q.zip);
  if (typeof q.page === 'number') query.page = String(q.page);
  if (typeof q.page_size === 'number') query.page_size = String(q.page_size);
  for (const [k, v] of Object.entries(q)) {
    if (['state','utilityID','zip','page','page_size'].includes(k)) continue;
    if (v === undefined || v === null) continue;
    query[k] = String(v);
  }
  const url = `${BASE}/electricity/retail-rates${qs(query)}`;
  return safeFetchJSON<any>(url, { timeoutMs: 15000, retries: 2 });
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
  const query: Record<string, string> = {};
  // Required: zip (5-digit)
  if (q.zip) {
    query.zip = String(q.zip).trim();
  }
  // Optional: address, city, state
  if (q.address) query.address = String(q.address);
  if (q.city) query.city = String(q.city);
  if (q.state) query.state = String(q.state).toLowerCase(); // API expects lowercase like "tx"
  // Optional: utility_eid (number)
  if (q.utility_eid !== undefined && q.utility_eid !== null) {
    query.utility_eid = String(q.utility_eid);
  }
  // Optional: wattkey
  if (q.wattkey) query.wattkey = String(q.wattkey);
  // Pass through any other keys
  for (const [k, v] of Object.entries(q)) {
    if (['address','city','state','zip','utility_eid','wattkey'].includes(k)) continue;
    if (v === undefined || v === null) continue;
    query[k] = String(v);
  }
  const url = `${BASE}/electricity${qs(query)}`;
  return safeFetchJSON<any>(url, { timeoutMs: 15000, retries: 2 });
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
  const query: Record<string, string> = {};
  // Required: zip (5-digit)
  if (q.zip) {
    query.zip = String(q.zip).trim();
  }
  // Optional: address, city, state
  if (q.address) query.address = String(q.address);
  if (q.city) query.city = String(q.city);
  if (q.state) query.state = String(q.state).toLowerCase(); // API expects lowercase like "tx"
  // Optional: housing_chars, utility_list (can be "true" string or boolean)
  if (q.housing_chars !== undefined && q.housing_chars !== null) {
    query.housing_chars = q.housing_chars === true || q.housing_chars === 'true' ? 'true' : String(q.housing_chars);
  }
  if (q.utility_list !== undefined && q.utility_list !== null) {
    query.utility_list = q.utility_list === true || q.utility_list === 'true' ? 'true' : String(q.utility_list);
  }
  // Pass through any other keys
  for (const [k, v] of Object.entries(q)) {
    if (['address','city','state','zip','housing_chars','utility_list'].includes(k)) continue;
    if (v === undefined || v === null) continue;
    query[k] = String(v);
  }
  const url = `${BASE}/electricity/info${qs(query)}`;
  return safeFetchJSON<any>(url, { timeoutMs: 15000, retries: 2 });
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
