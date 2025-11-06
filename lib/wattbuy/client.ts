// lib/wattbuy/client.ts
// WattBuy ESIID lookup client (address -> esiid).
// Reads WATTBUY_API_KEY from env.

const BASE = process.env.WATTBUY_BASE_URL || 'https://apis.wattbuy.com/v3';

export type EsiLookupInput = { line1: string; city: string; state: string; zip: string };

export type EsiLookupResult = {
  esiid: string | null;
  utility?: string | null;
  territory?: string | null;
  raw?: any;
};

export async function lookupEsiId(addr: EsiLookupInput): Promise<EsiLookupResult> {
  const apiKey = process.env.WATTBUY_API_KEY;
  if (!apiKey) throw new Error('Missing WATTBUY_API_KEY');

  const query = new URLSearchParams({
    address_line1: addr.line1,
    address_city: addr.city,
    address_state: addr.state,
    address_zip: addr.zip,
  });

  const url = `${BASE}/electricity/info/esi?${query.toString()}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
  const text = await res.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }

  if (!res.ok) throw new Error(`WattBuy ESI lookup failed ${res.status}: ${text}`);

  // Map conservative shapes
  const esiid = json?.esi || json?.esiid || json?.data?.esi || null;
  const utility = json?.utility || json?.data?.utility || null;
  const territory = json?.territory || json?.data?.territory || null;

  return { esiid, utility, territory, raw: json };
}
