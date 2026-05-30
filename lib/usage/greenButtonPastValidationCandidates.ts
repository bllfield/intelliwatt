import { convertGreenButtonPersistedRowsToHome } from "@/lib/time/greenButtonPersistedIntervalConvert";
import {
  homeProjectedIntervalFromRecord,
  type HomeProjectedIntervalPoint,
} from "@/lib/time/actualIntervalCalendar";
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
}): string[] {
  const windowStart = asDateKey(args.windowStart);
  const windowEnd = asDateKey(args.windowEnd);
  if (!windowStart || !windowEnd) return [];

  const projected: HomeProjectedIntervalPoint[] = convertGreenButtonPersistedRowsToHome(
    args.intervals.map((row) => ({
      timestamp: new Date(row.timestamp),
      consumptionKwh: Number(row.kwh) || 0,
    })),
    args.timezone
  ).intervals.map(homeProjectedIntervalFromRecord);

  const trustedHome = resolveGreenButtonPastSimTrustedHomeDateKeys({
    trustedUtcDateKeys: args.trustedUtcDateKeys,
    intervals: projected,
    timezone: args.timezone,
  });

  const travel = args.travelDateKeys ?? new Set<string>();
  return Array.from(trustedHome)
    .filter((dk) => dateKeyInRange(dk, windowStart, windowEnd) && !travel.has(dk))
    .sort((left, right) => left.localeCompare(right));
}

/** Home-local actual daily totals for validation compare (Green Button Past). */
export function buildGreenButtonActualDailyKwhByHomeDateKey(args: {
  intervals: ReadonlyArray<{ timestamp: string; kwh: number }>;
  dateKeysLocal: Iterable<string>;
  timezone: string;
}): Record<string, number> {
  const wanted = new Set(
    Array.from(args.dateKeysLocal)
      .map((dk) => asDateKey(dk))
      .filter((dk): dk is string => Boolean(dk))
  );
  if (wanted.size === 0) return {};

  const projected = convertGreenButtonPersistedRowsToHome(
    args.intervals.map((row) => ({
      timestamp: new Date(row.timestamp),
      consumptionKwh: Number(row.kwh) || 0,
    })),
    args.timezone
  ).intervals.map(homeProjectedIntervalFromRecord);

  const totals = new Map<string, number>();
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
