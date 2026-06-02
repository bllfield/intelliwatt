import { convertGreenButtonPersistedRowsToHome } from "@/lib/time/greenButtonPersistedIntervalConvert";
import {
  homeProjectedIntervalFromRecord,
  type HomeProjectedIntervalPoint,
} from "@/lib/time/actualIntervalCalendar";
import { filterOutDstAmbiguousLocalDateKeys } from "@/lib/usage/dstAmbiguousLocalDateKey";
import { resolveGreenButtonPastSimTrustedHomeDateKeys } from "@/lib/usage/greenButtonPastTrustedPool";

function asDateKey(value: unknown): string | null {
  const text = String(value ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function dateKeyInRange(dateKey: string, startDate: string, endDate: string): boolean {
  return dateKey >= startDate && dateKey <= endDate;
}

/**
 * Stratified validation pool for Green Button Past Sim: home-local trusted days in the
 * coverage window (not Chicago 96/96 on raw UTC-grid timestamps).
 */
export function resolveGreenButtonPastValidationCandidateDateKeys(args: {
  trustedUtcDateKeys: readonly string[];
  intervals: ReadonlyArray<{ timestamp: string; kwh: number }>;
  timezone: string;
  windowStart: string;
  windowEnd: string;
  travelDateKeys?: ReadonlySet<string>;
  /** When set (e.g. from `loadGreenButtonPastProducerIntervals`), use producer home-local trust directly. */
  trustedHomeDateKeys?: Iterable<string>;
}): string[] {
  const windowStart = asDateKey(args.windowStart);
  const windowEnd = asDateKey(args.windowEnd);
  if (!windowStart || !windowEnd) return [];

  const trustedHome =
    args.trustedHomeDateKeys != null
      ? new Set(
          Array.from(args.trustedHomeDateKeys)
            .map((dk) => asDateKey(dk))
            .filter((dk): dk is string => Boolean(dk))
        )
      : (() => {
          const projected: HomeProjectedIntervalPoint[] = convertGreenButtonPersistedRowsToHome(
            args.intervals.map((row) => ({
              timestamp: new Date(row.timestamp),
              consumptionKwh: Number(row.kwh) || 0,
            })),
            args.timezone
          ).intervals.map(homeProjectedIntervalFromRecord);

          return resolveGreenButtonPastSimTrustedHomeDateKeys({
            trustedUtcDateKeys: args.trustedUtcDateKeys,
            intervals: projected,
            timezone: args.timezone,
          });
        })();

  const travel = args.travelDateKeys ?? new Set<string>();
  return filterOutDstAmbiguousLocalDateKeys(
    Array.from(trustedHome).filter((dk) => dateKeyInRange(dk, windowStart, windowEnd) && !travel.has(dk)),
    args.timezone
  );
}

/** Home-local actual daily totals for validation compare (Green Button Past). */
export function buildGreenButtonActualDailyKwhByHomeDateKey(args: {
  intervals: ReadonlyArray<{ timestamp: string; kwh: number; homeDateKey?: string }>;
  dateKeysLocal: Iterable<string>;
  timezone: string;
}): Record<string, number> {
  const wanted = new Set(
    Array.from(args.dateKeysLocal)
      .map((dk) => asDateKey(dk))
      .filter((dk): dk is string => Boolean(dk))
  );
  if (wanted.size === 0) return {};

  const totals = new Map<string, number>();
  const hasHomeDateKeys = args.intervals.some((row) => asDateKey(row.homeDateKey));
  if (hasHomeDateKeys) {
    for (const row of args.intervals) {
      const dk = asDateKey(row.homeDateKey);
      if (!dk || !wanted.has(dk)) continue;
      totals.set(dk, (totals.get(dk) ?? 0) + Math.max(0, Number(row.kwh) || 0));
    }
    return Object.fromEntries(
      Array.from(totals.entries())
        .map(([date, kwh]) => [date, Math.round(kwh * 100) / 100] as const)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    );
  }

  const projected = convertGreenButtonPersistedRowsToHome(
    args.intervals.map((row) => ({
      timestamp: new Date(row.timestamp),
      consumptionKwh: Number(row.kwh) || 0,
    })),
    args.timezone
  ).intervals.map(homeProjectedIntervalFromRecord);

  for (const row of projected) {
    const dk = asDateKey(row.homeDateKey);
    if (!dk || !wanted.has(dk)) continue;
    totals.set(dk, (totals.get(dk) ?? 0) + Math.max(0, Number(row.kwh) || 0));
  }

  return Object.fromEntries(
    Array.from(totals.entries())
      .map(([date, kwh]) => [date, Math.round(kwh * 100) / 100] as const)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  );
}
