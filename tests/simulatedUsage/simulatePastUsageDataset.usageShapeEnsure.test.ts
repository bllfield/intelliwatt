import { beforeEach, describe, expect, it, vi } from "vitest";

const getActualIntervalsForRange = vi.fn();
const getHouseWeatherDays = vi.fn();
const ensureHouseWeatherBackfill = vi.fn();
const ensureHouseWeatherStubbed = vi.fn();
const getHomeProfileSimulatedByUserHouse = vi.fn();
const getApplianceProfileSimulatedByUserHouse = vi.fn();
const getLatestUsageShapeProfile = vi.fn();
const ensureUsageShapeProfileForUserHouse = vi.fn();
const buildPastSimulatedBaselineV1 = vi.fn();

vi.mock("@/lib/usage/actualDatasetForHouse", () => ({
  getActualIntervalsForRange: (...args: any[]) => getActualIntervalsForRange(...args),
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

vi.mock("@/modules/homeProfile/repo", () => ({
  getHomeProfileSimulatedByUserHouse: (...args: any[]) => getHomeProfileSimulatedByUserHouse(...args),
}));

vi.mock("@/modules/applianceProfile/repo", () => ({
  getApplianceProfileSimulatedByUserHouse: (...args: any[]) => getApplianceProfileSimulatedByUserHouse(...args),
}));

vi.mock("@/modules/usageShapeProfile/repo", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    getLatestUsageShapeProfile: (...args: any[]) => getLatestUsageShapeProfile(...args),
  };
});

vi.mock("@/modules/usageShapeProfile/autoBuild", () => ({
  ensureUsageShapeProfileForUserHouse: (...args: any[]) => ensureUsageShapeProfileForUserHouse(...args),
}));

vi.mock("@/modules/simulatedUsage/engine", () => ({
  buildPastSimulatedBaselineV1: (...args: any[]) => buildPastSimulatedBaselineV1(...args),
}));

vi.mock("@/modules/usageSimulator/metadataWindow", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    resolveCanonicalUsage365CoverageWindow: vi.fn(() => ({
      startDate: "2025-03-14",
      endDate: "2026-03-13",
    })),
  };
});

vi.mock("@/lib/admin/gapfillLab", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    dateKeyInTimezone: (iso: string) => String(iso).slice(0, 10),
  };
});

import {
  simulatePastFullWindowShared,
  simulatePastSelectedDaysShared,
} from "@/modules/simulatedUsage/simulatePastUsageDataset";

function weatherMap(dateKeys: string[]) {
  return new Map(
    dateKeys.map((dk) => [
      dk,
      {
        tAvgF: 60,
        tMinF: 50,
        tMaxF: 70,
        hdd65: 0,
        cdd65: 0,
        source: "OPEN_METEO",
      },
    ])
  );
}

function validUsageShapeRow() {
  return {
    id: "shape-1",
    version: "v1",
    derivedAt: "2026-03-14T00:00:00.000Z",
    windowStartUtc: "2025-03-14T00:00:00.000Z",
    windowEndUtc: "2026-03-13T23:59:59.999Z",
    shapeByMonth96: {
      "2026-01": Array.from({ length: 96 }, () => 1 / 96),
    },
    avgKwhPerDayWeekdayByMonth: Array.from({ length: 12 }, () => 24),
    avgKwhPerDayWeekendByMonth: Array.from({ length: 12 }, () => 20),
  };
}

