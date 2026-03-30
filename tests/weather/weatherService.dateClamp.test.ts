import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchHistoricalWeather = vi.fn();
const getWeatherRange = vi.fn();
const hasFullCoverage = vi.fn();
const insertWeatherBatch = vi.fn();

vi.mock("@/lib/weather/openMeteoClient", () => ({
  fetchHistoricalWeather: (...args: any[]) => fetchHistoricalWeather(...args),
}));

vi.mock("@/lib/weather/weatherCacheRepo", () => ({
  getWeatherRange: (...args: any[]) => getWeatherRange(...args),
  hasFullCoverage: (...args: any[]) => hasFullCoverage(...args),
  insertWeatherBatch: (...args: any[]) => insertWeatherBatch(...args),
}));

import { getHistoricalWeather } from "@/lib/weather/weatherService";

describe("weatherService date clamp", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-30T18:00:00.000Z"));
    fetchHistoricalWeather.mockReset();
    getWeatherRange.mockReset();
    hasFullCoverage.mockReset();
    insertWeatherBatch.mockReset();
    getWeatherRange.mockResolvedValue([]);
    hasFullCoverage.mockResolvedValue(false);
    fetchHistoricalWeather.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("clamps end_date to shared canonical coverage end before Open-Meteo fetch", async () => {
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
});
