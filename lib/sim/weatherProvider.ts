/**
 * Simulator weather provider. Single entry for simulator weather.
 * Simulator must use this only — never call Open-Meteo or weatherService directly.
 */

import {
  resolveHistoricalWeather,
  type HistoricalProviderCoverage,
  type HistoricalWeatherRow,
} from "@/lib/weather/weatherService";
import type { DayWeather } from "@/modules/weather/types";
import { WEATHER_SOURCE, WEATHER_STUB_VERSION } from "@/modules/weather/types";

const YYYY_MM_DD = /^\d{4}-\d{2}-\d{2}$/;

export type WeatherForRangeResult = {
  rows: Array<HistoricalWeatherRow & { sourceLabel?: string }>;
  fromStub: false;
  sourceLabel: string;
  provider: "CACHE" | "OPEN_METEO" | "VISUAL_CROSSING";
  fallbackUsed: boolean;
  coverageByProvider: HistoricalProviderCoverage[];
};

/**
 * Get hourly weather for a location and date range.
 * Returns only real/cache-backed weather rows. No synthetic fallback is allowed.
 */
export async function getWeatherForRange(
  lat: number,
  lon: number,
  startDate: string,
  endDate: string,
  timezone?: string
): Promise<WeatherForRangeResult> {
  const result = await resolveHistoricalWeather(lat, lon, startDate, endDate, timezone);
  const rows = result.rows;
  if (rows.length <= 0) {
    throw new Error("Real weather data unavailable for requested range.");
  }
  return { ...result, rows, fromStub: false };
}

/**
 * Convert hourly weather rows to day-level map for the past-sim engine (actualWxByDateKey).
 * Each day's tAvgF, hdd65, cdd65 are derived from hourly temperatures (UTC).
 */
export function hourlyRowsToDayWxMap(
  rows: Array<HistoricalWeatherRow & { sourceLabel?: string }>,
  houseId: string
): Map<string, DayWeather> {
  const byDate = new Map<string, { tempsC: number[]; sourceLabels: Set<string> }>();
  for (const r of rows ?? []) {
    if (!r.timestampUtc || !Number.isFinite(r.temperatureC ?? NaN)) continue;
    const d = r.timestampUtc instanceof Date ? r.timestampUtc : new Date(r.timestampUtc);
    const dateKey = d.toISOString().slice(0, 10);
    if (!YYYY_MM_DD.test(dateKey)) continue;
    let entry = byDate.get(dateKey);
    if (!entry) {
      entry = { tempsC: [], sourceLabels: new Set<string>() };
      byDate.set(dateKey, entry);
    }
    entry.tempsC.push(r.temperatureC as number);
    const sourceLabel = String((r as any)?.sourceLabel ?? "").trim();
    if (sourceLabel) entry.sourceLabels.add(sourceLabel);
  }

  const out = new Map<string, DayWeather>();
  Array.from(byDate.entries()).forEach(([dateKey, entry]) => {
    const temps = entry.tempsC;
    if (temps.length === 0) return;
    const minC = Math.min(...temps);
    const maxC = Math.max(...temps);
    const avgC = temps.reduce((a: number, b: number) => a + b, 0) / temps.length;
    const tMinF = Math.round(((minC * 9) / 5 + 32) * 100) / 100;
    const tMaxF = Math.round(((maxC * 9) / 5 + 32) * 100) / 100;
    const tAvgF = Math.round(((avgC * 9) / 5 + 32) * 100) / 100;
    const hdd65 = Math.round(Math.max(0, 65 - tAvgF) * 100) / 100;
    const cdd65 = Math.round(Math.max(0, tAvgF - 65) * 100) / 100;
    const source =
      entry.sourceLabels.size === 1
        ? Array.from(entry.sourceLabels)[0]!
        : entry.sourceLabels.size > 1
          ? WEATHER_SOURCE.MIXED_REAL_PROVIDERS
          : WEATHER_SOURCE.REAL_HOURLY_CACHE;
    out.set(dateKey, {
      houseId,
      dateKey,
      kind: "ACTUAL_LAST_YEAR",
      version: WEATHER_STUB_VERSION,
      tAvgF,
      tMinF,
      tMaxF,
      hdd65,
      cdd65,
      source,
    });
  });
  return out;
}
