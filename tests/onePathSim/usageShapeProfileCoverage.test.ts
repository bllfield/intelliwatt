import { beforeEach, describe, expect, it, vi } from "vitest";

const getLatestUsageShapeProfile = vi.fn();
const ensureUsageShapeProfileForUserHouse = vi.fn();

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

import { ensureUsageShapeProfileForSharedSimulation } from "@/modules/onePathSim/simulatedUsage/simulatePastUsageDataset";

describe("one path usage shape profile coverage", () => {
  beforeEach(() => {
    getLatestUsageShapeProfile.mockReset();
    ensureUsageShapeProfileForUserHouse.mockReset();
  });

  it("rebuilds instead of quarantining forever when stored coverage metadata is unknown", async () => {
    const rebuiltRow = {
      id: "shape-2",
      version: "v1",
      derivedAt: "2026-04-16T00:00:00.000Z",
      windowStartUtc: "2025-04-16T00:00:00.000Z",
      windowEndUtc: "2026-04-15T23:59:59.999Z",
      shapeByMonth96: {
        "2026-04": Array.from({ length: 96 }, () => 1 / 96),
      },
      avgKwhPerDayWeekdayByMonth: Array.from({ length: 12 }, () => 24),
      avgKwhPerDayWeekendByMonth: Array.from({ length: 12 }, () => 20),
    };
    getLatestUsageShapeProfile
      .mockResolvedValueOnce({
        id: "shape-legacy",
        version: "v1",
        derivedAt: "2026-04-15T00:00:00.000Z",
        windowStartUtc: null,
        windowEndUtc: null,
        shapeByMonth96: {
          "2026-04": Array.from({ length: 96 }, () => 1 / 96),
        },
        avgKwhPerDayWeekdayByMonth: Array.from({ length: 12 }, () => 24),
        avgKwhPerDayWeekendByMonth: Array.from({ length: 12 }, () => 20),
      })
      .mockResolvedValueOnce(rebuiltRow);
    ensureUsageShapeProfileForUserHouse.mockResolvedValue({
      ok: true,
      profileId: "shape-2",
      diagnostics: { dependentPastRebuildRequired: true },
    });

    const out = await ensureUsageShapeProfileForSharedSimulation({
      userId: "u1",
      houseId: "h1",
      timezone: "America/Chicago",
      canonicalMonths: ["2025-04", "2026-04"],
      simCoverageWindow: {
        startDate: "2025-04-16",
        endDate: "2026-04-15",
      },
    } as any);

    expect(ensureUsageShapeProfileForUserHouse).toHaveBeenCalledWith({
      userId: "u1",
      houseId: "h1",
      timezone: "America/Chicago",
      coverageWindow: {
        startDate: "2025-04-16",
        endDate: "2026-04-15",
      },
    });
    expect(out.usageShapeProfileSnap).toEqual({
      weekdayAvgByMonthKey: { "2026-04": 24 },
      weekendAvgByMonthKey: { "2026-04": 20 },
    });
    expect(out.error).toBeNull();
    expect(out.usageShapeProfileDiag).toMatchObject({
      reasonNotUsed: null,
      ensuredInFlow: true,
      ensureAttempted: true,
      ensuredReason: "coverage_window_mismatch",
      canonicalCoverageStartDate: "2025-04-16",
      canonicalCoverageEndDate: "2026-04-15",
      windowStartUtc: "2025-04-16T00:00:00.000Z",
      windowEndUtc: "2026-04-15T23:59:59.999Z",
    });
  });

  it("rebuilds when stored coverage is known but mismatched for the interval Past sim window", async () => {
    const rebuiltRow = {
      id: "shape-2",
      version: "v1",
      derivedAt: "2026-04-16T00:00:00.000Z",
      windowStartUtc: "2025-04-16T00:00:00.000Z",
      windowEndUtc: "2026-04-15T23:59:59.999Z",
      shapeByMonth96: {
        "2026-04": Array.from({ length: 96 }, () => 1 / 96),
      },
      avgKwhPerDayWeekdayByMonth: Array.from({ length: 12 }, () => 24),
      avgKwhPerDayWeekendByMonth: Array.from({ length: 12 }, () => 20),
    };
    getLatestUsageShapeProfile
      .mockResolvedValueOnce({
        id: "shape-1",
        version: "v1",
        derivedAt: "2026-04-15T00:00:00.000Z",
        windowStartUtc: "2025-03-14T00:00:00.000Z",
        windowEndUtc: "2026-03-13T23:59:59.999Z",
        shapeByMonth96: {
          "2026-04": Array.from({ length: 96 }, () => 1 / 96),
        },
        avgKwhPerDayWeekdayByMonth: Array.from({ length: 12 }, () => 24),
        avgKwhPerDayWeekendByMonth: Array.from({ length: 12 }, () => 20),
      })
      .mockResolvedValueOnce(rebuiltRow);
    ensureUsageShapeProfileForUserHouse.mockResolvedValue({
      ok: true,
      profileId: "shape-2",
      diagnostics: { dependentPastRebuildRequired: true },
    });

    const out = await ensureUsageShapeProfileForSharedSimulation({
      userId: "u1",
      houseId: "h1",
      timezone: "America/Chicago",
      canonicalMonths: ["2025-04", "2026-04"],
      simCoverageWindow: {
        startDate: "2025-04-16",
        endDate: "2026-04-15",
      },
    } as any);

    expect(ensureUsageShapeProfileForUserHouse).toHaveBeenCalledTimes(1);
    expect(out.usageShapeProfileSnap).toEqual({
      weekdayAvgByMonthKey: { "2026-04": 24 },
      weekendAvgByMonthKey: { "2026-04": 20 },
    });
    expect(out.error).toBeNull();
    expect(out.profileAutoBuilt).toBe(true);
    expect(out.usageShapeProfileDiag).toMatchObject({
      reasonNotUsed: null,
      ensuredInFlow: true,
      ensuredReason: "coverage_window_mismatch",
      ensuredProfileId: "shape-2",
    });
  });
});
