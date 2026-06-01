/**
 * Shared home-local calendar helpers for actual interval payloads (Past sim, range fetch, completeness).
 */

import {
  createHomeIntervalCalendar,
  enumerateExpectedLocalSlotsForDate,
  enumerateLocalDateKeys,
  expectedSlotsForLocalDate,
  localDayBoundsUtc,
  type HomeIntervalCalendar,
  type HomeIntervalRecord,
} from "@/lib/time/homeIntervalCalendar";
import { resolveHomeTimezone } from "@/lib/time/resolveHomeTimezone";
import { smtCompletenessIntervalThreshold, smtRequiredSlotsForDateKey } from "@/lib/usage/smtWindowStatus";
import { greenButtonTrustedCompletenessThreshold } from "@/lib/time/greenButtonPersistedIntervalConvert";

const FIFTEEN_MIN_MS = 15 * 60 * 1000;

export type HomeProjectedIntervalPoint = {
  timestamp: string;
  kwh: number;
  homeDateKey: string;
  homeSlot: number;
  homeSlotsExpected: number;
};

export function homeProjectedIntervalFromRecord(row: HomeIntervalRecord): HomeProjectedIntervalPoint {
  return {
    timestamp: row.tsUtc,
    kwh: row.kwh,
    homeDateKey: row.homeDateKey,
    homeSlot: row.homeSlot,
    homeSlotsExpected: row.homeSlotsExpected,
  };
}

/** Prefer home-local date key when intervals were projected through homeIntervalCalendar. */
export function dateKeyFromIntervalPoint(p: {
  timestamp: string;
  homeDateKey?: string | null;
}): string {
  const homeKey = String(p.homeDateKey ?? "").slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(homeKey)) return homeKey;
  return String(p.timestamp ?? "").slice(0, 10);
}

export function trustedIntervalThresholdForDateKey(
  dateKey: string,
  source: "SMT" | "GREEN_BUTTON",
  home?: HomeIntervalCalendar,
): number {
  if (source === "SMT") {
    return smtCompletenessIntervalThreshold(smtRequiredSlotsForDateKey(dateKey));
  }
  const calendar =
    home ?? createHomeIntervalCalendar(resolveHomeTimezone({ preferredActualSource: "GREEN_BUTTON" }));
  return greenButtonTrustedCompletenessThreshold(dateKey, calendar);
}

export function countPresentSlotsForIntervalDay(
  intervals: ReadonlyArray<{ timestamp: string; homeSlot?: number | null }>,
  dateKey?: string,
): number {
  const slots = new Set<number>();
  for (const row of intervals) {
    if (dateKey) {
      const dk = dateKeyFromIntervalPoint(row);
      if (dk !== dateKey) continue;
    }
    if (typeof row.homeSlot === "number" && Number.isFinite(row.homeSlot)) {
      slots.add(Math.trunc(row.homeSlot));
      continue;
    }
  }
  return slots.size;
}

/**
 * Trusted-day completeness units: deduped interval-row count (aligned with `smtWindowStatus`).
 * Row count — not distinct home slots alone — so DST fall-back days with 96 vendor rows stay trusted.
 */
export function countPresentUnitsForIntervalDay(args: {
  intervals: ReadonlyArray<{ timestamp: string; homeSlot?: number | null; homeDateKey?: string | null }>;
  dateKey?: string;
  source: "SMT" | "GREEN_BUTTON";
}): number {
  const filtered = args.dateKey
    ? args.intervals.filter((row) => dateKeyFromIntervalPoint(row) === args.dateKey)
    : args.intervals;
  const seen = new Set<string>();
  let count = 0;
  for (const row of filtered) {
    const ts = String(row.timestamp ?? "").trim();
    if (!ts || seen.has(ts)) continue;
    seen.add(ts);
    count += 1;
  }
  return count;
}

export function dayMeetsTrustedIntervalThreshold(args: {
  intervals: ReadonlyArray<{ timestamp: string; homeSlot?: number | null; homeDateKey?: string | null }>;
  dateKey: string;
  source: "SMT" | "GREEN_BUTTON";
  home?: HomeIntervalCalendar;
}): boolean {
  const present = countPresentUnitsForIntervalDay({
    intervals: args.intervals,
    dateKey: args.dateKey,
    source: args.source,
  });
  return present >= trustedIntervalThresholdForDateKey(args.dateKey, args.source, args.home);
}

export function enumerateHomeDayStartsMsForWindow(
  startDateKey: string,
  endDateKey: string,
  home: HomeIntervalCalendar,
): number[] {
  return enumerateLocalDateKeys(startDateKey, endDateKey, home).map(
    (dateKey) => localDayBoundsUtc(dateKey, home).startUtc.getTime(),
  );
}

/** DST-aware 15-minute grid for one home-local calendar day. */
export function getHomeDayGridTimestamps(dateKey: string, home: HomeIntervalCalendar): string[] {
  const { startUtc, endUtcExclusive } = localDayBoundsUtc(dateKey, home);
  const out: string[] = [];
  for (let ms = startUtc.getTime(); ms < endUtcExclusive.getTime(); ms += FIFTEEN_MIN_MS) {
    out.push(new Date(ms).toISOString());
  }
  return out;
}

export function buildHomeDayGridContext(args: {
  startDateKey: string;
  endDateKey: string;
  home: HomeIntervalCalendar;
}): {
  canonicalDayStartsMs: number[];
  getDayGridTimestamps: (dayStartMs: number) => string[];
  dateKeyFromTimestamp: (ts: string) => string;
} {
  const dateKeys = enumerateLocalDateKeys(args.startDateKey, args.endDateKey, args.home);
  const dateKeyByDayStartMs = new Map<number, string>();
  const canonicalDayStartsMs: number[] = [];
  for (const dateKey of dateKeys) {
    const dayStartMs = localDayBoundsUtc(dateKey, args.home).startUtc.getTime();
    dateKeyByDayStartMs.set(dayStartMs, dateKey);
    canonicalDayStartsMs.push(dayStartMs);
  }
  return {
    canonicalDayStartsMs,
    getDayGridTimestamps: (dayStartMs: number) => {
      const dateKey = dateKeyByDayStartMs.get(dayStartMs);
      return dateKey ? getHomeDayGridTimestamps(dateKey, args.home) : [];
    },
    dateKeyFromTimestamp: (ts: string) => dateKeyFromIntervalPoint({ timestamp: ts }),
  };
}

export function resolveHomeCalendarForActualSource(
  source: "SMT" | "GREEN_BUTTON",
  homeTimezone?: string,
): HomeIntervalCalendar {
  const tz =
    homeTimezone?.trim() ||
    resolveHomeTimezone({ preferredActualSource: source === "SMT" ? "SMT" : "GREEN_BUTTON" });
  return createHomeIntervalCalendar(tz);
}

export function expectedSlotsForDateKey(dateKey: string, home: HomeIntervalCalendar): number {
  return expectedSlotsForLocalDate(dateKey, home);
}

export { enumerateExpectedLocalSlotsForDate };
