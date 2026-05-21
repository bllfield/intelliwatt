/**
 * Convert persisted SmtInterval DB rows through homeIntervalCalendar (display path only).
 * Ingest is unchanged — this runs when building the Usage API dataset.
 */

import type { IntervalDelivery } from "@/lib/time/homeIntervalCalendar";
import {
  convertRawIntervalsToHome,
  createHomeIntervalCalendar,
  localDayBoundsUtc,
  smtHomeIntervalCalendar,
  type ConvertRawIntervalsResult,
  type HomeIntervalRecord,
  type RawIntervalInput,
} from "@/lib/time/homeIntervalCalendar";

export type SmtDbIntervalRow = {
  ts: Date;
  kwh: number;
};

export type UsageIntervalSeriesPoint = {
  timestamp: string;
  kwh: number;
};

/** Persisted SMT rows: UTC instants in `ts`, 15-minute interval start. */
export const SMT_PERSISTED_INTERVAL_DELIVERY: IntervalDelivery = {
  encoding: "unix_seconds_utc",
  sourceTimezone: "America/Chicago",
  intervalEdge: "start",
  durationSeconds: 900,
};

export function convertSmtPersistedRowsToHome(
  rows: SmtDbIntervalRow[],
  homeTimezone?: string,
): ConvertRawIntervalsResult {
  const home = homeTimezone
    ? createHomeIntervalCalendar(homeTimezone)
    : smtHomeIntervalCalendar();
  const rawRows: RawIntervalInput[] = rows.map((row) => ({
    timestamp: Math.floor(row.ts.getTime() / 1000),
    kwh: row.kwh,
    unit: "kWh",
  }));
  return convertRawIntervalsToHome(rawRows, SMT_PERSISTED_INTERVAL_DELIVERY, home);
}

export function homeIntervalsToUsageSeriesPoints(
  intervals: HomeIntervalRecord[],
): UsageIntervalSeriesPoint[] {
  return intervals.map((row) => ({
    timestamp: row.tsUtc,
    kwh: row.kwh,
  }));
}

export function homeDailyToUsageSeriesPoints(
  converted: ConvertRawIntervalsResult,
): UsageIntervalSeriesPoint[] {
  const home = converted.home;
  return converted.daily.map((row) => {
    const { startUtc } = localDayBoundsUtc(row.homeDateKey, home);
    return {
      timestamp: startUtc.toISOString(),
      kwh: row.kwh,
    };
  });
}

export function tailIntervals15(
  intervals: HomeIntervalRecord[],
  limit = 192,
): UsageIntervalSeriesPoint[] {
  const tail = intervals.slice(-limit);
  return homeIntervalsToUsageSeriesPoints(tail);
}
