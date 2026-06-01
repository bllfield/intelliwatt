import { DateTime } from "luxon";

import { getLatestGreenButtonFullDayDateKey } from "@/modules/realUsageAdapter/greenButton";
import { enumerateDateKeysInclusive, prevCalendarDayDateKey } from "@/lib/time/chicago";
import { coverageWindowEndingOnDateKey, type CoverageWindow } from "@/lib/usage/canonicalMetadataWindow";
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
 * Baseline / Usage Green Button display window: 365 inclusive local days ending on the
 * latest complete day in the uploaded file (not the SMT canonical lag window).
 * Past Sim producer loads home-local intervals via loadGreenButtonPastProducerIntervals()
 * (same path as getActualIntervalsForRange / Usage dashboard), not utcDayGrid rebasing.
 */
export async function resolveGreenButtonBaselineCoverageWindow(
  houseId: string,
  totalDays = CANONICAL_COVERAGE_TOTAL_DAYS
): Promise<CoverageWindow | null> {
  const anchorEndDate = await getLatestGreenButtonFullDayDateKey({ houseId: String(houseId ?? "").trim() });
  if (!anchorEndDate) return null;
  const window = coverageWindowEndingOnDateKey(anchorEndDate, totalDays);
  if (!window) return null;
  const dayCount = enumerateDateKeysInclusive(window.startDate, window.endDate).length;
  if (dayCount !== Math.max(1, Math.trunc(totalDays))) return null;
  return window;
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
