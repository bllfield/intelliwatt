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
    const info = await wbGetElectricityInfo({
      address: addr.line1,
      city: addr.city,
      state: addr.state,
      zip: addr.zip,
      utility_list: 'true',
    });

    if (!info.ok) {
      return {
        esiid: null,
        utility: null,
        territory: null,
        raw: { status: info.status, body: info.text ?? null },
      };
    }

    const data = info.data ?? null;
    const details = extractEsiidDetails(data);

    return {
      esiid: details.esiid,
      utility: details.utility,
      territory: details.territory,
      raw: data,
    };
  } catch (err) {
    return {
      esiid: null,
      utility: null,
      territory: null,
      raw: { error: err instanceof Error ? err.message : String(err) },
    };
  }
}

