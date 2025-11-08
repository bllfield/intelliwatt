import { getOffersForAddress } from '@/lib/wattbuy/client';
import { assertNodeRuntime } from '@/lib/node/_guard';

assertNodeRuntime();

type WattkeyParams = { wattkey: string };
type AddressParams = { address: string; city: string; state: string; zip: string };

type Params = WattkeyParams | AddressParams;

export async function syncWattbuyOffers(params: Params) {
  if ('wattkey' in params) {
    // Fallback: WattBuy API supports wattkey via offers endpoint; defer to address lookup for now.
    // Returning an empty array prevents callers from crashing and makes the missing feature obvious.
    return [];
  }
  const { address, city, state, zip } = params;
  return getOffersForAddress({ line1: address, city, state, zip });
}
