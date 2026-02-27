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
