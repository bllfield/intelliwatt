import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const resolveOnePathUpstreamUsageTruthForSimulation = vi.fn();
const getOnePathManualUsageInput = vi.fn();
const resolveOnePathManualStageOnePresentation = vi.fn();
const buildOnePathDailyCurveComparePayload = vi.fn();
const buildOnePathValidationCompareProjectionSidecar = vi.fn();
const buildOnePathSharedPastSimDiagnostics = vi.fn();
const buildOnePathManualArtifactDecorations = vi.fn();
const runOnePathSimulatorBuild = vi.fn();
const readOnePathSimulatedUsageScenario = vi.fn();
const logSimPipelineEvent = vi.fn();
const prismaUsageSimulatorBuildFindUnique = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    usageSimulatorBuild: {
      findUnique: (...args: any[]) => prismaUsageSimulatorBuildFindUnique(...args),
    },
  },
}));

vi.mock("@/modules/homeProfile/repo", () => ({
  getHomeProfileSimulatedByUserHouse: vi.fn(),
}));

vi.mock("@/modules/applianceProfile/repo", () => ({
  getApplianceProfileSimulatedByUserHouse: vi.fn(),
}));

vi.mock("@/modules/applianceProfile/validation", () => ({
  normalizeStoredApplianceProfile: vi.fn((value: unknown) => value),
}));

vi.mock("@/modules/onePathSim/runtime", () => ({
  attachOnePathRunIdentityToEffectiveSimulationVariablesUsed: vi.fn((value: unknown) => value),
  buildOnePathDailyCurveComparePayload: (...args: any[]) => buildOnePathDailyCurveComparePayload(...args),
  buildOnePathManualBillPeriodTargets: vi.fn((payload: any) => payload?.statementRanges ?? []),
  buildOnePathSharedPastSimDiagnostics: (...args: any[]) => buildOnePathSharedPastSimDiagnostics(...args),
  buildOnePathValidationCompareProjectionSidecar: (...args: any[]) =>
    buildOnePathValidationCompareProjectionSidecar(...args),
  buildOnePathWeatherEfficiencyDerivedInput: vi.fn(() => null),
  getOnePathManualUsageInput: (...args: any[]) => getOnePathManualUsageInput(...args),
  resolveOnePathCanonicalUsage365CoverageWindow: vi.fn(() => ({
    startDate: "2025-05-01",
    endDate: "2026-04-30",
  })),
  resolveOnePathManualStageOnePresentation: (...args: any[]) => resolveOnePathManualStageOnePresentation(...args),
  resolveOnePathUpstreamUsageTruthForSimulation: (...args: any[]) =>
    resolveOnePathUpstreamUsageTruthForSimulation(...args),
  resolveOnePathWeatherSensitivityEnvelope: vi.fn(() => ({ score: null, derivedInput: null })),
}));

vi.mock("@/modules/onePathSim/manualArtifactDecorations", () => ({
  buildOnePathManualArtifactDecorations: (...args: any[]) => buildOnePathManualArtifactDecorations(...args),
}));

vi.mock("@/modules/onePathSim/onePathTruthSummary", () => ({
  buildOnePathTruthSummary: vi.fn(() => ({
    upstreamUsageTruth: null,
    stageBoundaryMap: null,
    sharedDerivedInputs: null,
    sourceTruthIdentity: null,
    constraintRebalance: null,
    donorFallbackExclusions: null,
    intradayReconstruction: null,
    finalSharedOutputContract: null,
    annualModeTruth: null,
    newBuildModeTruth: null,
  })),
}));

vi.mock("@/modules/onePathSim/serviceBridge", () => ({
  runOnePathSimulatorBuild: (...args: any[]) => runOnePathSimulatorBuild(...args),
  readOnePathSimulatedUsageScenario: (...args: any[]) => readOnePathSimulatedUsageScenario(...args),
}));

vi.mock("@/modules/onePathSim/usageSimulator/simObservability", () => ({
  getMemoryRssMb: vi.fn(() => 123),
  logSimPipelineEvent: (...args: any[]) => logSimPipelineEvent(...args),
}));

