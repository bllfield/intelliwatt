import type { WeatherKind } from "@/modules/weather/types";
import type { WeatherPreference } from "@/modules/weatherNormalization/normalizer";

export type WeatherLogicOwner = "userWeatherLogicSetting" | "gapfillWeatherLogicSetting";
export type WeatherLogicMode = "LAST_YEAR_ACTUAL_WEATHER" | "LONG_TERM_AVERAGE_WEATHER";

export type ResolvedWeatherLogicSetting = {
  owner: WeatherLogicOwner;
  weatherLogicMode: WeatherLogicMode;
  weatherPreference: WeatherPreference;
  weatherKind: WeatherKind;
};

export function resolveWeatherLogicMode(raw: unknown): WeatherLogicMode {
  const value = String(raw ?? "").trim();
  switch (value) {
    case "LONG_TERM_AVERAGE_WEATHER":
    case "LONG_TERM_AVERAGE":
    case "NORMAL_AVG":
      return "LONG_TERM_AVERAGE_WEATHER";
    case "LAST_YEAR_ACTUAL_WEATHER":
    case "LAST_YEAR_WEATHER":
    case "ACTUAL_LAST_YEAR":
    case "open_meteo":
    case "NONE":
    default:
      return "LAST_YEAR_ACTUAL_WEATHER";
  }
}

export function resolveWeatherPreferenceForLogicMode(
  weatherLogicMode: WeatherLogicMode
): WeatherPreference {
  return weatherLogicMode === "LONG_TERM_AVERAGE_WEATHER"
    ? "LONG_TERM_AVERAGE"
    : "LAST_YEAR_WEATHER";
}

export function resolveWeatherKindForLogicMode(weatherLogicMode: WeatherLogicMode): WeatherKind {
  return weatherLogicMode === "LONG_TERM_AVERAGE_WEATHER"
    ? "NORMAL_AVG"
    : "ACTUAL_LAST_YEAR";
}

export function resolveUserWeatherLogicSetting(
  weatherPreference: WeatherPreference | null | undefined
): ResolvedWeatherLogicSetting {
  const weatherLogicMode = resolveWeatherLogicMode(weatherPreference ?? "LAST_YEAR_WEATHER");
  return {
    owner: "userWeatherLogicSetting",
    weatherLogicMode,
    weatherPreference: resolveWeatherPreferenceForLogicMode(weatherLogicMode),
    weatherKind: resolveWeatherKindForLogicMode(weatherLogicMode),
  };
}

export function resolveGapfillWeatherLogicSetting(raw: unknown): ResolvedWeatherLogicSetting {
  const weatherLogicMode = resolveWeatherLogicMode(raw);
  return {
    owner: "gapfillWeatherLogicSetting",
    weatherLogicMode,
    weatherPreference: resolveWeatherPreferenceForLogicMode(weatherLogicMode),
    weatherKind: resolveWeatherKindForLogicMode(weatherLogicMode),
  };
}

export function resolveWeatherLogicModeFromBuildInputs(
  buildInputs: Record<string, unknown> | null | undefined
): WeatherLogicMode {
  const explicitMode = buildInputs?.weatherLogicMode;
  if (typeof explicitMode === "string" && explicitMode.trim()) {
    return resolveWeatherLogicMode(explicitMode);
  }
  return resolveWeatherLogicMode(buildInputs?.weatherPreference ?? "LAST_YEAR_WEATHER");
}