describe("shared sim usage-shape ensure path", () => {
  beforeEach(() => {
    getActualIntervalsForRange.mockReset();
    getHouseWeatherDays.mockReset();
    ensureHouseWeatherBackfill.mockReset();
    ensureHouseWeatherStubbed.mockReset();
    getHomeProfileSimulatedByUserHouse.mockReset();
    getApplianceProfileSimulatedByUserHouse.mockReset();
    getLatestUsageShapeProfile.mockReset();
    ensureUsageShapeProfileForUserHouse.mockReset();
    buildPastSimulatedBaselineV1.mockReset();

    getHomeProfileSimulatedByUserHouse.mockResolvedValue(null);
    getApplianceProfileSimulatedByUserHouse.mockResolvedValue(null);
    ensureHouseWeatherBackfill.mockResolvedValue({ fetched: 0, stubbed: 0 });
    ensureHouseWeatherStubbed.mockResolvedValue(undefined);
    getActualIntervalsForRange.mockResolvedValue([
      { timestamp: "2026-01-01T00:00:00.000Z", kwh: 0.25 },
      { timestamp: "2026-01-01T00:15:00.000Z", kwh: 0.25 },
    ]);
    getHouseWeatherDays.mockImplementation(async ({ dateKeys }: any) => weatherMap(Array.from(dateKeys ?? [])));
    buildPastSimulatedBaselineV1.mockImplementation(() => ({
      intervals: [
        { timestamp: "2026-01-01T00:00:00.000Z", kwh: 0.25 },
        { timestamp: "2026-01-01T00:15:00.000Z", kwh: 0.25 },
      ],
      dayResults: [
        {
          localDate: "2026-01-01",
          intervals: [
            { timestamp: "2026-01-01T00:00:00.000Z", kwh: 0.25 },
            { timestamp: "2026-01-01T00:15:00.000Z", kwh: 0.25 },
          ],
          intervalSumKwh: 0.5,
          finalDayKwh: 0.5,
        },
      ],
    }));
  });

  it("ensures missing usage shape in full-window shared sim before simulation runs", async () => {
    getLatestUsageShapeProfile.mockResolvedValueOnce(null).mockResolvedValueOnce(validUsageShapeRow());
    ensureUsageShapeProfileForUserHouse.mockResolvedValue({
      ok: true,
      profileId: "shape-1",
      diagnostics: { dependentPastRebuildRequired: true },
    });

    const out = await simulatePastFullWindowShared({
      userId: "u1",
      houseId: "h1",
      esiid: "1044",
      startDate: "2026-01-01",
      endDate: "2026-01-01",
      timezone: "America/Chicago",
      travelRanges: [],
      buildInputs: {
        canonicalMonths: ["2026-01"],
        snapshots: {},
      } as any,
      buildPathKind: "lab_validation",
      includeSimulatedDayResults: false,
    });

    expect(out.simulatedIntervals).not.toBeNull();
    if (out.simulatedIntervals !== null) {
      expect(ensureUsageShapeProfileForUserHouse).toHaveBeenCalledWith({
        userId: "u1",
        houseId: "h1",
        timezone: "America/Chicago",
      });
      expect(ensureUsageShapeProfileForUserHouse.mock.invocationCallOrder[0]).toBeLessThan(
        buildPastSimulatedBaselineV1.mock.invocationCallOrder[0]
      );
      expect(buildPastSimulatedBaselineV1.mock.calls[0]?.[0]?.usageShapeProfile).toEqual({
        weekdayAvgByMonthKey: { "2026-01": 24 },
        weekendAvgByMonthKey: { "2026-01": 20 },
      });
      expect(out.profileAutoBuilt).toBe(true);
      expect(out.usageShapeProfileDiag).toMatchObject({
        reasonNotUsed: null,
        ensuredInFlow: true,
        ensuredReason: "profile_not_found",
      });
    }
  });

  it("refreshes stale usage shape in selected-days shared sim before simulation runs", async () => {
    const staleRow = {
      ...validUsageShapeRow(),
      windowStartUtc: "2024-03-14T00:00:00.000Z",
      windowEndUtc: "2025-03-13T23:59:59.999Z",
    };
    getLatestUsageShapeProfile.mockResolvedValueOnce(staleRow).mockResolvedValueOnce(validUsageShapeRow());
    ensureUsageShapeProfileForUserHouse.mockResolvedValue({
      ok: true,
      profileId: "shape-1",
      diagnostics: { dependentPastRebuildRequired: true },
    });

    const out = await simulatePastSelectedDaysShared({
      userId: "u1",
      houseId: "h1",
      esiid: "1044",
      startDate: "2026-01-01",
      endDate: "2026-01-01",
      timezone: "America/Chicago",
      travelRanges: [],
      buildInputs: {
        canonicalMonths: ["2026-01"],
        snapshots: {},
      } as any,
      buildPathKind: "lab_validation",
      selectedDateKeysLocal: new Set(["2026-01-01"]),
    });

    expect(out.simulatedIntervals).not.toBeNull();
    if (out.simulatedIntervals !== null) {
      expect(ensureUsageShapeProfileForUserHouse).toHaveBeenCalledWith({
        userId: "u1",
        houseId: "h1",
        timezone: "America/Chicago",
      });
      expect(ensureUsageShapeProfileForUserHouse.mock.invocationCallOrder[0]).toBeLessThan(
        buildPastSimulatedBaselineV1.mock.invocationCallOrder[0]
      );
      expect(buildPastSimulatedBaselineV1.mock.calls[0]?.[0]?.usageShapeProfile).toEqual({
        weekdayAvgByMonthKey: { "2026-01": 24 },
        weekendAvgByMonthKey: { "2026-01": 20 },
      });
      expect(out.profileAutoBuilt).toBe(true);
      expect(out.usageShapeProfileDiag).toMatchObject({
        reasonNotUsed: null,
        ensuredInFlow: true,
        ensuredReason: "coverage_window_mismatch",
      });
    }
  });
});
