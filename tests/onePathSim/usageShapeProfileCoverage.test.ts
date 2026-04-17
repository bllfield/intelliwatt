import { beforeEach, describe, expect, it, vi } from "vitest";

const getLatestUsageShapeProfile = vi.fn();

vi.mock("@/modules/usageShapeProfile/repo", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    getLatestUsageShapeProfile: (...args: any[]) => getLatestUsageShapeProfile(...args),
  };
});

import { ensureUsageShapeProfileForSharedSimulation } from "@/modules/onePathSim/simulatedUsage/simulatePastUsageDataset";

describe("one path usage shape profile coverage", () => {
  beforeEach(() => {
    getLatestUsageShapeProfile.mockReset();
  });

  it("surfaces the exact requested-vs-stored coverage window mismatch for interval Past sim", async () => {
    getLatestUsageShapeProfile.mockResolvedValue({
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

    expect(out.usageShapeProfileSnap).toBeNull();
    expect(out.error).toContain("usage_shape_profile_required:coverage_window_mismatch");
    expect(out.error).toContain("requestedCoverageWindow=2025-04-16..2026-04-15");
    expect(out.error).toContain("storedCoverageWindow=2025-03-14..2026-03-13");
    expect(out.usageShapeProfileDiag).toMatchObject({
      reasonNotUsed: "coverage_window_mismatch",
      canonicalCoverageStartDate: "2025-04-16",
      canonicalCoverageEndDate: "2026-04-15",
      windowStartUtc: "2025-03-14T00:00:00.000Z",
      windowEndUtc: "2026-03-13T23:59:59.999Z",
    });
  });
});
