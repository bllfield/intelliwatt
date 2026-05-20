import { beforeEach, describe, expect, it, vi } from "vitest";

const findFirst = vi.fn();
const resolveIntervalsLayer = vi.fn();
const loadSmtTailCoverage = vi.fn();
const ensureSmtTailCoverageForUserHouse = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    houseAddress: {
      findFirst: (...args: any[]) => findFirst(...args),
    },
  },
}));

vi.mock("@/lib/usage/resolveIntervalsLayer", () => ({
  resolveIntervalsLayer: (...args: any[]) => resolveIntervalsLayer(...args),
}));

vi.mock("@/lib/usage/smtTailCoverage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/usage/smtTailCoverage")>();
  return {
    ...actual,
    loadSmtTailCoverage: (...args: any[]) => loadSmtTailCoverage(...args),
    ensureSmtTailCoverageForUserHouse: (...args: any[]) => ensureSmtTailCoverageForUserHouse(...args),
  };
});

describe("one path upstream usage truth tail refresh", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findFirst.mockResolvedValue({ id: "house-1", esiid: "esiid-1" });
    resolveIntervalsLayer
      .mockResolvedValueOnce({
        dataset: {
          summary: { source: "SMT", end: "2026-05-17", latest: "2026-05-16T23:45:00.000Z" },
          series: { intervals15: [] },
        },
        alternatives: { smt: null, greenButton: null },
      })
      .mockResolvedValueOnce({
        dataset: {
          summary: { source: "SMT", end: "2026-05-17", latest: "2026-05-17T23:45:00.000Z" },
          series: { intervals15: [] },
        },
        alternatives: { smt: null, greenButton: null },
      });
    loadSmtTailCoverage.mockResolvedValue({
      coverageEndDate: "2026-05-16",
      targetEndDate: "2026-05-17",
      incompleteTailDateKeys: ["2026-05-17"],
      tailReady: false,
    });
    ensureSmtTailCoverageForUserHouse.mockResolvedValue({
      attempted: true,
      reason: "refresh_requested",
      coverage: {
        coverageEndDate: "2026-05-17",
        targetEndDate: "2026-05-17",
        incompleteTailDateKeys: [],
        tailReady: true,
      },
      wait: { timedOut: false, attempts: 2, durationMs: 4000 },
      refreshResult: { ok: true, homes: [], backfill: [] },
    });
  });

  it("refreshes persisted SMT usage when canonical tail coverage is incomplete", async () => {
    const { resolveUpstreamUsageTruthForSimulation } = await import("@/modules/onePathSim/upstreamUsageTruth");
    const out = await resolveUpstreamUsageTruthForSimulation({
      userId: "user-1",
      houseId: "house-1",
      seedIfMissing: true,
    });

    expect(loadSmtTailCoverage).toHaveBeenCalled();
    expect(ensureSmtTailCoverageForUserHouse).toHaveBeenCalledWith({
      userId: "user-1",
      houseId: "house-1",
      esiid: "esiid-1",
      targetEndDate: expect.any(String),
      waitTimeoutMs: 20_000,
    });
    expect(resolveIntervalsLayer).toHaveBeenCalledTimes(2);
    expect(out.usageTruthSource).toBe("seeded_via_existing_usage_orchestration");
    expect(out.summary.currentRun.statusSummary).toMatchObject({
      seedingAttempted: true,
      seedingResult: "success",
    });
  });
});
