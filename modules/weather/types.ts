export type WeatherKind = "ACTUAL_LAST_YEAR" | "NORMAL_AVG";

export type DayWeather = {
  houseId: string;
  dateKey: string; // YYYY-MM-DD
  kind: WeatherKind;
  version: number;
  tAvgF: number;
  tMinF: number;
  tMaxF: number;
  hdd65: number;
  cdd65: number;
  source: string;
};

export type DayWeatherByDateKey = Map<string, DayWeather>;

export const WEATHER_STUB_SOURCE = "STUB_V1";
export const WEATHER_STUB_VERSION = 1;

/** Canonical weather source labels for GapFill and simulator diagnostics. Use these when reporting what was actually used. */
export const WEATHER_SOURCE = {
  STUB_V1: "STUB_V1",
  OPEN_METEO_CACHE: "OPEN_METEO_CACHE",
  OPEN_METEO_LIVE: "OPEN_METEO_LIVE",
  /** DB-backed: ACTUAL_LAST_YEAR or NORMAL_AVG (row.source may still be STUB_V1 if DB was backfilled with stub). */
  ACTUAL_LAST_YEAR: "ACTUAL_LAST_YEAR",
  NORMAL_AVG: "NORMAL_AVG",
  FALLBACK_CLIMO: "FALLBACK_CLIMO",
} as const;
export type WeatherSourceLabel = (typeof WEATHER_SOURCE)[keyof typeof WEATHER_SOURCE];
