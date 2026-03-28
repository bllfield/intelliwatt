import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

const createGapfillCompareRunStart = vi.fn();
const finalizeGapfillCompareRunSnapshot = vi.fn();
const markGapfillCompareRunFailed = vi.fn();
const getSimulatedUsageForHouseScenario = vi.fn();
const recalcSimulatorBuild = vi.fn();
const getActualIntervalsForRange = vi.fn();
const getActualUsageDatasetForHouse = vi.fn();
const loadDisplayProfilesForHouse = vi.fn();
const chooseActualSource = vi.fn();
const getSharedPastCoverageWindowForHouse = vi.fn();
const rebuildGapfillSharedPastArtifact = vi.fn();
const getGapfillCompareRunSnapshotById = vi.fn();

const prisma: any = {
  user: { findUnique: vi.fn(), findFirst: vi.fn() },
  houseAddress: { findFirst: vi.fn(), findMany: vi.fn() },
  usageSimulatorScenario: { findFirst: vi.fn() },
};

vi.mock("@/lib/auth/admin", () => ({
  requireAdmin: () => ({ ok: true, status: 200, body: { ok: true } }),
}));

vi.mock("@/lib/db", () => ({ prisma }));

vi.mock("@/lib/usage/actualDatasetForHouse", () => ({
  getActualIntervalsForRange: (...args: any[]) => getActualIntervalsForRange(...args),
  getActualUsageDatasetForHouse: (...args: any[]) => getActualUsageDatasetForHouse(...args),
}));

vi.mock("@/modules/realUsageAdapter/actual", () => ({
  chooseActualSource: (...args: any[]) => chooseActualSource(...args),
}));

vi.mock("@/modules/usageSimulator/profileDisplay", () => ({
  loadDisplayProfilesForHouse: (...args: any[]) => loadDisplayProfilesForHouse(...args),
}));

vi.mock("@/modules/usageSimulator/service", () => ({
  getSimulatedUsageForHouseScenario: (...args: any[]) => getSimulatedUsageForHouseScenario(...args),
  recalcSimulatorBuild: (...args: any[]) => recalcSimulatorBuild(...args),
  getSharedPastCoverageWindowForHouse: (...args: any[]) => getSharedPastCoverageWindowForHouse(...args),
  rebuildGapfillSharedPastArtifact: (...args: any[]) => rebuildGapfillSharedPastArtifact(...args),
}));

vi.mock("@/modules/usageSimulator/compareRunSnapshot", () => ({
  createGapfillCompareRunStart: (...args: any[]) => createGapfillCompareRunStart(...args),
  finalizeGapfillCompareRunSnapshot: (...args: any[]) => finalizeGapfillCompareRunSnapshot(...args),
  markGapfillCompareRunFailed: (...args: any[]) => markGapfillCompareRunFailed(...args),
  markGapfillCompareRunRunning: vi.fn(),
  getGapfillCompareRunSnapshotById: (...args: any[]) => getGapfillCompareRunSnapshotById(...args),
}));

vi.mock("@/app/api/admin/tools/gapfill-lab/gapfillLabRouteHelpers", async () => {
  const actual = await vi.importActual<any>("@/app/api/admin/tools/gapfill-lab/gapfillLabRouteHelpers");
  return {
    ...actual,
    getTravelRangesFromDb: vi.fn().mockResolvedValue([]),
  };
});

function buildRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/admin/tools/gapfill-lab", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: "intelliwatt_admin=brian@intellipath-solutions.com",
    },
    body: JSON.stringify(body),
  });
}

