import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

const createGapfillCompareRunStart = vi.fn();
const finalizeGapfillCompareRunSnapshot = vi.fn();
const markGapfillCompareRunFailed = vi.fn();
const getSimulatedUsageForHouseScenario = vi.fn();
const recalcSimulatorBuild = vi.fn();
const dispatchPastSimRecalc = vi.fn();
const getPastSimRecalcJobForUser = vi.fn();
const runSimulatorDiagnostic = vi.fn();
const getActualIntervalsForRange = vi.fn();
const getActualUsageDatasetForHouse = vi.fn();
const loadDisplayProfilesForHouse = vi.fn();
const chooseActualSource = vi.fn();
const getSharedPastCoverageWindowForHouse = vi.fn();
const rebuildGapfillSharedPastArtifact = vi.fn();
const getUserDefaultValidationSelectionMode = vi.fn();
const setUserDefaultValidationSelectionMode = vi.fn();
const getAdminLabDefaultValidationSelectionMode = vi.fn();
const getGapfillCompareRunSnapshotById = vi.fn();
const getLabTestHomeLink = vi.fn();
const replaceGlobalLabTestHomeFromSource = vi.fn();
const ensureGlobalLabTestHomeHouse = vi.fn();
const selectValidationDayKeys = vi.fn();
const logSimPipelineEvent = vi.fn();
const createSimCorrelationId = vi.fn();

const homeDetailsPrisma: any = {
  homeProfileSimulated: { upsert: vi.fn() },
};
const appliancesPrisma: any = {
  applianceProfileSimulated: { upsert: vi.fn() },
};

const prisma: any = {
  user: { findUnique: vi.fn(), findFirst: vi.fn() },
  houseAddress: { findFirst: vi.fn(), findMany: vi.fn(), findUnique: vi.fn() },
  usageSimulatorScenario: { findFirst: vi.fn(), findMany: vi.fn() },
  usageSimulatorScenarioEvent: { findMany: vi.fn() },
  usageSimulatorBuild: { findUnique: vi.fn() },
  $transaction: vi.fn(),
};

const pastSimulatedDatasetCacheFindFirst = vi.fn();
vi.mock("@/lib/db/usageClient", () => ({
  usagePrisma: {
    pastSimulatedDatasetCache: { findFirst: (...args: any[]) => pastSimulatedDatasetCacheFindFirst(...args) },
  },
}));

vi.mock("@/lib/auth/admin", () => ({
  requireAdmin: () => ({ ok: true, status: 200, body: { ok: true } }),
}));

vi.mock("@/lib/db", () => ({ prisma }));
vi.mock("@/lib/db/homeDetailsClient", () => ({ homeDetailsPrisma }));
vi.mock("@/lib/db/appliancesClient", () => ({ appliancesPrisma }));

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
  getUserDefaultValidationSelectionMode: (...args: any[]) => getUserDefaultValidationSelectionMode(...args),
  setUserDefaultValidationSelectionMode: (...args: any[]) => setUserDefaultValidationSelectionMode(...args),
  getAdminLabDefaultValidationSelectionMode: (...args: any[]) => getAdminLabDefaultValidationSelectionMode(...args),
}));
vi.mock("@/modules/usageSimulator/pastSimRecalcDispatch", () => ({
  dispatchPastSimRecalc: (...args: any[]) => dispatchPastSimRecalc(...args),
}));
vi.mock("@/modules/usageSimulator/simObservability", () => ({
  logSimPipelineEvent: (...args: any[]) => logSimPipelineEvent(...args),
  createSimCorrelationId: (...args: any[]) => createSimCorrelationId(...args),
}));
vi.mock("@/modules/usageSimulator/simDropletJob", () => ({
  getPastSimRecalcJobForUser: (...args: any[]) => getPastSimRecalcJobForUser(...args),
}));
vi.mock("@/lib/admin/simulatorDiagnostic", () => ({
  runSimulatorDiagnostic: (...args: any[]) => runSimulatorDiagnostic(...args),
}));

vi.mock("@/modules/usageSimulator/compareRunSnapshot", () => ({
  createGapfillCompareRunStart: (...args: any[]) => createGapfillCompareRunStart(...args),
  finalizeGapfillCompareRunSnapshot: (...args: any[]) => finalizeGapfillCompareRunSnapshot(...args),
  markGapfillCompareRunFailed: (...args: any[]) => markGapfillCompareRunFailed(...args),
  markGapfillCompareRunRunning: vi.fn(),
  getGapfillCompareRunSnapshotById: (...args: any[]) => getGapfillCompareRunSnapshotById(...args),
}));

vi.mock("@/modules/usageSimulator/labTestHome", () => ({
  GAPFILL_LAB_TEST_HOME_LABEL: "GAPFILL_CANONICAL_LAB_TEST_HOME",
  getLabTestHomeLink: (...args: any[]) => getLabTestHomeLink(...args),
  replaceGlobalLabTestHomeFromSource: (...args: any[]) => replaceGlobalLabTestHomeFromSource(...args),
  ensureGlobalLabTestHomeHouse: (...args: any[]) => ensureGlobalLabTestHomeHouse(...args),
}));

vi.mock("@/modules/homeProfile/validation", () => ({
  validateHomeProfile: (value: any) => ({ ok: true, value }),
}));

vi.mock("@/modules/applianceProfile/validation", () => ({
  normalizeStoredApplianceProfile: (value: any) => value,
  validateApplianceProfile: (value: any) => ({ ok: true, value }),
}));

vi.mock("@/modules/usageSimulator/validationSelection", () => ({
  VALIDATION_DAY_SELECTION_MODES: [
    "manual",
    "random_simple",
    "customer_style_seasonal_mix",
    "stratified_weather_balanced",
  ],
  normalizeValidationSelectionMode: (value: unknown) => {
    const raw = String(value ?? "").trim().toLowerCase();
    return ["manual", "random_simple", "customer_style_seasonal_mix", "stratified_weather_balanced"].includes(raw)
      ? raw
      : null;
  },
  selectValidationDayKeys: (args: any) => selectValidationDayKeys(args),
}));

