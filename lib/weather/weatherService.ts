/**
 * Weather service layer. Single entry point for historical weather.
 * Simulator must use this only — never call Open-Meteo or weatherCacheRepo directly.
 * Supports HVAC demand modeling and solar production simulation.
 */

import { fetchHistoricalWeather } from "./openMeteoClient";
import {
  getWeatherRange,
  hasFullCoverage,
  insertWeatherBatch,
  type WeatherHourlyRow,
} from "./weatherCacheRepo";

export type HistoricalWeatherRow = WeatherHourlyRow;

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
    d.setUTCHours(23, 59, 59, 999);
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

/**
 * Get historical hourly weather for a location and date range.
 * Uses bucketed coordinates for shared cache. Fetches from Open-Meteo only on cache miss.
 */
export async function getHistoricalWeather(
  lat: number,
  lon: number,
  startDate: string,
  endDate: string
): Promise<HistoricalWeatherRow[]> {
  const latBucket = bucketCoordinate(lat);
  const lonBucket = bucketCoordinate(lon);
  const start = toStartOfDayUtc(startDate);
  const end = toEndOfDayUtc(endDate);

  const cached = await getWeatherRange(latBucket, lonBucket, start, end);
  const full = await hasFullCoverage(latBucket, lonBucket, start, end);
  if (full && cached.length > 0) {
    return cached;
  }

  const startStr = startDate.slice(0, 10);
  const endStr = endDate.slice(0, 10);
  const rows = await fetchHistoricalWeather(lat, lon, startStr, endStr);
  if (rows.length > 0) {
    await insertWeatherBatch(latBucket, lonBucket, rows);
  }
  return rows;
}
