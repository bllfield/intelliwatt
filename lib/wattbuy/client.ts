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

export async function getRetailRates(params: any) {
  assertKey();
  const url = `${BASE}/retail-rates${qs(params)}`;
  return safeFetchJSON<any>(url);
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

export class WattBuyClient {
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
