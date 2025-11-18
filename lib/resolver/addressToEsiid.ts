// lib/resolver/addressToEsiid.ts
// Provider-agnostic wrapper for address → ESIID resolution
// Currently uses WattBuy, but can be extended to support other providers

import { wbGetElectricityInfo } from '@/lib/wattbuy/client';
import { extractEsiidDetails } from '@/lib/wattbuy/extractEsiid';

export type AddressInput = {
  line1: string;
  city: string;
  state: string;
  zip: string;
};

export type AddressResolveResult = {
  esiid: string | null;
  utility?: string | null;
  territory?: string | null;
  raw?: any;
};

/**
 * Resolve address to ESIID using the configured provider (currently WattBuy).
 * Returns null esiid if not found, with error details in raw.
 */
export async function resolveAddressToEsiid(addr: AddressInput): Promise<AddressResolveResult> {
  try {
    console.log("[resolveAddressToEsiid] request", addr);
    const info = await wbGetElectricityInfo({
      address: addr.line1,
      city: addr.city,
      state: addr.state,
      zip: addr.zip,
      utility_list: 'true',
    });

    if (!info.ok) {
      console.warn("[resolveAddressToEsiid] wattbuy request failed", {
        status: info.status,
        text: info.text ?? null,
      });
      return {
        esiid: null,
        utility: null,
        territory: null,
        raw: { status: info.status, body: info.text ?? null },
      };
    }

    const data = info.data ?? null;
    const details = extractEsiidDetails(data);
    console.log("[resolveAddressToEsiid] response", {
      status: info.status,
      hasEsiid: Boolean(details.esiid),
      utility: details.utility ?? null,
      territory: details.territory ?? null,
    });

    return {
      esiid: details.esiid,
      utility: details.utility,
      territory: details.territory,
      raw: data,
    };
  } catch (err) {
    console.error("[resolveAddressToEsiid] error", err);
    return {
      esiid: null,
      utility: null,
      territory: null,
      raw: { error: err instanceof Error ? err.message : String(err) },
    };
  }
}

