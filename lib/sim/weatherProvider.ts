/**
 * Simulator weather provider. Single entry for simulator weather: real service with stub fallback.
 * Simulator must use this only — never call Open-Meteo or weatherService directly.
 */

import { getHistoricalWeather, type HistoricalWeatherRow } from "@/lib/weather/weatherService";
import type { DayWeather } from "@/modules/weather/types";
import { WEATHER_STUB_SOURCE, WEATHER_STUB_VERSION } from "@/modules/weather/types";

const YYYY_MM_DD = /^\d{4}-\d{2}-\d{2}$/;

export type WeatherForRangeResult = {
  rows: HistoricalWeatherRow[];
  fromStub: boolean;
};

function fToC(f: number): number {
  return ((Number(f) || 0) - 32) * (5 / 9);
}

function dayOfYearUtc(dateKey: string): number {
  const d = new Date(`${dateKey}T12:00:00.000Z`);
  if (!Number.isFinite(d.getTime())) return 1;
  const start = Date.UTC(d.getUTCFullYear(), 0, 1, 12, 0, 0, 0);
  return Math.max(1, Math.floor((d.getTime() - start) / (24 * 60 * 60 * 1000)) + 1);
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function hashStringToUnit(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1_000_000) / 1_000_000;
}

function normalMonthlyAvgF(month1: number): number {
  const m = clamp(month1, 1, 12);
  const normals = [48, 52, 60, 68, 75, 83, 87, 88, 81, 70, 58, 50];
  return normals[m - 1];
}

function normalMonthSwingF(month1: number): number {
  const m = clamp(month1, 1, 12);
  const swings = [12, 12, 13, 14, 14, 13, 12, 12, 13, 13, 12, 12];
  return swings[m - 1];
}

function buildStubDay(dateKey: string): { tMinF: number; tMaxF: number; tAvgF: number } {
  const d = new Date(`${dateKey}T12:00:00.000Z`);
  const month1 = Number.isFinite(d.getTime()) ? d.getUTCMonth() + 1 : 1;
  const doy = dayOfYearUtc(dateKey);
  const seasonal = Math.sin((2 * Math.PI * (doy - 1)) / 365);
  const avg = normalMonthlyAvgF(month1) + seasonal * 1.2;
  const swing = normalMonthSwingF(month1);
  const u = hashStringToUnit(`STUB_HOURLY:${dateKey}`);
  const perturb = (u - 0.5) * 2.6;
  const tAvgF = Math.round((avg + perturb) * 100) / 100;
  const tMinF = Math.round((tAvgF - swing / 2) * 100) / 100;
  const tMaxF = Math.round((tAvgF + swing / 2) * 100) / 100;
  return { tMinF, tMaxF, tAvgF };
}

/** Stub hourly weather for a date range (same shape as Open-Meteo hourly). Used when service fails. */
function generateStubHourlyWeather(startDate: string, endDate: string): HistoricalWeatherRow[] {
  const start = String(startDate).trim().slice(0, 10);
  const end = String(endDate).trim().slice(0, 10);
  if (!YYYY_MM_DD.test(start) || !YYYY_MM_DD.test(end) || end < start) return [];

  const rows: HistoricalWeatherRow[] = [];
  const startMs = new Date(start + "T00:00:00.000Z").getTime();
  const endMs = new Date(end + "T23:00:00.000Z").getTime();
  const stepMs = 60 * 60 * 1000;

  for (let t = startMs; t <= endMs; t += stepMs) {
    const d = new Date(t);
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth();
    const day = d.getUTCDate();
    const hour = d.getUTCHours();
    const dateKey = `${y}-${String(m + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const dayStub = buildStubDay(dateKey);
    const frac = hour / 24;
    const tempF = dayStub.tMinF + (dayStub.tMaxF - dayStub.tMinF) * (0.5 + 0.4 * Math.sin(Math.PI * (frac - 0.25)));
    const temperatureC = Math.round(fToC(tempF) * 10) / 10;
    const solarRadiation = hour >= 6 && hour <= 18 ? Math.round(200 + 150 * Math.sin((Math.PI * (hour - 6)) / 12)) : 0;
    rows.push({
      timestampUtc: new Date(t),
      temperatureC,
      cloudcoverPct: 50,
      solarRadiation,
    });
  }
  return rows;
}

/**
 * Get hourly weather for a location and date range.
 * Tries real weather service first; on failure or no data, falls back to stub and logs a warning.
 */
export async function getWeatherForRange(
  lat: number,
  lon: number,
  startDate: string,
  endDate: string,
  timezone?: string
): Promise<WeatherForRangeResult> {
  try {
    const rows = await getHistoricalWeather(lat, lon, startDate, endDate, timezone);
    if (rows.length > 0) {
      return { rows, fromStub: false };
    }
    console.warn("Weather service unavailable, using stub weather. (no data returned)");
  } catch (err) {
    console.warn("Weather service unavailable, using stub weather.", err instanceof Error ? err.message : String(err));
  }
  const stubRows = generateStubHourlyWeather(startDate, endDate);
  return { rows: stubRows, fromStub: true };
}

/**
 * Convert hourly weather rows to day-level map for the past-sim engine (actualWxByDateKey).
 * Each day's tAvgF, hdd65, cdd65 are derived from hourly temperatures (UTC).
 */
export function hourlyRowsToDayWxMap(
  rows: HistoricalWeatherRow[],
  houseId: string
): Map<string, DayWeather> {
  const byDate = new Map<string, { tempsC: number[] }>();
  for (const r of rows ?? []) {
    if (!r.timestampUtc || !Number.isFinite(r.temperatureC ?? NaN)) continue;
    const d = r.timestampUtc instanceof Date ? r.timestampUtc : new Date(r.timestampUtc);
    const dateKey = d.toISOString().slice(0, 10);
    if (!YYYY_MM_DD.test(dateKey)) continue;
    let entry = byDate.get(dateKey);
    if (!entry) {
      entry = { tempsC: [] };
      byDate.set(dateKey, entry);
    }
    entry.tempsC.push(r.temperatureC as number);
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
      source: "OPEN_METEO_CACHE",
    });
  });
  return out;
}
