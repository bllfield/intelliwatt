/**
 * Home-local 15-minute load curve and time-of-day buckets (Usage dashboard parity).
 * Do not bucket by UTC ISO substring — Green Button / SMT instants must map through home TZ.
 */

import { DateTime } from "luxon";

import { createHomeIntervalCalendar } from "@/lib/time/homeIntervalCalendar";

function round2(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

export function normalizeHomeTimezoneForLoadCurve(timezone: string | null | undefined): string {
  const tz = String(timezone ?? "").trim();
  return tz || "America/Chicago";
}

const homeCalendarCache = new Map<string, ReturnType<typeof createHomeIntervalCalendar>>();

function homeCalendarForTimezone(timezone: string) {
  const tz = normalizeHomeTimezoneForLoadCurve(timezone);
  let cached = homeCalendarCache.get(tz);
  if (!cached) {
    cached = createHomeIntervalCalendar(tz);
    homeCalendarCache.set(tz, cached);
  }
  return cached;
}

function homeDateTimeFromTimestamp(timestamp: string, timezone: string): DateTime | null {
  const ts = String(timestamp ?? "");
  if (!ts) return null;
  const home = homeCalendarForTimezone(timezone);
  const dt = DateTime.fromISO(ts, { zone: "utc" }).setZone(home.timezone);
  return dt.isValid ? dt : null;
}

export function hhmmInHomeTimezone(timestamp: string, timezone: string): string | null {
  const dt = homeDateTimeFromTimestamp(timestamp, timezone);
  if (!dt) return null;
  const hhmm = dt.toFormat("HH:mm");
  return /^\d{2}:\d{2}$/.test(hhmm) ? hhmm : null;
}

export function hourInHomeTimezone(timestamp: string, timezone: string): number | null {
  const dt = homeDateTimeFromTimestamp(timestamp, timezone);
  if (!dt) return null;
  const hour = dt.hour;
  if (!Number.isFinite(hour) || hour < 0 || hour > 23) return null;
  return hour;
}

export type LoadCurveInsightsFromIntervals = {
  fifteenMinuteAverages: Array<{ hhmm: string; avgKw: number }>;
  timeOfDayBuckets: Array<{ key: string; label: string; kwh: number }>;
};

/** Single pass over intervals for 15-minute curve + time-of-day buckets (Past sim / cache restore hot path). */
export function buildLoadCurveInsightsFromIntervalRows(
  rows: Array<{ timestamp?: string; kwh?: number; consumption_kwh?: number }>,
  timezone: string
): LoadCurveInsightsFromIntervals {
  const home = homeCalendarForTimezone(timezone);
  const hhmmBuckets = new Map<string, { sumKw: number; count: number }>();
  const sums = { overnight: 0, morning: 0, afternoon: 0, evening: 0 };

  for (const row of rows) {
    const timestamp = String(row?.timestamp ?? "");
    if (!timestamp) continue;
    const dt = DateTime.fromISO(timestamp, { zone: "utc" }).setZone(home.timezone);
    if (!dt.isValid) continue;
    const kwh = Number(row?.kwh ?? row?.consumption_kwh ?? 0) || 0;
    const hhmm = dt.toFormat("HH:mm");
    if (/^\d{2}:\d{2}$/.test(hhmm)) {
      const current = hhmmBuckets.get(hhmm) ?? { sumKw: 0, count: 0 };
      current.sumKw += kwh * 4;
      current.count += 1;
      hhmmBuckets.set(hhmm, current);
    }
    const hour = dt.hour;
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

export function buildFifteenMinuteAveragesFromIntervalRows(
  rows: Array<{ timestamp?: string; kwh?: number; consumption_kwh?: number }>,
  timezone: string
): Array<{ hhmm: string; avgKw: number }> {
  return buildLoadCurveInsightsFromIntervalRows(rows, timezone).fifteenMinuteAverages;
}

/** Peak pattern headline: highest average kW among 15-minute slots (matches the load-curve table). */
export function derivePeakHourFromFifteenMinuteCurve(
  curve: Array<{ hhmm: string; avgKw: number }>
): { hour: number; kw: number } | null {
  if (!Array.isArray(curve) || curve.length === 0) return null;
  let top: { hhmm: string; avgKw: number } | null = null;
  for (const row of curve) {
    const hhmm = String(row?.hhmm ?? "");
    if (!/^\d{2}:\d{2}$/.test(hhmm)) continue;
    const avgKw = Number(row?.avgKw) || 0;
    if (!top || avgKw > top.avgKw) top = { hhmm, avgKw };
  }
  if (!top) return null;
  const hour = Number(top.hhmm.slice(0, 2));
  if (!Number.isFinite(hour) || hour < 0 || hour > 23) return null;
  return { hour, kw: round2(top.avgKw) };
}

export function buildTimeOfDayBucketsFromIntervalRows(
  rows: Array<{ timestamp?: string; kwh?: number; consumption_kwh?: number }>,
  timezone: string
): Array<{ key: string; label: string; kwh: number }> {
  return buildLoadCurveInsightsFromIntervalRows(rows, timezone).timeOfDayBuckets;
}

/** True when a persisted daily row counts as actual (not travel/vacant or other simulated fill). */
export function countsAsActualDailySourceForLoadCurve(
  source: unknown,
  sourceDetail?: unknown
): boolean {
  const src = String(source ?? "").trim().toUpperCase();
  if (!src || src.startsWith("SIMULATED")) return false;
  const detail = String(sourceDetail ?? "").trim().toUpperCase();
  if (detail.includes("SIMULATED")) return false;
  if (src === "ACTUAL" || src.includes("ACTUAL")) return true;
  return detail.includes("ACTUAL");
}

export function localDateKeyInHomeTimezone(timestamp: string, timezone: string): string | null {
  const dt = homeDateTimeFromTimestamp(timestamp, timezone);
  if (!dt) return null;
  const key = dt.toFormat("yyyy-MM-dd");
  return /^\d{4}-\d{2}-\d{2}$/.test(key) ? key : null;
}

/** Restrict load-curve bucketing to calendar days marked ACTUAL on the Past daily table. */
export function filterIntervalRowsToActualDailyDates(
  rows: Array<{ timestamp?: string; kwh?: number; consumption_kwh?: number }>,
  daily: Array<{ date?: string; source?: string; sourceDetail?: string }>,
  timezone: string
): Array<{ timestamp?: string; kwh?: number; consumption_kwh?: number }> {
  const actualDates = new Set(
    (daily ?? [])
      .filter((row) => countsAsActualDailySourceForLoadCurve(row.source, row.sourceDetail))
      .map((row) => String(row.date ?? "").slice(0, 10))
      .filter((dk) => /^\d{4}-\d{2}-\d{2}$/.test(dk))
  );
  if (actualDates.size === 0) return rows;
  const filtered = rows.filter((row) => {
    const dk = localDateKeyInHomeTimezone(String(row.timestamp ?? ""), timezone);
    return dk != null && actualDates.has(dk);
  });
  return filtered.length > 0 ? filtered : rows;
}