function buildUsageTruth(dataset: any, overrides?: Record<string, unknown>) {
  return {
    selectedHouse: { id: "house-1", esiid: "esiid-1" },
    actualContextHouse: { id: "actual-house-1", esiid: "esiid-actual-1" },
    dataset,
    alternatives: { smt: null, greenButton: null },
    usageTruthSource: "persisted_usage_output",
    seedResult: null,
    summary: {
      title: "Upstream Usage Truth",
      summary: "baseline passthrough source",
      currentRun: {},
      sharedOwners: [],
    },
    ...overrides,
  };
}

function buildBaseEngineInput(overrides?: Record<string, unknown>) {
  return {
    engineInputVersion: "one-path-sim-v1" as const,
    inputType: "INTERVAL" as const,
    simulatorMode: "SMT_BASELINE" as const,
    houseId: "house-1",
    actualContextHouseId: "actual-house-1",
    scenarioId: null,
    timezone: "America/Chicago",
    coverageWindowStart: "2025-05-01",
    coverageWindowEnd: "2026-04-30",
    canonicalMonths: ["2026-03", "2026-04"],
    canonicalEndMonth: "2026-04",
    anchorEndDate: "2026-04-30",
    billEndDay: 30,
    statementRanges: [],
    dateSourceMode: null,
    manualConstraintMode: "INTERVAL" as const,
    monthlyTotalsKwhByMonth: {},
    annualTargetKwh: null,
    manualBillPeriodTotalsKwhById: {},
    normalizedMonthTargetsByMonth: {},
    monthlyTargetConstructionDiagnostics: null,
    actualIntervalsReference: [],
    actualDailyReference: [],
    actualMonthlyReference: [],
    actualSource: "SMT",
    actualIntervalFingerprint: "fp-1",
    weatherIdentity: "wx-1",
    usageShapeIdentity: "shape-1",
    travelRanges: [],
    excludedDateKeysLocal: [],
    validationOnlyDateKeysLocal: [],
    validationSelectionMode: null,
    validationSelectionDiagnostics: null,
    homeProfile: null,
    applianceProfile: null,
    occupantProfile: null,
    poolProfile: null,
    evProfile: null,
    weatherPreference: "LAST_YEAR_WEATHER" as const,
    weatherLogicMode: "LAST_YEAR_ACTUAL_WEATHER" as const,
    weatherDaysReference: null,
    sharedProducerPathUsed: true as const,
    sourceDerivedMode: "persisted_usage_output",
    manualTravelVacantDonorPoolMode: null,
    weatherEfficiencyDerivedInput: null,
    upstreamUsageTruth: {
      title: "Upstream Usage Truth",
      summary: "baseline passthrough source",
      currentRun: {},
      sharedOwners: [],
    },
    runtime: {
      userId: "user-1",
      houseId: "house-1",
      esiid: "esiid-1",
      actualContextHouseId: "actual-house-1",
      mode: "SMT_BASELINE" as const,
      scenarioId: null,
      persistPastSimBaseline: true,
      weatherPreference: "LAST_YEAR_WEATHER" as const,
      validationOnlyDateKeysLocal: [],
      preLockboxTravelRanges: [],
      validationDaySelectionMode: null,
      validationDayCount: null,
      runContext: {
        callerLabel: "one_path_sim_admin",
      },
    },
    ...overrides,
  };
}

