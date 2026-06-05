import { DateTime } from "luxon";

import { enumerateDateKeysInclusive, prevCalendarDayDateKey } from "@/lib/time/chicago";
import {
  coverageWindowEndingOnDateKey,
  resolveCanonicalUsage365CoverageWindow,
  type CanonicalCoverageWindowPolicy,
  type CoverageWindow,
} from "@/lib/usage/canonicalMetadataWindow";
import { CANONICAL_COVERAGE_TOTAL_DAYS } from "@/lib/usage/canonicalCoverageConfig";
import {
  countDistinctLocalSlotsByDateKey,
  getChicagoDateKeyForTimestamp,
  resolveLatestCompleteGreenButtonDateKeyFromSlotCounts,
} from "@/lib/usage/greenButtonLocalSlot";

export type GreenButtonTimestampedInterval = {
  timestamp: Date;
};

export { getChicagoDateKeyForTimestamp };

export function buildUtcRangeForChicagoLocalDateRange(args: {
  startDateKey: string;
  endDateKey: string;
}): { startInclusive: Date; endInclusive: Date } | null {
  const start = DateTime.fromISO(String(args.startDateKey ?? ""), { zone: "America/Chicago" }).startOf("day");
  const end = DateTime.fromISO(String(args.endDateKey ?? ""), { zone: "America/Chicago" }).endOf("day");
  if (!start.isValid || !end.isValid) return null;
  return {
    startInclusive: start.toUTC().toJSDate(),
    endInclusive: end.toUTC().toJSDate(),
  };
}

export function resolveLatestCompleteOrAvailableGreenButtonDateKey<T extends GreenButtonTimestampedInterval>(
  intervals: T[]
): string | null {
  return resolveLatestCompleteGreenButtonDateKeyFromSlotCounts(
    countDistinctLocalSlotsByDateKey(intervals),
  );
}

/**
 * Usage Green Button display window: 365 inclusive Chicago days ending near today
 * (canonical lag), same framing as the usage dashboard — not last complete file day.
 */
export async function resolveGreenButtonBaselineCoverageWindow(
  _houseId: string,
  totalDays = CANONICAL_COVERAGE_TOTAL_DAYS,
  now: Date = new Date(),
  policy?: CanonicalCoverageWindowPolicy
): Promise<CoverageWindow | null> {
  const window = resolveCanonicalUsage365CoverageWindow(now, {
    ...policy,
    canonicalCoverageTotalDays: policy?.canonicalCoverageTotalDays ?? totalDays,
  });
  const dayCount = enumerateDateKeysInclusive(window.startDate, window.endDate).length;
  if (dayCount !== Math.max(1, Math.trunc(totalDays))) return null;
  return window;
}

/** Ingest trim: keep all normalized file intervals inside the canonical today-anchored window (partial days OK). */
export function trimGreenButtonIntervalsToCanonicalUsageWindow<T extends GreenButtonTimestampedInterval>(
  intervals: T[],
  args?: {
    now?: Date;
    totalDays?: number;
    policy?: CanonicalCoverageWindowPolicy;
  }
): {
  trimmed: T[];
  startDateKey: string;
  endDateKey: string;
  window: CoverageWindow;
} {
  const totalDays = args?.totalDays ?? CANONICAL_COVERAGE_TOTAL_DAYS;
  const window = resolveCanonicalUsage365CoverageWindow(args?.now ?? new Date(), {
    ...args?.policy,
    canonicalCoverageTotalDays: args?.policy?.canonicalCoverageTotalDays ?? totalDays,
  });
  const range = buildUtcRangeForChicagoLocalDateRange({
    startDateKey: window.startDate,
    endDateKey: window.endDate,
  });
  if (!range) {
    return { trimmed: [], startDateKey: window.startDate, endDateKey: window.endDate, window };
  }
  const trimmed = intervals.filter(
    (interval) =>
      interval.timestamp.getTime() >= range.startInclusive.getTime() &&
      interval.timestamp.getTime() <= range.endInclusive.getTime()
  );
  return {
    trimmed,
    startDateKey: window.startDate,
    endDateKey: window.endDate,
    window,
  };
}

