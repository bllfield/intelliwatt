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

import { loadWeatherForPastWindow } from "@/modules/simulatedUsage/simulatePastUsageDataset";

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

describe("loadWeatherForPastWindow", () => {
  beforeEach(() => {
    prismaHouseFindUnique.mockReset();
    getHouseWeatherDays.mockReset();
    ensureHouseWeatherBackfill.mockReset();
    ensureHouseWeatherNormalAvgBackfill.mockReset();
    prismaHouseFindUnique.mockResolvedValue({ lat: 32.7, lng: -97.3 });
    ensureHouseWeatherBackfill.mockResolvedValue({ fetched: 0, stubbed: 0 });
    ensureHouseWeatherNormalAvgBackfill.mockResolvedValue({ fetched: 0, missing: 0 });
  });

  it("reuses saved actual weather without backfill when full non-stub coverage already exists", async () => {
    const canonicalDateKeys = ["2026-01-01", "2026-01-02"];
    getHouseWeatherDays.mockImplementation(async ({ kind }: any) =>
      kind === "ACTUAL_LAST_YEAR"
        ? buildWeatherMap("ACTUAL_LAST_YEAR", canonicalDateKeys.map((dateKey) => ({ dateKey, source: "OPEN_METEO_CACHE" })))
        : buildWeatherMap("NORMAL_AVG", canonicalDateKeys.map((dateKey) => ({ dateKey, source: "NORMAL_CLIMO" })))
    );

    const out = await loadWeatherForPastWindow({
      houseId: "h1",
      startDate: "2026-01-01",
      endDate: "2026-01-02",
      canonicalDateKeys,
      weatherLogicMode: "LAST_YEAR_ACTUAL_WEATHER",
    });

    expect(ensureHouseWeatherBackfill).not.toHaveBeenCalled();
    expect(ensureHouseWeatherNormalAvgBackfill).not.toHaveBeenCalled();
    expect(prismaHouseFindUnique).not.toHaveBeenCalled();
    expect(out.actualWxByDateKey.size).toBe(2);
    expect(out.provenance.weatherSourceSummary).toBe("actual_only");
    expect(out.provenance.weatherFallbackReason).toBeNull();
    expect(out.provenance.weatherProviderName).toBe("OPEN_METEO");
  });

  it("backfills when actual coverage is missing or stubbed", async () => {
    const canonicalDateKeys = ["2026-01-01", "2026-01-02"];
    getHouseWeatherDays
      .mockResolvedValueOnce(
        buildWeatherMap("ACTUAL_LAST_YEAR", [
          { dateKey: "2026-01-01", source: "OPEN_METEO_CACHE" },
          { dateKey: "2026-01-02", source: "STUB_V1" },
        ])
      )
      .mockResolvedValueOnce(buildWeatherMap("NORMAL_AVG", canonicalDateKeys.map((dateKey) => ({ dateKey, source: "NORMAL_CLIMO" }))))
      .mockResolvedValueOnce(
        buildWeatherMap("ACTUAL_LAST_YEAR", canonicalDateKeys.map((dateKey) => ({ dateKey, source: "OPEN_METEO_CACHE" })))
      )
      .mockResolvedValueOnce(buildWeatherMap("NORMAL_AVG", canonicalDateKeys.map((dateKey) => ({ dateKey, source: "NORMAL_CLIMO" }))));
    ensureHouseWeatherBackfill.mockResolvedValue({ fetched: 1, stubbed: 0 });

    const out = await loadWeatherForPastWindow({
      houseId: "h1",
      startDate: "2026-01-01",
      endDate: "2026-01-02",
      canonicalDateKeys,
      weatherLogicMode: "LAST_YEAR_ACTUAL_WEATHER",
    });

    expect(ensureHouseWeatherBackfill).toHaveBeenCalledWith({
      houseId: "h1",
      startDate: "2026-01-01",
      endDate: "2026-01-02",
    });
    expect(ensureHouseWeatherNormalAvgBackfill).not.toHaveBeenCalled();
    expect(prismaHouseFindUnique).toHaveBeenCalledTimes(1);
    expect(out.actualWxByDateKey.get("2026-01-02")?.source).toBe("OPEN_METEO_CACHE");
    expect(out.provenance.weatherSourceSummary).toBe("actual_only");
    expect(out.provenance.weatherFallbackReason).toBeNull();
  });

  it("reports Visual Crossing when shared persisted rows were built from fallback provider", async () => {
    const canonicalDateKeys = ["2026-01-01", "2026-01-02"];
    getHouseWeatherDays.mockImplementation(async ({ kind }: any) =>
      kind === "ACTUAL_LAST_YEAR"
        ? buildWeatherMap(
            "ACTUAL_LAST_YEAR",
            canonicalDateKeys.map((dateKey) => ({ dateKey, source: "VISUAL_CROSSING_HISTORICAL" }))
          )
        : buildWeatherMap(
            "NORMAL_AVG",
            canonicalDateKeys.map((dateKey) => ({ dateKey, source: "VISUAL_CROSSING_NORMAL_1991_2020" }))
          )
    );

    const out = await loadWeatherForPastWindow({
      houseId: "h1",
      startDate: "2026-01-01",
      endDate: "2026-01-02",
      canonicalDateKeys,
      weatherLogicMode: "LAST_YEAR_ACTUAL_WEATHER",
    });

    expect(out.provenance.weatherProviderName).toBe("VISUAL_CROSSING");
    expect(out.provenance.weatherFallbackUsed).toBe(true);
    expect(out.provenance.weatherProviderCoverage?.[0]?.source).toBe("VISUAL_CROSSING_HISTORICAL");
  });

  it("fails long-term-average mode when NORMAL_AVG rows are stubbed", async () => {
    const canonicalDateKeys = ["2026-01-01", "2026-01-02"];
    getHouseWeatherDays
      .mockResolvedValueOnce(
        buildWeatherMap("ACTUAL_LAST_YEAR", canonicalDateKeys.map((dateKey) => ({ dateKey, source: "OPEN_METEO_CACHE" })))
      )
      .mockResolvedValueOnce(
        buildWeatherMap("NORMAL_AVG", canonicalDateKeys.map((dateKey) => ({ dateKey, source: "STUB_V1" })))
      )
      .mockResolvedValueOnce(
        buildWeatherMap("ACTUAL_LAST_YEAR", canonicalDateKeys.map((dateKey) => ({ dateKey, source: "OPEN_METEO_CACHE" })))
      )
      .mockResolvedValueOnce(
        buildWeatherMap("NORMAL_AVG", canonicalDateKeys.map((dateKey) => ({ dateKey, source: "STUB_V1" })))
      );

    await expect(
      loadWeatherForPastWindow({
        houseId: "h1",
        startDate: "2026-01-01",
        endDate: "2026-01-02",
        canonicalDateKeys,
        weatherLogicMode: "LONG_TERM_AVERAGE_WEATHER",
      })
    ).rejects.toThrow(/NORMAL_AVG rows are unavailable after real historical backfill/i);

    expect(ensureHouseWeatherBackfill).not.toHaveBeenCalled();
    expect(ensureHouseWeatherNormalAvgBackfill).toHaveBeenCalledWith({
      houseId: "h1",
      dateKeys: canonicalDateKeys,
    });
  });
});
