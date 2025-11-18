// lib/resolver/addressToEsiid.ts
// Provider-agnostic wrapper for address → ESIID resolution
// Currently uses WattBuy, but can be extended to support other providers

import { wbGetElectricityInfo } from '@/lib/wattbuy/client';
import { composeWattbuyAddress, formatUnitForWattbuy } from '@/lib/wattbuy/formatAddress';
import { extractEsiidDetails } from '@/lib/wattbuy/extractEsiid';

export type AddressInput = {
  line1: string;
  line1Alt?: string | null;
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

function abbreviateDirections(line: string): string {
  const directionMap: Record<string, string> = {
    northeast: 'NE',
    northwest: 'NW',
    southeast: 'SE',
    southwest: 'SW',
    north: 'N',
    south: 'S',
    east: 'E',
    west: 'W',
  };
  let result = line;
  for (const [word, abbr] of Object.entries(directionMap)) {
    const regex = new RegExp(`\\b${word}\\b`, 'gi');
    result = result.replace(regex, abbr);
  }
  return result;
}

async function fetchWattbuyInfo(compositeLine1: string, addr: AddressInput, providerLine2: string | null) {
  console.log('[resolveAddressToEsiid] request', {
    line1: compositeLine1,
    originalLine1: addr.line1,
    line1Alt: addr.line1Alt ?? null,
    line2: providerLine2,
    city: addr.city,
    state: addr.state,
    zip: addr.zip,
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
      compositeLine1,
    });
  }

  return info;
}

/**
 * Resolve address to ESIID using the configured provider (currently WattBuy).
 * Returns null esiid if not found, with error details in raw.
 */
export async function resolveAddressToEsiid(addr: AddressInput): Promise<AddressResolveResult> {
  try {
    const trimmedLine2 =
      typeof addr.line2 === 'string' && addr.line2.trim().length > 0 ? addr.line2.trim() : null;

    let formattedUnit = formatUnitForWattbuy(addr.line2 ?? null);
    if (!formattedUnit && trimmedLine2) {
      formattedUnit = formatUnitForWattbuy(trimmedLine2);
    }

    const unitPattern =
      /(,?\s*(?:apt|apartment|unit|suite|ste|building|bldg|#)\s*[A-Za-z0-9#-]+(?:\s+[A-Za-z0-9#-]+)*)$/i;

    const trimValue = (value: string | null | undefined) => (value ? value.replace(/\s+/g, ' ').trim() : null);
    const candidateLine1 = [addr.line1, addr.line1Alt].map((value) => trimValue(value)).filter(Boolean) as string[];

    let fallbackInfo: Awaited<ReturnType<typeof fetchWattbuyInfo>> | null = null;

    const variants = new Set<string>();
    for (const variant of candidateLine1) {
      variants.add(variant);
      variants.add(abbreviateDirections(variant));
    }

    const variantList = Array.from(variants);
    for (let i = 0; i < variantList.length; i += 1) {
      const variant = variantList[i];
      if (!variant) continue;

      const cleanedVariant = variant.replace(unitPattern, '').replace(/\s+/g, ' ').trim();
      const compositeLine1 = composeWattbuyAddress(cleanedVariant, trimmedLine2);
      const providerLine2 = formatUnitForWattbuy(trimmedLine2);

      const info = await fetchWattbuyInfo(compositeLine1, addr, providerLine2);
      fallbackInfo = info;

      if (!info.ok) {
        continue;
      }

      const data = info.data ?? null;
      const details = extractEsiidDetails(data);
      console.log('[resolveAddressToEsiid] response', {
        hasEsiid: Boolean(details.esiid),
        utility: details.utility ?? null,
        territory: details.territory ?? null,
        compositeLine1,
      });

      if (details.esiid) {
        return {
          esiid: details.esiid,
          utility: details.utility,
          territory: details.territory,
          raw: data,
        };
      }
    }

    return {
      esiid: null,
      utility: null,
      territory: null,
      raw: fallbackInfo?.data ?? {
        status: fallbackInfo?.status ?? null,
        body: fallbackInfo?.text ?? null,
      },
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

