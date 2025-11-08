// lib/wattbuy/params.ts

// NOTE: WattBuy test page shows camelCase/specific names and lowercase state.
// Do not snake_case. Do not uppercase state.

export function retailRatesParams(input: {
  utilityID?: string | number;
  state?: string; // lowercase
  zip?: string | number;
}): Record<string, string> {
  const out: Record<string, string> = {};
  if (input.utilityID != null) out.utilityID = String(input.utilityID);
  if (input.state) out.state = String(input.state).toLowerCase();
  if (input.zip != null) out.zip = String(input.zip);
  return out;
}

export function electricityParams(input: {
  address?: string;
  city?: string;
  state?: string; // lowercase
  zip: string | number;
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
  zip: string | number;
  housing_chars?: boolean | string;
  utility_list?: boolean | string;
}): Record<string, string> {
  const out = electricityParams(input);
  if (input.housing_chars !== undefined) out.housing_chars = String(input.housing_chars);
  if (input.utility_list !== undefined) out.utility_list = String(input.utility_list);
  return out;
}
