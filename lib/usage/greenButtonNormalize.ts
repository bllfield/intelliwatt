/* eslint-disable @typescript-eslint/no-explicit-any */

export type GreenButtonRawReading = {
  /**
   * Timestamp for the reading:
   * - ISO string (e.g., "2025-12-03T01:00:00Z")
   * - epoch seconds (number like 1733197200)
   * - epoch milliseconds (number like 1733197200000)
   * - Date object
   */
  timestamp: string | number | Date;

  /**
   * Duration of this reading in seconds. If omitted or <= 0, defaults to 900s (15 min).
   * For hourly readings, this would be 3600.
   */
  durationSeconds?: number | null;

  /**
   * Numeric consumption value as provided by the file.
   * - Often Wh in XML (large integers).
   * - Sometimes already kWh in CSV.
   */
  value: number | string;

  /**
   * Optional explicit unit, e.g. "Wh" or "kWh".
   * If omitted, we infer from magnitude.
   */
  unit?: string | null;
};

/**
 * Normalized 15-minute interval record.
 * This is the shape that can be written into a usage interval table later.
 */
export type GreenButton15MinInterval = {
  /**
   * Start of the 15-minute interval (inclusive), in UTC, as a Date.
   */
  timestamp: Date;
  /**
   * Consumption during the 15-minute interval, in kWh.
   */
  consumptionKwh: number;
  /**
   * Fixed at 15 for 15-minute intervals.
   */
  intervalMinutes: 15;
  /**
   * Always "kWh" after normalization.
   */
  unit: "kWh";
};

/**
 * Normalize a list of raw Green Button readings into 15-minute kWh buckets.
 *
 * - Converts timestamps to UTC Date.
 * - Infers units (Wh vs kWh) and converts to kWh.
 * - Splits long intervals (e.g., 1-hour readings) across multiple 15-min buckets.
 * - Aggregates multiple readings that map to the same 15-min bucket.
 */
export function normalizeGreenButtonReadingsTo15Min(
  rawReadings: GreenButtonRawReading[],
  options?: {
    /**
     * If true, treat timestamps in the input as interval END instead of interval START.
     * In that case we shift by durationSeconds backwards before bucketing.
     * Default: false (assume timestamps are interval start).
     */
    treatTimestampAsEnd?: boolean;
    /**
     * Optional guard to cap extreme outliers (in kWh) after normalization.
     * If null/undefined, no cap is applied.
     */
    maxKwhPerInterval?: number | null;
  },
): GreenButton15MinInterval[] {
  const treatAsEnd = options?.treatTimestampAsEnd ?? false;
  const maxKwh = options?.maxKwhPerInterval ?? null;

  const buckets = new Map<number, number>(); // key = ms since epoch (UTC), value = kWh sum

  for (const reading of rawReadings) {
    const ts = ensureUtcDate(reading.timestamp);
    if (!ts) continue;

    const durSecRaw = reading.durationSeconds ?? 900;
    const durationSeconds = durSecRaw > 0 ? durSecRaw : 900;

    const valueKwh = ensureKwh(reading.value, reading.unit);
    if (!isFinite(valueKwh) || valueKwh < 0) {
      continue; // drop invalid or negative values
    }

    // Determine interval start based on whether the timestamp is start or end.
    const base = new Date(ts.getTime());
    if (treatAsEnd) {
      // If timestamp is interval END, subtract the duration to get START.
      base.setSeconds(base.getSeconds() - durationSeconds);
    }

    // Round down to 15-min bucket for the starting interval.
    const start = roundDownTo15Minutes(base);

    const intervals = Math.max(1, Math.round(durationSeconds / 900));
    const perIntervalKwh = valueKwh / intervals;

    for (let i = 0; i < intervals; i++) {
      const bucketStartMs = start.getTime() + i * 15 * 60 * 1000;
      const existing = buckets.get(bucketStartMs) ?? 0;
      buckets.set(bucketStartMs, existing + perIntervalKwh);
    }
  }

  const results: GreenButton15MinInterval[] = [];

  for (const [ms, kwh] of buckets.entries()) {
    if (!isFinite(kwh) || kwh < 0) continue;
    if (maxKwh != null && kwh > maxKwh) continue;

    results.push({
      timestamp: new Date(ms),
      consumptionKwh: kwh,
      intervalMinutes: 15,
      unit: "kWh",
    });
  }

  // Sort by timestamp ascending.
  results.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  return results;
}

