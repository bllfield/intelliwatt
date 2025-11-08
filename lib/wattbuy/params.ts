// lib/wattbuy/params.ts

// NOTE: WattBuy test page shows camelCase/specific names and lowercase state.
// Do not snake_case. Do not uppercase state.

export function retailRatesParams(input: {
  utilityID?: string | number;
  state: string; // required by their test page
}): Record<string, string> {
  const out: Record<string, string> = {};
  if (input.utilityID !== undefined) out.utilityID = String(input.utilityID);
  // state must be two-letter lowercase (per examples)
  out.state = String(input.state).toLowerCase();
  return out;
}

export function electricityParams(input: {
  address?: string; // raw string (do not pre-encode)
  city?: string;
  state?: string; // lowercase 2-letter
  zip: string | number; // required
}): Record<string, string> {
  const out: Record<string, string> = {};
  if (input.address) out.address = input.address;
  if (input.city) out.city = input.city;
  if (input.state) out.state = String(input.state).toLowerCase();
  out.zip = String(input.zip);
  return out;
}

export function electricityInfoParams(input: {
  address?: string;
  city?: string;
  state?: string; // lowercase
  zip: string | number; // required
  housing_chars?: boolean | string;
  utility_list?: boolean | string;
}): Record<string, string> {
  const out = electricityParams(input);
  if (input.housing_chars !== undefined) out.housing_chars = String(input.housing_chars);
  if (input.utility_list !== undefined) out.utility_list = String(input.utility_list);
  return out;
}
