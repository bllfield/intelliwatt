import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

const requireAdmin = vi.fn();
const lookupAdminHousesByEmail = vi.fn();
const resolveAdminHouseSelection = vi.fn();
const listScenarios = vi.fn();
const getManualUsageInputForUserHouse = vi.fn();
const saveManualUsageInputForUserHouse = vi.fn();
const getHomeProfileSimulatedByUserHouse = vi.fn();
const getHomeProfileReadOnlyByUserHouse = vi.fn();
const getApplianceProfileSimulatedByUserHouse = vi.fn();
const normalizeStoredApplianceProfile = vi.fn();
const resolveSharedWeatherSensitivityEnvelope = vi.fn();
const getTravelRangesFromDb = vi.fn();
const getSimulationVariablePolicy = vi.fn();
const resolveUpstreamUsageTruthForSimulation = vi.fn();
const buildUserUsageHouseContract = vi.fn();
const adaptIntervalRawInput = vi.fn();
const adaptGreenButtonRawInput = vi.fn();
const adaptManualMonthlyRawInput = vi.fn();
const adaptManualAnnualRawInput = vi.fn();
const adaptNewBuildRawInput = vi.fn();
const runSharedSimulation = vi.fn();
const buildSharedSimulationReadModel = vi.fn();
const buildOnePathManualUsagePastSimReadResult = vi.fn();
const readOnePathSimulatedUsageScenario = vi.fn();
const listOnePathScenarioEvents = vi.fn();
class UpstreamUsageTruthMissingError extends Error {
  code = "usage_truth_missing";
  usageTruthSource: string;
  seedResult: unknown;
  upstreamUsageTruth: unknown;

  constructor(args: { usageTruthSource: string; seedResult: unknown; upstreamUsageTruth: unknown }) {
    super("Upstream usage truth is required before simulation can run.");
    this.usageTruthSource = args.usageTruthSource;
    this.seedResult = args.seedResult;
    this.upstreamUsageTruth = args.upstreamUsageTruth;
  }
}

class SharedSimulationRunError extends Error {
  code: string;
  missingItems: string[];

  constructor(args: { code: string; missingItems?: string[] }) {
    super(args.code);
    this.code = args.code;
    this.missingItems = Array.isArray(args.missingItems) ? args.missingItems : [];
  }
}

vi.mock("@/lib/auth/admin", () => ({
  requireAdmin: (...args: any[]) => requireAdmin(...args),
}));

vi.mock("@/lib/admin/adminHouseLookup", () => ({
  lookupAdminHousesByEmail: (...args: any[]) => lookupAdminHousesByEmail(...args),
  resolveAdminHouseSelection: (...args: any[]) => resolveAdminHouseSelection(...args),
}));

vi.mock("@/modules/usageSimulator/service", () => ({
  listScenarios: (...args: any[]) => listScenarios(...args),
}));

vi.mock("@/modules/homeProfile/repo", () => ({
  getHomeProfileSimulatedByUserHouse: (...args: any[]) => getHomeProfileSimulatedByUserHouse(...args),
  getHomeProfileReadOnlyByUserHouse: (...args: any[]) => getHomeProfileReadOnlyByUserHouse(...args),
}));

vi.mock("@/modules/applianceProfile/repo", () => ({
  getApplianceProfileSimulatedByUserHouse: (...args: any[]) => getApplianceProfileSimulatedByUserHouse(...args),
}));

vi.mock("@/modules/applianceProfile/validation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/applianceProfile/validation")>();
  return {
    ...actual,
    normalizeStoredApplianceProfile: (...args: any[]) => normalizeStoredApplianceProfile(...args),
  };
});

vi.mock("@/modules/onePathSim/runtime", () => ({
  getOnePathManualUsageInput: (...args: any[]) => getManualUsageInputForUserHouse(...args),
  saveOnePathManualUsageInput: (...args: any[]) => saveManualUsageInputForUserHouse(...args),
  resolveOnePathWeatherSensitivityEnvelope: (...args: any[]) => resolveSharedWeatherSensitivityEnvelope(...args),
  getOnePathTravelRangesFromDb: (...args: any[]) => getTravelRangesFromDb(...args),
  getOnePathSimulationVariablePolicy: (...args: any[]) => getSimulationVariablePolicy(...args),
  resolveOnePathUpstreamUsageTruthForSimulation: (...args: any[]) => resolveUpstreamUsageTruthForSimulation(...args),
}));

vi.mock("@/lib/usage/userUsageHouseContract", () => ({
  buildUserUsageHouseContract: (...args: any[]) => buildUserUsageHouseContract(...args),
}));

vi.mock("@/modules/onePathSim/onePathSim", () => ({
  adaptIntervalRawInput: (...args: any[]) => adaptIntervalRawInput(...args),
  adaptGreenButtonRawInput: (...args: any[]) => adaptGreenButtonRawInput(...args),
  adaptManualMonthlyRawInput: (...args: any[]) => adaptManualMonthlyRawInput(...args),
  adaptManualAnnualRawInput: (...args: any[]) => adaptManualAnnualRawInput(...args),
  adaptNewBuildRawInput: (...args: any[]) => adaptNewBuildRawInput(...args),
  runSharedSimulation: (...args: any[]) => runSharedSimulation(...args),
  buildSharedSimulationReadModel: (...args: any[]) => buildSharedSimulationReadModel(...args),
  SharedSimulationRunError,
  UpstreamUsageTruthMissingError,
}));

vi.mock("@/modules/onePathSim/serviceBridge", () => ({
  readOnePathSimulatedUsageScenario: (...args: any[]) => readOnePathSimulatedUsageScenario(...args),
  listOnePathScenarioEvents: (...args: any[]) => listOnePathScenarioEvents(...args),
}));

vi.mock("@/modules/onePathSim/manualPastSimReadResult", () => ({
  buildOnePathManualUsagePastSimReadResult: (...args: any[]) => buildOnePathManualUsagePastSimReadResult(...args),
}));

function buildRequest(body: Record<string, unknown>, cookie = "brian@intellipath-solutions.com") {
  return new NextRequest("http://localhost/api/admin/tools/one-path-sim", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: `intelliwatt_admin=${cookie}`,
    },
    body: JSON.stringify(body),
  });
}

