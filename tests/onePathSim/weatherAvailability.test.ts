import { describe, expect, it } from "vitest";
import {
  resolveOnePathWeatherGuardDecision,
  summarizeOnePathWeatherAvailability,
} from "@/modules/onePathSim/weatherAvailability";

describe("summarizeOnePathWeatherAvailability", () => {
  it("accepts only full real-weather coverage", () => {
    const summary = summarizeOnePathWeatherAvailability({
      expectedDateKeys: ["2026-01-01", "2026-01-02"],
      wxMap: new Map([
        ["2026-01-01", { houseId: "h1", dateKey: "2026-01-01", kind: "ACTUAL_LAST_YEAR", version: 1, tAvgF: 50, tMinF: 40, tMaxF: 60, hdd65: 15, cdd65: 0, source: "OPEN_METEO_CACHE" }],
        ["2026-01-02", { houseId: "h1", dateKey: "2026-01-02", kind: "ACTUAL_LAST_YEAR", version: 1, tAvgF: 51, tMinF: 41, tMaxF: 61, hdd65: 14, cdd65: 0, source: "OPEN_METEO_CACHE" }],
      ]),
      weatherLogicMode: "LAST_YEAR_ACTUAL_WEATHER",
    });

    expect(summary.available).toBe(true);
    expect(summary.weatherSourceSummary).toBe("actual_only");
    expect(summary.weatherFallbackReason).toBeNull();
    expect(summary.failureMessage).toBeNull();
  });

  it("fails hard for partial or stub-backed actual weather", () => {
    const summary = summarizeOnePathWeatherAvailability({
      expectedDateKeys: ["2026-01-01", "2026-01-02"],
      wxMap: new Map([
        ["2026-01-01", { houseId: "h1", dateKey: "2026-01-01", kind: "ACTUAL_LAST_YEAR", version: 1, tAvgF: 50, tMinF: 40, tMaxF: 60, hdd65: 15, cdd65: 0, source: "OPEN_METEO_CACHE" }],
        ["2026-01-02", { houseId: "h1", dateKey: "2026-01-02", kind: "ACTUAL_LAST_YEAR", version: 1, tAvgF: 0, tMinF: 0, tMaxF: 0, hdd65: 0, cdd65: 0, source: "STUB_V1" }],
      ]),
      weatherLogicMode: "LAST_YEAR_ACTUAL_WEATHER",
    });

    expect(summary.available).toBe(false);
    expect(summary.weatherSourceSummary).toBe("mixed_actual_and_stub");
    expect(summary.weatherFallbackReason).toBe("partial_coverage");
    expect(summary.failureMessage).toContain("actual-only real weather coverage");
  });

  it("fails hard when long-term-average weather is unavailable", () => {
    const summary = summarizeOnePathWeatherAvailability({
      expectedDateKeys: ["2026-01-01", "2026-01-02"],
      wxMap: new Map(),
      weatherLogicMode: "LONG_TERM_AVERAGE_WEATHER",
      skippedLatLng: true,
    });

    expect(summary.available).toBe(false);
    expect(summary.weatherSourceSummary).toBe("none");
    expect(summary.weatherFallbackReason).toBe("missing_lat_lng");
    expect(summary.failureMessage).toContain("long-term-average weather");
  });

  it("keeps Past Sim / trusted weather-shaped outputs on a fatal weather hard-stop", () => {
    const availability = summarizeOnePathWeatherAvailability({
      expectedDateKeys: ["2026-04-14", "2026-04-15"],
      wxMap: new Map([
        ["2026-04-14", { houseId: "h1", dateKey: "2026-04-14", kind: "ACTUAL_LAST_YEAR", version: 1, tAvgF: 50, tMinF: 40, tMaxF: 60, hdd65: 15, cdd65: 0, source: "OPEN_METEO_CACHE" }],
      ]),
      weatherLogicMode: "LAST_YEAR_ACTUAL_WEATHER",
    });

    const guard = resolveOnePathWeatherGuardDecision({
      availability,
      scope: "trusted_simulation_output",
    });

    expect(guard.shouldHardStop).toBe(true);
    expect(guard.weatherTrustStatus).toBe("untrusted_weather");
    expect(guard.weatherCoverageStatus).toBe("partial_weather_coverage");
    expect(guard.missingLatestWeatherDay).toBe(true);
    expect(guard.partialWeatherCoverage).toBe(true);
    expect(guard.failureMessage).toContain("actual-only real weather coverage");
  });

  it("does not hard-stop baseline passthrough or lookup-only reads earlier than usage truth", () => {
    const availability = summarizeOnePathWeatherAvailability({
      expectedDateKeys: ["2026-04-14", "2026-04-15"],
      wxMap: new Map([
        ["2026-04-14", { houseId: "h1", dateKey: "2026-04-14", kind: "ACTUAL_LAST_YEAR", version: 1, tAvgF: 50, tMinF: 40, tMaxF: 60, hdd65: 15, cdd65: 0, source: "OPEN_METEO_CACHE" }],
      ]),
      weatherLogicMode: "LAST_YEAR_ACTUAL_WEATHER",
    });

    const guard = resolveOnePathWeatherGuardDecision({
      availability,
      scope: "baseline_passthrough_or_lookup",
    });

    expect(guard.shouldHardStop).toBe(false);
    expect(guard.weatherTrustStatus).toBe("weather_incomplete_for_baseline_readback");
    expect(guard.weatherCoverageStatus).toBe("partial_weather_coverage");
    expect(guard.missingLatestWeatherDay).toBe(true);
    expect(guard.partialWeatherCoverage).toBe(true);
    expect(guard.failureMessage).toBeNull();
  });

  it("surfaces baseline weather trust state without converting it into a fatal error", () => {
    const availability = summarizeOnePathWeatherAvailability({
      expectedDateKeys: ["2026-04-15"],
      wxMap: new Map(),
      weatherLogicMode: "LAST_YEAR_ACTUAL_WEATHER",
    });

    const guard = resolveOnePathWeatherGuardDecision({
      availability,
      scope: "baseline_passthrough_or_lookup",
    });

    expect(guard.shouldHardStop).toBe(false);
    expect(guard.weatherCoverageStatus).toBe("missing_weather_coverage");
    expect(guard.missingLatestWeatherDay).toBe(true);
    expect(guard.partialWeatherCoverage).toBe(false);
    expect(guard.failureMessage).toBeNull();
  });
});
