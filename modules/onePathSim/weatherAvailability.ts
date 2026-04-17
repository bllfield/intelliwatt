import { WEATHER_SOURCE, WEATHER_STUB_SOURCE, type DayWeatherByDateKey } from "@/modules/weather/types";

export type OnePathWeatherLogicMode = "LAST_YEAR_ACTUAL_WEATHER" | "LONG_TERM_AVERAGE_WEATHER";

export type OnePathWeatherAvailability = {
  available: boolean;
  weatherSourceSummary: "actual_only" | "stub_only" | "mixed_actual_and_stub" | "none";
  weatherFallbackReason: string | null;
  weatherProviderName: string | null;
  weatherCoverageStart: string | null;
  weatherCoverageEnd: string | null;
  weatherActualRowCount: number;
  weatherStubRowCount: number;
  missingDateCount: number;
  missingDateKeys: string[];
  failureMessage: string | null;
};

export type OnePathWeatherGuardScope = "trusted_simulation_output" | "baseline_passthrough_or_lookup";

export type OnePathWeatherGuardDecision = {
  scope: OnePathWeatherGuardScope;
  shouldHardStop: boolean;
  weatherTrustStatus: "trusted_weather" | "untrusted_weather" | "weather_incomplete_for_baseline_readback";
  weatherCoverageStatus:
    | "actual_weather_coverage_complete"
    | "partial_weather_coverage"
    | "missing_weather_coverage"
    | "stub_weather_only";
  missingLatestWeatherDay: boolean;
  partialWeatherCoverage: boolean;
  failureMessage: string | null;
};

function uniqueSortedDateKeys(dateKeys: string[]): string[] {
  return Array.from(
    new Set(
      (dateKeys ?? [])
        .map((dateKey) => String(dateKey ?? "").slice(0, 10))
        .filter((dateKey) => /^\d{4}-\d{2}-\d{2}$/.test(dateKey))
    )
  ).sort();
}

export function summarizeOnePathWeatherAvailability(args: {
  expectedDateKeys: string[];
  wxMap: DayWeatherByDateKey;
  weatherLogicMode: OnePathWeatherLogicMode;
  skippedLatLng?: boolean;
}) : OnePathWeatherAvailability {
  const expectedDateKeys = uniqueSortedDateKeys(args.expectedDateKeys);
  const actualSources = new Set<string>();
  let weatherActualRowCount = 0;
  let weatherStubRowCount = 0;
  const missingDateKeys: string[] = [];

  for (const dateKey of expectedDateKeys) {
    const row = args.wxMap.get(dateKey);
    if (!row) {
      missingDateKeys.push(dateKey);
      continue;
    }
    const source = String(row.source ?? "").trim();
    if (source && source !== WEATHER_STUB_SOURCE) {
      weatherActualRowCount += 1;
      actualSources.add(source);
    } else {
      weatherStubRowCount += 1;
    }
  }

  const missingDateCount = missingDateKeys.length;
  const weatherCoverageStart = expectedDateKeys[0] ?? null;
  const weatherCoverageEnd = expectedDateKeys[expectedDateKeys.length - 1] ?? null;
  const weatherProviderName =
    actualSources.size <= 0
      ? null
      : actualSources.size === 1
        ? Array.from(actualSources)[0]!
        : WEATHER_SOURCE.MIXED_REAL_PROVIDERS;

  let weatherSourceSummary: OnePathWeatherAvailability["weatherSourceSummary"] = "none";
  if (weatherActualRowCount === expectedDateKeys.length && weatherStubRowCount === 0 && missingDateCount === 0) {
    weatherSourceSummary = "actual_only";
  } else if (weatherActualRowCount > 0) {
    weatherSourceSummary = "mixed_actual_and_stub";
  } else if (weatherStubRowCount > 0) {
    weatherSourceSummary = "stub_only";
  }

  const available = weatherSourceSummary === "actual_only";
  let weatherFallbackReason: string | null = null;
  if (!available) {
    weatherFallbackReason = args.skippedLatLng
      ? "missing_lat_lng"
      : weatherSourceSummary === "none"
        ? "api_failure_or_no_data"
        : "partial_coverage";
  }

  let failureMessage: string | null = null;
  if (!available) {
    if (args.weatherLogicMode === "LONG_TERM_AVERAGE_WEATHER") {
      failureMessage =
        weatherFallbackReason === "missing_lat_lng"
          ? "Shared simulation weather guard failed: house coordinates are missing, so long-term-average weather could not be loaded."
          : "Shared simulation weather guard failed: long-term-average weather coverage is unavailable or incomplete for the modeled window.";
    } else {
      failureMessage =
        weatherFallbackReason === "missing_lat_lng"
          ? "Shared simulation weather guard failed: house coordinates are missing, so actual weather could not be loaded."
          : "Shared simulation weather guard failed: modeled window is not backed by actual-only real weather coverage.";
    }
  }

  return {
    available,
    weatherSourceSummary,
    weatherFallbackReason,
    weatherProviderName,
    weatherCoverageStart,
    weatherCoverageEnd,
    weatherActualRowCount,
    weatherStubRowCount,
    missingDateCount,
    missingDateKeys,
    failureMessage,
  };
}

export function resolveOnePathWeatherGuardDecision(args: {
  availability: OnePathWeatherAvailability;
  scope: OnePathWeatherGuardScope;
}): OnePathWeatherGuardDecision {
  const missingLatestWeatherDay =
    args.availability.weatherCoverageEnd != null &&
    args.availability.missingDateKeys.includes(args.availability.weatherCoverageEnd);
  const partialWeatherCoverage =
    args.availability.weatherSourceSummary === "mixed_actual_and_stub" ||
    args.availability.weatherSourceSummary === "stub_only";
  const weatherCoverageStatus: OnePathWeatherGuardDecision["weatherCoverageStatus"] =
    args.availability.weatherSourceSummary === "actual_only"
      ? "actual_weather_coverage_complete"
      : args.availability.weatherSourceSummary === "none"
        ? "missing_weather_coverage"
        : args.availability.weatherSourceSummary === "stub_only"
          ? "stub_weather_only"
          : "partial_weather_coverage";
  const shouldHardStop = args.scope === "trusted_simulation_output" && !args.availability.available;

  return {
    scope: args.scope,
    shouldHardStop,
    weatherTrustStatus: args.availability.available
      ? "trusted_weather"
      : shouldHardStop
        ? "untrusted_weather"
        : "weather_incomplete_for_baseline_readback",
    weatherCoverageStatus,
    missingLatestWeatherDay,
    partialWeatherCoverage,
    failureMessage: shouldHardStop ? args.availability.failureMessage : null,
  };
}
