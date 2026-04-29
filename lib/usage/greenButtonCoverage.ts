import { DateTime } from "luxon";
import { expectedIntervalsForDateISO } from "@/lib/analysis/dst";
import { dateTimePartsInTimezone, prevCalendarDayDateKey } from "@/lib/time/chicago";

const GREEN_BUTTON_TIMEZONE = "America/Chicago";

export type GreenButtonTimestampedInterval = {
  timestamp: Date;
};

export function getChicagoDateKeyForTimestamp(timestamp: Date | string): string | null {
  return dateTimePartsInTimezone(timestamp, GREEN_BUTTON_TIMEZONE)?.dateKey ?? null;
}

export function buildUtcRangeForChicagoLocalDateRange(args: {
  startDateKey: string;
  endDateKey: string;
}): { startInclusive: Date; endInclusive: Date } | null {
  const start = DateTime.fromISO(String(args.startDateKey ?? ""), { zone: GREEN_BUTTON_TIMEZONE }).startOf("day");
  const end = DateTime.fromISO(String(args.endDateKey ?? ""), { zone: GREEN_BUTTON_TIMEZONE }).endOf("day");
  if (!start.isValid || !end.isValid) return null;
  return {
    startInclusive: start.toUTC().toJSDate(),
    endInclusive: end.toUTC().toJSDate(),
  };
}

export function resolveLatestCompleteOrAvailableGreenButtonDateKey(
  intervals: GreenButtonTimestampedInterval[]
): string | null {
  const countsByDateKey = new Map<string, number>();
  for (const interval of intervals) {
    const dateKey = getChicagoDateKeyForTimestamp(interval.timestamp);
    if (!dateKey) continue;
    countsByDateKey.set(dateKey, (countsByDateKey.get(dateKey) ?? 0) + 1);
  }
  const sortedDateKeys = Array.from(countsByDateKey.keys()).sort();
  if (sortedDateKeys.length === 0) return null;
  for (let i = sortedDateKeys.length - 1; i >= 0; i -= 1) {
    const dateKey = sortedDateKeys[i]!;
    if ((countsByDateKey.get(dateKey) ?? 0) >= expectedIntervalsForDateISO(dateKey)) {
      return dateKey;
    }
  }
  return sortedDateKeys[sortedDateKeys.length - 1] ?? null;
}

export function trimGreenButtonIntervalsToLatestLocalDays(
  intervals: GreenButtonTimestampedInterval[],
  totalDays = 365
): {
  trimmed: GreenButtonTimestampedInterval[];
  startDateKey: string | null;
  endDateKey: string | null;
} {
  const sorted = [...intervals].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  const earliestDateKey = sorted.length > 0 ? getChicagoDateKeyForTimestamp(sorted[0]!.timestamp) : null;
  const endDateKey = resolveLatestCompleteOrAvailableGreenButtonDateKey(sorted);
  if (!earliestDateKey || !endDateKey) {
    return { trimmed: sorted, startDateKey: earliestDateKey, endDateKey };
  }
  const targetStartDateKey = prevCalendarDayDateKey(endDateKey, Math.max(0, Math.trunc(totalDays) - 1));
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
