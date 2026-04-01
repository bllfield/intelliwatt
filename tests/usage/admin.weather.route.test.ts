import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const requireAdmin = vi.fn();
const resolveAdminHouseSelection = vi.fn();
const getWeatherSourceMode = vi.fn();
const resolveHouseWeatherStationId = vi.fn();
const getStationWeatherDays = vi.fn();
const findMissingStationWeatherDateKeys = vi.fn();
const ensureStationWeatherStubbed = vi.fn();
const findMissingHouseWeatherDateKeys = vi.fn();
const loadWeatherForPastWindow = vi.fn();

vi.mock("@/lib/auth/admin", () => ({
  requireAdmin: (...args: any[]) => requireAdmin(...args),
}));

vi.mock("@/lib/admin/adminHouseLookup", () => ({
  resolveAdminHouseSelection: (...args: any[]) => resolveAdminHouseSelection(...args),
}));

vi.mock("@/modules/adminSettings/repo", () => ({
  getWeatherSourceMode: (...args: any[]) => getWeatherSourceMode(...args),
}));

vi.mock("@/modules/stationWeather/repo", () => ({
  resolveHouseWeatherStationId: (...args: any[]) => resolveHouseWeatherStationId(...args),
  getStationWeatherDays: (...args: any[]) => getStationWeatherDays(...args),
  findMissingStationWeatherDateKeys: (...args: any[]) => findMissingStationWeatherDateKeys(...args),
}));

vi.mock("@/modules/stationWeather/stubs", () => ({
  ensureStationWeatherStubbed: (...args: any[]) => ensureStationWeatherStubbed(...args),
}));

vi.mock("@/modules/weather/repo", () => ({
  findMissingHouseWeatherDateKeys: (...args: any[]) => findMissingHouseWeatherDateKeys(...args),
}));

vi.mock("@/modules/simulatedUsage/simulatePastUsageDataset", () => ({
  loadWeatherForPastWindow: (...args: any[]) => loadWeatherForPastWindow(...args),
}));

import { GET } from "@/app/api/admin/weather/route";

function buildMap(kind: "ACTUAL_LAST_YEAR" | "NORMAL_AVG", rows: Array<{ dateKey: string; source: string; tAvgF: number }>) {
  return new Map(
    rows.map((row) => [
      row.dateKey,
      {
        houseId: "h1",
        dateKey: row.dateKey,
        kind,
        version: 1,
        tAvgF: row.tAvgF,
        tMinF: row.tAvgF - 5,
        tMaxF: row.tAvgF + 5,
        hdd65: Math.max(0, 65 - row.tAvgF),
        cdd65: Math.max(0, row.tAvgF - 65),
        source: row.source,
      },
    ])
  );
}

describe("admin weather route", () => {
  beforeEach(() => {
    requireAdmin.mockReset();
    resolveAdminHouseSelection.mockReset();
    getWeatherSourceMode.mockReset();
    resolveHouseWeatherStationId.mockReset();
    getStationWeatherDays.mockReset();
    findMissingStationWeatherDateKeys.mockReset();
    ensureStationWeatherStubbed.mockReset();
    findMissingHouseWeatherDateKeys.mockReset();
    loadWeatherForPastWindow.mockReset();

    requireAdmin.mockReturnValue({ ok: true });
    resolveAdminHouseSelection.mockResolvedValue({ id: "h1", label: "House 1" });
    getWeatherSourceMode.mockResolvedValue("REAL_API");
    resolveHouseWeatherStationId.mockResolvedValue({ stationId: "station-1", stationCode: "DFW" });
    getStationWeatherDays.mockResolvedValue([]);
    findMissingStationWeatherDateKeys.mockResolvedValue([]);
    findMissingHouseWeatherDateKeys.mockResolvedValue([]);
    ensureStationWeatherStubbed.mockResolvedValue(undefined);
  });

  it("uses the shared normal selection map for house normal rows", async () => {
    const actualMap = buildMap("ACTUAL_LAST_YEAR", [
      { dateKey: "2026-03-01", source: "OPEN_METEO_CACHE", tAvgF: 51 },
    ]);
    const wrongNormalMapOnActualSelection = buildMap("NORMAL_AVG", [
      { dateKey: "2026-03-01", source: "WRONG_ACTUAL_SELECTION_NORMAL_MAP", tAvgF: 61 },
    ]);
    const realNormalSelectionMap = buildMap("NORMAL_AVG", [
      { dateKey: "2026-03-01", source: "OPEN_METEO_NORMAL_1991_2020_ERA5", tAvgF: 71 },
    ]);

    loadWeatherForPastWindow
      .mockResolvedValueOnce({
        actualWxByDateKey: actualMap,
        normalWxByDateKey: wrongNormalMapOnActualSelection,
        selectedWeatherByDateKey: actualMap,
        provenance: {
          weatherLogicMode: "LAST_YEAR_ACTUAL_WEATHER",
          weatherSourceSummary: "actual_only",
          weatherFallbackReason: null,
        },
      })
      .mockResolvedValueOnce({
        actualWxByDateKey: actualMap,
        normalWxByDateKey: realNormalSelectionMap,
        selectedWeatherByDateKey: realNormalSelectionMap,
        provenance: {
          weatherLogicMode: "LONG_TERM_AVERAGE_WEATHER",
          weatherSourceSummary: "actual_only",
          weatherFallbackReason: null,
        },
      });

    const req = {
      url: "https://example.com/api/admin/weather?email=user@example.com&end=2026-03-01",
    } as any;

    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.houseActualLastYear).toHaveLength(1);
    expect(body.houseActualLastYear[0]?.tAvgF).toBe(51);

    expect(body.houseNormalAvg).toHaveLength(1);
    expect(body.houseNormalAvg[0]?.tAvgF).toBe(71);
    expect(body.houseNormalAvg[0]?.source).toBe("OPEN_METEO_NORMAL_1991_2020_ERA5");
    expect(body.houseNormalAvg[0]?.source).not.toBe("WRONG_ACTUAL_SELECTION_NORMAL_MAP");

    expect(body.sharedHouseWeatherPath?.normalSelection?.sourceLabels).toEqual([
      "OPEN_METEO_NORMAL_1991_2020_ERA5",
    ]);
  });
});
