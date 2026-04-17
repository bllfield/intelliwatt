import { beforeEach, describe, expect, it, vi } from "vitest";

const houseFindFirst = vi.fn();
const getActualIntervalsForUsageShapeProfile = vi.fn();
const deriveUsageShapeProfile = vi.fn();
const upsertUsageShapeProfile = vi.fn();
const invalidatePastCachesForHouse = vi.fn();

vi.mock("server-only", () => ({}));

vi.mock("@/lib/db", () => ({
  prisma: {
    houseAddress: {
      findFirst: (...args: any[]) => houseFindFirst(...args),
    },
  },
}));

vi.mock("@/lib/time/chicago", () => ({
  canonicalUsageWindowChicago: () => ({ startDate: "2025-03-11", endDate: "2026-03-10" }),
}));

vi.mock("@/modules/usageShapeProfile/actualIntervals", () => ({
  getActualIntervalsForUsageShapeProfile: (...args: any[]) => getActualIntervalsForUsageShapeProfile(...args),
}));

vi.mock("@/modules/usageShapeProfile/derive", () => ({
  deriveUsageShapeProfile: (...args: any[]) => deriveUsageShapeProfile(...args),
}));

vi.mock("@/modules/usageShapeProfile/repo", () => ({
  upsertUsageShapeProfile: (...args: any[]) => upsertUsageShapeProfile(...args),
}));

vi.mock("@/modules/usageSimulator/pastCache", () => ({
  invalidatePastCachesForHouse: (...args: any[]) => invalidatePastCachesForHouse(...args),
}));

import { ensureUsageShapeProfileForUserHouse } from "@/modules/usageShapeProfile/autoBuild";

describe("ensureUsageShapeProfileForUserHouse invalidates stale past cache", () => {
  beforeEach(() => {
    houseFindFirst.mockReset();
    getActualIntervalsForUsageShapeProfile.mockReset();
    deriveUsageShapeProfile.mockReset();
    upsertUsageShapeProfile.mockReset();
    invalidatePastCachesForHouse.mockReset();
  });

  it("returns rebuild-required diagnostics after successful refresh", async () => {
    houseFindFirst.mockResolvedValue({ id: "h1", esiid: "104" });
    getActualIntervalsForUsageShapeProfile.mockResolvedValue({
      source: "SMT",
      intervals: [{ timestamp: "2026-03-10T06:00:00.000Z", kwh: 1.5 }],
    });
    deriveUsageShapeProfile.mockReturnValue({
      windowStartUtc: "2025-03-11T00:00:00.000Z",
      windowEndUtc: "2026-03-10T23:59:59.999Z",
      shapeByMonth96: { "2026-03": new Array(96).fill(1) },
    });
    upsertUsageShapeProfile.mockResolvedValue({
      id: "p1",
      derivedAt: "2026-03-12T00:00:00.000Z",
      simIdentityHash: "abc123",
    });
    invalidatePastCachesForHouse.mockResolvedValue(4);

    const out = await ensureUsageShapeProfileForUserHouse({
      userId: "u1",
      houseId: "h1",
      timezone: "America/Chicago",
    });

    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.diagnostics?.dependentPastArtifactsInvalidated).toBe(4);
      expect(out.diagnostics?.dependentPastRebuildRequired).toBe(true);
      expect(out.diagnostics?.profileDerivedAt).toBe("2026-03-12T00:00:00.000Z");
      expect(out.diagnostics?.profileSimIdentityHash).toBe("abc123");
    }
    expect(invalidatePastCachesForHouse).toHaveBeenCalledWith({ houseId: "h1" });
  });

  it("rebuilds against an explicit requested coverage window when provided", async () => {
    houseFindFirst.mockResolvedValue({ id: "h1", esiid: "104" });
    getActualIntervalsForUsageShapeProfile.mockResolvedValue({
      source: "SMT",
      intervals: [{ timestamp: "2026-04-15T06:00:00.000Z", kwh: 1.5 }],
    });
    deriveUsageShapeProfile.mockReturnValue({
      windowStartUtc: "2025-04-16T00:00:00.000Z",
      windowEndUtc: "2026-04-15T23:59:59.999Z",
      shapeByMonth96: { "2026-04": new Array(96).fill(1) },
    });
    upsertUsageShapeProfile.mockResolvedValue({
      id: "p2",
      derivedAt: "2026-04-16T00:00:00.000Z",
      simIdentityHash: "def456",
    });
    invalidatePastCachesForHouse.mockResolvedValue(2);

    const out = await ensureUsageShapeProfileForUserHouse({
      userId: "u1",
      houseId: "h1",
      timezone: "America/Chicago",
      coverageWindow: {
        startDate: "2025-04-16",
        endDate: "2026-04-15",
      },
    } as any);

    expect(out.ok).toBe(true);
    expect(getActualIntervalsForUsageShapeProfile).toHaveBeenCalledWith({
      houseId: "h1",
      esiid: "104",
      startDate: "2025-04-16",
      endDate: "2026-04-15",
    });
    expect(deriveUsageShapeProfile).toHaveBeenCalledWith(
      [{ tsUtc: "2026-04-15T06:00:00.000Z", kwh: 1.5 }],
      "America/Chicago",
      "2025-04-16T00:00:00.000Z",
      "2026-04-15T23:59:59.999Z",
    );
    if (out.ok) {
      expect(out.diagnostics?.canonicalWindowStartDate).toBe("2025-04-16");
      expect(out.diagnostics?.canonicalWindowEndDate).toBe("2026-04-15");
    }
  });
});
