import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const prismaHouseFindUnique = vi.fn();
const getHouseWeatherDays = vi.fn();
const ensureHouseWeatherBackfill = vi.fn();
const ensureHouseWeatherNormalAvgBackfill = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    houseAddress: {
      findUnique: (...args: any[]) => prismaHouseFindUnique(...args),
    },
  },
}));

vi.mock("@/modules/weather/repo", () => ({
  getHouseWeatherDays: (...args: any[]) => getHouseWeatherDays(...args),
}));

vi.mock("@/modules/weather/backfill", () => ({
  ensureHouseWeatherBackfill: (...args: any[]) => ensureHouseWeatherBackfill(...args),
  ensureHouseWeatherNormalAvgBackfill: (...args: any[]) => ensureHouseWeatherNormalAvgBackfill(...args),
}));

import { loadWeatherForPastWindow } from "@/modules/onePathSim/simulatedUsage/simulatePastUsageDataset";

function buildWeatherMap(
  kind: "ACTUAL_LAST_YEAR" | "NORMAL_AVG",
  rows: Array<{ dateKey: string; source: string }>
) {
  return new Map(
    rows.map(({ dateKey, source }) => [
      dateKey,
      {
        houseId: "h1",
        dateKey,
        kind,
        version: 1,
        tAvgF: 50,
        tMinF: 40,
        tMaxF: 60,
        hdd65: 15,
        cdd65: 0,
        source,
      },
    ])
  );
}

describe("one path lockbox loadWeatherForPastWindow", () => {
  beforeEach(() => {
    prismaHouseFindUnique.mockReset();
    getHouseWeatherDays.mockReset();
    ensureHouseWeatherBackfill.mockReset();
    ensureHouseWeatherNormalAvgBackfill.mockReset();
    prismaHouseFindUnique.mockResolvedValue({ lat: 32.7, lng: -97.3 });
    ensureHouseWeatherBackfill.mockResolvedValue({ fetched: 0, stubbed: 1 });
    ensureHouseWeatherNormalAvgBackfill.mockResolvedValue({ fetched: 0, missing: 0 });
  });

  it("fails interval Past ACTUAL_LAST_YEAR weather with exact missing date keys and attempted window surfaced", async () => {
    const canonicalDateKeys = ["2026-04-14", "2026-04-15"];
    getHouseWeatherDays
      .mockResolvedValueOnce(
        buildWeatherMap("ACTUAL_LAST_YEAR", [{ dateKey: "2026-04-14", source: "OPEN_METEO_CACHE" }])
      )
      .mockResolvedValueOnce(
        buildWeatherMap(
          "NORMAL_AVG",
          canonicalDateKeys.map((dateKey) => ({ dateKey, source: "NORMAL_CLIMO" }))
        )
      )
      .mockResolvedValueOnce(
        buildWeatherMap("ACTUAL_LAST_YEAR", [{ dateKey: "2026-04-14", source: "OPEN_METEO_CACHE" }])
      )
      .mockResolvedValueOnce(
        buildWeatherMap(
          "NORMAL_AVG",
          canonicalDateKeys.map((dateKey) => ({ dateKey, source: "NORMAL_CLIMO" }))
        )
      );

    let thrown: Error | null = null;
    try {
      await loadWeatherForPastWindow({
        houseId: "h1",
        startDate: "2026-04-14",
        endDate: "2026-04-15",
        canonicalDateKeys,
        weatherLogicMode: "LAST_YEAR_ACTUAL_WEATHER",
      });
    } catch (error) {
      thrown = error as Error;
    }

    expect(ensureHouseWeatherBackfill).toHaveBeenCalledWith({
      houseId: "h1",
      startDate: "2026-04-14",
      endDate: "2026-04-15",
      allowOutsideCanonicalCoverage: true,
    });
    expect(thrown?.message ?? "").toContain("ACTUAL_LAST_YEAR coverage is still missing after real API backfill");
    expect(thrown?.message ?? "").toContain("requestedWeatherWindow=2026-04-14..2026-04-15");
    expect(thrown?.message ?? "").toContain("missingDateKeys=2026-04-15");
    expect(thrown?.message ?? "").toContain("missingLatestWeatherDay=true");
  });
});
