/**
 * Convert persisted GreenButtonInterval DB rows through homeIntervalCalendar (read path only).
 * Normalize/repair run only in `runGreenButtonUsagePipeline` before rows are written.
 *
 * All Green Button read/display bucketing (Usage SQL parity, Past Sim, One Path read views)
 * must route series.intervals15 through this module — not parallel utcDayGrid hh:mm helpers.
 */

import { DateTime } from "luxon";

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
import { countsAsActualDailySourceForLoadCurve } from "@/lib/usage/fifteenMinuteLoadCurve";
import { smtCompletenessIntervalThreshold } from "@/lib/usage/smtWindowStatus";

export const GREEN_BUTTON_DEFAULT_HOME_TIMEZONE = "America/Chicago";

/** Persisted GB rows: UTC instants in `timestamp`, 15-minute interval start. */
export const GREEN_BUTTON_PERSISTED_INTERVAL_DELIVERY: IntervalDelivery = {
  encoding: "instant_iso",
  sourceTimezone: GREEN_BUTTON_DEFAULT_HOME_TIMEZONE,
  intervalEdge: "start",
  durationSeconds: 900,
};

/** Legacy cached Past artifacts: Z timestamps encode utc day-grid slots, not true instants. */
export const GREEN_BUTTON_LEGACY_UTC_DAY_GRID_DELIVERY: IntervalDelivery = {
  encoding: "utc_day_grid",
  sourceTimezone: GREEN_BUTTON_DEFAULT_HOME_TIMEZONE,
  intervalEdge: "start",
  durationSeconds: 900,
};

