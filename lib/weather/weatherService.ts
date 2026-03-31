/**
 * Weather service layer. Single entry point for historical weather.
 * Simulator must use this only — never call Open-Meteo or weatherCacheRepo directly.
 * Supports HVAC demand modeling and solar production simulation.
 */

import {
  fetchHistoricalDailyTemperatures,
  fetchHistoricalWeather,
  type OpenMeteoDailyTemperatureRow,
} from "./openMeteoClient";
import {
  fetchHistoricalDailyTemperatures as fetchVisualCrossingDailyTemperatures,
  fetchHistoricalHourlyWeather as fetchVisualCrossingHourlyWeather,
} from "./visualCrossingClient";
import {
  getWeatherRange,
  hasFullCoverage,
  insertWeatherBatch,
  type WeatherHourlyRow,
} from "./weatherCacheRepo";
import { canonicalUsageWindowForTimezone } from "@/lib/time/chicago";
import {
  NORMALS_BASELINE_END_DATE,
  NORMALS_BASELINE_START_DATE,
  WEATHER_SOURCE,
} from "@/modules/weather/types";

export type HistoricalWeatherRow = WeatherHourlyRow;
export type HistoricalDailyTemperatureRow = OpenMeteoDailyTemperatureRow;
export type HistoricalWeatherProvider = "CACHE" | "OPEN_METEO" | "VISUAL_CROSSING";
export type HistoricalProviderCoverage = {
  provider: HistoricalWeatherProvider;
  sourceLabel: string;
  count: number;
  coverageStart: string | null;
  coverageEnd: string | null;
};
export type ResolvedHistoricalWeatherResult = {
  rows: Array<HistoricalWeatherRow & { sourceLabel?: string }>;
  provider: HistoricalWeatherProvider;
  sourceLabel: string;
  fallbackUsed: boolean;
  coverageByProvider: HistoricalProviderCoverage[];
};
export type ResolvedHistoricalDailyTemperaturesResult = {
  rows: HistoricalDailyTemperatureRow[];
  provider: Exclude<HistoricalWeatherProvider, "CACHE">;
  sourceLabel: string;
  fallbackUsed: boolean;
  coverageByProvider: HistoricalProviderCoverage[];
  baselineStartDate: string;
  baselineEndDate: string;
};
const YYYY_MM_DD = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Normalize coordinates to 0.1° buckets so nearby homes share cache.
 * Example: 32.7555 → 32.8, -97.3308 → -97.3
 */
export function bucketCoordinate(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Parse a date string (YYYY-MM-DD) to start of day UTC.
 */
function toStartOfDayUtc(dateStr: string): Date {
  const s = String(dateStr).trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return new Date(s);
  }
  return new Date(Date.UTC(
    parseInt(s.slice(0, 4), 10),
    parseInt(s.slice(5, 7), 10) - 1,
    parseInt(s.slice(8, 10), 10),
    0,
    0,
    0,
    0
  ));
}

/**
 * Parse a date string (YYYY-MM-DD) to end of that day in UTC (23:00:00.000).
 */
function toEndOfDayUtc(dateStr: string): Date {
  const s = String(dateStr).trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = new Date(s);
    d.setUTCHours(23, 0, 0, 0);
    return d;
  }
  return new Date(Date.UTC(
    parseInt(s.slice(0, 4), 10),
    parseInt(s.slice(5, 7), 10) - 1,
    parseInt(s.slice(8, 10), 10),
    23,
    0,
    0,
    0
  ));
}

function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

function toIsoHourKey(date: Date): string {
  return date.toISOString().slice(0, 13);
}

function expectedHourKeys(start: Date, end: Date): string[] {
  const out: string[] = [];
  for (let cursor = new Date(start.getTime()); cursor.getTime() <= end.getTime(); cursor = addHours(cursor, 1)) {
    out.push(toIsoHourKey(cursor));
  }
  return out;
}

function applySourceLabelToRows<T extends HistoricalWeatherRow>(
  rows: T[],
  sourceLabel: string
): Array<T & { sourceLabel: string }> {
  return rows.map((row) => ({ ...row, sourceLabel }));
}

function coverageFromHourlyRows(
  provider: HistoricalWeatherProvider,
  sourceLabel: string,
  rows: Array<HistoricalWeatherRow & { sourceLabel?: string }>
): HistoricalProviderCoverage {
  const sorted = [...rows]
    .map((row) => row.timestampUtc)
    .filter((value): value is Date => value instanceof Date && Number.isFinite(value.getTime()))
    .sort((a, b) => a.getTime() - b.getTime());
  return {
    provider,
    sourceLabel,
    count: rows.length,
    coverageStart: sorted[0]?.toISOString() ?? null,
    coverageEnd: sorted[sorted.length - 1]?.toISOString() ?? null,
  };
}

