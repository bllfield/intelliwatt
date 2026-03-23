import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaHouseFindUnique = vi.fn();
const getHouseWeatherDays = vi.fn();
const ensureHouseWeatherBackfill = vi.fn();
const ensureHouseWeatherStubbed = vi.fn();

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
}));

vi.mock("@/modules/weather/stubs", () => ({
  ensureHouseWeatherStubbed: (...args: any[]) => ensureHouseWeatherStubbed(...args),
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
    ensureHouseWeatherStubbed.mockReset();
    prismaHouseFindUnique.mockResolvedValue({ lat: 32.7, lng: -97.3 });
    ensureHouseWeatherBackfill.mockResolvedValue({ fetched: 0, stubbed: 0 });
    ensureHouseWeatherStubbed.mockResolvedValue(undefined);
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
    });

    expect(ensureHouseWeatherBackfill).not.toHaveBeenCalled();
    expect(ensureHouseWeatherStubbed).not.toHaveBeenCalled();
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
    });

    expect(ensureHouseWeatherBackfill).toHaveBeenCalledWith({
      houseId: "h1",
      startDate: "2026-01-01",
      endDate: "2026-01-02",
    });
    expect(prismaHouseFindUnique).toHaveBeenCalledTimes(1);
    expect(out.actualWxByDateKey.get("2026-01-02")?.source).toBe("OPEN_METEO_CACHE");
    expect(out.provenance.weatherSourceSummary).toBe("actual_only");
    expect(out.provenance.weatherFallbackReason).toBeNull();
  });
});
