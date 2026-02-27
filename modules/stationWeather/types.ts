export type WeatherSourceMode = "STUB" | "REAL_API";
export type WeatherKind = "ACTUAL_LAST_YEAR" | "NORMAL_AVG";

export type DayWeather = {
  dateKey: string;
  kind: WeatherKind;
  version: number;
  tAvgF: number;
  tMinF: number;
  tMaxF: number;
  hdd65: number;
  cdd65: number;
  source: string;
};

export type DayWeatherByDateKey = Record<string, DayWeather>;

export const STATION_WEATHER_STUB_SOURCE = "STUB_V1";
export const STATION_WEATHER_DEFAULT_VERSION = 1;
