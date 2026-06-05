import { DateTime } from "luxon";
import {
  canonicalUsageWindowChicago,
  enumerateDateKeysInclusive,
  prevCalendarDayDateKey,
  smtCoverageDateKey,
} from "@/lib/time/chicago";
import {
  CANONICAL_COVERAGE_LAG_DAYS,
  CANONICAL_COVERAGE_TOTAL_DAYS,
} from "@/lib/usage/canonicalCoverageConfig";

export type CoverageWindow = { startDate: string; endDate: string };

export type CanonicalCoverageWindowPolicy = {
  canonicalCoverageLagDays?: number;
  canonicalCoverageTotalDays?: number;
};

const YYYY_MM_DD = /^\d{4}-\d{2}-\d{2}$/;

function normalizeDateKey(v: unknown): string | null {
  const s = String(v ?? "").slice(0, 10);
  return YYYY_MM_DD.test(s) ? s : null;
}

/**
 * Shared payload/report framing window for simulator metadata surfaces.
 * Prefer dataset.summary bounds when present; fall back to provided bounds.
 */
export function resolveReportedCoverageWindow(args: {
  dataset: any;
  fallbackStartDate: string;
  fallbackEndDate: string;
}): CoverageWindow {
  const fallbackStart = normalizeDateKey(args.fallbackStartDate) ?? String(args.fallbackStartDate).slice(0, 10);
  const fallbackEnd = normalizeDateKey(args.fallbackEndDate) ?? String(args.fallbackEndDate).slice(0, 10);
  const summaryStart = normalizeDateKey(args?.dataset?.summary?.start);
  const summaryEnd = normalizeDateKey(args?.dataset?.summary?.end);
  return {
    startDate: summaryStart ?? fallbackStart,
    endDate: summaryEnd ?? fallbackEnd,
  };
}

export function boundDateKeysToCoverageWindow(
  dateKeys: string[] | ReadonlyArray<string> | Set<string>,
  window: CoverageWindow
): Set<string> {
  const out = new Set<string>();
  if (Array.isArray(dateKeys)) {
    for (let i = 0; i < dateKeys.length; i += 1) {
      const key = normalizeDateKey(dateKeys[i]);
      if (!key) continue;
      if (key >= window.startDate && key <= window.endDate) out.add(key);
    }
    return out;
  }
  dateKeys.forEach((dk) => {
    const key = normalizeDateKey(dk);
    if (!key) return;
    if (key >= window.startDate && key <= window.endDate) out.add(key);
  });
  return out;
}

/**
 * Canonical usage dashboard coverage window (365 inclusive days in America/Chicago).
 * Single lib owner for coverage window metadata (PC-2026-05 Phase 7).
 */
/** Ensure daily rows include every calendar day in the canonical window (zero-fill gaps). */
export function fillCanonicalDailyTotals<T extends { date: string; kwh: number }>(
  rows: ReadonlyArray<T>,
  window: CoverageWindow
): T[] {
  const byDate = new Map<string, T>();
  for (const row of rows) {
    const date = String(row.date ?? "").slice(0, 10);
    if (!YYYY_MM_DD.test(date)) continue;
    byDate.set(date, { ...row, date, kwh: Number(row.kwh) || 0 });
  }
  return enumerateDateKeysInclusive(window.startDate, window.endDate).map((date) => {
    const existing = byDate.get(date);
    if (existing) return existing;
    return { date, kwh: 0 } as T;
  });
}

/** Every calendar month (YYYY-MM) from coverage start through end, inclusive. */
export function enumerateMonthsInclusive(startDateKey: string, endDateKey: string): string[] {
  const start = normalizeDateKey(startDateKey);
  const end = normalizeDateKey(endDateKey);
  if (!start || !end || end < start) return [];
  const zone = "America/Chicago";
  let cursor = DateTime.fromISO(start, { zone }).startOf("month");
  const endMonth = DateTime.fromISO(end, { zone }).startOf("month");
  if (!cursor.isValid || !endMonth.isValid) return [];
  const out: string[] = [];
  while (cursor <= endMonth) {
    out.push(cursor.toFormat("yyyy-MM"));
    cursor = cursor.plus({ months: 1 });
  }
  return out;
}

/** Ensure monthly rows include every month in the canonical window (zero-fill gaps). */
export function fillCanonicalMonthlyTotals<T extends { month: string; kwh: number }>(
  rows: ReadonlyArray<T>,
  window: CoverageWindow
): T[] {
  const byMonth = new Map<string, T>();
  for (const row of rows) {
    const month = String(row.month ?? "").slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) continue;
    byMonth.set(month, { ...row, month, kwh: Number(row.kwh) || 0 });
  }
  return enumerateMonthsInclusive(window.startDate, window.endDate).map((month) => {
    const existing = byMonth.get(month);
    if (existing) return existing;
    return { month, kwh: 0 } as T;
  });
}

/** Inclusive local-day window ending on a fixed anchor date (same span math as canonical SMT window). */
export function coverageWindowEndingOnDateKey(
  endDate: string,
  totalDays = CANONICAL_COVERAGE_TOTAL_DAYS
): CoverageWindow | null {
  const end = normalizeDateKey(endDate);
  if (!end) return null;
  const span = Math.max(1, Math.trunc(totalDays));
  const startDate = prevCalendarDayDateKey(end, span - 1);
  if (!normalizeDateKey(startDate)) return null;
  return { startDate, endDate: end };
}

export function resolveCanonicalUsage365CoverageWindow(
  now: Date = new Date(),
  policy?: CanonicalCoverageWindowPolicy
): CoverageWindow {
  const win = canonicalUsageWindowChicago({
    now,
    reliableLagDays: policy?.canonicalCoverageLagDays ?? CANONICAL_COVERAGE_LAG_DAYS,
    totalDays: policy?.canonicalCoverageTotalDays ?? CANONICAL_COVERAGE_TOTAL_DAYS,
  });
  return {
    startDate: String(win.startDate).slice(0, 10),
    endDate: String(win.endDate).slice(0, 10),
  };
}

/** True when an interval timestamp maps to a Chicago date key inside the coverage window. */
export function isSmtIntervalInCanonicalCoverageWindow(ts: Date, window: CoverageWindow): boolean {
  const dateKey = smtCoverageDateKey(ts);
  if (!dateKey) return false;
  return dateKey >= window.startDate && dateKey <= window.endDate;
}

export function filterIntervalsToCanonicalCoverageWindow<T extends { ts: Date }>(
  intervals: T[],
  window: CoverageWindow
): T[] {
  return intervals.filter((interval) =>
    isSmtIntervalInCanonicalCoverageWindow(
      interval.ts instanceof Date ? interval.ts : new Date(interval.ts),
      window
    )
  );
}

/** UTC bounds that fully cover every Chicago calendar day in the coverage window (for DB range scans). */
export function canonicalCoverageWindowUtcBounds(window: CoverageWindow): {
  rangeStart: Date;
  rangeEndInclusive: Date;
} {
  const zone = "America/Chicago";
  const rangeStart = DateTime.fromISO(window.startDate, { zone }).startOf("day").toUTC();
  const rangeEndInclusive = DateTime.fromISO(window.endDate, { zone })
    .plus({ days: 1 })
    .startOf("day")
    .minus({ milliseconds: 1 })
    .toUTC();
  return {
    rangeStart: rangeStart.toJSDate(),
    rangeEndInclusive: rangeEndInclusive.toJSDate(),
  };
}