function buildDailyRows(startDate: string, endDate: string, kwh = 10) {
  const out: Array<{ date: string; kwh: number }> = [];
  const start = new Date(`${startDate}T00:00:00.000Z`).getTime();
  const end = new Date(`${endDate}T00:00:00.000Z`).getTime();
  for (let cursor = start; cursor <= end; cursor += 24 * 60 * 60 * 1000) {
    out.push({ date: new Date(cursor).toISOString().slice(0, 10), kwh });
  }
  return out;
}

describe("admin one path sim route", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-16T12:00:00.000Z"));
    requireAdmin.mockReset();
    lookupAdminHousesByEmail.mockReset();
    resolveAdminHouseSelection.mockReset();
    listScenarios.mockReset();
    getManualUsageInputForUserHouse.mockReset();
    saveManualUsageInputForUserHouse.mockReset();
    getHomeProfileSimulatedByUserHouse.mockReset();
    getHomeProfileReadOnlyByUserHouse.mockReset();
    getApplianceProfileSimulatedByUserHouse.mockReset();
    normalizeStoredApplianceProfile.mockReset();
    resolveSharedWeatherSensitivityEnvelope.mockReset();
    getTravelRangesFromDb.mockReset();
    getSimulationVariablePolicy.mockReset();
    resolveUpstreamUsageTruthForSimulation.mockReset();
    buildUserUsageHouseContract.mockReset();
    adaptIntervalRawInput.mockReset();
    adaptGreenButtonRawInput.mockReset();
    adaptManualMonthlyRawInput.mockReset();
    adaptManualAnnualRawInput.mockReset();
    adaptNewBuildRawInput.mockReset();
    runSharedSimulation.mockReset();
    buildSharedSimulationReadModel.mockReset();
    buildOnePathManualUsagePastSimReadResult.mockReset();
    readOnePathSimulatedUsageScenario.mockReset();
    listOnePathScenarioEvents.mockReset();
    vi.stubEnv("HOME_DETAILS_DATABASE_URL", "");
    vi.stubEnv("APPLIANCES_DATABASE_URL", "");
    vi.stubEnv("USAGE_DATABASE_URL", "");

    requireAdmin.mockReturnValue({ ok: false, status: 401, body: { error: "Unauthorized" } });
    lookupAdminHousesByEmail.mockResolvedValue({
      ok: true,
      email: "customer@example.com",
      userId: "user-1",
      houses: [{ id: "house-1", label: "Primary", esiid: "esiid-1", isPrimary: true }],
    });
    resolveAdminHouseSelection.mockResolvedValue({ id: "house-1", label: "Primary", esiid: "esiid-1", isPrimary: true });
    listScenarios.mockResolvedValue({ ok: true, scenarios: [{ id: "scenario-1", name: "Past" }] });
    resolveUpstreamUsageTruthForSimulation.mockResolvedValue({
      dataset: {
        summary: { totalKwh: 3790, end: "2026-04-14" },
        meta: { actualSource: "SMT" },
        daily: buildDailyRows("2025-04-01", "2026-04-14"),
      },
      alternatives: { smt: { totalKwh: 123 }, greenButton: null },
      actualContextHouse: { id: "house-1", esiid: "esiid-1" },
      usageTruthSource: "persisted_usage_output",
      seedResult: null,
      summary: {
        title: "Upstream Usage Truth",
        summary: "shared usage truth summary",
        currentRun: {
          statusSummary: {
            usageTruthStatus: "existing_persisted_truth",
            downstreamSimulationAllowed: true,
            seedingAttempted: false,
            seedingResult: "not_needed",
          },
        },
        sharedOwners: [],
      },
    });
    getManualUsageInputForUserHouse.mockResolvedValue({ payload: null, updatedAt: null });
    getHomeProfileSimulatedByUserHouse.mockResolvedValue({ squareFeet: 2000 });
    getHomeProfileReadOnlyByUserHouse.mockResolvedValue({ squareFeet: 2000 });
    getApplianceProfileSimulatedByUserHouse.mockResolvedValue({ appliancesJson: { fuelConfiguration: "all_electric", appliances: [] } });
    normalizeStoredApplianceProfile.mockReturnValue({ fuelConfiguration: "all_electric", appliances: [] });
    resolveSharedWeatherSensitivityEnvelope.mockResolvedValue({ score: { scoringMode: "INTERVAL_BASED" }, derivedInput: null });
    getTravelRangesFromDb.mockResolvedValue([{ startDate: "2026-03-01", endDate: "2026-03-05" }]);
    getSimulationVariablePolicy.mockResolvedValue({
      effectiveByMode: {
        INTERVAL: { previewPolicy: "interval" },
        GREEN_BUTTON: { previewPolicy: "green-button" },
        MANUAL_MONTHLY: { previewPolicy: "manual-monthly" },
        MANUAL_ANNUAL: { previewPolicy: "manual-annual" },
        NEW_BUILD: { previewPolicy: "new-build" },
      },
      overrides: {},
    });
    adaptIntervalRawInput.mockResolvedValue({ sharedProducerPathUsed: true, inputType: "INTERVAL" });
    adaptGreenButtonRawInput.mockResolvedValue({ sharedProducerPathUsed: true, inputType: "GREEN_BUTTON" });
    adaptManualMonthlyRawInput.mockResolvedValue({ sharedProducerPathUsed: true, inputType: "MANUAL_MONTHLY" });
    adaptManualAnnualRawInput.mockResolvedValue({ sharedProducerPathUsed: true, inputType: "MANUAL_ANNUAL" });
    adaptNewBuildRawInput.mockResolvedValue({ sharedProducerPathUsed: true, inputType: "NEW_BUILD" });
    runSharedSimulation.mockResolvedValue({ artifactId: "artifact-1", artifactInputHash: "artifact-hash-1", engineInput: {} });
    buildSharedSimulationReadModel.mockReturnValue({
      runIdentity: { artifactId: "artifact-1" },
      manualStageOneView: {
        mode: "MONTHLY",
        source: "artifact_backed_read_model",
        stageOnePresentation: { mode: "MONTHLY" },
        billPeriodCompare: {
          rows: [{ month: "2026-03", actualIntervalTotalKwh: 300, manualTotalKwh: 300 }],
        },
      },
      dataset: {
        summary: {
          source: "SIMULATED",
          intervalsCount: 35040,
          totalKwh: 15008.06,
          start: "2025-04-16",
          end: "2026-04-15",
        },
        meta: {
          source: "SIMULATED",
          weatherSensitivityScore: { scoringMode: "INTERVAL_BASED" },
        },
        monthly: [{ month: "2026-04", kwh: 15008.06 }],
        daily: [{ date: "2026-04-15", kwh: 41.12, source: "SIMULATED" }],
        totals: {
          importKwh: 15008.06,
          exportKwh: 0,
          netKwh: 15008.06,
        },
        insights: {
          fifteenMinuteAverages: [{ hhmm: "00:00", avgKw: 1.2 }],
          weekdayVsWeekend: { weekday: 10000, weekend: 5008.06 },
          timeOfDayBuckets: [{ key: "overnight", label: "Overnight", kwh: 3200 }],
        },
      },
      compareProjection: {
        rows: [
          {
            localDate: "2026-04-15",
            dayType: "weekday",
            actualDayKwh: 40,
            simulatedDayKwh: 41.12,
            errorKwh: 1.12,
            percentError: 2.8,
          },
        ],
        metrics: { wape: 2.8, mae: 1.12, rmse: 1.12 },
      },
      tuningSummary: {
        selectedValidationRows: [
          {
            localDate: "2026-04-15",
            dayType: "weekday",
            actualDayKwh: 40,
            simulatedDayKwh: 41.12,
            errorKwh: 1.12,
            percentError: 2.8,
          },
        ],
        validationMetricsSummary: { wape: 2.8, mae: 1.12, rmse: 1.12 },
      },
      sharedDiagnostics: {
        simulatedChartStitchedMonth: {
          mode: "PRIOR_YEAR_TAIL",
          yearMonth: "2026-04",
          haveDaysThrough: 15,
          missingDaysFrom: 16,
          missingDaysTo: 30,
          borrowedFromYearMonth: "2025-04",
          completenessRule: "test",
        },
      },
    });
    buildOnePathManualUsagePastSimReadResult.mockResolvedValue({
      ok: true,
      dataset: {
        summary: {
          source: "SIMULATED",
          intervalsCount: 35040,
          totalKwh: 15008.06,
          start: "2025-04-16",
          end: "2026-04-15",
        },
        monthly: [{ month: "2026-04", kwh: 15008.06 }],
        daily: [{ date: "2026-04-15", kwh: 41.12, source: "SIMULATED" }],
      },
      displayDataset: {
        summary: {
          source: "SIMULATED",
          intervalsCount: 35040,
          totalKwh: 15008.06,
          start: "2025-04-16",
          end: "2026-04-15",
        },
        meta: {
          weatherSensitivityScore: { scoringMode: "INTERVAL_BASED" },
        },
        monthly: [{ month: "2026-04", kwh: 15008.06 }],
        daily: [{ date: "2026-04-15", kwh: 41.12, source: "SIMULATED" }],
        dailyWeather: {
          "2026-04-15": { tAvgF: 63, tMinF: 54, tMaxF: 71, hdd65: 2, cdd65: 0 },
        },
        totals: {
          importKwh: 15008.06,
          exportKwh: 0,
          netKwh: 15008.06,
        },
        insights: {
          fifteenMinuteAverages: [{ hhmm: "00:00", avgKw: 1.2 }],
          weekdayVsWeekend: { weekday: 10000, weekend: 5008.06 },
          timeOfDayBuckets: [{ key: "overnight", label: "Overnight", kwh: 3200 }],
        },
      },
      compareProjection: {
        rows: [
          {
            localDate: "2026-04-15",
            dayType: "weekday",
            actualDayKwh: 40,
            simulatedDayKwh: 41.12,
            errorKwh: 1.12,
            percentError: 2.8,
          },
        ],
        metrics: { wape: 2.8, mae: 1.12, rmse: 1.12 },
      },
    });
    readOnePathSimulatedUsageScenario.mockResolvedValue({
      ok: true,
      houseId: "house-1",
      scenarioKey: "scenario-1",
      scenarioId: "scenario-1",
      dataset: {
        summary: {
          source: "SIMULATED",
          intervalsCount: 35040,
          totalKwh: 15008.06,
          start: "2025-04-16",
          end: "2026-04-15",
        },
        meta: {
          source: "SIMULATED",
          weatherSensitivityScore: { scoringMode: "INTERVAL_BASED" },
          validationCompareRows: [
            {
              localDate: "2026-04-15",
              dayType: "weekday",
              actualDayKwh: 40,
              simulatedDayKwh: 41.12,
              errorKwh: 1.12,
              percentError: 2.8,
            },
          ],
          validationCompareMetrics: { wape: 2.8, mae: 1.12, rmse: 1.12 },
          stitchedMonth: {
            mode: "PRIOR_YEAR_TAIL",
            yearMonth: "2026-04",
            haveDaysThrough: 15,
            missingDaysFrom: 16,
            missingDaysTo: 30,
            borrowedFromYearMonth: "2025-04",
            completenessRule: "test",
          },
        },
        monthly: [{ month: "2026-04", kwh: 15008.06 }],
        daily: [{ date: "2026-04-15", kwh: 41.12, source: "SIMULATED" }],
        dailyWeather: {
          "2026-04-15": { tAvgF: 63, tMinF: 54, tMaxF: 71, hdd65: 2, cdd65: 0 },
        },
        totals: {
          importKwh: 15008.06,
          exportKwh: 0,
          netKwh: 15008.06,
        },
        insights: {
          fifteenMinuteAverages: [{ hhmm: "00:00", avgKw: 1.2 }],
          weekdayVsWeekend: { weekday: 10000, weekend: 5008.06 },
          timeOfDayBuckets: [{ key: "overnight", label: "Overnight", kwh: 3200 }],
        },
      },
    });
    listOnePathScenarioEvents.mockResolvedValue({
      ok: true,
      events: [
        {
          id: "event-1",
          scenarioId: "scenario-1",
          kind: "TRAVEL_RANGE",
          effectiveMonth: "2026-04",
          payloadJson: { startDate: "2026-04-10", endDate: "2026-04-15" },
        },
      ],
    });
    buildUserUsageHouseContract.mockResolvedValue({
      houseId: "house-1",
      label: "Home",
      address: { line1: "123 Main", city: "Dallas", state: "TX" },
      esiid: "esiid-1",
      dataset: {
        summary: {
          source: "SMT",
          intervalsCount: 34823,
          totalKwh: 13542.3,
          start: "2025-04-15",
          end: "2026-04-14",
        },
        daily: [{ date: "2026-04-14", kwh: 13542.3 }],
        monthly: [{ month: "2026-04", kwh: 13542.3 }],
        series: { intervals15: [{ timestamp: "2026-04-14T23:45:00.000Z", kwh: 0.3 }] },
        meta: { baselinePassthrough: true },
        insights: {
          weekdayVsWeekend: { weekday: 9800, weekend: 3742.3 },
          timeOfDayBuckets: [{ key: "overnight", label: "Overnight", kwh: 2800 }],
          fifteenMinuteAverages: [{ hhmm: "00:00", avgKw: 1.2 }],
        },
        totals: { importKwh: 13542.3, exportKwh: 0, netKwh: 13542.3 },
      },
      alternatives: { smt: { totalKwh: 123 }, greenButton: null },
      datasetError: null,
      weatherSensitivityScore: { scoringMode: "INTERVAL_BASED" },
      weatherEfficiencyDerivedInput: null,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows the browser admin cookie for lookup and returns source context", async () => {
    const { POST } = await import("@/app/api/admin/tools/one-path-sim/route");
    const res = await POST(buildRequest({ action: "lookup", email: "customer@example.com", includeDebugDiagnostics: true }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(requireAdmin).not.toHaveBeenCalled();
    expect(json.ok).toBe(true);
    expect(json.selectedHouse.id).toBe("house-1");
    expect(json.sourceContext.actualDatasetSummary).toEqual(
      expect.objectContaining({ totalKwh: 3790, end: "2026-04-14" })
    );
    expect(json.sourceContext.upstreamUsageTruth.currentRun.statusSummary).toEqual({
      usageTruthStatus: "existing_persisted_truth",
      downstreamSimulationAllowed: true,
      seedingAttempted: false,
      seedingResult: "not_needed",
    });
    expect(json.sourceContext.readOnlyAudit.validatorAudit.usageTruth).toEqual(
      expect.objectContaining({
        ready: true,
        validator: "upstreamUsageTruth.currentRun.statusSummary.downstreamSimulationAllowed || usageTruthSource === persisted_usage_output",
      })
    );
    expect(json.sourceContext.readOnlyAudit.readSourceComparison.manualUsage).toEqual(
      expect.objectContaining({
        sameBackingStoreAsUserSite: true,
      })
    );
    expect(json.sourceContext.environmentVisibility).toEqual({
      homeDetails: expect.objectContaining({
        envVarName: "HOME_DETAILS_DATABASE_URL",
        envVarPresent: false,
      }),
      appliances: expect.objectContaining({
        envVarName: "APPLIANCES_DATABASE_URL",
        envVarPresent: false,
      }),
      usage: expect.objectContaining({
        envVarName: "USAGE_DATABASE_URL",
        envVarPresent: false,
      }),
    });
    expect(json.sourceContext.runtimeEnvParityTrace).toEqual(
      expect.objectContaining({
        routeRuntimeParity: true,
        envVisibility: {
          homeDetails: false,
          appliances: false,
          usage: false,
        },
        parityStatus: "local_env_not_populated",
      })
    );
    expect(json.sourceContext.weatherScore).toEqual({ scoringMode: "INTERVAL_BASED" });
    expect(json.sourceContext.travelRangesFromDb).toEqual([{ startDate: "2026-03-01", endDate: "2026-03-05" }]);
    expect(json.sourceContext.userUsageBaselineContract).toEqual(
      expect.objectContaining({
        dataset: expect.objectContaining({
          summary: expect.objectContaining({
            intervalsCount: 34823,
            totalKwh: 13542.3,
          }),
        }),
      })
    );
    expect(json.sourceContext.baselineParityAudit).toEqual(
      expect.objectContaining({
        parityStatus: "matched_shared_baseline_truth",
      })
    );
    expect(json.sourceContext.baselineParityReport).toEqual(
      expect.objectContaining({
        overallMatch: true,
        firstDivergenceField: null,
      })
    );
    expect(buildUserUsageHouseContract).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        house: expect.objectContaining({ id: "house-1" }),
      })
    );
    expect(buildUserUsageHouseContract).toHaveBeenCalledTimes(2);
    expect(getHomeProfileReadOnlyByUserHouse).toHaveBeenCalledWith({ userId: "user-1", houseId: "house-1" });
    expect(getHomeProfileSimulatedByUserHouse).not.toHaveBeenCalled();
    expect(saveManualUsageInputForUserHouse).not.toHaveBeenCalled();
  });

  it("returns a compact baseline view for green button lookup debug mode", async () => {
    const { POST } = await import("@/app/api/admin/tools/one-path-sim/route");
    const res = await POST(
      buildRequest({
        action: "lookup",
        email: "customer@example.com",
        houseId: "house-1",
        actualContextHouseId: "house-1",
        mode: "GREEN_BUTTON",
        includeDebugDiagnostics: true,
      })
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(resolveUpstreamUsageTruthForSimulation).toHaveBeenCalledWith({
      userId: "user-1",
      houseId: "house-1",
      actualContextHouseId: "house-1",
      seedIfMissing: false,
      preferredActualSource: "GREEN_BUTTON",
    });
    expect(json.sourceContext.userUsageBaselineContract).toBeNull();
    expect(json.sourceContext.userUsagePageBaselineContract).toBeNull();
    expect(json.sourceContext.userUsageBaselineView).toEqual(
      expect.objectContaining({
        summary: expect.objectContaining({
          source: "SMT",
          intervalsCount: 34823,
        }),
        monthlyRows: expect.any(Array),
        dailyRows: expect.any(Array),
      })
    );
  });

  it("uses the selected mode policy and actual context house for lookup weather preview", async () => {
    lookupAdminHousesByEmail.mockResolvedValue({
      ok: true,
      email: "customer@example.com",
      userId: "user-1",
      houses: [
        { id: "house-1", label: "Primary", esiid: "esiid-1", isPrimary: true },
        { id: "house-2", label: "Actual", esiid: "esiid-2", isPrimary: false },
      ],
    });
    const { POST } = await import("@/app/api/admin/tools/one-path-sim/route");
    await POST(
      buildRequest({
        action: "lookup",
        email: "customer@example.com",
        mode: "MANUAL_MONTHLY",
        actualContextHouseId: "house-2",
        includeDebugDiagnostics: true,
      })
    );

    expect(resolveUpstreamUsageTruthForSimulation).toHaveBeenCalledWith({
      userId: "user-1",
      houseId: "house-1",
      actualContextHouseId: "house-2",
      seedIfMissing: false,
    });
    expect(resolveSharedWeatherSensitivityEnvelope).toHaveBeenCalledWith(
      expect.objectContaining({
        weatherHouseId: "house-2",
        simulationVariablePolicy: { previewPolicy: "manual-monthly" },
      })
    );
  });

  it("returns upstream usage truth metadata on lookup without introducing page-local usage loading", async () => {
    resolveUpstreamUsageTruthForSimulation.mockResolvedValue({
      dataset: null,
      alternatives: { smt: null, greenButton: null },
      actualContextHouse: { id: "house-2", esiid: "esiid-2" },
      usageTruthSource: "missing_usage_truth",
      seedResult: null,
      summary: {
        title: "Upstream Usage Truth",
        summary: "shared usage truth summary",
        currentRun: {
          statusSummary: {
            usageTruthStatus: "unavailable",
            downstreamSimulationAllowed: false,
            seedingAttempted: false,
            seedingResult: "not_needed",
          },
          orchestrationTrace: {
            lookedForExistingUsageTruth: true,
            existingUsageTruthFound: false,
            refreshRequested: false,
          },
        },
        sharedOwners: [],
      },
    });

    const { POST } = await import("@/app/api/admin/tools/one-path-sim/route");
    const res = await POST(
      buildRequest({
        action: "lookup",
        email: "customer@example.com",
        houseId: "house-1",
        mode: "MANUAL_MONTHLY",
        actualContextHouseId: "house-2",
        includeDebugDiagnostics: true,
      })
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.sourceContext.upstreamUsageTruth.currentRun.statusSummary).toEqual({
      usageTruthStatus: "unavailable",
      downstreamSimulationAllowed: false,
      seedingAttempted: false,
      seedingResult: "not_needed",
    });
    expect(json.sourceContext.upstreamUsageTruth.currentRun.orchestrationTrace).toEqual(
      expect.objectContaining({
        lookedForExistingUsageTruth: true,
        existingUsageTruthFound: false,
        refreshRequested: false,
      })
    );
    expect(adaptManualMonthlyRawInput).not.toHaveBeenCalled();
  });

  it("routes interval runs through the shared adapter, producer, and read model", async () => {
    const { POST } = await import("@/app/api/admin/tools/one-path-sim/route");
    const res = await POST(
      buildRequest({
        action: "run",
        email: "customer@example.com",
        houseId: "house-1",
        mode: "INTERVAL",
        includeDebugDiagnostics: true,
      })
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(adaptIntervalRawInput).toHaveBeenCalledTimes(1);
    expect(runSharedSimulation).toHaveBeenCalledWith({ sharedProducerPathUsed: true, inputType: "INTERVAL" });
    expect(buildSharedSimulationReadModel).toHaveBeenCalledWith(
      expect.objectContaining({ artifactId: "artifact-1" })
    );
    expect(json.readModel.runIdentity.artifactId).toBe("artifact-1");
  });

  it("routes green button runs through the dedicated green button adapter and source preference", async () => {
    const { POST } = await import("@/app/api/admin/tools/one-path-sim/route");
    const res = await POST(
      buildRequest({
        action: "run",
        email: "customer@example.com",
        houseId: "house-1",
        mode: "GREEN_BUTTON",
        includeDebugDiagnostics: true,
      })
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(adaptGreenButtonRawInput).toHaveBeenCalledTimes(1);
    expect(adaptGreenButtonRawInput).toHaveBeenCalledWith(
      expect.objectContaining({
        preferredActualSource: "GREEN_BUTTON",
      })
    );
    expect(adaptIntervalRawInput).not.toHaveBeenCalled();
    expect(runSharedSimulation).toHaveBeenCalledWith({ sharedProducerPathUsed: true, inputType: "GREEN_BUTTON" });
    expect(json.readModel.runIdentity.artifactId).toBe("artifact-1");
  });

  it("keeps interval run requests off the lookup-only preview and baseline contract path", async () => {
    const { POST } = await import("@/app/api/admin/tools/one-path-sim/route");
    const res = await POST(
      buildRequest({
        action: "run",
        email: "customer@example.com",
        houseId: "house-1",
        mode: "INTERVAL",
        scenarioId: "scenario-1",
        includeDebugDiagnostics: true,
      })
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(adaptIntervalRawInput).toHaveBeenCalledTimes(1);
    expect(runSharedSimulation).toHaveBeenCalledTimes(1);
    expect(resolveUpstreamUsageTruthForSimulation).not.toHaveBeenCalled();
    expect(resolveSharedWeatherSensitivityEnvelope).not.toHaveBeenCalled();
    expect(getHomeProfileReadOnlyByUserHouse).not.toHaveBeenCalled();
    expect(getApplianceProfileSimulatedByUserHouse).not.toHaveBeenCalled();
    expect(getTravelRangesFromDb).not.toHaveBeenCalled();
    expect(getSimulationVariablePolicy).not.toHaveBeenCalled();
    expect(buildUserUsageHouseContract).not.toHaveBeenCalled();
  });

  it("defaults lookup requests to lean debug-off source context when debug is not requested", async () => {
    const { POST } = await import("@/app/api/admin/tools/one-path-sim/route");
    const res = await POST(buildRequest({ action: "lookup", email: "customer@example.com" }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.sourceContext).toEqual({
      debugDiagnosticsIncluded: false,
      greenButtonUpload: null,
      travelRangesFromDb: [{ startDate: "2026-03-01", endDate: "2026-03-05" }],
    });
    expect(resolveUpstreamUsageTruthForSimulation).not.toHaveBeenCalled();
    expect(resolveSharedWeatherSensitivityEnvelope).not.toHaveBeenCalled();
    expect(getHomeProfileReadOnlyByUserHouse).not.toHaveBeenCalled();
    expect(getApplianceProfileSimulatedByUserHouse).not.toHaveBeenCalled();
    expect(getSimulationVariablePolicy).not.toHaveBeenCalled();
    expect(buildUserUsageHouseContract).not.toHaveBeenCalled();
  });

  it("defaults interval runs to the lean debug-off response when debug is not requested", async () => {
    const { POST } = await import("@/app/api/admin/tools/one-path-sim/route");
    const res = await POST(
      buildRequest({
        action: "run",
        email: "customer@example.com",
        houseId: "house-1",
        mode: "INTERVAL",
        scenarioId: "scenario-1",
      })
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.debugDiagnosticsIncluded).toBe(false);
    expect(json.runType).toBe("PAST_SIM");
    expect(json.runDisplayView).toBeTruthy();
    expect(json.runDisplayView.pastVariables).toEqual([
      {
        kind: "TRAVEL_RANGE",
        effectiveMonth: "2026-04",
        payloadJson: { startDate: "2026-04-10", endDate: "2026-04-15" },
      },
    ]);
    expect(json.artifact ?? null).toBeNull();
    expect(json.readModel ?? null).toBeNull();
    expect(readOnePathSimulatedUsageScenario).toHaveBeenCalledWith({
      userId: "user-1",
      houseId: "house-1",
      scenarioId: "scenario-1",
      readMode: "allow_rebuild",
      projectionMode: "baseline",
      readContext: {
        artifactReadMode: "allow_rebuild",
        projectionMode: "baseline",
        compareSidecarRequest: true,
      },
    });
    expect(listOnePathScenarioEvents).toHaveBeenCalledWith({
      userId: "user-1",
      houseId: "house-1",
      scenarioId: "scenario-1",
    });
    expect(runSharedSimulation).not.toHaveBeenCalled();
    expect(buildSharedSimulationReadModel).not.toHaveBeenCalled();
  });

  it("returns a lean manual Stage 1 preview on manual lookup without falling back to the user manual page path", async () => {
    getManualUsageInputForUserHouse.mockResolvedValueOnce({
      payload: {
        mode: "MONTHLY",
        anchorEndDate: "2026-03-31",
        dateSourceMode: "AUTO_DATES",
        monthlyKwh: [
          { month: "2026-02", kwh: 420 },
          { month: "2026-03", kwh: 510 },
        ],
        statementRanges: [
          { month: "2026-03", startDate: "2026-03-01", endDate: "2026-03-31" },
          { month: "2026-02", startDate: "2026-02-01", endDate: "2026-02-28" },
        ],
        travelRanges: [{ startDate: "2026-03-10", endDate: "2026-03-12" }],
      },
      updatedAt: "2026-04-09T00:00:00.000Z",
    });

    const { POST } = await import("@/app/api/admin/tools/one-path-sim/route");
    const res = await POST(
      buildRequest({
        action: "lookup",
        email: "customer@example.com",
        houseId: "house-1",
        mode: "MANUAL_MONTHLY",
      })
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.sourceContext.debugDiagnosticsIncluded).toBe(false);
    expect(json.sourceContext.manualStageOneView).toMatchObject({
      mode: "MONTHLY",
      source: "saved_payload_preview",
    });
    expect(json.sourceContext.manualStageOneView?.stageOnePresentation).toMatchObject({
      mode: "MONTHLY",
    });
    expect(json.sourceContext.manualStageOneView?.billPeriodCompare ?? null).toBeNull();
    expect(json.sourceContext.manualUsageUpdatedAt).toBe("2026-04-09T00:00:00.000Z");
    expect(resolveUpstreamUsageTruthForSimulation).not.toHaveBeenCalled();
    expect(runSharedSimulation).not.toHaveBeenCalled();
  });

  it("returns a derived manual Stage 1 preview on manual lookup when the test-home payload is missing", async () => {
    const { POST } = await import("@/app/api/admin/tools/one-path-sim/route");
    const res = await POST(
      buildRequest({
        action: "lookup",
        email: "customer@example.com",
        houseId: "house-1",
        mode: "MANUAL_MONTHLY",
      })
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.sourceContext.debugDiagnosticsIncluded).toBe(false);
    expect(json.sourceContext.effectiveManualUsagePayload).toMatchObject({
      mode: "MONTHLY",
      dateSourceMode: "AUTO_DATES",
      anchorEndDate: "2026-04-14",
    });
    expect(json.sourceContext.manualStageOneView).toMatchObject({
      mode: "MONTHLY",
    });
    expect(json.sourceContext.manualSeed).toMatchObject({
      sourceMode: "ACTUAL_INTERVALS_MONTHLY_PREFILL",
    });
    expect(resolveUpstreamUsageTruthForSimulation).toHaveBeenCalledWith({
      userId: "user-1",
      houseId: "house-1",
      actualContextHouseId: "house-1",
      seedIfMissing: false,
    });
  });

  it("repairs legacy manual lookup payloads that only saved anchorEndMonth before building Stage 1 preview", async () => {
    getManualUsageInputForUserHouse.mockResolvedValueOnce({
      payload: {
        mode: "MONTHLY",
        billEndDay: 15,
        monthlyKwh: [
          { month: "2026-03", kwh: "" },
          { month: "2026-02", kwh: "" },
        ],
        travelRanges: [{ startDate: "2026-03-10", endDate: "2026-03-12" }],
        anchorEndMonth: "2026-03",
      },
      updatedAt: "2026-04-09T00:00:00.000Z",
    });

    const { POST } = await import("@/app/api/admin/tools/one-path-sim/route");
    const res = await POST(
      buildRequest({
        action: "lookup",
        email: "customer@example.com",
        houseId: "house-1",
        mode: "MANUAL_MONTHLY",
      })
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.sourceContext.effectiveManualUsagePayload).toMatchObject({
      mode: "MONTHLY",
      anchorEndDate: "2026-04-14",
      dateSourceMode: "AUTO_DATES",
    });
    expect(json.sourceContext.manualStageOneView).toMatchObject({
      mode: "MONTHLY",
    });
    expect(json.sourceContext.manualSeed).toMatchObject({
      sourceMode: "ACTUAL_INTERVALS_MONTHLY_PREFILL",
    });
    expect(resolveUpstreamUsageTruthForSimulation).toHaveBeenCalledWith({
      userId: "user-1",
      houseId: "house-1",
      actualContextHouseId: "house-1",
      seedIfMissing: false,
    });
  });

  it("keeps manual lookup weather scoring on the billing-period path", async () => {
    const savedPayload = {
      mode: "MONTHLY",
      anchorEndDate: "2026-04-14",
      dateSourceMode: "AUTO_DATES",
      monthlyKwh: [
        { month: "2026-03", kwh: 510 },
        { month: "2026-04", kwh: 420 },
      ],
      statementRanges: [
        { month: "2026-03", startDate: "2026-03-01", endDate: "2026-03-31" },
        { month: "2026-04", startDate: "2026-04-01", endDate: "2026-04-14" },
      ],
      travelRanges: [{ startDate: "2026-03-10", endDate: "2026-03-12" }],
    };
    getManualUsageInputForUserHouse.mockResolvedValueOnce({
      payload: savedPayload,
      updatedAt: "2026-04-09T00:00:00.000Z",
    });

    const { POST } = await import("@/app/api/admin/tools/one-path-sim/route");
    const res = await POST(
      buildRequest({
        action: "lookup",
        email: "customer@example.com",
        houseId: "house-1",
        mode: "MANUAL_MONTHLY",
        includeDebugDiagnostics: true,
      })
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(resolveSharedWeatherSensitivityEnvelope).toHaveBeenCalledWith(
      expect.objectContaining({
        actualDataset: null,
        manualUsagePayload: expect.objectContaining({
          mode: "MONTHLY",
          anchorEndDate: "2026-04-14",
        }),
        weatherHouseId: "house-1",
      })
    );
  });

  it("returns interval-derived monthly and annual admin seeds on manual load when no payload is saved", async () => {
    const { POST } = await import("@/app/api/admin/tools/one-path-sim/route");
    const res = await POST(
      buildRequest({
        action: "load_manual",
        email: "customer@example.com",
        houseId: "house-1",
        actualContextHouseId: "house-1",
      })
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.payload).toBeNull();
    expect(json.seed?.sourceMode).toBe("ACTUAL_INTERVALS_MONTHLY_PREFILL");
    expect(json.seed?.monthly).toMatchObject({
      mode: "MONTHLY",
      dateSourceMode: "AUTO_DATES",
      anchorEndDate: "2026-04-14",
    });
    expect(Array.isArray(json.seed?.monthly?.monthlyKwh)).toBe(true);
    expect(json.seed?.monthly?.monthlyKwh?.length).toBeGreaterThan(0);
    expect(json.seed?.annual).toMatchObject({
      mode: "ANNUAL",
      anchorEndDate: "2026-04-14",
    });
    expect(json.seed?.annual?.annualKwh).toBeGreaterThan(0);
    expect(resolveUpstreamUsageTruthForSimulation).toHaveBeenCalledWith({
      userId: "user-1",
      houseId: "house-1",
      actualContextHouseId: "house-1",
      seedIfMissing: false,
    });
  });

  it("rebuilds manual debug-off past runs before returning Stage 1 plus the manual display dataset", async () => {
    const explicitTravelRanges = [
      { startDate: "2025-03-14", endDate: "2025-06-01" },
      { startDate: "2025-08-13", endDate: "2025-08-17" },
    ];
    getManualUsageInputForUserHouse.mockResolvedValueOnce({
      payload: {
        mode: "MONTHLY",
        anchorEndDate: "2026-03-31",
        dateSourceMode: "AUTO_DATES",
        monthlyKwh: [
          { month: "2026-02", kwh: 420 },
          { month: "2026-03", kwh: 510 },
        ],
        statementRanges: [
          { month: "2026-03", startDate: "2026-03-01", endDate: "2026-03-31" },
          { month: "2026-02", startDate: "2026-02-01", endDate: "2026-02-28" },
        ],
        travelRanges: [{ startDate: "2026-03-10", endDate: "2026-03-12" }],
      },
      updatedAt: "2026-04-09T00:00:00.000Z",
    });

    const { POST } = await import("@/app/api/admin/tools/one-path-sim/route");
    const res = await POST(
      buildRequest({
        action: "run",
        email: "customer@example.com",
        houseId: "house-1",
        mode: "MANUAL_MONTHLY",
        scenarioId: "scenario-1",
        travelRanges: explicitTravelRanges,
      })
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.debugDiagnosticsIncluded).toBe(false);
    expect(json.runType).toBe("PAST_SIM");
    expect(json.manualStageOneView).toMatchObject({
      mode: "MONTHLY",
      source: "artifact_backed_read_model",
    });
    expect(json.manualStageOneView?.stageOnePresentation).toMatchObject({
      mode: "MONTHLY",
    });
    expect(json.manualStageOneView?.billPeriodCompare).toBeTruthy();
    expect(json.runDisplayView).toBeTruthy();
    expect(json.artifact ?? null).toBeNull();
    expect(json.readModel ?? null).toBeNull();
    expect(adaptManualMonthlyRawInput).toHaveBeenCalledWith(
      expect.objectContaining({
        scenarioId: "scenario-1",
        manualUsagePayload: expect.objectContaining({
          mode: "MONTHLY",
          anchorEndDate: "2026-04-14",
          travelRanges: explicitTravelRanges,
        }),
      })
    );
    expect(runSharedSimulation).toHaveBeenCalledTimes(1);
    expect(buildSharedSimulationReadModel).toHaveBeenCalledTimes(1);
    expect(buildOnePathManualUsagePastSimReadResult).toHaveBeenCalledWith({
      userId: "user-1",
      houseId: "house-1",
      scenarioId: "scenario-1",
      readMode: "artifact_only",
      callerType: "user_past",
      exactArtifactInputHash: "artifact-hash-1",
      requireExactArtifactMatch: true,
      usageInputMode: "MANUAL_MONTHLY",
      weatherLogicMode: null,
      artifactId: "artifact-1",
      artifactInputHash: "artifact-hash-1",
      artifactEngineVersion: null,
      manualUsagePayload: expect.objectContaining({
        mode: "MONTHLY",
        anchorEndDate: "2026-04-14",
        travelRanges: explicitTravelRanges,
      }),
      actualDataset: expect.objectContaining({
        summary: expect.objectContaining({ totalKwh: 3790 }),
      }),
    });
    expect(readOnePathSimulatedUsageScenario).not.toHaveBeenCalled();
  });

  it("passes actual context house and manual validation date keys through the shared adapter", async () => {
    const { POST } = await import("@/app/api/admin/tools/one-path-sim/route");
    await POST(
      buildRequest({
        action: "run",
        email: "customer@example.com",
        houseId: "house-1",
        mode: "INTERVAL",
        actualContextHouseId: "house-2",
        validationSelectionMode: "manual",
        validationOnlyDateKeysLocal: ["2026-03-10", "2026-03-11"],
      })
    );

    expect(adaptIntervalRawInput).toHaveBeenCalledWith(
      expect.objectContaining({
        actualContextHouseId: "house-2",
        validationSelectionMode: "manual",
        validationOnlyDateKeysLocal: ["2026-03-10", "2026-03-11"],
      })
    );
  });

  it("derives a manual monthly payload from interval-backed usage when no payload is saved", async () => {
    const { POST } = await import("@/app/api/admin/tools/one-path-sim/route");
    const res = await POST(
      buildRequest({
        action: "run",
        email: "customer@example.com",
        houseId: "house-1",
        mode: "MANUAL_MONTHLY",
      })
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(adaptManualMonthlyRawInput).toHaveBeenCalledWith(
      expect.objectContaining({
        manualUsagePayload: expect.objectContaining({
          mode: "MONTHLY",
          anchorEndDate: "2026-04-14",
          dateSourceMode: "AUTO_DATES",
        }),
      })
    );
    expect(runSharedSimulation).toHaveBeenCalledTimes(1);
  });

  it("refreshes stale auto-date monthly payload totals from actual-derived admin truth when a saved oldest bill is zero", async () => {
    getManualUsageInputForUserHouse.mockResolvedValueOnce({
      payload: {
        mode: "MONTHLY",
        anchorEndDate: "2026-04-14",
        dateSourceMode: "AUTO_DATES",
        monthlyKwh: [
          { month: "2026-04", kwh: 300 },
          { month: "2026-03", kwh: 300 },
          { month: "2026-02", kwh: 300 },
          { month: "2026-01", kwh: 300 },
          { month: "2025-12", kwh: 300 },
          { month: "2025-11", kwh: 300 },
          { month: "2025-10", kwh: 300 },
          { month: "2025-09", kwh: 300 },
          { month: "2025-08", kwh: 300 },
          { month: "2025-07", kwh: 300 },
          { month: "2025-06", kwh: 300 },
          { month: "2025-05", kwh: 0 },
        ],
        statementRanges: [
          { month: "2026-04", startDate: "2026-03-15", endDate: "2026-04-14" },
          { month: "2026-03", startDate: "2026-02-15", endDate: "2026-03-14" },
          { month: "2026-02", startDate: "2026-01-15", endDate: "2026-02-14" },
          { month: "2026-01", startDate: "2025-12-15", endDate: "2026-01-14" },
          { month: "2025-12", startDate: "2025-11-15", endDate: "2025-12-14" },
          { month: "2025-11", startDate: "2025-10-15", endDate: "2025-11-14" },
          { month: "2025-10", startDate: "2025-09-15", endDate: "2025-10-14" },
          { month: "2025-09", startDate: "2025-08-15", endDate: "2025-09-14" },
          { month: "2025-08", startDate: "2025-07-15", endDate: "2025-08-14" },
          { month: "2025-07", startDate: "2025-06-15", endDate: "2025-07-14" },
          { month: "2025-06", startDate: "2025-05-15", endDate: "2025-06-14" },
          { month: "2025-05", startDate: "2025-04-15", endDate: "2025-05-14" },
        ],
        travelRanges: [],
      },
      updatedAt: "2026-04-09T00:00:00.000Z",
    });

    const { POST } = await import("@/app/api/admin/tools/one-path-sim/route");
    const res = await POST(
      buildRequest({
        action: "run",
        email: "customer@example.com",
        houseId: "house-1",
        mode: "MANUAL_MONTHLY",
      })
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(adaptManualMonthlyRawInput).toHaveBeenCalledWith(
      expect.objectContaining({
        manualUsagePayload: expect.objectContaining({
          mode: "MONTHLY",
          anchorEndDate: "2026-04-14",
          dateSourceMode: "AUTO_DATES",
          monthlyKwh: expect.not.arrayContaining([expect.objectContaining({ kwh: 0 })]),
        }),
      })
    );
  });

  it("returns shared recalc requirement failures without masking the missing manual payload", async () => {
    getManualUsageInputForUserHouse.mockResolvedValueOnce({
      payload: { mode: "MONTHLY", anchorEndDate: "2026-03-31", monthlyKwh: [{ month: "2026-03", kwh: 500 }] },
      updatedAt: "2026-04-09T00:00:00.000Z",
    });
    runSharedSimulation.mockRejectedValueOnce(
      new SharedSimulationRunError({
        code: "requirements_unmet",
        missingItems: ["Save manual usage totals (monthly or annual)."],
      })
    );

    const { POST } = await import("@/app/api/admin/tools/one-path-sim/route");
    const res = await POST(
      buildRequest({
        action: "run",
        email: "customer@example.com",
        houseId: "house-1",
        mode: "MANUAL_MONTHLY",
      })
    );
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json).toEqual({
      ok: false,
      error: "requirements_unmet",
      missingItems: ["Save manual usage totals (monthly or annual)."],
      message: "requirements_unmet: Save manual usage totals (monthly or annual).",
    });
  });

  it("maps plain requirements_unmet errors to a structured 409 response", async () => {
    getManualUsageInputForUserHouse.mockResolvedValueOnce({
      payload: { mode: "MONTHLY", anchorEndDate: "2026-03-31", monthlyKwh: [{ month: "2026-03", kwh: 500 }] },
      updatedAt: "2026-04-09T00:00:00.000Z",
    });
    runSharedSimulation.mockRejectedValueOnce(new Error("requirements_unmet"));

    const { POST } = await import("@/app/api/admin/tools/one-path-sim/route");
    const res = await POST(
      buildRequest({
        action: "run",
        email: "customer@example.com",
        houseId: "house-1",
        mode: "MANUAL_MONTHLY",
      })
    );
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json).toEqual({
      ok: false,
      error: "requirements_unmet",
      missingItems: [],
      message: "requirements_unmet",
    });
  });

  it("routes manual save through the shared manual input store", async () => {
    saveManualUsageInputForUserHouse.mockResolvedValue({
      ok: true,
      updatedAt: "2026-04-09T00:00:00.000Z",
      payload: { mode: "ANNUAL", anchorEndDate: "2026-03-31", annualKwh: 9000, travelRanges: [] },
    });
    const { POST } = await import("@/app/api/admin/tools/one-path-sim/route");
    const res = await POST(
      buildRequest({
        action: "save_manual",
        email: "customer@example.com",
        houseId: "house-1",
        payload: { mode: "ANNUAL", anchorEndDate: "2026-03-31", annualKwh: 9000, travelRanges: [] },
      })
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(saveManualUsageInputForUserHouse).toHaveBeenCalledWith({
      userId: "user-1",
      houseId: "house-1",
      payload: { mode: "ANNUAL", anchorEndDate: "2026-03-31", annualKwh: 9000, travelRanges: [] },
    });
    expect(json.payload.mode).toBe("ANNUAL");
  });
});
