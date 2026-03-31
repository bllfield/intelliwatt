import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchHistoricalWeather = vi.fn();
const fetchHistoricalDailyTemperatures = vi.fn();
const fetchVisualCrossingHourlyWeather = vi.fn();
const fetchVisualCrossingDailyTemperatures = vi.fn();
const getWeatherRange = vi.fn();
const hasFullCoverage = vi.fn();
const insertWeatherBatch = vi.fn();

vi.mock("@/lib/weather/openMeteoClient", () => ({
  fetchHistoricalWeather: (...args: any[]) => fetchHistoricalWeather(...args),
  fetchHistoricalDailyTemperatures: (...args: any[]) => fetchHistoricalDailyTemperatures(...args),
}));

vi.mock("@/lib/weather/visualCrossingClient", () => ({
  fetchHistoricalHourlyWeather: (...args: any[]) => fetchVisualCrossingHourlyWeather(...args),
  fetchHistoricalDailyTemperatures: (...args: any[]) => fetchVisualCrossingDailyTemperatures(...args),
}));

vi.mock("@/lib/weather/weatherCacheRepo", () => ({
  getWeatherRange: (...args: any[]) => getWeatherRange(...args),
  hasFullCoverage: (...args: any[]) => hasFullCoverage(...args),
  insertWeatherBatch: (...args: any[]) => insertWeatherBatch(...args),
}));

import {
  getHistoricalDailyTemperatures,
  getHistoricalWeather,
  resolveHistoricalDailyTemperatures,
  resolveHistoricalWeather,
} from "@/lib/weather/weatherService";

function buildHourlyRows(startIso: string, endIso: string) {
  const out: Array<{
    timestampUtc: Date;
    temperatureC: number;
    cloudcoverPct: number;
    solarRadiation: number;
  }> = [];
  for (
    let cursor = new Date(startIso);
    cursor.getTime() <= new Date(endIso).getTime();
    cursor = new Date(cursor.getTime() + 60 * 60 * 1000)
  ) {
    out.push({
      timestampUtc: new Date(cursor.getTime()),
      temperatureC: 10,
      cloudcoverPct: 30,
      solarRadiation: 0,
    });
  }
  return out;
}

describe("weatherService date clamp", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-30T18:00:00.000Z"));
    fetchHistoricalWeather.mockReset();
    fetchHistoricalDailyTemperatures.mockReset();
    fetchVisualCrossingHourlyWeather.mockReset();
    fetchVisualCrossingDailyTemperatures.mockReset();
    getWeatherRange.mockReset();
    hasFullCoverage.mockReset();
    insertWeatherBatch.mockReset();
    getWeatherRange.mockResolvedValue([]);
    hasFullCoverage.mockResolvedValue(false);
    fetchHistoricalWeather.mockResolvedValue([]);
    fetchHistoricalDailyTemperatures.mockResolvedValue([]);
    fetchVisualCrossingHourlyWeather.mockResolvedValue([]);
    fetchVisualCrossingDailyTemperatures.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("clamps end_date to shared canonical coverage end before Open-Meteo fetch", async () => {
    fetchHistoricalWeather.mockResolvedValueOnce(
      buildHourlyRows("2026-03-20T00:00:00.000Z", "2026-03-28T23:00:00.000Z")
    );
    await getHistoricalWeather(32.7, -97.3, "2026-03-20", "2026-03-31");

    expect(fetchHistoricalWeather).toHaveBeenCalledWith(32.7, -97.3, "2026-03-20", "2026-03-28");
    const cacheEnd: Date = getWeatherRange.mock.calls[0]?.[3];
    expect(cacheEnd?.toISOString()).toBe("2026-03-28T23:00:00.000Z");
  });

  it("returns empty when clamped end falls before start", async () => {
    const rows = await getHistoricalWeather(32.7, -97.3, "2026-03-31", "2026-03-31");

    expect(rows).toEqual([]);
    expect(fetchHistoricalWeather).not.toHaveBeenCalled();
    expect(getWeatherRange).not.toHaveBeenCalled();
  });

  it("uses Visual Crossing fallback when Open-Meteo hourly fetch fails", async () => {
    fetchHistoricalWeather.mockRejectedValueOnce(new Error("open-meteo-down"));
    fetchVisualCrossingHourlyWeather.mockResolvedValueOnce(
      buildHourlyRows("2026-03-20T00:00:00.000Z", "2026-03-20T23:00:00.000Z")
    );

    const result = await resolveHistoricalWeather(32.7, -97.3, "2026-03-20", "2026-03-20");

    expect(fetchHistoricalWeather).toHaveBeenCalledTimes(1);
    expect(fetchVisualCrossingHourlyWeather).toHaveBeenCalledTimes(1);
    expect(result.provider).toBe("VISUAL_CROSSING");
    expect(result.fallbackUsed).toBe(true);
    expect(result.coverageByProvider[0]?.provider).toBe("VISUAL_CROSSING");
  });

  it("falls back to Visual Crossing daily normals when Open-Meteo daily normals fail", async () => {
    fetchHistoricalDailyTemperatures.mockRejectedValueOnce(new Error("open-meteo-daily-down"));
    fetchVisualCrossingDailyTemperatures.mockResolvedValueOnce([
      {
        dateKey: "1991-01-01",
        temperatureMeanC: 10,
        temperatureMinC: 5,
        temperatureMaxC: 15,
      },
    ]);

    const result = await resolveHistoricalDailyTemperatures(32.7, -97.3, "1991-01-01", "2020-12-31");

    expect(fetchHistoricalDailyTemperatures).toHaveBeenCalledTimes(1);
    expect(fetchVisualCrossingDailyTemperatures).toHaveBeenCalledTimes(1);
    expect(result.provider).toBe("VISUAL_CROSSING");
    expect(result.fallbackUsed).toBe(true);
    expect(result.rows).toEqual([
      {
        dateKey: "1991-01-01",
        temperatureMeanC: 10,
        temperatureMinC: 5,
        temperatureMaxC: 15,
      },
    ]);
  });

  it("errors when both real providers fail for hourly weather", async () => {
    fetchHistoricalWeather.mockRejectedValueOnce(new Error("open-meteo-down"));
    fetchVisualCrossingHourlyWeather.mockRejectedValueOnce(new Error("visual-crossing-down"));

    await expect(
      resolveHistoricalWeather(32.7, -97.3, "2026-03-20", "2026-03-20")
    ).rejects.toThrow(/openMeteo=.*visualCrossing=.*/i);
  });
});
