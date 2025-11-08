// lib/wattbuy/params.ts

export function normalizeRetailRateParams(input: {
  zip?: string | number;
  state?: string;
  utility_id?: string;     // API parameter: Numeric string of utility_id (EIA utility ID)
}): Record<string, string> {
  const out: Record<string, string> = {};
  if (input.zip !== undefined) out.zip = String(input.zip);
  const state = input.state ? String(input.state).toUpperCase() : undefined;
  if (state) out.state = state;
  const util = input.utility_id; // use utility_id (snake_case)
  if (util) out.utility_id = String(util);
  return out;
}

export function normalizeElectricityParams(input: {
  address?: string;
  city?: string;
  state?: string;
  zip?: string | number;
}): Record<string, string> {
  const out: Record<string, string> = {};
  if (input.address) out.address = input.address;
  if (input.city) out.city = input.city;
  if (input.state) out.state = String(input.state).toUpperCase();
  if (input.zip !== undefined) out.zip = String(input.zip);
  return out;
}

