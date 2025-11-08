// lib/wattbuy/derive.ts

import { wbGet } from './client';

import { electricityInfoParams } from './params';

/**
 * Derive { utilityID, state } from an address by calling /v3/electricity/info.
 * - Prefers deregulated utilities in the returned utility_list.
 * - Falls back to a matching distributor (Oncor, CenterPoint, TNMP, AEP Central/North) if present.
 * Returns undefined if nothing usable is found.
 */
export async function deriveUtilityFromAddress(input: {
  address?: string;
  city?: string;
  state?: string;   // lower/upper accepted; we lower it internally
  zip: string | number;
}) : Promise<{ utilityID: string; state: string } | undefined> {
  const state = String(input.state ?? '').toLowerCase() || 'tx';
  const params = electricityInfoParams({
    address: input.address,
    city: input.city,
    state,
    zip: input.zip,
    housing_chars: 'false',
    utility_list: 'true',
  });

  const info = await wbGet<any>('electricity/info', params, undefined, 1);
  if (!info.ok) return undefined;

  // utility_list items may include deregulated utilities; prefer those.
  const list: any[] = Array.isArray(info.data?.utility_list) ? info.data.utility_list : [];
  // Prefer well-known TX TDSPs or any "deregulated" entry
  const prefer = ['Oncor', 'CenterPoint', 'Texas New Mexico Power', 'AEP North', 'AEP Central'];
  let candidate = list.find(u => u.type === 'deregulated') || list.find(u => prefer.includes(u.utility_name));

  // Some pages expose Oncor via "utility_info" with eid/company_id fields—try those as fallback.
  if (!candidate && Array.isArray(info.data?.utility_info) && info.data.utility_info.length > 0) {
    const ui = info.data.utility_info[0];
    if (ui?.eid) {
      return { utilityID: String(ui.eid), state };
    }
    if (ui?.company_id) {
      return { utilityID: String(ui.company_id), state };
    }
  }

  // From utility_list we prefer a utility_eid if available
  if (candidate?.utility_eid) {
    return { utilityID: String(candidate.utility_eid), state };
  }

  // If a TX TDSP name was matched but no eid was present, try common hard-codes (last resort)
  // (These are public EIA ids; keep minimal and only for TX TDSPs)
  const hardCodes: Record<string, string> = {
    'Oncor Electric Delivery': '44372',
    'Oncor': '44372',
    'CenterPoint': '8901',
    'Texas New Mexico Power': '40051',
    'AEP North': '20404',
    'AEP Central': '3278',
  };
  if (candidate?.utility_name && hardCodes[candidate.utility_name]) {
    return { utilityID: hardCodes[candidate.utility_name], state };
  }

  return undefined;
}