function round2(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

/**
 * GreenButtonInterval.timestamp is TIMESTAMP(3) without time zone: ingest stores UTC wall clock.
 * Postgres labels slots with `(timestamp AT TIME ZONE 'UTC') AT TIME ZONE <home>` — not local Date getters.
 */
export function persistedGreenButtonUtcWallClockDateTime(
  timestamp: Date,
  homeTimezone: string
): DateTime {
  const zone = String(homeTimezone ?? "").trim() || GREEN_BUTTON_DEFAULT_HOME_TIMEZONE;
  const y = timestamp.getUTCFullYear();
  const m = String(timestamp.getUTCMonth() + 1).padStart(2, "0");
  const d = String(timestamp.getUTCDate()).padStart(2, "0");
  const h = String(timestamp.getUTCHours()).padStart(2, "0");
  const mi = String(timestamp.getUTCMinutes()).padStart(2, "0");
  const s = String(timestamp.getUTCSeconds()).padStart(2, "0");
  const ms = String(timestamp.getUTCMilliseconds()).padStart(3, "0");
  return DateTime.fromSQL(`${y}-${m}-${d} ${h}:${mi}:${s}.${ms}`, { zone: "UTC" }).setZone(zone);
}

export function persistedGreenButtonTimestampHhmm(
  timestamp: Date,
  homeTimezone?: string
): string | null {
  const dt = persistedGreenButtonUtcWallClockDateTime(
    timestamp,
    homeTimezone ?? GREEN_BUTTON_DEFAULT_HOME_TIMEZONE
  );
  if (!dt.isValid) return null;
  const hhmm = dt.toFormat("HH:mm");
  return /^\d{2}:\d{2}$/.test(hhmm) ? hhmm : null;
}

/**
 * Usage 15-minute curve: aggregate stored consumptionKwh only (no slot repair / no calendar re-project).
 * Matches SQL `AVG(consumptionKwh * 4)` grouped by Chicago HH24:MI with double AT TIME ZONE UTC.
 */
export function buildGreenButtonLoadCurveInsightsFromPersistedIntervalRows(
  rows: Array<{ timestamp: Date; consumptionKwh: number }>,
  homeTimezone?: string
): GreenButtonLoadCurveInsights {
  const zone = String(homeTimezone ?? "").trim() || GREEN_BUTTON_DEFAULT_HOME_TIMEZONE;
  const hhmmBuckets = new Map<string, { sumKw: number; count: number }>();
  const sums = { overnight: 0, morning: 0, afternoon: 0, evening: 0 };

  for (const row of rows) {
    const kwh = Number(row.consumptionKwh) || 0;
    if (!Number.isFinite(kwh) || kwh < 0) continue;
    const hhmm = persistedGreenButtonTimestampHhmm(row.timestamp, zone);
    if (!hhmm) continue;
    const current = hhmmBuckets.get(hhmm) ?? { sumKw: 0, count: 0 };
    current.sumKw += kwh * 4;
    current.count += 1;
    hhmmBuckets.set(hhmm, current);
    const hour = persistedGreenButtonUtcWallClockDateTime(row.timestamp, zone).hour;
    if (hour < 6) sums.overnight += kwh;
    else if (hour < 12) sums.morning += kwh;
    else if (hour < 18) sums.afternoon += kwh;
    else sums.evening += kwh;
  }

  const fifteenMinuteAverages = Array.from(hhmmBuckets.entries())
    .map(([hhmm, bucket]) => ({
      hhmm,
      avgKw: bucket.count > 0 ? round2(bucket.sumKw / bucket.count) : 0,
    }))
    .sort((left, right) => (left.hhmm < right.hhmm ? -1 : left.hhmm > right.hhmm ? 1 : 0));

  const timeOfDayBuckets = [
    { key: "overnight", label: "Overnight (12am–6am)", kwh: round2(sums.overnight) },
    { key: "morning", label: "Morning (6am–12pm)", kwh: round2(sums.morning) },
    { key: "afternoon", label: "Afternoon (12pm–6pm)", kwh: round2(sums.afternoon) },
    { key: "evening", label: "Evening (6pm–12am)", kwh: round2(sums.evening) },
  ];

  return { fifteenMinuteAverages, timeOfDayBuckets };
}

/** Minimum 15m rows to rebuild a year-shaped curve from series (avoids tail-only Usage loads). */
export const GREEN_BUTTON_MIN_INTERVALS_FOR_SERIES_CURVE = 96 * 30;

export function shouldRebuildGreenButtonFifteenMinuteCurveFromSeries(args: {
  meta?: Record<string, unknown> | null;
  intervals15Count: number;
  hasSimulatedFill?: boolean;
}): boolean {
  if (args.intervals15Count <= 0) return false;
  // Past sim artifacts rebuild GB curves on decode; do not replace with a second series pass.
  if (args.hasSimulatedFill) return false;
  if (args.intervals15Count >= GREEN_BUTTON_MIN_INTERVALS_FOR_SERIES_CURVE) return true;
  return args.meta?.greenButtonFullYearIntervals15 === true;
}

export function isGreenButtonBackedDatasetMeta(meta: Record<string, unknown> | null | undefined): boolean {
  if (!meta) return false;
  if (meta.actualSource === "GREEN_BUTTON") return true;
  if (typeof meta.greenButtonCoverageIntervalCount === "number") return true;
  if (meta.greenButtonIntervalTimestampMode === "utcDayGrid") return true;
  return Boolean(
    meta.greenButtonSourceDateByTargetDate &&
      typeof meta.greenButtonSourceDateByTargetDate === "object" &&
      !Array.isArray(meta.greenButtonSourceDateByTargetDate)
  );
}

/** Shared delivery contract for persisted or cached series.intervals15 rows. */
export function resolveGreenButtonIntervalDeliveryFromMeta(
  meta: Record<string, unknown> | null | undefined
): IntervalDelivery {
  const normalized = resolveGreenButtonPastDisplayMeta(meta);
  const mode = String(normalized?.greenButtonIntervalTimestampMode ?? "").trim();
  if (mode === "utcDayGrid") return GREEN_BUTTON_LEGACY_UTC_DAY_GRID_DELIVERY;
  return GREEN_BUTTON_PERSISTED_INTERVAL_DELIVERY;
}

export function hasGreenButtonSourceDateShiftMap(
  meta: Record<string, unknown> | null | undefined
): boolean {
  return Boolean(
    meta?.greenButtonSourceDateByTargetDate &&
      typeof meta.greenButtonSourceDateByTargetDate === "object" &&
      !Array.isArray(meta.greenButtonSourceDateByTargetDate) &&
      Object.keys(meta.greenButtonSourceDateByTargetDate as Record<string, unknown>).length > 0
  );
}

/**
 * Past/read display: producer-shifted GB Past stores UTC instants (home_local) but legacy
 * artifacts may still carry utcDayGrid. Use home_local for display bucketing in that case.
 */
function isGreenButtonPastSimArtifactMeta(meta: Record<string, unknown>): boolean {
  if (meta.datasetKind === "SIMULATED") return true;
  if (String(meta.scenarioKey ?? "").trim() === "PAST") return true;
  if (meta.artifactSource != null || meta.artifactReadMode != null) return true;
  if (meta.greenButtonPastProducer === true) return true;
  return false;
}

export function resolveGreenButtonPastDisplayMeta(
  meta: Record<string, unknown> | null | undefined
): Record<string, unknown> | null | undefined {
  if (!meta) return meta;
  if (meta.actualSource !== "GREEN_BUTTON") return meta;
  const mode = String(meta.greenButtonIntervalTimestampMode ?? "").trim();
  if (mode === "home_local") return meta;
  if (hasGreenButtonSourceDateShiftMap(meta) || isGreenButtonPastSimArtifactMeta(meta)) {
    return { ...meta, greenButtonIntervalTimestampMode: "home_local" };
  }
  return meta;
}

export function convertGreenButtonSeriesRowsToHome(
  rows: Array<{ timestamp?: string; kwh?: number; consumption_kwh?: number }>,
  options?: { homeTimezone?: string; meta?: Record<string, unknown> | null }
): HomeIntervalRecord[] {
  const home = greenButtonHomeIntervalCalendar(options?.homeTimezone);
  const delivery = resolveGreenButtonIntervalDeliveryFromMeta(options?.meta ?? null);
  const rawRows: RawIntervalInput[] = [];
  for (const row of rows) {
    const timestamp = String(row.timestamp ?? "");
    if (!timestamp) continue;
    rawRows.push({
      timestamp,
      kwh: Number(row.kwh ?? row.consumption_kwh ?? 0) || 0,
      unit: "kWh",
    });
  }
  return convertRawIntervalsToHome(rawRows, delivery, home).intervals;
}

export function filterHomeIntervalRecordsToActualDailyDates(
  records: HomeIntervalRecord[],
  daily: Array<{ date?: string; source?: string; sourceDetail?: string }>
): HomeIntervalRecord[] {
  const actualDates = new Set(
    (daily ?? [])
      .filter((row) => countsAsActualDailySourceForLoadCurve(row.source, row.sourceDetail))
      .map((row) => String(row.date ?? "").slice(0, 10))
      .filter((dk) => /^\d{4}-\d{2}-\d{2}$/.test(dk))
  );
  if (actualDates.size === 0) return records;
  const filtered = records.filter((row) => actualDates.has(row.homeDateKey));
  return filtered.length > 0 ? filtered : records;
}

function hhmmInHomeWallTime(tsUtc: string, home: HomeIntervalCalendar): string | null {
  const dt = DateTime.fromISO(tsUtc, { zone: "utc" }).setZone(home.timezone);
  if (!dt.isValid) return null;
  const hhmm = dt.toFormat("HH:mm");
  return /^\d{2}:\d{2}$/.test(hhmm) ? hhmm : null;
}

export type GreenButtonLoadCurveInsights = {
  fifteenMinuteAverages: Array<{ hhmm: string; avgKw: number }>;
  timeOfDayBuckets: Array<{ key: string; label: string; kwh: number }>;
};

/** 15-minute load curve + time-of-day buckets from home-projected GB intervals (Usage SQL parity). */
export function buildGreenButtonLoadCurveInsightsFromHomeRecords(
  records: HomeIntervalRecord[],
  homeTimezone?: string
): GreenButtonLoadCurveInsights {
  const home = greenButtonHomeIntervalCalendar(homeTimezone);
  const hhmmBuckets = new Map<string, { sumKw: number; count: number }>();
  const sums = { overnight: 0, morning: 0, afternoon: 0, evening: 0 };

  for (const row of records) {
    const hhmm = hhmmInHomeWallTime(row.tsUtc, home);
    if (!hhmm) continue;
    const kwh = row.kwh;
    const current = hhmmBuckets.get(hhmm) ?? { sumKw: 0, count: 0 };
    current.sumKw += kwh * 4;
    current.count += 1;
    hhmmBuckets.set(hhmm, current);
    const hour = DateTime.fromISO(row.tsUtc, { zone: "utc" }).setZone(home.timezone).hour;
    if (hour < 6) sums.overnight += kwh;
    else if (hour < 12) sums.morning += kwh;
    else if (hour < 18) sums.afternoon += kwh;
    else sums.evening += kwh;
  }

  const fifteenMinuteAverages = Array.from(hhmmBuckets.entries())
    .map(([hhmm, bucket]) => ({
      hhmm,
      avgKw: bucket.count > 0 ? round2(bucket.sumKw / bucket.count) : 0,
    }))
    .sort((left, right) => (left.hhmm < right.hhmm ? -1 : left.hhmm > right.hhmm ? 1 : 0));

  const timeOfDayBuckets = [
    { key: "overnight", label: "Overnight (12am–6am)", kwh: round2(sums.overnight) },
    { key: "morning", label: "Morning (6am–12pm)", kwh: round2(sums.morning) },
    { key: "afternoon", label: "Afternoon (12pm–6pm)", kwh: round2(sums.afternoon) },
    { key: "evening", label: "Evening (6pm–12am)", kwh: round2(sums.evening) },
  ];

  return { fifteenMinuteAverages, timeOfDayBuckets };
}

/** Project series.intervals15 through homeIntervalCalendar, then build load-curve insights. */
export function buildGreenButtonLoadCurveInsightsFromSeriesRows(
  rows: Array<{ timestamp?: string; kwh?: number; consumption_kwh?: number }>,
  options?: {
    homeTimezone?: string;
    meta?: Record<string, unknown> | null;
    displayDaily?: Array<{ date?: string; source?: string; sourceDetail?: string }>;
    filterToActualDailyDates?: boolean;
  }
): GreenButtonLoadCurveInsights {
  const displayMeta = resolveGreenButtonPastDisplayMeta(options?.meta ?? null);
  let homeRecords = convertGreenButtonSeriesRowsToHome(rows, {
    homeTimezone: options?.homeTimezone,
    meta: displayMeta,
  });
  if (options?.filterToActualDailyDates && options.displayDaily?.length) {
    homeRecords = filterHomeIntervalRecordsToActualDailyDates(homeRecords, options.displayDaily);
  }
  return buildGreenButtonLoadCurveInsightsFromHomeRecords(homeRecords, options?.homeTimezone);
}

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

/** DST-aware wall-period count: 92 spring-forward, 96 normal, 100 fall-back. */
export function greenButtonTrustedIntervalThreshold(dateKey: string, home?: HomeIntervalCalendar): number {
  const calendar = home ?? greenButtonHomeIntervalCalendar();
  return expectedSlotsForLocalDate(dateKey, calendar);
}

/**
 * Past-sim / trusted-pool completeness (aligned with SMT): vendor feeds cap at 96 rows/day,
 * so fall-back days require min(100, 96) = 96 present intervals, not 100 wall periods.
 */
export function greenButtonCompletenessIntervalThreshold(requiredSlots: number): number {
  return smtCompletenessIntervalThreshold(requiredSlots);
}

export function greenButtonTrustedCompletenessThreshold(dateKey: string, home?: HomeIntervalCalendar): number {
  return greenButtonCompletenessIntervalThreshold(greenButtonTrustedIntervalThreshold(dateKey, home));
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
