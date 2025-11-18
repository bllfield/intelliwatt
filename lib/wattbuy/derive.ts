// lib/wattbuy/derive.ts

import { wbGet } from './client';
import { composeWattbuyAddress } from './formatAddress';
import { electricityInfoParams } from './params';

/**
 * Derive { utilityID, state, utilityList } from an address by calling /v3/electricity/info.
 * - Prefers deregulated utilities in the returned utility_list.
 * - Falls back to a matching distributor (Oncor, CenterPoint, TNMP, AEP Central/North) if present.
 * - Returns utilityList so callers can try alternates if the first utility returns 204/empty.
 * Returns undefined if electricity/info call fails.
 */
export async function deriveUtilityFromAddress(input: {
  address?: string;
  unit?: string | null;
  city?: string;
  state?: string;   // lower/upper accepted; we lower it internally
  zip: string | number;
}) : Promise<{ utilityID: string; state: string; utilityList?: Array<{ utility_eid?: number; utility_name?: string; type?: string }> } | undefined> {
  const state = String(input.state ?? '').toLowerCase() || 'tx';
  const composite = composeWattbuyAddress(input.address ?? '', input.unit ?? null);
  const params = electricityInfoParams({
    address: composite,
    city: input.city,
    state,
    zip: input.zip,
    housing_chars: 'false',
    utility_list: 'true',
  });

  const info = await wbGet<any>('electricity/info', params, undefined, 1);
  if (!info.ok) return undefined;

  const list: any[] = Array.isArray(info.data?.utility_list) ? info.data.utility_list : [];
  const prefer = ['Oncor', 'CenterPoint', 'Texas New Mexico Power', 'AEP North', 'AEP Central'];
  let candidate = list.find(u => u.type === 'deregulated') || list.find(u => prefer.includes(u.utility_name));

  // fallback via utility_info fields
  if (!candidate && Array.isArray(info.data?.utility_info) && info.data.utility_info.length > 0) {
    const ui = info.data.utility_info[0];
    if (ui?.eid) {
      return { utilityID: String(ui.eid), state, utilityList: list };
    }
    if (ui?.company_id) {
      return { utilityID: String(ui.company_id), state, utilityList: list };
    }
  }

  // pick an eid from utility_list if present
  if (candidate?.utility_eid) {
    return { utilityID: String(candidate.utility_eid), state, utilityList: list };
  }

  // hard-codes last resort
  const hardCodes: Record<string, string> = {
    'Oncor Electric Delivery': '44372',
    'Oncor': '44372',
    'CenterPoint': '8901',
    'Texas New Mexico Power': '40051',
    'AEP North': '20404',
    'AEP Central': '3278',
  };
  if (candidate?.utility_name && hardCodes[candidate.utility_name]) {
    return { utilityID: hardCodes[candidate.utility_name], state, utilityList: list };
  }

  return { utilityID: '', state, utilityList: list };
}
