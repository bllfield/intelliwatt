import { beforeEach, describe, expect, it, vi } from "vitest";

const findFirst = vi.fn();
const resolveIntervalsLayer = vi.fn();
const loadSmtTailCoverage = vi.fn();
const ensureSmtCoverageForHouse = vi.fn();

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
  };
});

vi.mock("@/lib/usage/ensureSmtCoverage", () => ({
  ensureSmtCoverageForHouse: (...args: any[]) => ensureSmtCoverageForHouse(...args),
}));

vi.mock("@/lib/usage/smtBackfillEligibility", () => ({
  isUserFacingSmtBackfillAllowed: vi.fn().mockResolvedValue(true),
}));

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
    ensureSmtCoverageForHouse.mockResolvedValue({
      healed: true,
      window: { startDate: "2025-05-18", endDate: "2026-05-17" },
      dayStatus: {
        ready: true,
        incompleteDateKeys: [],
        pendingDateKeys: [],
        incompleteMeterDateKeys: [],
        canonicalEndDayComplete: true,
        window: { startDate: "2025-05-18", endDate: "2026-05-17" },
      },
      refreshResult: { ok: true, homes: [], backfill: [] },
      tailWaitTimedOut: false,
      incompleteMeterWaitTimedOut: false,
    });
  });

  it("refreshes persisted SMT usage when canonical tail coverage is incomplete", async () => {
    const { resolveUpstreamUsageTruthForSimulation } = await import("@/modules/onePathSim/upstreamUsageTruth");
    const out = await resolveUpstreamUsageTruthForSimulation({
      userId: "user-1",
      houseId: "house-1",
      seedIfMissing: true,
      runId: "run-abc",
    });

    expect(loadSmtTailCoverage).toHaveBeenCalled();
    expect(ensureSmtCoverageForHouse).toHaveBeenCalledWith({
      userId: "user-1",
      houseId: "house-1",
      profile: "sim_run",
      sessionKey: "sim:run-abc",
    });
    expect(resolveIntervalsLayer).toHaveBeenCalledTimes(2);
    expect(out.usageTruthSource).toBe("seeded_via_existing_usage_orchestration");
    expect(out.summary.currentRun.statusSummary).toMatchObject({
      seedingAttempted: true,
      seedingResult: "success",
    });
  });
});
