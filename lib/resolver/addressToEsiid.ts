// lib/resolver/addressToEsiid.ts
// Provider-agnostic wrapper for address → ESIID resolution
// Currently uses WattBuy, but can be extended to support other providers

import { wbGetElectricityInfo } from '@/lib/wattbuy/client';
import { extractEsiidDetails } from '@/lib/wattbuy/extractEsiid';

export type AddressInput = {
  line1: string;
  line2?: string | null;
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
function formatProviderLine2(rawLine2: string | null | undefined): string | null {
  if (!rawLine2) return null;
  const trimmed = rawLine2.trim();
  if (!trimmed) return null;

  const normalized = trimmed.replace(/\s+/g, ' ');
  const lower = normalized.toLowerCase();

  // If it already describes the unit (apt, unit, suite, #, etc), respect it.
  const knownPrefixes = ['apt', 'apartment', 'unit', 'suite', 'ste', 'building', 'bldg', '#'];
  if (
    knownPrefixes.some((prefix) => lower.startsWith(prefix)) ||
    /[a-z]/.test(lower.replace(/^#/, '').trim())
  ) {
    // ensure we don't leave a bare "#" with no space
    if (normalized.startsWith('#') && normalized.length > 1) {
      return `Apt ${normalized.slice(1).trim()}`;
    }
    return normalized;
  }

  return `Apt ${normalized}`;
}

export async function resolveAddressToEsiid(addr: AddressInput): Promise<AddressResolveResult> {
  try {
    const trimmedLine2 =
      typeof addr.line2 === 'string' && addr.line2.trim().length > 0 ? addr.line2.trim() : null;
    const providerLine2 = formatProviderLine2(trimmedLine2);
    const compositeLine1 = providerLine2 ? `${addr.line1}, ${providerLine2}` : addr.line1;

    console.log('[resolveAddressToEsiid] request', {
      ...addr,
      line2: trimmedLine2,
      providerLine2,
      compositeLine1,
    });

    const info = await wbGetElectricityInfo({
      address: compositeLine1,
      city: addr.city,
      state: addr.state,
      zip: addr.zip,
      utility_list: 'true',
    });

    if (!info.ok) {
      console.warn('[resolveAddressToEsiid] wattbuy request failed', {
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
    console.log('[resolveAddressToEsiid] response', {
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
    console.error('[resolveAddressToEsiid] error', err);
    return {
      esiid: null,
      utility: null,
      territory: null,
      raw: { error: err instanceof Error ? err.message : String(err) },
    };
  }
}