describe("gapfill-lab route canonical artifact-only flow", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    prisma.user.findUnique.mockResolvedValue({ id: "u1", email: "brian@intellipath-solutions.com" });
    prisma.user.findFirst.mockResolvedValue({ id: "u1", email: "brian@intellipath-solutions.com" });
    prisma.houseAddress.findFirst.mockResolvedValue({
      id: "h1",
      userId: "u1",
      archivedAt: null,
      esiid: "E1",
      addressLine1: "1 Main",
      addressCity: "Austin",
      addressState: "TX",
    });
    prisma.houseAddress.findMany.mockResolvedValue([
      { id: "h1", addressLine1: "1 Main", addressCity: "Austin", addressState: "TX", esiid: "E1" },
    ]);
    prisma.usageSimulatorScenario.findFirst.mockResolvedValue({ id: "past-s1" });

    chooseActualSource.mockResolvedValue({ source: "SMT" });
    loadDisplayProfilesForHouse.mockResolvedValue({
      homeProfile: { hvac: {} },
      applianceProfile: { fuelConfiguration: {} },
    });
    getSharedPastCoverageWindowForHouse.mockResolvedValue({
      startDate: "2025-03-01",
      endDate: "2026-02-28",
    });
    getActualUsageDatasetForHouse.mockResolvedValue({
      dataset: {
        summary: { source: "SMT", intervalsCount: 0, start: "2025-03-01", end: "2026-02-28", latest: "2026-02-28T23:45:00Z" },
        daily: [],
        monthly: [],
        insights: {},
      },
    });
    getActualIntervalsForRange.mockResolvedValue([
      { timestamp: "2025-04-10T00:00:00.000Z", kwh: 1 },
      { timestamp: "2025-04-10T00:15:00.000Z", kwh: 1 },
      { timestamp: "2025-05-02T00:00:00.000Z", kwh: 2 },
    ]);

    createGapfillCompareRunStart.mockResolvedValue({
      ok: true,
      compareRunId: "cmp-1",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      status: "started",
    });
    finalizeGapfillCompareRunSnapshot.mockResolvedValue(true);
    markGapfillCompareRunFailed.mockResolvedValue(true);
    getGapfillCompareRunSnapshotById.mockResolvedValue({
      ok: false,
      error: "compare_run_not_found",
      message: "not found",
    });
    recalcSimulatorBuild.mockResolvedValue({
      ok: true,
      houseId: "h1",
      buildInputsHash: "hash-1",
      dataset: {},
    });
    getSimulatedUsageForHouseScenario.mockImplementation(async (args: any) => {
      if (args.projectionMode === "baseline") {
        return {
          ok: true,
          houseId: "h1",
          scenarioKey: "past-s1",
          scenarioId: "past-s1",
          dataset: {
            summary: { source: "SIMULATED", totalKwh: 100, intervalsCount: 2, start: "2025-03-01", end: "2026-02-28", latest: "2026-02-28T23:45:00Z" },
            daily: [{ date: "2025-04-11", kwh: 8 }],
            monthly: [{ month: "2025-04", kwh: 8 }],
            series: { intervals15: [{ timestamp: "2025-04-11T00:00:00.000Z", kwh: 2 }] },
            meta: { validationOnlyDateKeysLocal: ["2025-04-10", "2025-05-02"], validationProjectionApplied: true },
          },
        };
      }
      return {
        ok: true,
        houseId: "h1",
        scenarioKey: "past-s1",
        scenarioId: "past-s1",
        dataset: {
          summary: { source: "SIMULATED", totalKwh: 120, intervalsCount: 3, start: "2025-03-01", end: "2026-02-28", latest: "2026-02-28T23:45:00Z" },
          daily: [
            { date: "2025-04-10", kwh: 9.5 },
            { date: "2025-05-02", kwh: 12.25 },
          ],
          monthly: [{ month: "2025-04", kwh: 9.5 }, { month: "2025-05", kwh: 12.25 }],
          series: {
            intervals15: [
              { timestamp: "2025-04-10T00:00:00.000Z", kwh: 1.2 },
              { timestamp: "2025-04-10T00:15:00.000Z", kwh: 1.1 },
              { timestamp: "2025-05-02T00:00:00.000Z", kwh: 2.3 },
            ],
          },
          meta: {
            canonicalArtifactSimulatedDayTotalsByDate: {
              "2025-04-10": 9.5,
              "2025-05-02": 12.25,
            },
            validationOnlyDateKeysLocal: ["2025-04-10", "2025-05-02"],
          },
        },
      };
    });
  });

  it("uses canonical recalc + canonical read family for compare core", async () => {
    const { POST } = await import("@/app/api/admin/tools/gapfill-lab/route");
    const req = buildRequest({
      email: "brian@intellipath-solutions.com",
      timezone: "America/Chicago",
      houseId: "h1",
      includeUsage365: false,
      includeDiagnostics: false,
      includeFullReportText: false,
      testRanges: [{ startDate: "2025-04-10", endDate: "2025-04-10" }],
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.compareExecutionMode).toBe("inline_canonical");
    expect(body.compareRunId).toBe("cmp-1");
    expect(body.compareRunStatus).toBe("succeeded");
    expect(body.compareRunSnapshotReady).toBe(true);
    expect(body.compareSharedCalcPath).toContain("getSimulatedUsageForHouseScenario");
    expect(body.compareSharedCalcPath).toContain("/api/user/usage/simulated/house");
  });

  it("passes validation-only selected days into canonical recalc inputs", async () => {
    const { POST } = await import("@/app/api/admin/tools/gapfill-lab/route");
    const req = buildRequest({
      email: "brian@intellipath-solutions.com",
      timezone: "America/Chicago",
      houseId: "h1",
      includeUsage365: false,
      includeDiagnostics: false,
      includeFullReportText: false,
      testRanges: [{ startDate: "2025-04-10", endDate: "2025-04-10" }],
    });

    await POST(req);

    expect(recalcSimulatorBuild).toHaveBeenCalledTimes(1);
    const arg = recalcSimulatorBuild.mock.calls[0]?.[0];
    expect(arg.mode).toBe("SMT_BASELINE");
    expect(arg.scenarioId).toBe("past-s1");
    const keys = Array.from(arg.validationOnlyDateKeysLocal as Set<string>).sort();
    expect(keys).toEqual(["2025-04-10"]);
  });

  it("derives scored simulated values from canonical artifact totals", async () => {
    const { POST } = await import("@/app/api/admin/tools/gapfill-lab/route");
    const req = buildRequest({
      email: "brian@intellipath-solutions.com",
      timezone: "America/Chicago",
      houseId: "h1",
      includeUsage365: false,
      includeDiagnostics: false,
      includeFullReportText: false,
      testRanges: [{ startDate: "2025-04-10", endDate: "2025-05-02" }],
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(Array.isArray(body.scoredDayTruthRows)).toBe(true);
    const row = (body.scoredDayTruthRows as Array<any>).find((r) => r.localDate === "2025-04-10");
    expect(row).toBeTruthy();
    expect(row.freshCompareSimDayKwh).toBe(9.5);
    expect(row.selectedDayTotalSource).toBe("canonical_artifact_simulated_day_total");

    expect(finalizeGapfillCompareRunSnapshot).toHaveBeenCalledTimes(1);
    const snap = finalizeGapfillCompareRunSnapshot.mock.calls[0]?.[0]?.snapshot ?? {};
    expect(snap.selectedScoredDateKeys).toContain("2025-04-10");
    expect(snap.compareTruth?.compareSharedCalcPath).toContain("getSimulatedUsageForHouseScenario");
  });

  it("requests raw + baseline projections from same read family", async () => {
    const { POST } = await import("@/app/api/admin/tools/gapfill-lab/route");
    const req = buildRequest({
      email: "brian@intellipath-solutions.com",
      timezone: "America/Chicago",
      houseId: "h1",
      includeUsage365: false,
      includeDiagnostics: false,
      includeFullReportText: false,
      testRanges: [{ startDate: "2025-04-10", endDate: "2025-04-10" }],
    });

    const res = await POST(req);
    const body = await res.json();
    expect(res.status).toBe(200);

    const projectionModes = getSimulatedUsageForHouseScenario.mock.calls.map((c) => c?.[0]?.projectionMode);
    expect(projectionModes).toEqual(["raw", "baseline"]);
    expect(body.baselineDatasetProjection?.meta?.validationProjectionApplied).toBe(true);
  });
});
