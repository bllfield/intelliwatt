/**
 * Convert persisted GreenButtonInterval DB rows through homeIntervalCalendar (display path only).
 * Ingest/normalize pipelines are unchanged.
 */

import type { IntervalDelivery } from "@/lib/time/homeIntervalCalendar";
import {
  convertRawIntervalsToHome,
  createHomeIntervalCalendar,
  expectedSlotsForLocalDate,
  localDayBoundsUtc,
  type ConvertRawIntervalsResult,
  type HomeIntervalCalendar,
  type HomeIntervalRecord,
  type RawIntervalInput,
} from "@/lib/time/homeIntervalCalendar";

export const GREEN_BUTTON_DEFAULT_HOME_TIMEZONE = "America/Chicago";

/** Persisted GB rows: UTC instants in `timestamp`, 15-minute interval start. */
export const GREEN_BUTTON_PERSISTED_INTERVAL_DELIVERY: IntervalDelivery = {
  encoding: "instant_iso",
  sourceTimezone: GREEN_BUTTON_DEFAULT_HOME_TIMEZONE,
  intervalEdge: "start",
  durationSeconds: 900,
};

export type GreenButtonDbIntervalRow = {
  timestamp: Date;
  consumptionKwh: number;
};

export function greenButtonHomeIntervalCalendar(
  homeTimezone?: string,
): HomeIntervalCalendar {
  return createHomeIntervalCalendar(homeTimezone ?? GREEN_BUTTON_DEFAULT_HOME_TIMEZONE);
}

export function convertGreenButtonPersistedRowsToHome(
  rows: GreenButtonDbIntervalRow[],
  homeTimezone?: string,
): ConvertRawIntervalsResult {
  const home = greenButtonHomeIntervalCalendar(homeTimezone);
  const rawRows: RawIntervalInput[] = rows.map((row) => ({
    timestamp: row.timestamp instanceof Date ? row.timestamp.toISOString() : String(row.timestamp),
    kwh: row.consumptionKwh,
    unit: "kWh",
  }));
  return convertRawIntervalsToHome(rawRows, GREEN_BUTTON_PERSISTED_INTERVAL_DELIVERY, home);
}

/** DST-aware completeness: 92 spring-forward, 96 normal, 100 fall-back (full wall periods). */
export function greenButtonTrustedIntervalThreshold(dateKey: string, home?: HomeIntervalCalendar): number {
  const calendar = home ?? greenButtonHomeIntervalCalendar();
  return expectedSlotsForLocalDate(dateKey, calendar);
}

export function homeDailyToUsageSeriesPoints(
  converted: ConvertRawIntervalsResult,
): Array<{ timestamp: string; kwh: number }> {
  const home = converted.home;
  return converted.daily.map((row) => {
    const { startUtc } = localDayBoundsUtc(row.homeDateKey, home);
    return {
      timestamp: startUtc.toISOString(),
      kwh: row.kwh,
    };
  });
}

export function tailHomeIntervals(
  intervals: HomeIntervalRecord[],
  limit = 192,
): Array<{ timestamp: string; kwh: number }> {
  return intervals.slice(-limit).map((row) => ({
    timestamp: row.tsUtc,
    kwh: row.kwh,
  }));
}