export function resolveGreenButtonDataAvailableDateKeys<T extends GreenButtonTimestampedInterval>(
  intervals: T[]
): { startDateKey: string | null; endDateKey: string | null } {
  if (intervals.length === 0) return { startDateKey: null, endDateKey: null };
  const sorted = [...intervals].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  return {
    startDateKey: getChicagoDateKeyForTimestamp(sorted[0]!.timestamp),
    endDateKey: getChicagoDateKeyForTimestamp(sorted[sorted.length - 1]!.timestamp),
  };
}

export function resolveGreenButtonDisplayWindow(
  endDateKey: string,
  totalDays = CANONICAL_COVERAGE_TOTAL_DAYS
): CoverageWindow | null {
  return coverageWindowEndingOnDateKey(endDateKey, totalDays);
}

export function greenButtonUploadDateRangeFromChicagoDateKeys(args: {
  startDateKey: string;
  endDateKey: string;
}): { dateRangeStart: Date; dateRangeEnd: Date } | null {
  const range = buildUtcRangeForChicagoLocalDateRange(args);
  if (!range) return null;
  return { dateRangeStart: range.startInclusive, dateRangeEnd: range.endInclusive };
}

/** Upload record dates: full display window (dashboard parity), not first persisted interval only. */
export function resolveGreenButtonUploadRecordDateRange(args: {
  endDateKey: string;
  windowDays?: number;
  fallbackStart?: Date | null;
  fallbackEnd?: Date | null;
}): { dateRangeStart: Date; dateRangeEnd: Date } | null {
  const displayWindow = resolveGreenButtonDisplayWindow(
    args.endDateKey,
    args.windowDays ?? CANONICAL_COVERAGE_TOTAL_DAYS
  );
  if (displayWindow) {
    const fromWindow = greenButtonUploadDateRangeFromChicagoDateKeys({
      startDateKey: displayWindow.startDate,
      endDateKey: displayWindow.endDate,
    });
    if (fromWindow) return fromWindow;
  }
  if (args.fallbackStart && args.fallbackEnd) {
    return { dateRangeStart: args.fallbackStart, dateRangeEnd: args.fallbackEnd };
  }
  return null;
}

export function trimGreenButtonIntervalsToLatestLocalDays<T extends GreenButtonTimestampedInterval>(
  intervals: T[],
  totalDays = 365
): {
  trimmed: T[];
  startDateKey: string | null;
  endDateKey: string | null;
} {
  const sorted = [...intervals].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  const earliestDateKey = sorted.length > 0 ? getChicagoDateKeyForTimestamp(sorted[0]!.timestamp) : null;
  const endDateKey = resolveLatestCompleteOrAvailableGreenButtonDateKey(sorted);
  if (!earliestDateKey || !endDateKey) {
    return { trimmed: sorted, startDateKey: earliestDateKey, endDateKey };
  }
  const targetStartDateKey =
    coverageWindowEndingOnDateKey(endDateKey, totalDays)?.startDate ??
    prevCalendarDayDateKey(endDateKey, Math.max(0, Math.trunc(totalDays) - 1));
  const startDateKey = earliestDateKey > targetStartDateKey ? earliestDateKey : targetStartDateKey;
  const range = buildUtcRangeForChicagoLocalDateRange({ startDateKey, endDateKey });
  if (!range) {
    return { trimmed: sorted, startDateKey, endDateKey };
  }
  return {
    trimmed: sorted.filter(
      (interval) =>
        interval.timestamp.getTime() >= range.startInclusive.getTime() &&
        interval.timestamp.getTime() <= range.endInclusive.getTime()
    ),
    startDateKey,
    endDateKey,
  };
}
