import { DateTime } from 'luxon';

// TZ_BUILD_ID is surfaced in some diagnostics/admin tooling; bump when parsing semantics change.
export const TZ_BUILD_ID = 'us-tz-deterministic-v1';
export type AmbiguousPolicy = 'earlier' | 'later';

type UsZoneRule = {
  /** Standard-time UTC offset minutes (e.g., Central = -360). */
  stdOffsetMinutes: number;
  /** Daylight-time UTC offset minutes (e.g., Central DST = -300). */
  dstOffsetMinutes: number;
  /** Whether this zone observes US DST. */
  observesDst: boolean;
};

// Core US timezones + key no-DST zones/territories.
// Goal: deterministic parsing without requiring a tz database for these zones.
const US_ZONE_RULES: Record<string, UsZoneRule> = {
  // Contiguous US
  'America/New_York': { stdOffsetMinutes: -300, dstOffsetMinutes: -240, observesDst: true }, // Eastern
  'America/Chicago': { stdOffsetMinutes: -360, dstOffsetMinutes: -300, observesDst: true }, // Central
  'America/Denver': { stdOffsetMinutes: -420, dstOffsetMinutes: -360, observesDst: true }, // Mountain
  'America/Los_Angeles': { stdOffsetMinutes: -480, dstOffsetMinutes: -420, observesDst: true }, // Pacific

  // Common no-DST exception
  'America/Phoenix': { stdOffsetMinutes: -420, dstOffsetMinutes: -420, observesDst: false }, // Arizona (statewide, excluding Navajo)

  // Alaska / Aleutian / Hawaii
  'America/Anchorage': { stdOffsetMinutes: -540, dstOffsetMinutes: -480, observesDst: true }, // Alaska
  'America/Adak': { stdOffsetMinutes: -600, dstOffsetMinutes: -540, observesDst: true }, // Aleutian (Adak)
  'Pacific/Honolulu': { stdOffsetMinutes: -600, dstOffsetMinutes: -600, observesDst: false }, // Hawaii

  // US territories (no DST)
  'America/Puerto_Rico': { stdOffsetMinutes: -240, dstOffsetMinutes: -240, observesDst: false },
  'America/St_Thomas': { stdOffsetMinutes: -240, dstOffsetMinutes: -240, observesDst: false }, // USVI
  'Pacific/Guam': { stdOffsetMinutes: 600, dstOffsetMinutes: 600, observesDst: false },
  'Pacific/Saipan': { stdOffsetMinutes: 600, dstOffsetMinutes: 600, observesDst: false }, // CNMI
  'Pacific/Pago_Pago': { stdOffsetMinutes: -660, dstOffsetMinutes: -660, observesDst: false }, // American Samoa
};

function nthWeekdayOfMonthUtcDay(year: number, month0: number, weekday0: number, n: number): number {
  const first = new Date(Date.UTC(year, month0, 1));
  const firstDow = first.getUTCDay();
  const delta = (weekday0 - firstDow + 7) % 7;
  return 1 + delta + (n - 1) * 7;
}

function isUsDstDateLocal(args: {
  year: number;
  month0: number;
  day: number;
  hour: number;
  minute: number;
}): boolean {
  // US DST rule (2007+): second Sunday in March @ 02:00 local, first Sunday in Nov @ 02:00 local.
  // We intentionally apply this only for zones we mark as observesDst.
  const { year, month0, day, hour, minute } = args;
  if (month0 < 2 || month0 > 10) return false; // Jan/Feb/Dec
  if (month0 > 2 && month0 < 10) return true; // Apr-Oct

  const minutesOfDay = hour * 60 + minute;

  if (month0 === 2) {
    const startDay = nthWeekdayOfMonthUtcDay(year, 2, 0, 2);
    if (day < startDay) return false;
    if (day > startDay) return true;
    return minutesOfDay >= 2 * 60;
  }

  // November
  const endDay = nthWeekdayOfMonthUtcDay(year, 10, 0, 1);
  if (day < endDay) return true;
  if (day > endDay) return false;
  return minutesOfDay < 2 * 60;
}