const buildValidationCompareProjectionSidecarCalls: unknown[] = [];
vi.mock("@/modules/usageSimulator/compareProjection", async () => {
  const actual = await vi.importActual<typeof import("@/modules/usageSimulator/compareProjection")>(
    "@/modules/usageSimulator/compareProjection"
  );
  return {
    ...actual,
    buildValidationCompareProjectionSidecar: (dataset: unknown) => {
      buildValidationCompareProjectionSidecarCalls.push(dataset);
      return actual.buildValidationCompareProjectionSidecar(dataset);
    },
  };
});

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
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    buildValidationCompareProjectionSidecarCalls.length = 0;
    createSimCorrelationId.mockReturnValue("corr-1");
    const helpers = await import("@/app/api/admin/tools/gapfill-lab/gapfillLabRouteHelpers");
    vi.mocked(helpers.getTravelRangesFromDb as any).mockResolvedValue([]);

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
    prisma.houseAddress.findUnique.mockImplementation(async ({ where }: any) => {
      if (where?.id === "test-home-1") {
        return { id: "test-home-1", userId: "u1", esiid: null, addressLine1: "Lab Home", addressCity: "Austin", addressState: "TX" };
      }
      if (where?.id === "h1") {
        return { id: "h1", userId: "u1", esiid: "E1", addressLine1: "1 Main", addressCity: "Austin", addressState: "TX" };
      }
      return null;
    });
    prisma.usageSimulatorScenario.findFirst.mockResolvedValue({ id: "past-s1" });
    prisma.usageSimulatorScenario.findMany.mockResolvedValue([{ id: "past-s1" }]);
    prisma.usageSimulatorScenarioEvent.findMany.mockResolvedValue([
      {
        payloadJson: { startDate: "2025-03-01", endDate: "2025-03-02" },
      },
    ]);
    prisma.usageSimulatorBuild.findUnique.mockResolvedValue({
      id: "build-1",
      lastBuiltAt: new Date("2026-01-02T00:00:00.000Z"),
      buildInputsHash: "hash-from-build-row",
      buildInputs: {
        effectiveValidationSelectionMode: "manual",
        validationSelectionDiagnostics: { modeUsed: "manual" },
      },
    });
    pastSimulatedDatasetCacheFindFirst.mockResolvedValue({
      id: "artifact-1",
      updatedAt: new Date("2026-01-02T00:01:00.000Z"),
      inputHash: "artifact-input-hash",
      engineVersion: "production_past_stitched_v1",
    });
    prisma.$transaction.mockImplementation(async (fn: any) => await fn({
      usageSimulatorScenario: {
        findFirst: vi.fn().mockResolvedValue({ id: "past-s1" }),
        create: vi.fn().mockResolvedValue({ id: "past-s1" }),
      },
      usageSimulatorScenarioEvent: {
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        createMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    }));

    chooseActualSource.mockResolvedValue({ source: "SMT" });
    loadDisplayProfilesForHouse.mockResolvedValue({
      homeProfile: { hvac: {} },
      applianceProfile: { fuelConfiguration: {} },
    });
    getSharedPastCoverageWindowForHouse.mockResolvedValue({
      startDate: "2025-03-01",
      endDate: "2026-02-28",
    });
    getUserDefaultValidationSelectionMode.mockResolvedValue("random_simple");
    setUserDefaultValidationSelectionMode.mockResolvedValue({ ok: true, mode: "random_simple" });
    getAdminLabDefaultValidationSelectionMode.mockReturnValue("stratified_weather_balanced");
    selectValidationDayKeys.mockImplementation((args: any) => {
      const picked = Array.from(new Set(args?.manualDateKeys?.length ? args.manualDateKeys : ["2025-04-10"])).sort();
      return {
        selectedDateKeys: picked,
        diagnostics: {
          modeUsed: args?.mode ?? "manual",
          targetCount: Number(args?.targetCount ?? picked.length) || picked.length,
          selectedCount: picked.length,
          fallbackSubstitutions: 0,
          excludedTravelVacantCount: 0,
          excludedWeakCoverageCount: 0,
          weekdayWeekendSplit: { weekday: picked.length, weekend: 0 },
          seasonalSplit: { winter: 0, summer: 0, shoulder: picked.length },
          bucketCounts: { manual: picked.length },
          shortfallReason: null,
        },
      };
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
    getLabTestHomeLink.mockResolvedValue({
      ownerUserId: "u1",
      testHomeHouseId: "test-home-1",
      sourceUserId: "u1",
      sourceHouseId: "h1",
      status: "ready",
      statusMessage: null,
      lastReplacedAt: null,
    });
    replaceGlobalLabTestHomeFromSource.mockResolvedValue({ ok: true, testHomeHouseId: "test-home-1", sourceHouseId: "h1" });
    ensureGlobalLabTestHomeHouse.mockResolvedValue({ id: "test-home-1", esiid: null, label: "LAB" });
    recalcSimulatorBuild.mockResolvedValue({
      ok: true,
      houseId: "h1",
      buildInputsHash: "hash-1",
      dataset: {},
      canonicalArtifactInputHash: "canonical-hash-1",
    });
    dispatchPastSimRecalc.mockResolvedValue({
      executionMode: "inline",
      correlationId: "source-cid-1",
      result: {
        ok: true,
        houseId: "h1",
        buildInputsHash: "source-hash-1",
        dataset: {},
        canonicalArtifactInputHash: "source-canonical-hash-1",
      },
    });
    getPastSimRecalcJobForUser.mockResolvedValue({
      ok: true,
      status: "succeeded",
      failureMessage: null,
    });
    runSimulatorDiagnostic.mockResolvedValue({
      ok: true,
      identity: {
        windowStartUtc: "2025-03-01",
        windowEndUtc: "2026-02-28",
        timezone: "America/Chicago",
        inputHash: "source-input-hash",
        engineVersion: "production_past_stitched_v2",
        intervalDataFingerprint: "ifp-1",
        weatherIdentity: "wx-1",
        usageShapeProfileIdentity: "shape-1",
        buildInputsHash: "hash-from-build-row",
      },
      weatherProvenance: { weatherSourceSummary: "actual_only" },
      stubAudit: { stubCount: 0 },
      pastPath: { paritySummary: { matches: true } },
      dayLevelParity: { sampleCount: 1 },
      integrity: { classification: "ok" },
      rawActualIntervalsMeta: { intervalCount: 96 },
      rawActualIntervals: [{ timestamp: "2025-03-01T00:00:00.000Z", kwh: 1 }],
      stitchedPastIntervalsMeta: { intervalCount: 96 },
      stitchedPastIntervals: [{ timestamp: "2025-03-01T00:00:00.000Z", kwh: 0.9 }],
      firstActualOnlyDayComparison: { localDate: "2025-03-01" },
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
            daily: [
              { date: "2025-04-10", kwh: 9.5, source: "ACTUAL" },
              { date: "2025-05-02", kwh: 12.25, source: "ACTUAL" },
            ],
            monthly: [{ month: "2025-04", kwh: 9.5 }, { month: "2025-05", kwh: 12.25 }],
            series: {
              intervals15: [
                { timestamp: "2025-04-10T00:00:00.000Z", kwh: 1.2 },
                { timestamp: "2025-05-02T00:00:00.000Z", kwh: 2.3 },
              ],
            },
            meta: {
              validationOnlyDateKeysLocal: ["2025-04-10"],
              validationProjectionApplied: true,
              artifactHashMatch: true,
              artifactUpdatedAt: "2026-01-02T00:00:00.000Z",
              artifactSourceNote: "exact",
              artifactRecomputed: false,
              artifactSourceMode: "exact_hash_match",
              weatherDatasetIdentity: "wx-meta-1",
              validationCompareRows: [
                {
                  localDate: "2025-04-10",
                  dayType: "weekday",
                  actualDayKwh: 2,
                  simulatedDayKwh: 9.5,
                  errorKwh: 7.5,
                  percentError: 375,
                  weather: {
                    tAvgF: 62,
                    tMinF: 55,
                    tMaxF: 70,
                    hdd65: 3,
                    cdd65: 1,
                    source: "actual_cached",
                    weatherMissing: false,
                  },
                },
              ],
              validationCompareMetrics: {
                wape: 375,
                mae: 7.5,
                rmse: 7.5,
                mape: 375,
                maxAbs: 7.5,
                totalActualKwhMasked: 2,
                totalSimKwhMasked: 9.5,
                deltaKwhMasked: 7.5,
                mapeFiltered: 375,
                mapeFilteredCount: 1,
              },
              monthlyTargetConstructionDiagnostics: [
                {
                  month: "2025-04",
                  rawMonthKwhFromSource: 240,
                  travelVacantDayCountInMonth: 2,
                  eligibleNonTravelDayCount: 5,
                  eligibleNonTravelKwhTotal: 70,
                  nonTravelDailyAverage: 14,
                  normalizedMonthTarget: 420,
                  monthlyTargetBuildMethod: "normalized_from_non_travel_days",
                  trustedMonthlyAnchorUsed: true,
                },
              ],
              canonicalArtifactSimulatedDayTotalsByDate: {
                "2025-04-10": 9.5,
                "2025-05-02": 12.25,
              },
              lockboxInput: {
                sourceContext: {
                  sourceHouseId: "h1",
                  intervalFingerprint: "ifp-lockbox-1",
                  weatherIdentity: "wx-lockbox-1",
                },
                profileContext: {
                  profileHouseId: "h1",
                  usageShapeProfileIdentity: "shape-lockbox-1",
                },
                mode: "ACTUAL_INTERVAL_BASELINE",
                travelRanges: { ranges: [] },
                validationKeys: { localDateKeys: ["2025-04-10"] },
              },
              lockboxPerRunTrace: {
                inputHash: "input-1",
                fullChainHash: "chain-1",
                sourceHouseId: "h1",
                profileHouseId: "h1",
                stageTimingsMs: { restore: 0 },
              },
            },
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
            validationCompareRows: [
              {
                localDate: "2025-04-10",
                dayType: "weekday",
                actualDayKwh: 2,
                simulatedDayKwh: 9.5,
                errorKwh: 7.5,
                percentError: 375,
              },
              {
                localDate: "2025-05-02",
                dayType: "weekday",
                actualDayKwh: 2,
                simulatedDayKwh: 12.25,
                errorKwh: 10.25,
                percentError: 512.5,
              },
            ],
            validationCompareMetrics: { wape: 10, mae: 1, rmse: 1, mape: 10, maxAbs: 10.25, totalActualKwhMasked: 4, totalSimKwhMasked: 21.75, deltaKwhMasked: 17.75, mapeFiltered: 10, mapeFilteredCount: 2 },
          },
        },
      };
    });
  });

  it("uses persisted artifact reads only for compare core", async () => {
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
    expect(recalcSimulatorBuild).not.toHaveBeenCalled();
    const readModes = getSimulatedUsageForHouseScenario.mock.calls.map((c) => c?.[0]?.readMode);
    expect(readModes).toEqual(["artifact_only", "artifact_only"]);
    expect(body.compareSharedCalcPath).toContain("getSimulatedUsageForHouseScenario");
    expect(body.compareSharedCalcPath).toContain("/api/user/usage/simulated/house");
    expect(rebuildGapfillSharedPastArtifact).not.toHaveBeenCalled();
  });

  it("uses selected validation days for compare scoring without rebuilding", async () => {
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

    expect(recalcSimulatorBuild).not.toHaveBeenCalled();
    expect(getSimulatedUsageForHouseScenario).toHaveBeenCalledTimes(2);
    const projectionModes = getSimulatedUsageForHouseScenario.mock.calls.map((c) => c?.[0]?.projectionMode);
    expect(projectionModes).toEqual(["raw", "baseline"]);
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
    expect(body.parity?.userPipelineParity?.status).toBe("not_requested");
    expect(body.parity?.userPipelineParity?.comparedDateCount).toBeNull();
    expect(body.parity?.userPipelineParity?.mismatchDateCount).toBeNull();
    expect(body.parity?.userPipelineParity?.maxAbsKwhDiff).toBeNull();
    expect(body.parity?.userPipelineParity?.totalAbsKwhDiff).toBeNull();
    expect(body.parity?.userPipelineParity?.mismatchSample).toBeNull();
    expect(body.baselineDatasetProjection?.meta?.validationProjectionApplied).toBe(true);
  });

  it("keeps optional user-pipeline parity disabled even when baseline projection read falls back to raw", async () => {
    getSimulatedUsageForHouseScenario.mockImplementation(async (args: any) => {
      if (args.projectionMode === "raw") {
        return {
          ok: true,
          houseId: "h1",
          scenarioKey: "past-s1",
          scenarioId: "past-s1",
          dataset: {
            summary: {
              source: "SIMULATED",
              totalKwh: 140,
              intervalsCount: 3,
              start: "2025-03-01",
              end: "2026-02-28",
              latest: "2026-02-28T23:45:00Z",
            },
            daily: [
              { date: "2025-04-10", kwh: 16.5 },
              { date: "2025-05-02", kwh: 11.25 },
            ],
            monthly: [
              { month: "2025-04", kwh: 16.5 },
              { month: "2025-05", kwh: 11.25 },
            ],
            series: {
              intervals15: [
                { timestamp: "2025-04-10T00:00:00.000Z", kwh: 1 },
                { timestamp: "2025-04-10T00:15:00.000Z", kwh: 1 },
                { timestamp: "2025-05-02T00:00:00.000Z", kwh: 2 },
              ],
            },
            meta: {
              canonicalArtifactSimulatedDayTotalsByDate: {
                "2025-04-10": 16.5,
                "2025-05-02": 11.25,
              },
            },
          },
        };
      }
      if (args.projectionMode === "baseline") {
        return {
          ok: false,
          code: "INTERNAL_ERROR",
          message: "baseline projection read failed",
        };
      }
      return {
        ok: true,
        houseId: "h1",
        scenarioKey: "past-s1",
        scenarioId: "past-s1",
        dataset: {
          summary: { source: "SIMULATED", totalKwh: 125, intervalsCount: 3, start: "2025-03-01", end: "2026-02-28", latest: "2026-02-28T23:45:00Z" },
          daily: [
            { date: "2025-04-10", kwh: 12.5 },
            { date: "2025-05-02", kwh: 9.75 },
          ],
          monthly: [{ month: "2025-04", kwh: 12.5 }, { month: "2025-05", kwh: 9.75 }],
          series: { intervals15: [{ timestamp: "2025-04-10T00:00:00.000Z", kwh: 1 }] },
          meta: {
            validationOnlyDateKeysLocal: ["2025-04-10", "2025-05-02"],
          },
        },
      };
    });

    const { POST } = await import("@/app/api/admin/tools/gapfill-lab/route");
    const req = buildRequest({
      email: "brian@intellipath-solutions.com",
      timezone: "America/Chicago",
      houseId: "h1",
      includeUsage365: false,
      includeUserPipelineParity: true,
      includeDiagnostics: false,
      includeFullReportText: false,
      testRanges: [{ startDate: "2025-04-10", endDate: "2025-04-10" }],
    });

    const res = await POST(req);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.parity?.userPipelineParity?.status).toBe("not_requested");
    expect(body.parity?.userPipelineParity?.baselineProjectionUsed).toBe("raw_fallback");
    expect(body.parity?.userPipelineParity?.baselineReadOk).toBe(false);
    expect(body.parity?.userPipelineParity?.baselineReadError).toBe("baseline projection read failed");
    expect(String(body.parity?.userPipelineParity?.source ?? "")).toBe("not_requested");
    expect(String(body.compareTruth?.userPipelineParitySource ?? "")).toBe("not_requested");
  });

  it("enables optional user-pipeline parity only when diagnostics and parity flag are both requested", async () => {
    const { POST } = await import("@/app/api/admin/tools/gapfill-lab/route");
    const req = buildRequest({
      email: "brian@intellipath-solutions.com",
      timezone: "America/Chicago",
      houseId: "h1",
      includeUsage365: false,
      includeUserPipelineParity: true,
      includeDiagnostics: true,
      includeFullReportText: false,
      testRanges: [{ startDate: "2025-04-10", endDate: "2025-04-10" }],
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.parity?.userPipelineParity?.status).toBe("available");
    expect(body.parity?.userPipelineParity?.includeUserPipelineParity).toBe(true);
    expect(body.parity?.userPipelineParity?.baselineProjectionUsed).toBe("baseline");
    expect(body.parity?.userPipelineParity?.comparedDateCount).toBe(2);
    expect(body.parity?.userPipelineParity?.mismatchDateCount).toBe(0);
    expect(body.parity?.userPipelineParity?.maxAbsKwhDiff).toBe(0);
    expect(body.parity?.userPipelineParity?.totalAbsKwhDiff).toBe(0);
    expect(String(body.parity?.userPipelineParity?.source ?? "")).toContain("default_projection");
    expect(String(body.compareTruth?.userPipelineParitySource ?? "")).toContain("default_projection");
    expect(body.compareTruth?.validationDaysTruthSource).toBe("canonical_saved_artifact_family");
    expect(String(body.compareTruth?.compareSharedCalcPath ?? "")).toContain("artifact_only");
    const projectionModes = getSimulatedUsageForHouseScenario.mock.calls.map((c) => c?.[0]?.projectionMode);
    expect(projectionModes).toEqual(["raw", "baseline", undefined]);
  });

  it("keeps canonical compare artifact-only while preserving baseline travel metadata on edge dates", async () => {
    const travelBlockDates = [
      "2025-03-28",
      "2025-03-29",
      "2025-03-30",
      "2025-03-31",
      "2025-04-01",
    ];
    const travelBlockTotals: Record<string, number> = {
      "2025-03-28": 18.12,
      "2025-03-29": 27.78,
      "2025-03-30": 22.64,
      "2025-03-31": 19.05,
      "2025-04-01": 20.11,
    };
    getSimulatedUsageForHouseScenario.mockImplementation(async (args: any) => {
      const commonDataset = {
        summary: {
          source: "SIMULATED",
          totalKwh: 15123.55,
          intervalsCount: 35232,
          start: "2025-03-01",
          end: "2026-02-28",
          latest: "2026-02-28T23:45:00Z",
        },
        daily: travelBlockDates.map((date) => ({
          date,
          kwh: travelBlockTotals[date],
          source: "SIMULATED",
        })),
        monthly: [{ month: "2025-03", kwh: 300.5 }, { month: "2025-04", kwh: 412.1 }],
        series: {
          intervals15: travelBlockDates.flatMap((date) => [
            { timestamp: `${date}T00:00:00.000Z`, kwh: 1.0 },
            { timestamp: `${date}T00:15:00.000Z`, kwh: 1.0 },
          ]),
        },
        meta: {
          validationOnlyDateKeysLocal: ["2025-04-10"],
          validationProjectionApplied: args?.projectionMode === "baseline",
          excludedDateKeysCount: 5,
          excludedDateKeysFingerprint: travelBlockDates.join(","),
          canonicalArtifactSimulatedDayTotalsByDate: travelBlockTotals,
        },
      };
      return {
        ok: true,
        houseId: "h1",
        scenarioKey: "past-s1",
        scenarioId: "past-s1",
        dataset: commonDataset,
      };
    });

    const { POST } = await import("@/app/api/admin/tools/gapfill-lab/route");
    const req = buildRequest({
      email: "brian@intellipath-solutions.com",
      timezone: "America/Chicago",
      houseId: "h1",
      includeUsage365: false,
      includeUserPipelineParity: true,
      includeDiagnostics: false,
      includeFullReportText: false,
      testRanges: [{ startDate: "2025-04-10", endDate: "2025-04-10" }],
    });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.parity?.userPipelineParity?.status).toBe("not_requested");
    expect(body.parity?.userPipelineParity?.mismatchDateCount).toBeNull();
    expect(body.parity?.userPipelineParity?.maxAbsKwhDiff).toBeNull();
    expect(body.parity?.userPipelineParity?.totalAbsKwhDiff).toBeNull();
    expect(body.parity?.userPipelineParity?.comparedDateCount).toBeNull();
    const projectionModes = getSimulatedUsageForHouseScenario.mock.calls.map((c) => c?.[0]?.projectionMode);
    expect(projectionModes).toEqual(["raw", "baseline"]);
    expect(body.baselineDatasetProjection?.summary?.start).toBe("2025-03-01");
    expect(body.baselineDatasetProjection?.summary?.end).toBe("2026-02-28");
    expect(body.baselineDatasetProjection?.summary?.intervalsCount).toBe(35232);
    expect(body.baselineDatasetProjection?.meta?.excludedDateKeysCount).toBe(5);
    expect(body.baselineDatasetProjection?.meta?.excludedDateKeysFingerprint).toBe(travelBlockDates.join(","));
    expect(body.baselineDatasetProjection?.meta?.canonicalArtifactSimulatedDayTotalsByDate).toMatchObject(
      travelBlockTotals
    );
  });

  it("runs standalone source-home past-sim snapshot action separately from gapfill recalc flow", async () => {
    const helpers = await import("@/app/api/admin/tools/gapfill-lab/gapfillLabRouteHelpers");
    (helpers as any).getTravelRangesFromDb.mockResolvedValue([
      { startDate: "2025-02-27", endDate: "2025-03-02" },
      { startDate: "2026-03-01", endDate: "2026-03-01" },
    ]);
    getSharedPastCoverageWindowForHouse.mockResolvedValue({
      startDate: "2025-03-01",
      endDate: "2026-02-28",
    });
    getSimulatedUsageForHouseScenario.mockImplementation(async (args: any) => ({
      ok: true,
      houseId: "h1",
      scenarioKey: "past-s1",
      scenarioId: "past-s1",
      dataset: {
        summary: { source: "SIMULATED", totalKwh: 120, intervalsCount: 3, start: "2025-03-01", end: "2026-02-28", latest: "2026-02-28T23:45:00Z" },
        daily: [{ date: "2025-03-01", kwh: 9.5 }],
        monthly: [{ month: "2025-03", kwh: 9.5 }],
        insights: {
          fifteenMinuteAverages: [{ hhmm: "00:00", avgKw: 1.25 }],
          weekdayVsWeekend: { weekday: 9.5, weekend: 8.25 },
        },
        meta: {
          excludedDateKeysCount: 999,
          excludedDateKeysFingerprint: "bogus_not_canonical",
          artifactInputHash: "artifact-input-hash",
          artifactInputHashUsed: "artifact-input-hash",
          validationCompareRows: [
            {
              localDate: "2025-03-01",
              dayType: "weekday",
              actualDayKwh: 10,
              simulatedDayKwh: 9.5,
              errorKwh: -0.5,
              percentError: 5,
            },
          ],
          validationCompareMetrics: { wape: 5, mae: 0.5, rmse: 0.5 },
          lockboxInput: {
            sourceContext: { sourceHouseId: "h1", intervalFingerprint: "ifp-1" },
            profileContext: { profileHouseId: "h1", usageShapeProfileIdentity: "shape-1" },
            mode: "ACTUAL_INTERVAL_BASELINE",
            travelRanges: { ranges: [] },
            validationKeys: { localDateKeys: ["2025-03-01"] },
          },
          lockboxPerRunTrace: {
            stageTimingsMs: { restore: 12 },
            inputHash: "input-1",
            fullChainHash: "chain-1",
            sourceHouseId: "h1",
            profileHouseId: "h1",
          },
          lockboxPerDayTrace: [{ localDate: "2025-03-01", finalDayKwh: 9.5 }],
          fullChainHash: "chain-1",
        },
      },
    }));
    const { POST } = await import("@/app/api/admin/tools/gapfill-lab/route");
    const req = buildRequest({
      action: "run_source_home_past_sim_snapshot",
      email: "brian@intellipath-solutions.com",
      timezone: "America/Chicago",
      sourceHouseId: "h1",
      includeUsage365: false,
    });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.action).toBe("run_source_home_past_sim_snapshot");
    expect(body.sourceHouseId).toBe("h1");
    expect(body.scenarioId).toBe("past-s1");
    expect(dispatchPastSimRecalc).toHaveBeenCalledTimes(1);
    expect(dispatchPastSimRecalc.mock.calls[0]?.[0]).toMatchObject({
      houseId: "h1",
      scenarioId: "past-s1",
      mode: "SMT_BASELINE",
      weatherPreference: "LAST_YEAR_WEATHER",
      persistPastSimBaseline: true,
      validationDayCount: 21,
      runContext: {
        callerLabel: "user_recalc",
        buildPathKind: "recalc",
        persistRequested: true,
      },
    });
    expect(recalcSimulatorBuild).not.toHaveBeenCalled();
    const readModes = getSimulatedUsageForHouseScenario.mock.calls.map((c) => c?.[0]?.readMode);
    expect(readModes).toEqual(["artifact_only", "artifact_only", "artifact_only"]);
    const projectionModes = getSimulatedUsageForHouseScenario.mock.calls.map((c) => c?.[0]?.projectionMode);
    expect(projectionModes).toEqual([undefined, "baseline", "raw"]);
    expect(getSimulatedUsageForHouseScenario.mock.calls[0]?.[0]).toMatchObject({
      exactArtifactInputHash: "source-canonical-hash-1",
      requireExactArtifactMatch: true,
    });
    expect(getSimulatedUsageForHouseScenario.mock.calls[1]?.[0]).toMatchObject({
      exactArtifactInputHash: "source-canonical-hash-1",
      requireExactArtifactMatch: true,
    });
    expect(getSimulatedUsageForHouseScenario.mock.calls[2]?.[0]).toMatchObject({
      exactArtifactInputHash: "source-canonical-hash-1",
      requireExactArtifactMatch: true,
    });
    expect(body.pastSimSnapshot?.reads?.defaultProjection?.ok).toBe(true);
    expect(body.pastSimSnapshot?.reads?.baselineProjection?.ok).toBe(true);
    expect(body.pastSimSnapshot?.reads?.rawProjection?.ok).toBe(true);
    expect(body.pastSimSnapshot?.canonicalWindow?.startDate).toBe("2025-03-01");
    expect(Array.isArray(body.pastSimSnapshot?.travelRangesFromDb)).toBe(true);
    expect(body.validationPolicyOwner).toBe("userValidationPolicy");
    expect(body.pastSimSnapshot?.validationPolicyOwner).toBe("userValidationPolicy");
    expect(body.pastSimSnapshot?.reads?.defaultProjection?.dataset?.meta?.excludedDateKeysCount).toBe(2);
    expect(body.pastSimSnapshot?.reads?.defaultProjection?.dataset?.meta?.excludedDateKeysFingerprint).toBe(
      "2025-03-01,2025-03-02"
    );
    expect(body.pastSimSnapshot?.reads?.baselineProjection?.dataset?.meta?.excludedDateKeysCount).toBe(2);
    expect(body.pastSimSnapshot?.reads?.baselineProjection?.dataset?.meta?.excludedDateKeysFingerprint).toBe(
      "2025-03-01,2025-03-02"
    );
    expect(body.pastSimSnapshot?.reads?.baselineProjection?.dataset?.insights?.fifteenMinuteAverages?.[0]?.hhmm).toBe("00:00");
    expect(body.pastSimSnapshot?.reads?.baselineProjection?.dataset?.meta?.lockboxInput?.sourceContext?.sourceHouseId).toBe("h1");
    expect(body.pastSimSnapshot?.reads?.baselineProjection?.dataset?.meta?.lockboxPerRunTrace?.inputHash).toBe("input-1");
    expect(body.pastSimSnapshot?.reads?.baselineProjection?.dataset?.meta?.fullChainHash).toBe("chain-1");
    expect(body.pastSimSnapshot?.reads?.baselineProjection?.compareProjection?.metrics?.wape).toBe(5);
    expect(runSimulatorDiagnostic).toHaveBeenCalledTimes(1);
    expect(body.pastSimSnapshot?.build?.buildInputsHash).toBe("hash-from-build-row");
    expect(body.pastSimSnapshot?.profiles?.homeProfileLive).toEqual({ hvac: {} });
    expect(body.pastSimSnapshot?.engineContext?.identity?.intervalDataFingerprint).toBe("ifp-1");
    expect(body.pastSimSnapshot?.engineContext?.rawActualIntervalsMeta?.intervalCount).toBe(96);
    expect(body.pastSimSnapshot?.sharedDiagnostics?.identityContext?.callerType).toBe("gapfill_actual");
    expect(body.pastSimSnapshot?.sharedDiagnostics?.identityContext?.weatherLogicMode).toBe("LAST_YEAR_ACTUAL_WEATHER");
  });

  it("runs source-home Past Sim snapshot through the thin actual-home route", async () => {
    const { POST } = await import("@/app/api/admin/tools/gapfill-lab/source-home-past-sim/route");
    const req = buildRequest({
      action: "run_source_home_past_sim_snapshot",
      email: "brian@intellipath-solutions.com",
      timezone: "America/Chicago",
      sourceHouseId: "h1",
      includeUsage365: false,
    });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.action).toBe("run_source_home_past_sim_snapshot");
    expect(dispatchPastSimRecalc).toHaveBeenCalledTimes(1);
    expect(recalcSimulatorBuild).not.toHaveBeenCalled();
    expect(getSimulatedUsageForHouseScenario.mock.calls.map((c) => c?.[0]?.readMode)).toEqual([
      "artifact_only",
    ]);
    expect(runSimulatorDiagnostic).not.toHaveBeenCalled();
    expect(body.pastSimSnapshot?.reads?.baselineProjection?.ok).toBe(true);
    expect(body.pastSimSnapshot?.sharedDiagnostics?.identityContext?.callerType).toBe("gapfill_actual");
    expect(body.pastSimSnapshot?.engineContext).toBeNull();
    expect(body.pastSimSnapshot?.reads?.defaultProjection).toBeUndefined();
    expect(body.pastSimSnapshot?.reads?.rawProjection).toBeUndefined();
  });

  it("loads actual-house engine diagnostics separately without rerunning recalc", async () => {
    const { POST } = await import("@/app/api/admin/tools/gapfill-lab/source-home-past-sim/route");
    const req = buildRequest({
      action: "run_source_home_past_sim_snapshot",
      email: "brian@intellipath-solutions.com",
      timezone: "America/Chicago",
      sourceHouseId: "h1",
      includeUsage365: false,
      includeDiagnostics: true,
      diagnosticsOnly: true,
    });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(dispatchPastSimRecalc).not.toHaveBeenCalled();
    expect(getSimulatedUsageForHouseScenario).not.toHaveBeenCalled();
    expect(runSimulatorDiagnostic).toHaveBeenCalledTimes(1);
    expect(body.pastSimSnapshot?.recalc?.executionMode).toBe("not_run");
    expect(body.pastSimSnapshot?.engineContext?.identity?.intervalDataFingerprint).toBe("ifp-1");
  });

  it("preserves untouched parity outputs while surfacing persisted actual-house diagnostics fields", async () => {
    const { POST: postActual } = await import("@/app/api/admin/tools/gapfill-lab/source-home-past-sim/route");
    const { POST: postTest } = await import("@/app/api/admin/tools/gapfill-lab/route");

    const actualReq = buildRequest({
      action: "run_source_home_past_sim_snapshot",
      email: "brian@intellipath-solutions.com",
      timezone: "America/Chicago",
      sourceHouseId: "h1",
      includeUsage365: false,
    });
    const testReq = buildRequest({
      action: "run_test_home_canonical_recalc",
      email: "brian@intellipath-solutions.com",
      timezone: "America/Chicago",
      sourceHouseId: "h1",
      includeUsage365: false,
      includeDiagnostics: false,
      includeFullReportText: false,
      testRanges: [{ startDate: "2025-04-10", endDate: "2025-04-10" }],
    });

    const actualRes = await postActual(actualReq);
    const testRes = await postTest(testReq);
    const actualBody = await actualRes.json();
    const testBody = await testRes.json();

    expect(actualRes.status).toBe(200);
    expect(testRes.status).toBe(200);
    expect(actualBody.pastSimSnapshot?.reads?.baselineProjection?.dataset?.summary?.totalKwh).toBe(100);
    expect(testBody.baselineDatasetProjection?.summary?.totalKwh).toBe(100);
    expect(actualBody.pastSimSnapshot?.reads?.baselineProjection?.dataset?.monthly).toEqual(
      testBody.baselineDatasetProjection?.monthly
    );
    expect(actualBody.pastSimSnapshot?.reads?.baselineProjection?.compareProjection?.metrics).toEqual(
      testBody.compareProjection?.metrics
    );
    expect(actualBody.pastSimSnapshot?.reads?.baselineProjection?.compareProjection?.rows?.length).toBe(
      testBody.compareProjection?.rows?.length
    );
    expect(actualBody.pastSimSnapshot?.sharedDiagnostics?.sourceTruthContext?.weatherDatasetIdentity).toBe("wx-lockbox-1");
    expect(actualBody.pastSimSnapshot?.sharedDiagnostics?.sourceTruthContext?.intervalSourceIdentity).toBe("ifp-lockbox-1");
  });

  it("logs a source-home failure event when pre-dispatch Actual Home setup throws", async () => {
    getSharedPastCoverageWindowForHouse.mockRejectedValueOnce(new Error("coverage_window_failed"));
    const { POST } = await import("@/app/api/admin/tools/gapfill-lab/route");
    const req = buildRequest({
      action: "run_source_home_past_sim_snapshot",
      email: "brian@intellipath-solutions.com",
      timezone: "America/Chicago",
      sourceHouseId: "h1",
      includeUsage365: false,
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error).toBe("source_home_past_sim_snapshot_failed");
    expect(logSimPipelineEvent).toHaveBeenCalledWith(
      "admin_lab_run_source_home_past_sim_snapshot_failed",
      expect.objectContaining({
        correlationId: "corr-1",
        action: "run_source_home_past_sim_snapshot",
        phase: "pre_dispatch_failed",
      })
    );
  });

  it("runs canonical test-home recalc with generic actual-context source", async () => {
    const { POST } = await import("@/app/api/admin/tools/gapfill-lab/route");
    const req = buildRequest({
      action: "run_test_home_canonical_recalc",
      email: "brian@intellipath-solutions.com",
      timezone: "America/Chicago",
      sourceHouseId: "h1",
      includeUsage365: false,
      includeDiagnostics: false,
      includeFullReportText: false,
      testRanges: [{ startDate: "2025-04-10", endDate: "2025-04-10" }],
    });

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.action).toBe("run_test_home_canonical_recalc");
    expect(body.testHome?.label).toBe("Test Home");
    expect(recalcSimulatorBuild).toHaveBeenCalledTimes(1);
    expect(selectValidationDayKeys).toHaveBeenCalledTimes(1);
    const arg = recalcSimulatorBuild.mock.calls[0]?.[0];
    expect(arg.houseId).toBe("test-home-1");
    expect(arg.actualContextHouseId).toBe("h1");
    expect(arg.esiid).toBe("E1");
    expect(arg.scenarioId).toBe("past-s1");
    expect(arg.mode).toBe("SMT_BASELINE");
    expect(arg.adminLabTreatmentMode).toBeUndefined();
    expect(arg.preLockboxTravelRanges).toEqual([]);
    expect(Array.from(arg.validationOnlyDateKeysLocal as Set<string>).sort()).toEqual(["2025-04-10"]);
    const projectionModes = getSimulatedUsageForHouseScenario.mock.calls.map((c) => c?.[0]?.projectionMode);
    expect(projectionModes).toEqual(["baseline"]);
    const readModes = getSimulatedUsageForHouseScenario.mock.calls.map((c) => c?.[0]?.readMode);
    expect(readModes).toEqual(["artifact_only"]);
    const exactHashes = getSimulatedUsageForHouseScenario.mock.calls.map((c) => c?.[0]?.exactArtifactInputHash);
    expect(exactHashes).toEqual(["canonical-hash-1"]);
    const exactRequired = getSimulatedUsageForHouseScenario.mock.calls.map((c) => c?.[0]?.requireExactArtifactMatch);
    expect(exactRequired).toEqual([true]);
    expect(body.sourceHouseId).toBe("h1");
    expect(body.scenarioId).toBe("past-s1");
    expect(body.testHomeId).toBe("test-home-1");
    expect(body.treatmentMode).toBe("EXACT_INTERVALS");
    expect(body.usageInputMode).toBe("EXACT_INTERVALS");
    expect(body.validationPolicyOwner).toBe("adminValidationPolicy");
    expect(body.adminValidationMode).toBeTruthy();
    expect(body.effectiveValidationSelectionMode).toBe("manual");
    expect(body.effectiveValidationSelectionModeSource).toBe("usage_simulator_build");
    expect(body.buildId).toBe("build-1");
    expect(body.artifactId).toBe("artifact-1");
    expect(body.fingerprintBuildFreshness?.state).toBe("ready");
    expect(body.fingerprintBuildFreshness?.builtAt).toBe("2026-01-02T00:00:00.000Z");
    expect(Array.isArray(body.compareProjection?.rows)).toBe(true);
    expect(body.canonicalReadResultSummary?.ok).toBe(true);
    expect(body.canonicalReadResultSummary?.readMode).toBe("artifact_only");
    expect(body.canonicalReadResultSummary?.fallbackAllowed).toBe(false);
    expect(body.canonicalReadResultSummary?.exactCanonicalReadSucceeded).toBe(true);
    expect(body.canonicalReadResultSummary?.metadataValidationOnlyDateKeysLocal).toEqual(["2025-04-10"]);
    expect(arg.runContext?.buildPathKind).toBe("recalc");
    expect(body.baselineProjectionSummary?.applied).toBe(true);
    expect(body.baselineProjectionSummary?.expected).toBe(true);
    expect(body.baselineProjectionSummary?.correct).toBe(true);
    expect(body.baselineProjectionSummary?.validationOnlyDateKeysLocal).toEqual(["2025-04-10"]);
    expect(body.sharedResultPayloadSummary?.validationOnlyDateKeysLocal).toEqual(["2025-04-10"]);
    expect(body.pipelineDiagnosticsSummary?.validationOnlyDateKeysLocal).toEqual(["2025-04-10"]);
    expect(body.modelAssumptions?.validationOnlyDateKeysLocal).toEqual(["2025-04-10"]);
    const scoredDates = Array.isArray(body.scoredDayTruthRows)
      ? (body.scoredDayTruthRows as Array<{ localDate?: string }>).map((row) => String(row.localDate ?? "")).sort()
      : [];
    expect(scoredDates).toEqual(["2025-04-10"]);
    const compareDates = Array.isArray(body.compareProjection?.rows)
      ? (body.compareProjection.rows as Array<{ localDate?: string }>).map((row) => String(row.localDate ?? "")).sort()
      : [];
    for (const dk of compareDates) {
      expect(scoredDates).toContain(dk);
    }
    expect(compareDates).not.toContain("2025-05-02");
    expect(body.compareProjectionSummary?.rowCount).toBe(body.compareProjection?.rows?.length ?? 0);
    expect(body.compareProjection?.rows?.[0]?.weather?.tAvgF).toBe(62);
    expect(body.sharedDiagnostics?.identityContext?.callerType).toBe("gapfill_test");
    expect(body.sharedDiagnostics?.identityContext?.weatherLogicMode).toBe("LAST_YEAR_ACTUAL_WEATHER");
    expect(body.sharedDiagnostics?.projectionReadSummary?.validationRowsCount).toBe(1);
    expect(body.sharedDiagnostics?.sourceTruthContext?.monthlyTargetConstructionDiagnostics?.[0]?.month).toBe("2025-04");
    expect(body.diagnosticsVerdict?.selectedValidationDateCount).toBe(1);
    expect(body.diagnosticsVerdict?.compareRowCount).toBe(body.compareProjectionSummary?.rowCount ?? 0);
    expect(typeof body.diagnosticsVerdict?.compareRowsMatchSelectedDates).toBe("boolean");
    expect(body.diagnosticsVerdict?.validationLeakCountInBaseline).toBe(0);
    expect(body.diagnosticsVerdict?.usedFallbackArtifact).toBe(false);
    expect(body.pipelineDiagnosticsSummary?.validationOnlyDateKeyCount).toBe(scoredDates.length);
    expect(body.failureCode).toBeUndefined();
    expect(buildValidationCompareProjectionSidecarCalls.length).toBeGreaterThanOrEqual(1);
    const compareInput = buildValidationCompareProjectionSidecarCalls[buildValidationCompareProjectionSidecarCalls.length - 1] as {
      meta?: { validationOnlyDateKeysLocal?: string[] };
    };
    expect(Array.isArray(compareInput?.meta?.validationOnlyDateKeysLocal)).toBe(true);
  });

  it("uses the same selected gapfill weather mode for Actual Home and Test Home runs", async () => {
    const { POST } = await import("@/app/api/admin/tools/gapfill-lab/route");

    const actualReq = buildRequest({
      action: "run_source_home_past_sim_snapshot",
      email: "brian@intellipath-solutions.com",
      timezone: "America/Chicago",
      sourceHouseId: "h1",
      weatherKind: "LONG_TERM_AVERAGE_WEATHER",
      includeUsage365: false,
    });
    const actualRes = await POST(actualReq);
    const actualBody = await actualRes.json();

    const testReq = buildRequest({
      action: "run_test_home_canonical_recalc",
      email: "brian@intellipath-solutions.com",
      timezone: "America/Chicago",
      sourceHouseId: "h1",
      weatherKind: "LONG_TERM_AVERAGE_WEATHER",
      includeUsage365: false,
      includeDiagnostics: false,
      includeFullReportText: false,
      testRanges: [{ startDate: "2025-04-10", endDate: "2025-04-10" }],
    });
    const testRes = await POST(testReq);
    const testBody = await testRes.json();

    expect(actualRes.status).toBe(200);
    expect(testRes.status).toBe(200);
    expect(dispatchPastSimRecalc.mock.calls[0]?.[0]?.weatherPreference).toBe("LONG_TERM_AVERAGE");
    expect(recalcSimulatorBuild.mock.calls[0]?.[0]?.weatherPreference).toBe("LONG_TERM_AVERAGE");
    expect(actualBody.pastSimSnapshot?.weatherLogicMode).toBe("LONG_TERM_AVERAGE_WEATHER");
    expect(testBody.weatherLogicMode).toBe("LONG_TERM_AVERAGE_WEATHER");
  });

  it("reuses canonical source travel and validation state for exact-interval source-copy runs", async () => {
    const helpers = await import("@/app/api/admin/tools/gapfill-lab/gapfillLabRouteHelpers");
    const getTravelRangesFromDbMock = vi.mocked(helpers.getTravelRangesFromDb as any);
    getTravelRangesFromDbMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ startDate: "2025-08-13", endDate: "2025-08-17" }]);
    prisma.usageSimulatorBuild.findUnique.mockResolvedValue({
      id: "source-build-1",
      lastBuiltAt: new Date("2026-01-02T00:00:00.000Z"),
      buildInputsHash: "source-hash",
      buildInputs: {
        validationOnlyDateKeysLocal: ["2025-04-11", "2025-04-12"],
        effectiveValidationSelectionMode: "random_simple",
      },
    });
    getSimulatedUsageForHouseScenario.mockImplementationOnce(async () => ({
      ok: true,
      houseId: "test-home-1",
      scenarioKey: "past-s1",
      scenarioId: "past-s1",
      dataset: {
        summary: {
          source: "SIMULATED",
          totalKwh: 100,
          intervalsCount: 2,
          start: "2025-03-01",
          end: "2026-02-28",
          latest: "2026-02-28T23:45:00Z",
        },
        daily: [
          { date: "2025-04-11", kwh: 2, source: "ACTUAL" },
          { date: "2025-04-12", kwh: 3, source: "ACTUAL" },
        ],
        monthly: [{ month: "2025-04", kwh: 5 }],
        series: { intervals15: [{ timestamp: "2025-04-11T00:00:00.000Z", kwh: 1 }] },
        meta: {
          validationOnlyDateKeysLocal: ["2025-04-11", "2025-04-12"],
          validationProjectionApplied: true,
          validationCompareRows: [
            {
              localDate: "2025-04-11",
              dayType: "weekday",
              actualDayKwh: 2,
              simulatedDayKwh: 2,
              errorKwh: 0,
              percentError: 0,
            },
            {
              localDate: "2025-04-12",
              dayType: "weekend",
              actualDayKwh: 3,
              simulatedDayKwh: 3,
              errorKwh: 0,
              percentError: 0,
            },
          ],
          validationCompareMetrics: { mae: 0, rmse: 0, wape: 0 },
        },
      },
    }));

    const { POST } = await import("@/app/api/admin/tools/gapfill-lab/route");
    const req = buildRequest({
      action: "run_test_home_canonical_recalc",
      email: "brian@intellipath-solutions.com",
      timezone: "America/Chicago",
      sourceHouseId: "h1",
      includeUsage365: false,
      includeDiagnostics: false,
      includeFullReportText: false,
      testRanges: [],
      testUsageInputMode: "EXACT_INTERVALS",
    });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.validationPolicyOwner).toBe("adminValidationPolicy");
    expect(body.testSelectionMode).toBe("random_simple");
    expect(body.travelRangesFromDb).toEqual([{ startDate: "2025-08-13", endDate: "2025-08-17" }]);
    expect(body.testRangesUsed).toEqual([{ startDate: "2025-04-11", endDate: "2025-04-12" }]);
    expect(Array.from(recalcSimulatorBuild.mock.calls.at(-1)?.[0]?.validationOnlyDateKeysLocal ?? []).sort()).toEqual([
      "2025-04-11",
      "2025-04-12",
    ]);
    expect(recalcSimulatorBuild.mock.calls.at(-1)?.[0]?.preLockboxTravelRanges).toEqual([
      { startDate: "2025-08-13", endDate: "2025-08-17" },
    ]);
  });

  it("keeps gapfill compare on shared recalc->stored-artifact read path", async () => {
    const { POST } = await import("@/app/api/admin/tools/gapfill-lab/route");
    const req = buildRequest({
      action: "run_test_home_canonical_recalc",
      email: "brian@intellipath-solutions.com",
      timezone: "America/Chicago",
      sourceHouseId: "h1",
      includeUsage365: false,
      includeDiagnostics: false,
      includeFullReportText: false,
      testRanges: [{ startDate: "2025-04-10", endDate: "2025-04-10" }],
    });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(recalcSimulatorBuild).toHaveBeenCalledTimes(1);
    const recalcArg = recalcSimulatorBuild.mock.calls[0]?.[0];
    expect(recalcArg.houseId).toBe("test-home-1");
    expect(recalcArg.actualContextHouseId).toBe("h1");
    const projectionModes = getSimulatedUsageForHouseScenario.mock.calls.map((c) => c?.[0]?.projectionMode);
    const readModes = getSimulatedUsageForHouseScenario.mock.calls.map((c) => c?.[0]?.readMode);
    expect(projectionModes).toEqual(["baseline"]);
    expect(readModes).toEqual(["artifact_only"]);
  });

  it("returns compare rows from same stored sidecar shape used by user-facing past", async () => {
    const expectedRows = [
      {
        localDate: "2025-04-10",
        dayType: "weekday",
        actualDayKwh: 2,
        simulatedDayKwh: 9.5,
        errorKwh: 7.5,
        percentError: 375,
      },
    ];
    getSimulatedUsageForHouseScenario.mockImplementation(async (args: any) => {
      const dataset = {
        summary: { source: "SIMULATED", totalKwh: 120, intervalsCount: 3, start: "2025-03-01", end: "2026-02-28", latest: "2026-02-28T23:45:00Z" },
        daily: [
          { date: "2025-04-10", kwh: 2.0, source: "ACTUAL", sourceDetail: "ACTUAL_VALIDATION_TEST_DAY" },
          { date: "2025-04-11", kwh: 8.0, source: "SIMULATED", sourceDetail: "SIMULATED_TRAVEL_VACANT" },
        ],
        monthly: [{ month: "2025-04", kwh: 10 }],
        series: { intervals15: [{ timestamp: "2025-04-10T00:00:00.000Z", kwh: 1 }] },
        meta: {
          validationOnlyDateKeysLocal: ["2025-04-10"],
          validationProjectionApplied: args?.projectionMode === "baseline",
          canonicalArtifactSimulatedDayTotalsByDate: { "2025-04-10": 9.5 },
          validationCompareRows: expectedRows,
          validationCompareMetrics: { wape: 375, mae: 7.5, rmse: 7.5, mape: 375, maxAbs: 7.5, totalActualKwhMasked: 2, totalSimKwhMasked: 9.5, deltaKwhMasked: 7.5, mapeFiltered: 375, mapeFilteredCount: 1 },
        },
      };
      return {
        ok: true,
        houseId: "h1",
        scenarioKey: "past-s1",
        scenarioId: "past-s1",
        dataset,
      };
    });

    const { POST } = await import("@/app/api/admin/tools/gapfill-lab/route");
    const gapfillReq = buildRequest({
      action: "run_test_home_canonical_recalc",
      email: "brian@intellipath-solutions.com",
      timezone: "America/Chicago",
      sourceHouseId: "h1",
      includeUsage365: false,
      includeDiagnostics: false,
      includeFullReportText: false,
      testRanges: [{ startDate: "2025-04-10", endDate: "2025-04-10" }],
    });
    const gapfillRes = await POST(gapfillReq);
    const gapfillBody = await gapfillRes.json();

    expect(gapfillRes.status).toBe(200);
    expect(gapfillBody.compareProjection?.rows).toEqual(expectedRows);
    const validationDay = (gapfillBody.baselineDatasetProjection?.daily ?? []).find((d: any) => d.date === "2025-04-10");
    const travelDay = (gapfillBody.baselineDatasetProjection?.daily ?? []).find((d: any) => d.date === "2025-04-11");
    expect(validationDay?.source).toBe("ACTUAL");
    expect(validationDay?.sourceDetail).toBe("ACTUAL_VALIDATION_TEST_DAY");
    expect(travelDay?.source).toBe("SIMULATED");
    expect(travelDay?.sourceDetail).toBe("SIMULATED_TRAVEL_VACANT");
  });

  it("keeps source-faithful calibration baseline travel/vacant totals stable for edge dates", async () => {
    const edgeDates = ["2025-03-28", "2025-03-29", "2025-03-30", "2025-03-31"];
    const edgeTotals: Record<string, number> = {
      "2025-03-28": 18.12,
      "2025-03-29": 27.78,
      "2025-03-30": 22.64,
      "2025-03-31": 19.05,
    };
    getSimulatedUsageForHouseScenario.mockImplementation(async (args: any) => {
      if (args?.projectionMode !== "baseline") {
        return { ok: false, code: "INTERNAL_ERROR", message: "unexpected projection in test" };
      }
      return {
        ok: true,
        houseId: "test-home-1",
        scenarioKey: "past-s1",
        scenarioId: "past-s1",
        dataset: {
          summary: {
            source: "SIMULATED",
            totalKwh: 15123.55,
            intervalsCount: 35232,
            start: "2025-03-01",
            end: "2026-02-28",
            latest: "2026-02-28T23:45:00Z",
          },
          daily: edgeDates.map((date) => ({
            date,
            kwh: edgeTotals[date],
            source: "SIMULATED",
          })),
          monthly: [{ month: "2025-03", kwh: 300.5 }],
          series: { intervals15: [{ timestamp: "2025-03-29T00:00:00.000Z", kwh: 1 }] },
          meta: {
            validationOnlyDateKeysLocal: ["2025-04-10"],
            validationProjectionApplied: true,
            excludedDateKeysCount: 4,
            excludedDateKeysFingerprint: edgeDates.join(","),
            validationCompareRows: [
              {
                localDate: "2025-04-10",
                dayType: "weekday",
                actualDayKwh: 2,
                simulatedDayKwh: 9.5,
                errorKwh: 7.5,
                percentError: 375,
              },
            ],
            validationCompareMetrics: {
              mae: 7.5,
              rmse: 7.5,
              mape: 375,
              wape: 375,
              maxAbs: 7.5,
              totalActualKwhMasked: 2,
              totalSimKwhMasked: 9.5,
              deltaKwhMasked: 7.5,
              mapeFiltered: 375,
              mapeFilteredCount: 1,
            },
            canonicalArtifactSimulatedDayTotalsByDate: { ...edgeTotals, "2025-04-10": 9.5 },
          },
        },
      };
    });

    const { POST } = await import("@/app/api/admin/tools/gapfill-lab/route");
    const req = buildRequest({
      action: "run_test_home_canonical_recalc",
      email: "brian@intellipath-solutions.com",
      timezone: "America/Chicago",
      sourceHouseId: "h1",
      includeUsage365: false,
      includeDiagnostics: false,
      includeFullReportText: false,
      testRanges: [{ startDate: "2025-04-10", endDate: "2025-04-10" }],
    });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    const arg = recalcSimulatorBuild.mock.calls[0]?.[0];
    expect(arg.actualContextHouseId).toBe("h1");
    expect(arg.houseId).toBe("test-home-1");
    const baselineRows = Array.isArray(body.baselineDatasetProjection?.daily)
      ? (body.baselineDatasetProjection.daily as Array<{ date: string; kwh: number }>)
      : [];
    const byDate = Object.fromEntries(baselineRows.map((row) => [String(row.date).slice(0, 10), Number(row.kwh)]));
    expect(byDate["2025-03-28"]).toBe(18.12);
    expect(byDate["2025-03-29"]).toBe(27.78);
    expect(byDate["2025-03-30"]).toBe(22.64);
    expect(byDate["2025-03-31"]).toBe(19.05);
  });

  it("does not change excluded ownership metadata when only validation selection changes", async () => {
    const excludedFingerprint = "2025-03-28,2025-03-29,2025-03-30,2025-03-31";
    getSimulatedUsageForHouseScenario.mockImplementation(async (args: any) => {
      if (args?.projectionMode !== "baseline") {
        return { ok: false, code: "INTERNAL_ERROR", message: "unexpected projection in guard test" };
      }
      return {
        ok: true,
        houseId: "test-home-1",
        scenarioKey: "past-s1",
        scenarioId: "past-s1",
        dataset: {
          summary: {
            source: "SIMULATED",
            totalKwh: 15123.55,
            intervalsCount: 35232,
            start: "2025-03-01",
            end: "2026-02-28",
            latest: "2026-02-28T23:45:00Z",
          },
          daily: [{ date: "2025-03-29", kwh: 27.78, source: "SIMULATED" }],
          monthly: [{ month: "2025-03", kwh: 27.78 }],
          series: { intervals15: [{ timestamp: "2025-03-29T00:00:00.000Z", kwh: 1 }] },
          meta: {
            validationOnlyDateKeysLocal: ["2025-04-10", "2025-05-02"],
            validationProjectionApplied: true,
            excludedDateKeysCount: 4,
            excludedDateKeysFingerprint: excludedFingerprint,
            validationCompareRows: [
              {
                localDate: "2025-04-10",
                dayType: "weekday",
                actualDayKwh: 2,
                simulatedDayKwh: 9.5,
                errorKwh: 7.5,
                percentError: 375,
              },
              {
                localDate: "2025-05-02",
                dayType: "weekday",
                actualDayKwh: 2,
                simulatedDayKwh: 12.25,
                errorKwh: 10.25,
                percentError: 512.5,
              },
            ],
            validationCompareMetrics: {
              mae: 8.88,
              rmse: 9.99,
              mape: 777,
              wape: 777,
              maxAbs: 10.25,
              totalActualKwhMasked: 4,
              totalSimKwhMasked: 21.75,
              deltaKwhMasked: 17.75,
              mapeFiltered: 777,
              mapeFilteredCount: 2,
            },
            canonicalArtifactSimulatedDayTotalsByDate: {
              "2025-03-29": 27.78,
              "2025-04-10": 9.5,
              "2025-05-02": 12.25,
            },
          },
        },
      };
    });

    const { POST } = await import("@/app/api/admin/tools/gapfill-lab/route");
    const reqA = buildRequest({
      action: "run_test_home_canonical_recalc",
      email: "brian@intellipath-solutions.com",
      timezone: "America/Chicago",
      sourceHouseId: "h1",
      includeUsage365: false,
      includeDiagnostics: false,
      includeFullReportText: false,
      testRanges: [{ startDate: "2025-04-10", endDate: "2025-04-10" }],
    });
    const reqB = buildRequest({
      action: "run_test_home_canonical_recalc",
      email: "brian@intellipath-solutions.com",
      timezone: "America/Chicago",
      sourceHouseId: "h1",
      includeUsage365: false,
      includeDiagnostics: false,
      includeFullReportText: false,
      testRanges: [{ startDate: "2025-05-02", endDate: "2025-05-02" }],
    });

    const resA = await POST(reqA);
    const bodyA = await resA.json();
    const resB = await POST(reqB);
    const bodyB = await resB.json();
    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);
    expect(bodyA.baselineDatasetProjection?.meta?.excludedDateKeysCount).toBe(4);
    expect(bodyB.baselineDatasetProjection?.meta?.excludedDateKeysCount).toBe(4);
    expect(bodyA.baselineDatasetProjection?.meta?.excludedDateKeysFingerprint).toBe(excludedFingerprint);
    expect(bodyB.baselineDatasetProjection?.meta?.excludedDateKeysFingerprint).toBe(excludedFingerprint);
    expect(recalcSimulatorBuild).toHaveBeenCalledTimes(2);
    const keysA = Array.from(recalcSimulatorBuild.mock.calls[0]?.[0]?.validationOnlyDateKeysLocal as Set<string>).sort();
    const keysB = Array.from(recalcSimulatorBuild.mock.calls[1]?.[0]?.validationOnlyDateKeysLocal as Set<string>).sort();
    expect(keysA).toEqual(["2025-04-10"]);
    expect(keysB).toEqual(["2025-05-02"]);
  });

  it("rejects invalid adminLabTreatmentMode on canonical recalc", async () => {
    const { POST } = await import("@/app/api/admin/tools/gapfill-lab/route");
    const req = buildRequest({
      action: "run_test_home_canonical_recalc",
      email: "brian@intellipath-solutions.com",
      timezone: "America/Chicago",
      sourceHouseId: "h1",
      adminLabTreatmentMode: "not_a_real_treatment",
      includeUsage365: false,
      includeDiagnostics: false,
      includeFullReportText: false,
      testRanges: [{ startDate: "2025-04-10", endDate: "2025-04-10" }],
    });
    const res = await POST(req);
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error).toBe("invalid_admin_lab_treatment_mode");
    expect(Array.isArray(body.supportedModes)).toBe(true);
  });

  it("accepts new testUsageInputMode values even when the client mirrors them in adminLabTreatmentMode", async () => {
    const { POST } = await import("@/app/api/admin/tools/gapfill-lab/route");
    const req = buildRequest({
      action: "run_test_home_canonical_recalc",
      email: "brian@intellipath-solutions.com",
      timezone: "America/Chicago",
      sourceHouseId: "h1",
      adminLabTreatmentMode: "EXACT_INTERVALS",
      testUsageInputMode: "EXACT_INTERVALS",
      includeUsage365: false,
      includeDiagnostics: false,
      includeFullReportText: false,
      testRanges: [{ startDate: "2025-04-10", endDate: "2025-04-10" }],
    });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.treatmentMode).toBe("EXACT_INTERVALS");
    expect(body.usageInputMode).toBe("EXACT_INTERVALS");
    expect(recalcSimulatorBuild.mock.calls.at(-1)?.[0]?.mode).toBe("SMT_BASELINE");
  });

  it("maps legacy whole_home_prior_only requests onto profile-only pre-lockbox usage mode", async () => {
    const { POST } = await import("@/app/api/admin/tools/gapfill-lab/route");
    const req = buildRequest({
      action: "run_test_home_canonical_recalc",
      email: "brian@intellipath-solutions.com",
      timezone: "America/Chicago",
      sourceHouseId: "h1",
      adminLabTreatmentMode: "whole_home_prior_only",
      includeUsage365: false,
      includeDiagnostics: false,
      includeFullReportText: false,
      testRanges: [{ startDate: "2025-04-10", endDate: "2025-04-10" }],
    });
    const res = await POST(req);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.treatmentMode).toBe("PROFILE_ONLY_NEW_BUILD");
    expect(body.usageInputMode).toBe("PROFILE_ONLY_NEW_BUILD");
    expect(recalcSimulatorBuild.mock.calls.at(-1)?.[0]?.mode).toBe("NEW_BUILD_ESTIMATE");
    expect(recalcSimulatorBuild.mock.calls.at(-1)?.[0]?.adminLabTreatmentMode).toBeUndefined();
  });

  it("returns persisted compareProjection rows and metrics without route-local reshaping", async () => {
    getSimulatedUsageForHouseScenario.mockImplementationOnce(async () => ({
      ok: true,
      houseId: "h1",
      scenarioKey: "past-s1",
      scenarioId: "past-s1",
      dataset: {
        summary: {
          source: "SIMULATED",
          totalKwh: 100,
          intervalsCount: 2,
          start: "2025-03-01",
          end: "2026-02-28",
          latest: "2026-02-28T23:45:00Z",
        },
        daily: [
          { date: "2025-04-10", kwh: 2, source: "ACTUAL" },
          { date: "2025-05-02", kwh: 2, source: "ACTUAL" },
        ],
        monthly: [{ month: "2025-04", kwh: 2 }, { month: "2025-05", kwh: 2 }],
        series: {
          intervals15: [
            { timestamp: "2025-04-10T00:00:00.000Z", kwh: 1 },
            { timestamp: "2025-05-02T00:00:00.000Z", kwh: 1 },
          ],
        },
        meta: {
          validationOnlyDateKeysLocal: ["2025-04-10", "2025-05-02"],
          validationProjectionApplied: true,
          canonicalArtifactSimulatedDayTotalsByDate: {
            "2025-04-10": 9.5,
            "2025-05-02": 12.25,
          },
          validationCompareRows: [
            {
              localDate: "2025-04-10",
              dayType: "weekday",
              actualDayKwh: 2,
              simulatedDayKwh: 9.5,
              errorKwh: 7.5,
              percentError: 375,
            },
            {
              localDate: "2025-05-02",
              dayType: "weekday",
              actualDayKwh: 2,
              simulatedDayKwh: 12.25,
              errorKwh: 10.25,
              percentError: 512.5,
            },
          ],
          validationCompareMetrics: {
            mae: 8.88,
            rmse: 9.99,
            mape: 777,
            wape: 777,
            maxAbs: 10.25,
            totalActualKwhMasked: 4,
            totalSimKwhMasked: 21.75,
            deltaKwhMasked: 17.75,
            mapeFiltered: 777,
            mapeFilteredCount: 2,
          },
        },
      },
    }));

    const { POST } = await import("@/app/api/admin/tools/gapfill-lab/route");
    const req = buildRequest({
      action: "run_test_home_canonical_recalc",
      email: "brian@intellipath-solutions.com",
      timezone: "America/Chicago",
      sourceHouseId: "h1",
      includeUsage365: false,
      includeDiagnostics: false,
      includeFullReportText: false,
      testRanges: [{ startDate: "2025-04-10", endDate: "2025-04-10" }],
    });

    const res = await POST(req);
    const body = await res.json();
    expect(res.status).toBe(200);
    const compareRows = Array.isArray(body.compareProjection?.rows)
      ? (body.compareProjection.rows as Array<{ localDate?: string; actualDayKwh?: number; simulatedDayKwh?: number }>)
      : [];
    expect(compareRows.map((r) => String(r.localDate ?? ""))).toEqual(["2025-04-10", "2025-05-02"]);
    expect(body.compareProjectionSummary?.rowCount).toBe(2);
    expect(body.metrics?.mae).toBe(8.88);
    expect(body.metrics?.rmse).toBe(9.99);
    expect(body.metrics?.wape).toBe(777);
    expect(body.metrics?.totalActualKwhMasked).toBe(4);
    expect(body.metrics?.totalSimKwhMasked).toBe(21.75);
    expect(body.metrics?.deltaKwhMasked).toBe(17.75);
    expect(body.metrics?.mapeFilteredCount).toBe(2);
    expect(body.diagnosticsVerdict?.compareRowsMatchSelectedDates).toBe(false);
  });

  it("run_test_home_canonical_recalc fails closed (409) when canonical simulated-day totals are missing for validation days", async () => {
    getSimulatedUsageForHouseScenario.mockImplementationOnce(async () => ({
      ok: true,
      houseId: "h1",
      scenarioKey: "past-s1",
      scenarioId: "past-s1",
      dataset: {
        summary: { source: "SIMULATED", totalKwh: 100, intervalsCount: 2, start: "2025-03-01", end: "2026-02-28" },
        daily: [{ date: "2025-04-10", kwh: 8, source: "ACTUAL" }],
        monthly: [{ month: "2025-04", kwh: 8 }],
        series: { intervals15: [{ timestamp: "2025-04-10T00:00:00.000Z", kwh: 2 }] },
        meta: {
          validationOnlyDateKeysLocal: ["2025-04-10"],
          validationProjectionApplied: true,
          artifactHashMatch: true,
          artifactSourceMode: "exact_hash_match",
        },
      },
    }));

    const { POST } = await import("@/app/api/admin/tools/gapfill-lab/route");
    const req = buildRequest({
      action: "run_test_home_canonical_recalc",
      email: "brian@intellipath-solutions.com",
      timezone: "America/Chicago",
      sourceHouseId: "h1",
      includeUsage365: false,
      includeDiagnostics: false,
      includeFullReportText: false,
      testRanges: [{ startDate: "2025-04-10", endDate: "2025-04-10" }],
    });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.ok).toBe(false);
    expect(body.error).toBe("compare_truth_incomplete");
    expect(body.reasonCode).toBe("COMPARE_TRUTH_INCOMPLETE");
    expect(Array.isArray(body.missingDateKeysLocal)).toBe(true);
    expect((body.missingDateKeysLocal as string[]).length).toBeGreaterThan(0);
  });

  it("run_test_home_canonical_recalc succeeds when compare metadata is complete for validation days", async () => {
    getSimulatedUsageForHouseScenario.mockImplementationOnce(async () => ({
      ok: true,
      houseId: "h1",
      scenarioKey: "past-s1",
      scenarioId: "past-s1",
      dataset: {
        summary: { source: "SIMULATED", totalKwh: 100, intervalsCount: 2, start: "2025-03-01", end: "2026-02-28" },
        daily: [{ date: "2025-04-10", kwh: 8, source: "ACTUAL" }],
        monthly: [{ month: "2025-04", kwh: 8 }],
        series: { intervals15: [{ timestamp: "2025-04-10T00:00:00.000Z", kwh: 2 }] },
        meta: {
          validationOnlyDateKeysLocal: ["2025-04-10"],
          validationProjectionApplied: true,
          artifactHashMatch: true,
          artifactSourceMode: "exact_hash_match",
          canonicalArtifactSimulatedDayTotalsByDate: { "2025-04-10": 9.5 },
          validationCompareRows: [
            {
              localDate: "2025-04-10",
              dayType: "weekday",
              actualDayKwh: 8,
              simulatedDayKwh: 9.5,
              errorKwh: 1.5,
              percentError: 18.75,
            },
          ],
          validationCompareMetrics: {
            mae: 1.5,
            rmse: 1.5,
            mape: 18.75,
            wape: 18.75,
            maxAbs: 1.5,
            totalActualKwhMasked: 8,
            totalSimKwhMasked: 9.5,
            deltaKwhMasked: 1.5,
            mapeFiltered: 18.75,
            mapeFilteredCount: 1,
          },
        },
      },
    }));

    const { POST } = await import("@/app/api/admin/tools/gapfill-lab/route");
    const req = buildRequest({
      action: "run_test_home_canonical_recalc",
      email: "brian@intellipath-solutions.com",
      timezone: "America/Chicago",
      sourceHouseId: "h1",
      includeUsage365: false,
      includeDiagnostics: false,
      includeFullReportText: false,
      testRanges: [{ startDate: "2025-04-10", endDate: "2025-04-10" }],
    });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.action).toBe("run_test_home_canonical_recalc");
    expect(Array.isArray(body.compareProjection?.rows)).toBe(true);
    expect(body.compareProjection?.rows?.length).toBe(1);
    expect(body.failureCode).toBeUndefined();
  });

  it("custom testRanges compare uses selected validation dates only (not full artifact metadata list)", async () => {
    getSimulatedUsageForHouseScenario.mockImplementationOnce(async () => ({
      ok: true,
      houseId: "h1",
      scenarioKey: "past-s1",
      scenarioId: "past-s1",
      dataset: {
        summary: { source: "SIMULATED", totalKwh: 100, intervalsCount: 2, start: "2025-03-01", end: "2026-02-28" },
        daily: [
          { date: "2025-04-10", kwh: 2, source: "ACTUAL" },
          { date: "2025-05-02", kwh: 2, source: "ACTUAL" },
        ],
        monthly: [{ month: "2025-04", kwh: 4 }],
        series: { intervals15: [{ timestamp: "2025-04-10T00:00:00.000Z", kwh: 1 }] },
        meta: {
          validationOnlyDateKeysLocal: ["2025-04-10"],
          validationProjectionApplied: true,
          artifactHashMatch: true,
          artifactSourceMode: "exact_hash_match",
          canonicalArtifactSimulatedDayTotalsByDate: {
            "2025-04-10": 9.5,
          },
          validationCompareRows: [
            {
              localDate: "2025-04-10",
              dayType: "weekday",
              actualDayKwh: 2,
              simulatedDayKwh: 9.5,
              errorKwh: 7.5,
              percentError: 375,
            },
          ],
          validationCompareMetrics: {
            mae: 7.5,
            rmse: 7.5,
            mape: 375,
            wape: 375,
            maxAbs: 7.5,
            totalActualKwhMasked: 2,
            totalSimKwhMasked: 9.5,
            deltaKwhMasked: 7.5,
            mapeFiltered: 375,
            mapeFilteredCount: 1,
          },
        },
      },
    }));

    const { POST } = await import("@/app/api/admin/tools/gapfill-lab/route");
    const req = buildRequest({
      action: "run_test_home_canonical_recalc",
      email: "brian@intellipath-solutions.com",
      timezone: "America/Chicago",
      sourceHouseId: "h1",
      includeUsage365: false,
      includeDiagnostics: false,
      includeFullReportText: false,
      testRanges: [{ startDate: "2025-04-10", endDate: "2025-04-10" }],
    });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    const rows = Array.isArray(body.compareProjection?.rows) ? body.compareProjection.rows : [];
    expect(rows.map((r: { localDate?: string }) => String(r.localDate ?? ""))).toEqual(["2025-04-10"]);
    expect(body.metrics?.mae).toBe(7.5);
    expect(body.metrics?.mapeFilteredCount).toBe(1);
    expect(body.diagnosticsVerdict?.compareRowsMatchSelectedDates).toBe(true);
  });

  it("custom testRanges fail closed (409) when canonical simulated-day total is missing for a selected date", async () => {
    getSimulatedUsageForHouseScenario.mockImplementationOnce(async () => ({
      ok: true,
      houseId: "h1",
      scenarioKey: "past-s1",
      scenarioId: "past-s1",
      dataset: {
        summary: { source: "SIMULATED", totalKwh: 100, intervalsCount: 2, start: "2025-03-01", end: "2026-02-28" },
        daily: [
          { date: "2025-04-10", kwh: 2, source: "ACTUAL" },
          { date: "2025-05-02", kwh: 2, source: "ACTUAL" },
        ],
        monthly: [{ month: "2025-04", kwh: 4 }],
        series: { intervals15: [{ timestamp: "2025-04-10T00:00:00.000Z", kwh: 1 }] },
        meta: {
          validationOnlyDateKeysLocal: ["2025-04-10"],
          validationProjectionApplied: true,
          artifactHashMatch: true,
          artifactSourceMode: "exact_hash_match",
          canonicalArtifactSimulatedDayTotalsByDate: {
            "2025-05-02": 12.25,
          },
        },
      },
    }));

    const { POST } = await import("@/app/api/admin/tools/gapfill-lab/route");
    const req = buildRequest({
      action: "run_test_home_canonical_recalc",
      email: "brian@intellipath-solutions.com",
      timezone: "America/Chicago",
      sourceHouseId: "h1",
      includeUsage365: false,
      includeDiagnostics: false,
      includeFullReportText: false,
      testRanges: [{ startDate: "2025-04-10", endDate: "2025-04-10" }],
    });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.ok).toBe(false);
    expect(body.error).toBe("compare_truth_incomplete");
    expect(body.reasonCode).toBe("COMPARE_TRUTH_INCOMPLETE");
    expect((body.missingDateKeysLocal as string[]).sort()).toEqual(["2025-04-10"]);
  });

  it("custom testRanges do not require canonical totals for non-selected metadata validation days", async () => {
    getSimulatedUsageForHouseScenario.mockImplementationOnce(async () => ({
      ok: true,
      houseId: "h1",
      scenarioKey: "past-s1",
      scenarioId: "past-s1",
      dataset: {
        summary: { source: "SIMULATED", totalKwh: 100, intervalsCount: 2, start: "2025-03-01", end: "2026-02-28" },
        daily: [
          { date: "2025-04-10", kwh: 2, source: "ACTUAL" },
          { date: "2025-05-02", kwh: 2, source: "ACTUAL" },
        ],
        monthly: [{ month: "2025-04", kwh: 4 }],
        series: { intervals15: [{ timestamp: "2025-04-10T00:00:00.000Z", kwh: 1 }] },
        meta: {
          validationOnlyDateKeysLocal: ["2025-04-10"],
          validationProjectionApplied: true,
          artifactHashMatch: true,
          artifactSourceMode: "exact_hash_match",
          canonicalArtifactSimulatedDayTotalsByDate: {
            "2025-04-10": 9.5,
          },
          validationCompareRows: [
            {
              localDate: "2025-04-10",
              dayType: "weekday",
              actualDayKwh: 2,
              simulatedDayKwh: 9.5,
              errorKwh: 7.5,
              percentError: 375,
            },
          ],
          validationCompareMetrics: {
            mae: 7.5,
            rmse: 7.5,
            mape: 375,
            wape: 375,
            maxAbs: 7.5,
            totalActualKwhMasked: 2,
            totalSimKwhMasked: 9.5,
            deltaKwhMasked: 7.5,
            mapeFiltered: 375,
            mapeFilteredCount: 1,
          },
        },
      },
    }));

    const { POST } = await import("@/app/api/admin/tools/gapfill-lab/route");
    const req = buildRequest({
      action: "run_test_home_canonical_recalc",
      email: "brian@intellipath-solutions.com",
      timezone: "America/Chicago",
      sourceHouseId: "h1",
      includeUsage365: false,
      includeDiagnostics: false,
      includeFullReportText: false,
      testRanges: [{ startDate: "2025-04-10", endDate: "2025-04-10" }],
    });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect((body.compareProjection?.rows as Array<{ localDate?: string }> | undefined)?.map((r) => r.localDate)).toEqual([
      "2025-04-10",
    ]);
  });

  it("surfaces baseline validation leak diagnostics when hash match fails (no latest-by-scenario substitution)", async () => {
    getSimulatedUsageForHouseScenario.mockImplementationOnce(async () => ({
      ok: true,
      houseId: "h1",
      scenarioKey: "past-s1",
      scenarioId: "past-s1",
      dataset: {
        summary: { source: "SIMULATED", totalKwh: 100, intervalsCount: 2, start: "2025-03-01", end: "2026-02-28" },
        daily: [{ date: "2025-04-10", kwh: 8, source: "SIMULATED" }],
        monthly: [{ month: "2025-04", kwh: 8 }],
        series: { intervals15: [{ timestamp: "2025-04-10T00:00:00.000Z", kwh: 2 }] },
        meta: {
          validationOnlyDateKeysLocal: ["2025-04-10"],
          validationProjectionApplied: false,
          artifactHashMatch: false,
          artifactSourceMode: "exact_hash_match",
          requestedInputHash: "req-hash",
          artifactInputHashUsed: "artifact-hash",
          validationCompareRows: [
            {
              localDate: "2025-04-10",
              dayType: "weekday",
              actualDayKwh: 8,
              simulatedDayKwh: 10.5,
              errorKwh: 2.5,
              percentError: 31.25,
            },
          ],
          validationCompareMetrics: {
            mae: 2.5,
            rmse: 2.5,
            mape: 31.25,
            wape: 31.25,
            maxAbs: 2.5,
            totalActualKwhMasked: 8,
            totalSimKwhMasked: 10.5,
            deltaKwhMasked: 2.5,
            mapeFiltered: 31.25,
            mapeFilteredCount: 1,
          },
          canonicalArtifactSimulatedDayTotalsByDate: {
            "2025-04-10": 10.5,
          },
        },
      },
    }));

    const { POST } = await import("@/app/api/admin/tools/gapfill-lab/route");
    const req = buildRequest({
      action: "run_test_home_canonical_recalc",
      email: "brian@intellipath-solutions.com",
      timezone: "America/Chicago",
      sourceHouseId: "h1",
      includeUsage365: false,
      includeDiagnostics: false,
      includeFullReportText: false,
      testRanges: [{ startDate: "2025-04-10", endDate: "2025-04-10" }],
    });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.canonicalReadResultSummary?.usedFallbackArtifact).toBe(false);
    expect(body.canonicalReadResultSummary?.exactCanonicalReadSucceeded).toBe(false);
    expect(body.canonicalReadResultSummary?.requestedInputHash).toBe("req-hash");
    expect(body.canonicalReadResultSummary?.artifactInputHashUsed).toBe("artifact-hash");
    expect(body.baselineProjectionSummary?.applied).toBe(false);
    expect(body.baselineProjectionSummary?.validationLeakCountInBaseline).toBe(1);
    expect(body.diagnosticsVerdict?.usedFallbackArtifact).toBe(false);
    expect(body.diagnosticsVerdict?.artifactHashMatch).toBe(false);
    expect(body.diagnosticsVerdict?.baselineProjectionCorrect).toBe(false);
    expect(body.diagnosticsVerdict?.validationLeakDatesInBaseline).toEqual(["2025-04-10"]);
    expect(body.diagnosticsVerdict?.validationDatesRenderedAsSimulatedCount).toBe(1);
  });

  it("echoes effectiveSimulatorMode from recalc (e.g. MANUAL_TOTALS for manual constraint treatments)", async () => {
    recalcSimulatorBuild.mockResolvedValueOnce({
      ok: true,
      houseId: "h1",
      buildInputsHash: "hash-manual",
      dataset: {},
      effectiveSimulatorMode: "MANUAL_TOTALS",
    });
    const { POST } = await import("@/app/api/admin/tools/gapfill-lab/route");
    const req = buildRequest({
      action: "run_test_home_canonical_recalc",
      email: "brian@intellipath-solutions.com",
      timezone: "America/Chicago",
      sourceHouseId: "h1",
      adminLabTreatmentMode: "manual_monthly_constrained",
      includeUsage365: false,
      includeDiagnostics: false,
      includeFullReportText: false,
      testRanges: [{ startDate: "2025-04-10", endDate: "2025-04-10" }],
    });
    const res = await POST(req);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.simulatorMode).toBe("MANUAL_TOTALS");
    expect(body.treatmentMode).toBe("MONTHLY_FROM_SOURCE_INTERVALS");
    expect(body.usageInputMode).toBe("MONTHLY_FROM_SOURCE_INTERVALS");
    expect(recalcSimulatorBuild.mock.calls.at(-1)?.[0]?.adminLabTreatmentMode).toBe("manual_monthly_constrained");
    expect(recalcSimulatorBuild.mock.calls.at(-1)?.[0]?.mode).toBe("MANUAL_TOTALS");
  });

  it("maps annual source-interval mode onto the shared MANUAL_TOTALS recalc entry", async () => {
    recalcSimulatorBuild.mockResolvedValueOnce({
      ok: true,
      houseId: "h1",
      buildInputsHash: "hash-annual",
      dataset: {},
      effectiveSimulatorMode: "MANUAL_TOTALS",
    });
    const { POST } = await import("@/app/api/admin/tools/gapfill-lab/route");
    const req = buildRequest({
      action: "run_test_home_canonical_recalc",
      email: "brian@intellipath-solutions.com",
      timezone: "America/Chicago",
      sourceHouseId: "h1",
      testUsageInputMode: "ANNUAL_FROM_SOURCE_INTERVALS",
      includeUsage365: false,
      includeDiagnostics: false,
      includeFullReportText: false,
      testRanges: [{ startDate: "2025-04-10", endDate: "2025-04-10" }],
    });
    const res = await POST(req);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.simulatorMode).toBe("MANUAL_TOTALS");
    expect(body.treatmentMode).toBe("ANNUAL_FROM_SOURCE_INTERVALS");
    expect(body.usageInputMode).toBe("ANNUAL_FROM_SOURCE_INTERVALS");
    expect(recalcSimulatorBuild.mock.calls.at(-1)?.[0]?.adminLabTreatmentMode).toBe("manual_annual_constrained");
    expect(recalcSimulatorBuild.mock.calls.at(-1)?.[0]?.mode).toBe("MANUAL_TOTALS");
  });

  it("returns explicit canonical recalc timeout without route hang", async () => {
    const timeoutErr = new Error("canonical_recalc_timeout");
    (timeoutErr as any).code = "canonical_recalc_timeout";
    recalcSimulatorBuild.mockImplementationOnce(async () => {
      throw timeoutErr;
    });

    const { POST } = await import("@/app/api/admin/tools/gapfill-lab/route");
    const req = buildRequest({
      action: "run_test_home_canonical_recalc",
      email: "brian@intellipath-solutions.com",
      timezone: "America/Chicago",
      sourceHouseId: "h1",
      includeUsage365: false,
      includeDiagnostics: false,
      includeFullReportText: false,
      testRanges: [{ startDate: "2025-04-10", endDate: "2025-04-10" }],
    });

    const res = await POST(req);
    const body = await res.json();
    expect(res.status).toBe(504);
    expect(body.ok).toBe(false);
    expect(body.error).toBe("canonical_recalc_timeout");
    expect(body.failureCode).toBeTruthy();
    expect(body.failureMessage).toBeTruthy();
  });

  it("fails canonical recalc before read when recalc reports artifact persistence failure", async () => {
    recalcSimulatorBuild.mockResolvedValueOnce({
      ok: false,
      error: "artifact_persist_failed",
    });
    const { POST } = await import("@/app/api/admin/tools/gapfill-lab/route");
    const req = buildRequest({
      action: "run_test_home_canonical_recalc",
      email: "brian@intellipath-solutions.com",
      timezone: "America/Chicago",
      sourceHouseId: "h1",
      includeUsage365: false,
      includeDiagnostics: false,
      includeFullReportText: false,
      testRanges: [{ startDate: "2025-04-10", endDate: "2025-04-10" }],
    });

    const res = await POST(req);
    const body = await res.json();
    expect(res.status).toBe(500);
    expect(body.ok).toBe(false);
    expect(body.error).toBe("canonical_recalc_failed");
    expect(String(body.message ?? "")).toContain("artifact_persist_failed");
    expect(getSimulatedUsageForHouseScenario).not.toHaveBeenCalled();
  });

  it("blocks save when test-home replace status is not ready", async () => {
    getLabTestHomeLink.mockResolvedValueOnce({
      ownerUserId: "u1",
      testHomeHouseId: "test-home-1",
      sourceUserId: "u1",
      sourceHouseId: "h1",
      status: "profile_syncing",
      statusMessage: "syncing",
      lastReplacedAt: null,
    });
    const { POST } = await import("@/app/api/admin/tools/gapfill-lab/route");
    const req = buildRequest({
      action: "save_test_home_inputs",
      email: "brian@intellipath-solutions.com",
      timezone: "America/Chicago",
      sourceHouseId: "h1",
      homeProfile: { homeAge: 20 },
      applianceProfile: { version: 1, fuelConfiguration: "electric", appliances: [] },
      travelRanges: [],
    });
    const res = await POST(req);
    const body = await res.json();
    expect(res.status).toBe(409);
    expect(body.ok).toBe(false);
    expect(body.error).toBe("test_home_replace_incomplete");
  });

  it("replaces test home from selected source house", async () => {
    const { POST } = await import("@/app/api/admin/tools/gapfill-lab/route");
    const req = buildRequest({
      action: "replace_test_home_from_source",
      email: "brian@intellipath-solutions.com",
      timezone: "America/Chicago",
      sourceHouseId: "h1",
    });
    const res = await POST(req);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.action).toBe("replace_test_home_from_source");
    expect(body.testHome?.label).toBe("Test Home");
    expect(replaceGlobalLabTestHomeFromSource).toHaveBeenCalledWith({
      ownerUserId: "u1",
      sourceUserId: "u1",
      sourceHouseId: "h1",
    });
  });

  it("prefills lookup travel ranges from linked test home", async () => {
    const helpers = await import("@/app/api/admin/tools/gapfill-lab/gapfillLabRouteHelpers");
    const getTravelRangesFromDbMock = vi.mocked(helpers.getTravelRangesFromDb as any);
    getTravelRangesFromDbMock.mockResolvedValueOnce([
      { startDate: "2025-08-13", endDate: "2025-08-17" },
    ]);

    const { POST } = await import("@/app/api/admin/tools/gapfill-lab/route");
    const req = buildRequest({
      action: "lookup_source_houses",
      email: "brian@intellipath-solutions.com",
      timezone: "America/Chicago",
    });
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.action).toBe("lookup_source_houses");
    expect(body.travelRangesFromDb).toEqual([{ startDate: "2025-08-13", endDate: "2025-08-17" }]);
    expect(body.travelRangesSource).toBe("test_home");
  });

  it("saves home/appliance inputs only to test-home house id", async () => {
    const { POST } = await import("@/app/api/admin/tools/gapfill-lab/route");
    const req = buildRequest({
      action: "save_test_home_inputs",
      email: "brian@intellipath-solutions.com",
      timezone: "America/Chicago",
      sourceHouseId: "h1",
      homeProfile: { homeAge: 12, squareFeet: 2200, summerTemp: 73, winterTemp: 70 },
      applianceProfile: { version: 1, fuelConfiguration: "all_electric", appliances: [] },
      travelRanges: [],
    });

    const res = await POST(req);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.action).toBe("save_test_home_inputs");
    expect(homeDetailsPrisma.homeProfileSimulated.upsert).toHaveBeenCalledTimes(1);
    expect(appliancesPrisma.applianceProfileSimulated.upsert).toHaveBeenCalledTimes(1);
    const homeCall = homeDetailsPrisma.homeProfileSimulated.upsert.mock.calls[0]?.[0];
    const applianceCall = appliancesPrisma.applianceProfileSimulated.upsert.mock.calls[0]?.[0];
    expect(homeCall?.where?.userId_houseId?.houseId).toBe("test-home-1");
    expect(applianceCall?.where?.userId_houseId?.houseId).toBe("test-home-1");
    expect(homeCall?.where?.userId_houseId?.houseId).not.toBe("h1");
    expect(applianceCall?.where?.userId_houseId?.houseId).not.toBe("h1");
  });
});