describe("one path baseline passthrough", () => {
  beforeEach(() => {
    resolveOnePathUpstreamUsageTruthForSimulation.mockReset();
    getOnePathManualUsageInput.mockReset();
    resolveOnePathManualStageOnePresentation.mockReset();
    buildOnePathDailyCurveComparePayload.mockReset();
    buildOnePathValidationCompareProjectionSidecar.mockReset();
    buildOnePathSharedPastSimDiagnostics.mockReset();
    buildOnePathManualArtifactDecorations.mockReset();
    runOnePathSimulatorBuild.mockReset();
    readOnePathSimulatedUsageScenario.mockReset();
    logSimPipelineEvent.mockReset();
    prismaUsageSimulatorBuildFindUnique.mockReset();

    buildOnePathValidationCompareProjectionSidecar.mockReturnValue({
      rows: [],
      metrics: { mode: "baseline" },
    });
    buildOnePathDailyCurveComparePayload.mockReturnValue({
      actualIntervals15: [{ timestamp: "2026-04-01T00:00:00.000Z", kwh: 0.11 }],
      simulatedIntervals15: [{ timestamp: "2026-04-01T00:00:00.000Z", kwh: 0.22 }],
      simulatedDailyRows: [{ date: "2026-04-01", kwh: 8.4 }],
    });
    buildOnePathSharedPastSimDiagnostics.mockReturnValue({
      lockboxExecutionSummary: {
        sharedProducerPathUsed: false,
        baselinePassthrough: true,
      },
    });
    buildOnePathManualArtifactDecorations.mockResolvedValue({
      manualMonthlyReconciliation: { rows: [] },
      manualParitySummary: { overallParityReady: true },
      sharedDiagnostics: {
        lockboxExecutionSummary: {
          sharedProducerPathUsed: false,
          baselinePassthrough: true,
        },
      },
    });
    resolveOnePathManualStageOnePresentation.mockReturnValue({
      mode: "MONTHLY",
      surface: "admin_manual_monthly_stage_one",
      rows: [],
    });
    prismaUsageSimulatorBuildFindUnique.mockResolvedValue({
      id: "build-1",
      buildInputsHash: "build-hash-1",
      createdAt: new Date("2026-04-17T00:00:00.000Z"),
      updatedAt: new Date("2026-04-17T00:00:00.000Z"),
    });
  });

  it("reuses upstream interval usage truth for baseline and skips synthetic recalc", async () => {
    const upstreamDataset = {
      summary: {
        source: "SMT",
        totalKwh: 222,
        start: "2026-03-01",
        end: "2026-04-30",
        latest: "2026-04-30",
      },
      daily: [{ date: "2026-04-01", kwh: 7.4 }],
      monthly: [
        { month: "2026-03", kwh: 110 },
        { month: "2026-04", kwh: 112 },
      ],
      series: {
        intervals15: [{ timestamp: "2026-04-01T00:00:00.000Z", kwh: 0.25 }],
      },
      meta: {
        datasetKind: "ACTUAL",
        actualSource: "SMT",
        canonicalMonths: ["2026-03", "2026-04"],
      },
    };
    resolveOnePathUpstreamUsageTruthForSimulation.mockResolvedValue(
      buildUsageTruth(upstreamDataset)
    );

    const { runSharedSimulation } = await import("@/modules/onePathSim/onePathSim");
    const artifact = await runSharedSimulation(buildBaseEngineInput());

    expect(runOnePathSimulatorBuild).not.toHaveBeenCalled();
    expect(readOnePathSimulatedUsageScenario).not.toHaveBeenCalled();
    expect(resolveOnePathUpstreamUsageTruthForSimulation).toHaveBeenCalledWith({
      userId: "user-1",
      houseId: "house-1",
      actualContextHouseId: "actual-house-1",
      seedIfMissing: true,
    });
    expect(artifact.dataset.summary.source).toBe("SMT");
    expect(artifact.dataset.daily).toEqual(upstreamDataset.daily);
    expect(artifact.dataset.monthly).toEqual(upstreamDataset.monthly);
    expect(artifact.dataset.series.intervals15).toEqual(upstreamDataset.series.intervals15);
    expect(artifact.dataset.meta.baselinePassthrough).toBe(true);
    expect(artifact.dataset.series.intervals15).toHaveLength(1);
    expect(logSimPipelineEvent).toHaveBeenCalledWith(
      "baseline_dataset_passthrough_success",
      expect.objectContaining({
        mode: "SMT_BASELINE",
        inputType: "INTERVAL",
      })
    );
  });

  it("reuses saved manual monthly truth for baseline without drifting to normalized engine input values", async () => {
    resolveOnePathUpstreamUsageTruthForSimulation.mockResolvedValue(
      buildUsageTruth({
        summary: {
          source: "SMT",
          totalKwh: 480,
          start: "2026-03-01",
          end: "2026-04-30",
          latest: "2026-04-30",
        },
        daily: [],
        monthly: [],
        series: { intervals15: [] },
        meta: { datasetKind: "ACTUAL" },
      })
    );
    getOnePathManualUsageInput.mockResolvedValue({
      payload: {
        mode: "MONTHLY",
        anchorEndDate: "2026-04-30",
        monthlyKwh: [
          { month: "2026-03", kwh: 210 },
          { month: "2026-04", kwh: 270 },
        ],
        statementRanges: [
          { id: "apr", month: "2026-04", startDate: "2026-04-01", endDate: "2026-04-30", kwh: 270 },
          { id: "mar", month: "2026-03", startDate: "2026-03-01", endDate: "2026-03-31", kwh: 210 },
        ],
      },
    });
    resolveOnePathManualStageOnePresentation.mockReturnValue({
      mode: "MONTHLY",
      surface: "admin_manual_monthly_stage_one",
      rows: [{ month: "2026-03", kwh: 210 }, { month: "2026-04", kwh: 270 }],
    });

    const { runSharedSimulation } = await import("@/modules/onePathSim/onePathSim");
    const artifact = await runSharedSimulation(
      buildBaseEngineInput({
        inputType: "MANUAL_MONTHLY",
        simulatorMode: "MANUAL_TOTALS",
        manualConstraintMode: "MANUAL_MONTHLY",
        monthlyTotalsKwhByMonth: {
          "2026-03": 999,
          "2026-04": 888,
        },
        statementRanges: [
          { id: "apr", month: "2026-04", startDate: "2026-04-05", endDate: "2026-04-29", kwh: 888 },
          { id: "mar", month: "2026-03", startDate: "2026-03-05", endDate: "2026-03-29", kwh: 999 },
        ],
        manualBillPeriodTotalsKwhById: {
          apr: 888,
          mar: 999,
        },
        runtime: {
          ...buildBaseEngineInput().runtime,
          mode: "MANUAL_TOTALS",
        },
      })
    );

    expect(runOnePathSimulatorBuild).not.toHaveBeenCalled();
    expect(getOnePathManualUsageInput).toHaveBeenCalledWith({
      userId: "user-1",
      houseId: "house-1",
    });
    expect(artifact.dataset.summary.source).toBe("MANUAL");
    expect(artifact.dataset.monthly).toEqual([
      { month: "2026-03", kwh: 210 },
      { month: "2026-04", kwh: 270 },
    ]);
    expect(artifact.dataset.series.intervals15).toEqual([]);
    expect(artifact.dataset.meta.baselinePassthroughMode).toBe("MANUAL_MONTHLY");
    expect(artifact.dataset.meta.statementRanges).toEqual([
      { id: "apr", month: "2026-04", startDate: "2026-04-01", endDate: "2026-04-30", kwh: 270 },
      { id: "mar", month: "2026-03", startDate: "2026-03-01", endDate: "2026-03-31", kwh: 210 },
    ]);
    expect(artifact.manualBillPeriodTotalsKwhById).toEqual({
      apr: 270,
      mar: 210,
    });
  });

  it("reuses saved manual annual truth for baseline without drifting to normalized engine input coverage", async () => {
    resolveOnePathUpstreamUsageTruthForSimulation.mockResolvedValue(
      buildUsageTruth({
        summary: {
          source: "SMT",
          totalKwh: 999,
          start: "2025-05-01",
          end: "2026-04-30",
          latest: "2026-04-30",
        },
        daily: [],
        monthly: [],
        series: { intervals15: [] },
        meta: { datasetKind: "ACTUAL" },
      })
    );
    getOnePathManualUsageInput.mockResolvedValue({
      payload: {
        mode: "ANNUAL",
        anchorEndDate: "2026-02-15",
        annualKwh: 12345,
        statementRanges: [],
      },
    });
    resolveOnePathManualStageOnePresentation.mockReturnValue({
      mode: "ANNUAL",
      surface: "admin_manual_monthly_stage_one",
      summary: { annualKwh: 12345 },
    });

    const { runSharedSimulation } = await import("@/modules/onePathSim/onePathSim");
    const artifact = await runSharedSimulation(
      buildBaseEngineInput({
        inputType: "MANUAL_ANNUAL",
        simulatorMode: "MANUAL_TOTALS",
        manualConstraintMode: "MANUAL_ANNUAL",
        annualTargetKwh: 99999,
        anchorEndDate: "2026-04-30",
        runtime: {
          ...buildBaseEngineInput().runtime,
          mode: "MANUAL_TOTALS",
        },
      })
    );

    expect(runOnePathSimulatorBuild).not.toHaveBeenCalled();
    expect(artifact.dataset.summary.totalKwh).toBe(12345);
    expect(artifact.dataset.summary.end).toBe("2026-02-15");
    expect(artifact.dataset.summary.latest).toBe("2026-02-15");
    expect(artifact.dataset.monthly).toEqual([]);
    expect(artifact.dataset.series.intervals15).toEqual([]);
    expect(artifact.dataset.meta.baselinePassthroughMode).toBe("MANUAL_ANNUAL");
    expect(artifact.dataset.meta.coverageEnd).toBe("2026-02-15");
  });

  it("fails baseline only when upstream usage truth still cannot be obtained", async () => {
    resolveOnePathUpstreamUsageTruthForSimulation.mockResolvedValue(
      buildUsageTruth(null, {
        dataset: null,
        usageTruthSource: "missing_usage_truth",
        seedResult: {
          ok: false,
          homeId: "actual-house-1",
          message: "refresh failed",
        },
      })
    );

    const { runSharedSimulation, UpstreamUsageTruthMissingError } = await import("@/modules/onePathSim/onePathSim");

    await expect(runSharedSimulation(buildBaseEngineInput())).rejects.toBeInstanceOf(
      UpstreamUsageTruthMissingError
    );
    expect(runOnePathSimulatorBuild).not.toHaveBeenCalled();
    expect(logSimPipelineEvent).toHaveBeenCalledWith(
      "baseline_dataset_passthrough_failure",
      expect.objectContaining({
        failureMessage: "baseline_upstream_usage_truth_missing_after_seed",
      })
    );
  });

  it("keeps Past runs on the existing shared simulation path", async () => {
    resolveOnePathUpstreamUsageTruthForSimulation.mockResolvedValue(
      buildUsageTruth({
        summary: {
          source: "SMT",
          totalKwh: 222,
          start: "2026-03-01",
          end: "2026-04-30",
          latest: "2026-04-30",
        },
        daily: [],
        monthly: [],
        series: { intervals15: [] },
        meta: { datasetKind: "SIMULATED", artifactInputHash: "artifact-hash-1", engineVersion: "past-v1" },
      })
    );
    runOnePathSimulatorBuild.mockResolvedValue({
      ok: true,
      canonicalArtifactInputHash: "artifact-hash-1",
    });
    readOnePathSimulatedUsageScenario.mockResolvedValue({
      ok: true,
      dataset: {
        summary: {
          source: "SIMULATED",
          totalKwh: 240,
          start: "2026-03-01",
          end: "2026-04-30",
          latest: "2026-04-30",
        },
        daily: [{ date: "2026-04-01", kwh: 8 }],
        monthly: [{ month: "2026-04", kwh: 240 }],
        series: {
          intervals15: [{ timestamp: "2026-04-01T00:00:00.000Z", kwh: 0.25 }],
        },
        meta: {
          artifactInputHash: "artifact-hash-1",
          engineVersion: "past-v1",
          manualBillPeriodTotalsKwhById: {},
        },
      },
    });

    const { runSharedSimulation } = await import("@/modules/onePathSim/onePathSim");
    const artifact = await runSharedSimulation(
      buildBaseEngineInput({
        scenarioId: "past-scenario-1",
        runtime: {
          ...buildBaseEngineInput().runtime,
          scenarioId: "past-scenario-1",
        },
      })
    );

    expect(runOnePathSimulatorBuild).toHaveBeenCalledTimes(1);
    expect(readOnePathSimulatedUsageScenario).toHaveBeenCalledTimes(1);
    expect(artifact.dataset.summary.source).toBe("SIMULATED");
  });

  it("suppresses Past Sim-only curve compare payloads for baseline read models", async () => {
    resolveOnePathUpstreamUsageTruthForSimulation.mockResolvedValue(
      buildUsageTruth({
        summary: {
          source: "SMT",
          totalKwh: 222,
          start: "2026-03-01",
          end: "2026-04-30",
          latest: "2026-04-30",
        },
        daily: [{ date: "2026-04-01", kwh: 7.4 }],
        monthly: [{ month: "2026-04", kwh: 222 }],
        series: {
          intervals15: [{ timestamp: "2026-04-01T00:00:00.000Z", kwh: 0.25 }],
        },
        meta: { datasetKind: "ACTUAL" },
      })
    );

    const { runSharedSimulation, buildSharedSimulationReadModel } = await import("@/modules/onePathSim/onePathSim");
    const artifact = await runSharedSimulation(buildBaseEngineInput());
    const readModel = buildSharedSimulationReadModel(artifact);

    expect(buildOnePathDailyCurveComparePayload).not.toHaveBeenCalled();
    expect(readModel.curveCompareActualIntervals15).toEqual([]);
    expect(readModel.curveCompareSimulatedIntervals15).toEqual([]);
    expect(readModel.curveCompareSimulatedDailyRows).toEqual([]);
  });

  it("keeps Past Sim-only curve compare payloads on Past read models", async () => {
    resolveOnePathUpstreamUsageTruthForSimulation.mockResolvedValue(
      buildUsageTruth({
        summary: {
          source: "SMT",
          totalKwh: 222,
          start: "2026-03-01",
          end: "2026-04-30",
          latest: "2026-04-30",
        },
        daily: [],
        monthly: [],
        series: { intervals15: [] },
        meta: { datasetKind: "ACTUAL" },
      })
    );
    runOnePathSimulatorBuild.mockResolvedValue({
      ok: true,
      canonicalArtifactInputHash: "artifact-hash-1",
    });
    readOnePathSimulatedUsageScenario.mockResolvedValue({
      ok: true,
      dataset: {
        summary: {
          source: "SIMULATED",
          totalKwh: 240,
          start: "2026-03-01",
          end: "2026-04-30",
          latest: "2026-04-30",
        },
        daily: [{ date: "2026-04-01", kwh: 8 }],
        monthly: [{ month: "2026-04", kwh: 240 }],
        series: {
          intervals15: [{ timestamp: "2026-04-01T00:00:00.000Z", kwh: 0.25 }],
        },
        meta: {
          artifactInputHash: "artifact-hash-1",
          engineVersion: "past-v1",
          manualBillPeriodTotalsKwhById: {},
        },
      },
    });

    const { runSharedSimulation, buildSharedSimulationReadModel } = await import("@/modules/onePathSim/onePathSim");
    const artifact = await runSharedSimulation(
      buildBaseEngineInput({
        scenarioId: "past-scenario-1",
        runtime: {
          ...buildBaseEngineInput().runtime,
          scenarioId: "past-scenario-1",
        },
      })
    );
    const readModel = buildSharedSimulationReadModel(artifact);

    expect(buildOnePathDailyCurveComparePayload).toHaveBeenCalledTimes(1);
    expect(readModel.curveCompareActualIntervals15).toEqual([{ timestamp: "2026-04-01T00:00:00.000Z", kwh: 0.11 }]);
    expect(readModel.curveCompareSimulatedIntervals15).toEqual([
      { timestamp: "2026-04-01T00:00:00.000Z", kwh: 0.22 },
    ]);
    expect(readModel.curveCompareSimulatedDailyRows).toEqual([{ date: "2026-04-01", kwh: 8.4 }]);
  });
});