function isUsDstEndDay(year: number, month0: number, day: number): boolean {
  if (month0 !== 10) return false;
  const endDay = nthWeekdayOfMonthUtcDay(year, 10, 0, 1);
  return day === endDay;
}

function resolveUsRuleForZone(zone: string): UsZoneRule | null {
  const z = String(zone ?? '').trim();
  if (!z) return null;
  return US_ZONE_RULES[z] ?? null;
}

function parseOffsetAwareDate(isoish: string): Date | null {
  const d = new Date(isoish);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseYmdLocal(isoish: string): {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
} | null {
  const m = isoish.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  const [, Y, M, D, h, mm, ss] = m;
  return {
    year: Number(Y),
    month: Number(M),
    day: Number(D),
    hour: Number(h),
    minute: Number(mm),
    second: Number(ss ?? '0'),
  };
}

function localWallTimeToUtcDateDeterministic(args: {
  year: number;
  month0: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  zone: string;
  ambiguous: AmbiguousPolicy;
}): Date | null {
  const rule = resolveUsRuleForZone(args.zone);
  if (!rule) return null;

  // Spring-forward gap: local 02:xx does not exist (for DST-observing zones).
  // Keep prior behavior: snap deterministically to 03:00:00 local.
  let hour = args.hour;
  let minute = args.minute;
  let second = args.second;
  if (rule.observesDst && hour === 2) {
    hour = 3;
    minute = 0;
    second = 0;
  }

  const isDst =
    rule.observesDst &&
    isUsDstDateLocal({ year: args.year, month0: args.month0, day: args.day, hour, minute });

  // Fall-back ambiguous hour: on DST end day, 01:00-01:59 occurs twice.
  // - "earlier" => DST instance
  // - "later"   => standard instance
  const ambiguousFallBack =
    rule.observesDst &&
    isUsDstEndDay(args.year, args.month0, args.day) &&
    hour === 1;

  const offsetMinutes = ambiguousFallBack
    ? args.ambiguous === 'later'
      ? rule.stdOffsetMinutes
      : rule.dstOffsetMinutes
    : isDst
      ? rule.dstOffsetMinutes
      : rule.stdOffsetMinutes;

  const localAsUtcMs = Date.UTC(args.year, args.month0, args.day, hour, minute, second);
  const utcMs = localAsUtcMs - offsetMinutes * 60000;
  const d = new Date(utcMs);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function parseInZoneToUTC(
  s: string,
  zone: string = 'America/Chicago',
  ambiguous: AmbiguousPolicy = 'earlier'
): Date | null {
  if (!s) return null;

  const isoish = s.includes('T') ? s : s.replace(' ', 'T');

  // Trust explicit offsets as-is.
  const hasOffset = /[+-]\d{2}:\d{2}$/.test(isoish) || /Z$/.test(isoish);
  if (hasOffset) {
    // No Luxon required when the string already carries timezone info.
    return parseOffsetAwareDate(isoish);
  }

  // Deterministic fast-path for core US zones (and key no-DST US zones/territories).
  // If the zone is not in our supported set, fall back to Luxon (tzdb-backed).
  const ymd = parseYmdLocal(isoish);
  if (ymd) {
    const d = localWallTimeToUtcDateDeterministic({
      year: ymd.year,
      month0: ymd.month - 1,
      day: ymd.day,
      hour: ymd.hour,
      minute: ymd.minute,
      second: ymd.second,
      zone,
      ambiguous,
    });
    if (d) return d;
  }

  // Fallback: Luxon (non-US zones or non-parseable formats).
  const dt = DateTime.fromISO(isoish, { zone });
  return dt.isValid ? dt.toUTC().toJSDate() : null;
}