/**
 * Convert an arbitrary "timestamp" type into a UTC Date object.
 * - ISO string: parsed and forced to UTC (if no offset is present).
 * - Epoch seconds: 10-digit or small number treated as seconds since epoch.
 * - Epoch millis: large number (>= 1e11) treated as ms since epoch.
 * - Date: cloned.
 * Returns null if parsing fails.
 */
function ensureUtcDate(input: string | number | Date): Date | null {
  try {
    if (input instanceof Date) {
      return new Date(input.getTime());
    }

    if (typeof input === "number") {
      if (!Number.isFinite(input)) return null;

      // Heuristic: numbers >= 1e11 are likely milliseconds, otherwise seconds.
      if (Math.abs(input) >= 1e11) {
        return new Date(Math.trunc(input));
      } else {
        return new Date(Math.trunc(input) * 1000);
      }
    }

    if (typeof input === "string") {
      const trimmed = input.trim();
      if (!trimmed) return null;

      // Try ISO-style first.
      const isoParsed = new Date(trimmed);
      if (!isNaN(isoParsed.getTime())) {
        return isoParsed;
      }

      // Fallback: known common formats (e.g., "MM/DD/YYYY HH:mm:ss")
      // We keep this minimal: most GB exports are ISO or epoch.
      const maybeEpoch = Number(trimmed);
      if (Number.isFinite(maybeEpoch)) {
        return ensureUtcDate(maybeEpoch);
      }
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Ensure the reading value is in kWh.
 * - If unit explicitly says "Wh" → divide by 1000.
 * - If unit explicitly says "kWh" → use as is.
 * - If no unit is given:
 *     - large magnitudes (>100) are assumed to be Wh → divide by 1000,
 *     - else assumed to be kWh.
 */
function ensureKwh(value: number | string, unit?: string | null): number {
  let numeric = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(numeric)) return NaN;

  const u = unit?.toLowerCase().trim();

  if (u === "wh") {
    return numeric / 1000;
  }

  if (u === "kwh") {
    return numeric;
  }

  // No explicit unit: infer from magnitude (heuristic from the old project).
  if (Math.abs(numeric) > 100) {
    // Likely watt-hours.
    return numeric / 1000;
  }

  // Otherwise assume already kWh.
  return numeric;
}

/**
 * Round a Date down to the nearest 15-minute boundary (UTC).
 * Example:
 *  - 12:07 → 12:00
 *  - 12:14 → 12:00
 *  - 12:15 → 12:15
 *  - 12:29 → 12:15
 */
function roundDownTo15Minutes(d: Date): Date {
  const ms = d.getTime();
  const FIFTEEN_MIN_MS = 15 * 60 * 1000;
  const bucketMs = Math.floor(ms / FIFTEEN_MIN_MS) * FIFTEEN_MIN_MS;
  return new Date(bucketMs);
}

/**
 * Helper to summarize monthly totals from normalized 15-min intervals.
 * Optional utility if you need monthly aggregates.
 */
export function group15MinToMonthlyTotals(
  intervals: GreenButton15MinInterval[],
): Array<{ year: number; month: number; kWh: number }> {
  const map = new Map<string, number>();

  for (const row of intervals) {
    const ts = row.timestamp;
    const year = ts.getUTCFullYear();
    const month = ts.getUTCMonth() + 1; // 1-12
    const key = `${year}-${month.toString().padStart(2, "0")}`;
    const existing = map.get(key) ?? 0;
    map.set(key, existing + row.consumptionKwh);
  }

  const out: Array<{ year: number; month: number; kWh: number }> = [];
  for (const [key, kWh] of map.entries()) {
    const [y, m] = key.split("-");
    out.push({
      year: Number(y),
      month: Number(m),
      kWh,
    });
  }

  // Sort by year, month.
  out.sort((a, b) => a.year - b.year || a.month - b.month);

  return out;
}


