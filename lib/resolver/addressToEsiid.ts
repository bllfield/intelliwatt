// lib/resolver/addressToEsiid.ts
// Provider-agnostic wrapper for address → ESIID resolution
// Currently uses WattBuy, but can be extended to support other providers

import { lookupEsiId, type EsiLookupInput, type EsiLookupResult } from '@/lib/wattbuy/client';

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
  const result = await lookupEsiId({
    line1: addr.line1,
    city: addr.city,
    state: addr.state,
    zip: addr.zip,
  });

  return {
    esiid: result.esiid,
    utility: result.utility,
    territory: result.territory,
    raw: result.raw,
  };
}

