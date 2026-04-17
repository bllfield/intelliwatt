import { describe, expect, it } from "vitest";
import { summarizeOnePathWeatherAvailability } from "@/modules/onePathSim/weatherAvailability";

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
});