function coverageFromDailyRows(
  provider: Exclude<HistoricalWeatherProvider, "CACHE">,
  sourceLabel: string,
  rows: HistoricalDailyTemperatureRow[]
): HistoricalProviderCoverage {
  const sorted = rows
    .map((row) => String(row.dateKey ?? "").slice(0, 10))
    .filter((dateKey) => YYYY_MM_DD.test(dateKey))
    .sort();
  return {
    provider,
    sourceLabel,
    count: rows.length,
    coverageStart: sorted[0] ?? null,
    coverageEnd: sorted[sorted.length - 1] ?? null,
  };
}

/**
 * Get historical hourly weather for a location and date range.
 * Uses bucketed coordinates for shared cache. Fetches from Open-Meteo only on cache miss.
 */
export async function resolveHistoricalWeather(
  lat: number,
  lon: number,
  startDate: string,
  endDate: string,
  timezone?: string
): Promise<ResolvedHistoricalWeatherResult> {
  const latBucket = bucketCoordinate(lat);
  const lonBucket = bucketCoordinate(lon);
  const startDateKey = String(startDate).trim().slice(0, 10);
  const endDateKeyRaw = String(endDate).trim().slice(0, 10);
  const maxArchiveDateKey = canonicalUsageWindowForTimezone({
    timezone: String(timezone ?? "America/Chicago").trim() || "America/Chicago",
  }).endDate;
  const endDateKey =
    YYYY_MM_DD.test(endDateKeyRaw) && endDateKeyRaw > maxArchiveDateKey ? maxArchiveDateKey : endDateKeyRaw;
  if (YYYY_MM_DD.test(startDateKey) && YYYY_MM_DD.test(endDateKey) && startDateKey > endDateKey) {
    return {
      rows: [],
      provider: "OPEN_METEO",
      sourceLabel: WEATHER_SOURCE.OPEN_METEO_LIVE,
      fallbackUsed: false,
      coverageByProvider: [],
    };
  }
  const start = toStartOfDayUtc(startDateKey);
  const end = toEndOfDayUtc(endDateKey);
  const expectedKeys = new Set(expectedHourKeys(start, end));

  const cached = await getWeatherRange(latBucket, lonBucket, start, end);
  const full = await hasFullCoverage(latBucket, lonBucket, start, end);
  if (full && cached.length > 0) {
    const rows = applySourceLabelToRows(cached, WEATHER_SOURCE.REAL_HOURLY_CACHE);
    return {
      rows,
      provider: "CACHE",
      sourceLabel: WEATHER_SOURCE.REAL_HOURLY_CACHE,
      fallbackUsed: false,
      coverageByProvider: [coverageFromHourlyRows("CACHE", WEATHER_SOURCE.REAL_HOURLY_CACHE, rows)],
    };
  }

  const startStr = startDateKey;
  const endStr = endDateKey;
  const coverageByProvider: HistoricalProviderCoverage[] = [];
  const rowsByHour = new Map<string, HistoricalWeatherRow & { sourceLabel?: string }>();
  let openMeteoError: string | null = null;
  try {
    const openMeteoRows = applySourceLabelToRows(
      await fetchHistoricalWeather(lat, lon, startStr, endStr),
      WEATHER_SOURCE.OPEN_METEO_LIVE
    );
    for (const row of openMeteoRows) {
      if (!(row.timestampUtc instanceof Date) || !Number.isFinite(row.timestampUtc.getTime())) continue;
      rowsByHour.set(toIsoHourKey(row.timestampUtc), row);
    }
    if (openMeteoRows.length > 0) {
      coverageByProvider.push(
        coverageFromHourlyRows("OPEN_METEO", WEATHER_SOURCE.OPEN_METEO_LIVE, openMeteoRows)
      );
    }
  } catch (err) {
    openMeteoError = err instanceof Error ? err.message : String(err);
  }
  const missingHourKeys = Array.from(expectedKeys).filter((key) => !rowsByHour.has(key)).sort();
  let visualCrossingError: string | null = null;
  if (missingHourKeys.length > 0) {
    try {
      const visualCrossingRows = applySourceLabelToRows(
        await fetchVisualCrossingHourlyWeather(lat, lon, startStr, endStr),
        WEATHER_SOURCE.VISUAL_CROSSING_HISTORICAL
      );
      const usedVisualCrossingRows: Array<HistoricalWeatherRow & { sourceLabel?: string }> = [];
      for (const row of visualCrossingRows) {
        if (!(row.timestampUtc instanceof Date) || !Number.isFinite(row.timestampUtc.getTime())) continue;
        const hourKey = toIsoHourKey(row.timestampUtc);
        if (!expectedKeys.has(hourKey) || rowsByHour.has(hourKey)) continue;
        rowsByHour.set(hourKey, row);
        usedVisualCrossingRows.push(row);
      }
      if (usedVisualCrossingRows.length > 0) {
        coverageByProvider.push(
          coverageFromHourlyRows(
            "VISUAL_CROSSING",
            WEATHER_SOURCE.VISUAL_CROSSING_HISTORICAL,
            usedVisualCrossingRows
          )
        );
      }
    } catch (err) {
      visualCrossingError = err instanceof Error ? err.message : String(err);
    }
  }

  const rows = Array.from(rowsByHour.entries())
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([, row]) => row);
  const stillMissingHourKeys = Array.from(expectedKeys).filter((key) => !rowsByHour.has(key)).sort();
  if (rows.length > 0) {
    await insertWeatherBatch(latBucket, lonBucket, rows);
  }
  if (stillMissingHourKeys.length > 0) {
    throw new Error(
      `Real weather data unavailable for requested range. openMeteo=${openMeteoError ?? "incomplete"} visualCrossing=${
        visualCrossingError ?? "incomplete"
      } missingHours=${stillMissingHourKeys.length}`
    );
  }
  const provider =
    coverageByProvider.some((entry) => entry.provider === "VISUAL_CROSSING") &&
    !coverageByProvider.some((entry) => entry.provider === "OPEN_METEO")
      ? "VISUAL_CROSSING"
      : "OPEN_METEO";
  const sourceLabel =
    provider === "VISUAL_CROSSING"
      ? WEATHER_SOURCE.VISUAL_CROSSING_HISTORICAL
      : WEATHER_SOURCE.OPEN_METEO_LIVE;
  return {
    rows,
    provider,
    sourceLabel,
    fallbackUsed: coverageByProvider.some((entry) => entry.provider === "VISUAL_CROSSING"),
    coverageByProvider,
  };
}

