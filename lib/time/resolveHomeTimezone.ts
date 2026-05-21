/**
 * Single source of truth for per-home IANA timezone (meter-local / plan-local).
 */

import { SMT_DEFAULT_HOME_TIMEZONE } from "@/lib/time/homeIntervalCalendar";

export type HomeTimezoneInput = {
  /** Explicit override when present on house or build inputs. */
  timezone?: string | null;
  addressState?: string | null;
  /** Texas SMT meters are Central; used when address is missing. */
  preferredActualSource?: "SMT" | "GREEN_BUTTON" | null;
};

const US_STATE_TZ: Record<string, string> = {
  AL: "America/Chicago",
  AK: "America/Anchorage",
  AZ: "America/Phoenix",
  AR: "America/Chicago",
  CA: "America/Los_Angeles",
  CO: "America/Denver",
  CT: "America/New_York",
  DE: "America/New_York",
  DC: "America/New_York",
  FL: "America/New_York",
  GA: "America/New_York",
  HI: "Pacific/Honolulu",
  ID: "America/Boise",
  IL: "America/Chicago",
  IN: "America/Indiana/Indianapolis",
  IA: "America/Chicago",
  KS: "America/Chicago",
  KY: "America/New_York",
  LA: "America/Chicago",
  ME: "America/New_York",
  MD: "America/New_York",
  MA: "America/New_York",
  MI: "America/Detroit",
  MN: "America/Chicago",
  MS: "America/Chicago",
  MO: "America/Chicago",
  MT: "America/Denver",
  NE: "America/Chicago",
  NV: "America/Los_Angeles",
  NH: "America/New_York",
  NJ: "America/New_York",
  NM: "America/Denver",
  NY: "America/New_York",
  NC: "America/New_York",
  ND: "America/Chicago",
  OH: "America/New_York",
  OK: "America/Chicago",
  OR: "America/Los_Angeles",
  PA: "America/New_York",
  RI: "America/New_York",
  SC: "America/New_York",
  SD: "America/Chicago",
  TN: "America/Chicago",
  TX: "America/Chicago",
  UT: "America/Denver",
  VT: "America/New_York",
  VA: "America/New_York",
  WA: "America/Los_Angeles",
  WV: "America/New_York",
  WI: "America/Chicago",
  WY: "America/Denver",
};

function normalizeUsState(value: unknown): string | null {
  const raw = String(value ?? "").trim().toUpperCase();
  if (!raw) return null;
  if (/^[A-Z]{2}$/.test(raw)) return raw;
  return null;
}

function isValidIanaTimezone(value: string): boolean {
  const zone = String(value ?? "").trim();
  if (!zone) return false;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

export function timezoneFromUsState(state: string | null | undefined): string | null {
  const code = normalizeUsState(state);
  if (!code) return null;
  return US_STATE_TZ[code] ?? null;
}

/**
 * Resolve the home-local timezone for interval grouping, baseload, plans, and dataset meta.
 */
export function resolveHomeTimezone(house: HomeTimezoneInput): string {
  const explicit = String(house.timezone ?? "").trim();
  if (explicit && isValidIanaTimezone(explicit)) return explicit;

  const fromState = timezoneFromUsState(house.addressState);
  if (fromState) return fromState;

  if (house.preferredActualSource === "SMT") return SMT_DEFAULT_HOME_TIMEZONE;

  return SMT_DEFAULT_HOME_TIMEZONE;
}
