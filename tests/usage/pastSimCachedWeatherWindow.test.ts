import { beforeEach, describe, expect, it, vi } from "vitest";

const getHouseWeatherDays = vi.fn();

vi.mock("@/modules/weather/repo", () => ({
  getHouseWeatherDays: (...args: unknown[]) => getHouseWeatherDays(...args),
}));

import {
  assessCachedWeatherWindowCoverage,
  getCachedWeatherWindowCoverage,
  isUsableDailyWeatherRow,
  persistPastSimArtifactWeatherFields,
  readDailyWeatherFromDataset,
} from "@/lib/usage/pastSimCachedWeatherWindow";

describe("pastSimCachedWeatherWindow", () => {
  beforeEach(() => {
    getHouseWeatherDays.mockReset();
  });

  it("treats stub weather rows as incomplete", () => {
    expect(
      isUsableDailyWeatherRow({
        tAvgF: 50,
        tMinF: 40,
        tMaxF: 60,
        hdd65: 10,
        cdd65: 0,
        source: "STUB_V1",
      })
    ).toBe(false);
  });

  it("reads artifact daily weather from meta.dailyWeatherByDateKey first", () => {
    const dataset = {
      meta: {
        dailyWeatherByDateKey: {
          "2026-01-01": { tAvgF: 50, tMinF: 40, tMaxF: 60, hdd65: 10, cdd65: 0, source: "CACHE" },
        },
      },
      dailyWeather: {
        "2026-01-02": { tAvgF: 51, tMinF: 41, tMaxF: 61, hdd65: 11, cdd65: 0, source: "CACHE" },
      },
    };
    const record = readDailyWeatherFromDataset(dataset);
    expect(record?.["2026-01-01"]?.tAvgF).toBe(50);
    expect(record?.["2026-01-02"]).toBeUndefined();
  });

  it("marks artifact weather complete when every required date is usable", () => {
    const coverage = assessCachedWeatherWindowCoverage({
      requiredDateKeys: ["2026-01-01", "2026-01-02"],
      dailyWeatherByDateKey: {
        "2026-01-01": { tAvgF: 50, tMinF: 40, tMaxF: 60, hdd65: 10, cdd65: 0, source: "CACHE" },
        "2026-01-02": { tAvgF: 51, tMinF: 41, tMaxF: 61, hdd65: 11, cdd65: 0, source: "CACHE" },
      },
      sourceOwner: "artifact_daily_weather",
      startDateKey: "2026-01-01",
      endDateKey: "2026-01-02",
    });
    expect(coverage.complete).toBe(true);
    expect(coverage.sourceOwner).toBe("artifact_daily_weather");
    expect(coverage.missingDateKeys).toEqual([]);
  });

  it("fetches only missing dates from DB when artifact coverage is partial", async () => {
    getHouseWeatherDays.mockResolvedValue(
      new Map([
        [
          "2026-01-02",
          {
            houseId: "h1",
            dateKey: "2026-01-02",
            kind: "ACTUAL_LAST_YEAR",
            version: 1,
            tAvgF: 51,
            tMinF: 41,
            tMaxF: 61,
            hdd65: 11,
            cdd65: 0,
            source: "OPEN_METEO_CACHE",
          },
        ],
      ])
    );

    const coverage = await getCachedWeatherWindowCoverage({
      houseId: "h1",
      startDateKey: "2026-01-01",
      endDateKey: "2026-01-02",
      requiredDateKeys: ["2026-01-01", "2026-01-02"],
      artifactDailyWeather: {
        "2026-01-01": { tAvgF: 50, tMinF: 40, tMaxF: 60, hdd65: 10, cdd65: 0, source: "CACHE" },
      },
      weatherLogicMode: "LAST_YEAR_ACTUAL_WEATHER",
      skipDbLookup: true,
    });
    expect(coverage.complete).toBe(false);
    expect(coverage.missingDateKeys).toEqual(["2026-01-02"]);

    const merged = await getCachedWeatherWindowCoverage({
      houseId: "h1",
      startDateKey: "2026-01-01",
      endDateKey: "2026-01-02",
      requiredDateKeys: ["2026-01-01", "2026-01-02"],
      artifactDailyWeather: {
        "2026-01-01": { tAvgF: 50, tMinF: 40, tMaxF: 60, hdd65: 10, cdd65: 0, source: "CACHE" },
      },
      weatherLogicMode: "LAST_YEAR_ACTUAL_WEATHER",
    });
    expect(getHouseWeatherDays).toHaveBeenCalledTimes(1);
    expect(merged.complete).toBe(true);
    expect(merged.dailyWeatherByDateKey["2026-01-02"]?.tAvgF).toBe(51);
  });

  it("persists dailyWeather and meta.dailyWeatherByDateKey together", () => {
    const dataset: Record<string, unknown> = { meta: {} };
    persistPastSimArtifactWeatherFields({
      dataset,
      dailyWeatherByDateKey: {
        "2026-01-01": { tAvgF: 50, tMinF: 40, tMaxF: 60, hdd65: 10, cdd65: 0, source: "CACHE" },
      },
      sourceOwner: "cached_weather",
    });
    expect((dataset.dailyWeather as Record<string, unknown>)["2026-01-01"]).toBeTruthy();
    expect((dataset.meta as Record<string, unknown>).dailyWeatherByDateKey).toBeTruthy();
    expect((dataset.meta as Record<string, unknown>).dailyWeatherSourceOwner).toBe("cached_weather");
  });
});