/**
 * Get historical hourly weather for a location and date range.
 * Uses bucketed coordinates for shared cache. Fetches from provider chain only on cache miss.
 */
export async function getHistoricalWeather(
  lat: number,
  lon: number,
  startDate: string,
  endDate: string,
  timezone?: string
): Promise<HistoricalWeatherRow[]> {
  const result = await resolveHistoricalWeather(lat, lon, startDate, endDate, timezone);
  return result.rows;
}

/**
 * Get historical daily temperatures for a stable long-term-average baseline.
 * No synthetic fallback is allowed.
 */
export async function resolveHistoricalDailyTemperatures(
  lat: number,
  lon: number,
  startDate: string,
  endDate: string
): Promise<ResolvedHistoricalDailyTemperaturesResult> {
  const startDateKey = String(startDate).trim().slice(0, 10);
  const endDateKey = String(endDate).trim().slice(0, 10);
  if (YYYY_MM_DD.test(startDateKey) && YYYY_MM_DD.test(endDateKey) && startDateKey > endDateKey) {
    return {
      rows: [],
      provider: "OPEN_METEO",
      sourceLabel: WEATHER_SOURCE.OPEN_METEO_NORMAL_1991_2020_ERA5,
      fallbackUsed: false,
      coverageByProvider: [],
      baselineStartDate: NORMALS_BASELINE_START_DATE,
      baselineEndDate: NORMALS_BASELINE_END_DATE,
    };
  }
  let openMeteoError: string | null = null;
  try {
    const rows = await fetchHistoricalDailyTemperatures(lat, lon, startDateKey, endDateKey);
    if (rows.length > 0) {
      return {
        rows,
        provider: "OPEN_METEO",
        sourceLabel: WEATHER_SOURCE.OPEN_METEO_NORMAL_1991_2020_ERA5,
        fallbackUsed: false,
        coverageByProvider: [
          coverageFromDailyRows("OPEN_METEO", WEATHER_SOURCE.OPEN_METEO_NORMAL_1991_2020_ERA5, rows),
        ],
        baselineStartDate: NORMALS_BASELINE_START_DATE,
        baselineEndDate: NORMALS_BASELINE_END_DATE,
      };
    }
    openMeteoError = "no rows";
  } catch (err) {
    openMeteoError = err instanceof Error ? err.message : String(err);
  }

  try {
    const rows = await fetchVisualCrossingDailyTemperatures(lat, lon, startDateKey, endDateKey);
    if (rows.length > 0) {
      return {
        rows,
        provider: "VISUAL_CROSSING",
        sourceLabel: WEATHER_SOURCE.VISUAL_CROSSING_NORMAL_1991_2020,
        fallbackUsed: true,
        coverageByProvider: [
          coverageFromDailyRows(
            "VISUAL_CROSSING",
            WEATHER_SOURCE.VISUAL_CROSSING_NORMAL_1991_2020,
            rows
          ),
        ],
        baselineStartDate: NORMALS_BASELINE_START_DATE,
        baselineEndDate: NORMALS_BASELINE_END_DATE,
      };
    }
  } catch (err) {
    throw new Error(
      `Historical daily temperatures unavailable. openMeteo=${openMeteoError ?? "no rows"} visualCrossing=${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }

  throw new Error(
    `Historical daily temperatures unavailable. openMeteo=${openMeteoError ?? "no rows"} visualCrossing=no rows`
  );
}

export async function getHistoricalDailyTemperatures(
  lat: number,
  lon: number,
  startDate: string,
  endDate: string
): Promise<HistoricalDailyTemperatureRow[]> {
  const result = await resolveHistoricalDailyTemperatures(lat, lon, startDate, endDate);
  return result.rows;
}