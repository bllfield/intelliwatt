import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const resolveOnePathUpstreamUsageTruthForSimulation = vi.fn();
const getOnePathManualUsageInput = vi.fn();
const resolveOnePathManualStageOnePresentation = vi.fn();
const buildOnePathDailyCurveComparePayload = vi.fn();
const buildOnePathValidationCompareProjectionSidecar = vi.fn();
const buildOnePathSharedPastSimDiagnostics = vi.fn();
const buildOnePathManualArtifactDecorations = vi.fn();
const resolveOnePathCanonicalUsage365CoverageWindow = vi.fn();
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
  resolveOnePathCanonicalUsage365CoverageWindow: (...args: any[]) =>
    resolveOnePathCanonicalUsage365CoverageWindow(...args),
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
    resolveOnePathCanonicalUsage365CoverageWindow.mockReset();
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
    resolveOnePathCanonicalUsage365CoverageWindow.mockReturnValue({
      startDate: "2025-05-01",
      endDate: "2026-04-30",
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
    expect(resolveOnePathUpstreamUsageTruthForSimulation).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        houseId: "house-1",
        actualContextHouseId: "actual-house-1",
        seedIfMissing: true,
      })
    );
    expect(artifact.dataset.summary.source).toBe("SMT");
    expect(artifact.dataset.daily).toEqual(upstreamDataset.daily);
    expect(artifact.dataset.monthly).toEqual([{ month: "2026-04", kwh: 7.4 }]);
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

  it("uses the normalized engine-input coverage window while preserving upstream interval counts", async () => {
    const upstreamDataset = {
      summary: {
        source: "SMT",
        totalKwh: 13546.27,
        start: "2025-04-14",
        end: "2026-04-14",
        latest: "2026-04-14T23:45:00.000Z",
        intervalsCount: 34823,
      },
      daily: [{ date: "2026-04-14", kwh: 31.2 }],
      monthly: [{ month: "2026-04", kwh: 1110 }],
      series: {
        intervals15: [{ timestamp: "2026-04-14T23:45:00.000Z", kwh: 0.3 }],
      },
      meta: {
        datasetKind: "ACTUAL",
        actualSource: "SMT",
      },
    };
    resolveOnePathUpstreamUsageTruthForSimulation.mockResolvedValue(buildUsageTruth(upstreamDataset));

    const { runSharedSimulation } = await import("@/modules/onePathSim/onePathSim");
    const artifact = await runSharedSimulation(
      buildBaseEngineInput({
        coverageWindowStart: "2025-04-15",
        coverageWindowEnd: "2026-04-14",
      })
    );

    expect(artifact.dataset.summary.intervalsCount).toBe(34823);
    expect(artifact.dataset.series.intervals15).toHaveLength(1);
    expect(artifact.dataset.summary.start).toBe("2025-04-15");
    expect(artifact.dataset.summary.end).toBe("2026-04-14");
    expect(artifact.dataset.meta.coverageStart).toBe("2025-04-15");
    expect(artifact.dataset.meta.coverageEnd).toBe("2026-04-14");
    expect(artifact.dataset.meta.upstreamDatasetSummaryStart).toBe("2025-04-14");
    expect(artifact.dataset.meta.upstreamDatasetSummaryEnd).toBe("2026-04-14");
    expect(artifact.dataset.meta.baselineCoverageDisplayOwner).toBe("engineInput.coverageWindowStart/coverageWindowEnd");
    expect(runOnePathSimulatorBuild).not.toHaveBeenCalled();
  });

  it("bounds Green Button baseline passthrough rows and insights to the engine-input coverage window", async () => {
    const upstreamDataset = {
      summary: {
        source: "GREEN_BUTTON",
        totalKwh: 9999,
        start: "2024-12-01",
        end: "2025-12-31",
        latest: "2025-12-31T23:45:00.000Z",
        intervalsCount: 4,
      },
      daily: [
        { date: "2025-04-25", kwh: 10 },
        { date: "2025-04-26", kwh: 20 },
        { date: "2025-04-27", kwh: 30 },
        { date: "2025-12-31", kwh: 40 },
      ],
      monthly: [
        { month: "2024-12", kwh: 500 },
        { month: "2025-04", kwh: 1000 },
        { month: "2025-12", kwh: 2000 },
      ],
      series: {
        intervals15: [
          { timestamp: "2025-04-25T05:00:00.000Z", kwh: 1 },
          { timestamp: "2025-04-26T12:00:00.000Z", kwh: 2 },
          { timestamp: "2025-04-27T01:00:00.000Z", kwh: 3 },
          { timestamp: "2025-12-31T20:00:00.000Z", kwh: 4 },
        ],
      },
      meta: {
        datasetKind: "ACTUAL",
        actualSource: "GREEN_BUTTON",
        timezone: "America/Chicago",
      },
    };
    resolveOnePathUpstreamUsageTruthForSimulation.mockResolvedValue(buildUsageTruth(upstreamDataset));

    const { runSharedSimulation } = await import("@/modules/onePathSim/onePathSim");
    const artifact = await runSharedSimulation(
      buildBaseEngineInput({
        inputType: "GREEN_BUTTON",
        manualConstraintMode: "GREEN_BUTTON",
        coverageWindowStart: "2024-12-01",
        coverageWindowEnd: "2025-12-31",
      })
    );

    expect(artifact.dataset.summary.start).toBe("2024-12-01");
    expect(artifact.dataset.summary.end).toBe("2025-12-31");
    expect(artifact.dataset.summary.totalKwh).toBe(100);
    expect(artifact.dataset.daily).toEqual([
      { date: "2025-04-25", kwh: 10 },
      { date: "2025-04-26", kwh: 20 },
      { date: "2025-04-27", kwh: 30 },
      { date: "2025-12-31", kwh: 40 },
    ]);
    expect(artifact.dataset.monthly).toEqual([
      { month: "2025-04", kwh: 60 },
      { month: "2025-12", kwh: 40 },
    ]);
    expect(artifact.dataset.totals).toEqual({
      importKwh: 100,
      exportKwh: 0,
      netKwh: 100,
    });
    expect(artifact.dataset.series.intervals15).toEqual([
      { timestamp: "2025-04-25T05:00:00.000Z", kwh: 1 },
      { timestamp: "2025-04-26T12:00:00.000Z", kwh: 2 },
      { timestamp: "2025-04-27T01:00:00.000Z", kwh: 3 },
      { timestamp: "2025-12-31T20:00:00.000Z", kwh: 4 },
    ]);
    expect(artifact.dataset.insights.weekdayVsWeekend).toEqual({
      weekday: 50,
      weekend: 50,
    });
    expect(artifact.dataset.insights.timeOfDayBuckets).toEqual([
      { key: "overnight", label: "Overnight (12am–6am)", kwh: 1 },
      { key: "morning", label: "Morning (6am–12pm)", kwh: 2 },
      { key: "afternoon", label: "Afternoon (12pm–6pm)", kwh: 4 },
      { key: "evening", label: "Evening (6pm–12am)", kwh: 3 },
    ]);
    expect(artifact.dataset.meta.coverageStart).toBe("2024-12-01");
    expect(artifact.dataset.meta.coverageEnd).toBe("2025-12-31");
    expect(artifact.dataset.meta.baselineCoverageDisplayOwner).toBe("engineInput.coverageWindowStart/coverageWindowEnd");
  });

  it("keeps Green Button baseline on the uploaded file's full persisted 365-day window when available", async () => {
    const upstreamDataset = {
      summary: {
        source: "GREEN_BUTTON",
        totalKwh: 3650,
        start: "2024-12-02",
        end: "2025-12-01",
        latest: "2025-12-01T23:45:00.000Z",
        intervalsCount: 35040,
      },
      daily: [
        { date: "2024-12-02", kwh: 10 },
        { date: "2025-06-01", kwh: 20 },
        { date: "2025-12-01", kwh: 30 },
      ],
      monthly: [
      { month: "2025-04", kwh: 50 },
        { month: "2025-06", kwh: 20 },
        { month: "2025-12", kwh: 30 },
      ],
      series: {
        intervals15: [],
      },
      meta: {
        datasetKind: "ACTUAL",
        actualSource: "GREEN_BUTTON",
        timezone: "America/Chicago",
      },
    };
    resolveOnePathUpstreamUsageTruthForSimulation.mockResolvedValue(buildUsageTruth(upstreamDataset));

    const { runSharedSimulation } = await import("@/modules/onePathSim/onePathSim");
    const artifact = await runSharedSimulation(
      buildBaseEngineInput({
        inputType: "GREEN_BUTTON",
        manualConstraintMode: "GREEN_BUTTON",
        coverageWindowStart: "2024-12-02",
        coverageWindowEnd: "2025-12-01",
      })
    );

    expect(artifact.dataset.summary.start).toBe("2024-12-02");
    expect(artifact.dataset.summary.end).toBe("2025-12-01");
    expect(artifact.dataset.daily[0]).toEqual({ date: "2024-12-02", kwh: 10 });
    expect(artifact.dataset.daily[artifact.dataset.daily.length - 1]).toEqual({ date: "2025-12-01", kwh: 30 });
    expect(artifact.dataset.meta.upstreamDatasetSummaryStart).toBe("2024-12-02");
    expect(artifact.dataset.meta.upstreamDatasetSummaryEnd).toBe("2025-12-01");
  });

  it("keeps persisted time-of-day buckets for Green Button baseline when interval series is only a recent preview", async () => {
    const upstreamDataset = {
      summary: {
        source: "GREEN_BUTTON",
        totalKwh: 9545.8,
        start: "2025-04-28",
        end: "2025-12-01",
        latest: "2025-12-02T00:00:00.000Z",
        intervalsCount: 31488,
      },
      daily: [
        { date: "2025-12-01", kwh: 9545.8 },
      ],
      monthly: [{ month: "2025-12", kwh: 9545.8 }],
      insights: {
        timeOfDayBuckets: [
          { key: "overnight", label: "Overnight (12am–6am)", kwh: 1200 },
          { key: "morning", label: "Morning (6am–12pm)", kwh: 2400 },
          { key: "afternoon", label: "Afternoon (12pm–6pm)", kwh: 3600 },
          { key: "evening", label: "Evening (6pm–12am)", kwh: 2345.8 },
        ],
      },
      series: {
        intervals15: [
          { timestamp: "2025-12-01T00:00:00.000Z", kwh: 0.5 },
          { timestamp: "2025-12-01T00:15:00.000Z", kwh: 0.75 },
        ],
      },
      meta: {
        datasetKind: "ACTUAL",
        actualSource: "GREEN_BUTTON",
        timezone: "America/Chicago",
      },
    };
    resolveOnePathUpstreamUsageTruthForSimulation.mockResolvedValue(buildUsageTruth(upstreamDataset));

    const { runSharedSimulation } = await import("@/modules/onePathSim/onePathSim");
    const artifact = await runSharedSimulation(
      buildBaseEngineInput({
        inputType: "GREEN_BUTTON",
        manualConstraintMode: "GREEN_BUTTON",
        coverageWindowStart: "2025-04-28",
        coverageWindowEnd: "2025-12-01",
      })
    );

    expect(artifact.dataset.insights.timeOfDayBuckets).toEqual(upstreamDataset.insights.timeOfDayBuckets);
  });

  it("drops preview-only Green Button time-of-day buckets when they do not match full-window totals", async () => {
    const upstreamDataset = {
      summary: {
        source: "GREEN_BUTTON",
        totalKwh: 19433.91,
        start: "2024-12-02",
        end: "2025-12-01",
        latest: "2025-12-01T23:00:00.000Z",
        intervalsCount: 31560,
      },
      daily: [
        { date: "2024-12-02", kwh: 35.73 },
        { date: "2025-12-01", kwh: 54.89 },
      ],
      monthly: [{ month: "2025-12", kwh: 54.89 }],
      insights: {
        timeOfDayBuckets: [
          { key: "overnight", label: "Overnight (12am–6am)", kwh: 17.11 },
          { key: "morning", label: "Morning (6am–12pm)", kwh: 45.18 },
          { key: "afternoon", label: "Afternoon (12pm–6pm)", kwh: 41.63 },
          { key: "evening", label: "Evening (6pm–12am)", kwh: 17.41 },
        ],
      },
      series: {
        intervals15: [
          { timestamp: "2025-12-01T00:00:00.000Z", kwh: 0.5 },
          { timestamp: "2025-12-01T00:15:00.000Z", kwh: 0.75 },
        ],
      },
      meta: {
        datasetKind: "ACTUAL",
        actualSource: "GREEN_BUTTON",
        timezone: "America/Chicago",
      },
    };
    resolveOnePathUpstreamUsageTruthForSimulation.mockResolvedValue(buildUsageTruth(upstreamDataset));

    const { runSharedSimulation } = await import("@/modules/onePathSim/onePathSim");
    const artifact = await runSharedSimulation(
      buildBaseEngineInput({
        inputType: "GREEN_BUTTON",
        manualConstraintMode: "GREEN_BUTTON",
        coverageWindowStart: "2024-12-02",
        coverageWindowEnd: "2025-12-01",
      })
    );

    expect(artifact.dataset.insights.timeOfDayBuckets).toEqual([]);
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

  it("keeps manual monthly baseline on Stage 1 truth even when no saved payload exists", async () => {
    resolveOnePathUpstreamUsageTruthForSimulation.mockResolvedValue(
      buildUsageTruth({
        summary: {
          source: "SMT",
          totalKwh: 480,
          start: "2026-03-01",
          end: "2026-04-30",
          latest: "2026-04-30",
        },
        daily: [{ date: "2026-04-01", kwh: 10 }],
        monthly: [{ month: "2026-04", kwh: 300 }],
        series: { intervals15: [{ timestamp: "2026-04-01T00:00:00.000Z", kwh: 0.25 }] },
        meta: { datasetKind: "ACTUAL" },
      })
    );
    getOnePathManualUsageInput.mockResolvedValue({ payload: null });
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
          "2026-03": 210,
          "2026-04": 270,
        },
        statementRanges: [
          { id: "apr", month: "2026-04", startDate: "2026-04-01", endDate: "2026-04-30", kwh: 270 },
          { id: "mar", month: "2026-03", startDate: "2026-03-01", endDate: "2026-03-31", kwh: 210 },
        ],
        dateSourceMode: "AUTO_DATES",
        travelRanges: [{ startDate: "2026-03-10", endDate: "2026-03-12" }],
        actualIntervalsReference: [{ timestamp: "2026-04-01T00:00:00.000Z", kwh: 0.25 }],
        actualDailyReference: [{ date: "2026-04-01", kwh: 10 }],
        runtime: {
          ...buildBaseEngineInput().runtime,
          mode: "MANUAL_TOTALS",
        },
      })
    );

    expect(runOnePathSimulatorBuild).not.toHaveBeenCalled();
    expect(artifact.dataset.summary.source).toBe("MANUAL");
    expect(artifact.dataset.monthly).toEqual([
      { month: "2026-03", kwh: 210 },
      { month: "2026-04", kwh: 270 },
    ]);
    expect(artifact.dataset.daily).toEqual([]);
    expect(artifact.dataset.series.intervals15).toEqual([]);
    expect(artifact.dataset.meta.statementRanges).toEqual([
      { month: "2026-04", startDate: "2026-04-01", endDate: "2026-04-30" },
      { month: "2026-03", startDate: "2026-03-01", endDate: "2026-03-31" },
    ]);
    expect(buildOnePathManualArtifactDecorations).toHaveBeenCalledWith(
      expect.objectContaining({
        manualUsagePayload: {
          mode: "MONTHLY",
          anchorEndDate: "2026-04-30",
          dateSourceMode: "AUTO_DATES",
          monthlyKwh: [
            { month: "2026-03", kwh: 210 },
            { month: "2026-04", kwh: 270 },
          ],
          statementRanges: [
            { month: "2026-04", startDate: "2026-04-01", endDate: "2026-04-30" },
            { month: "2026-03", startDate: "2026-03-01", endDate: "2026-03-31" },
          ],
          travelRanges: [{ startDate: "2026-03-10", endDate: "2026-03-12" }],
        },
      })
    );
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

  it("falls back to derived manual annual Stage 1 truth when the saved annual payload is blank", async () => {
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
        anchorEndDate: "",
        annualKwh: Number.NaN,
        statementRanges: [],
      },
    });
    resolveOnePathManualStageOnePresentation.mockImplementation(({ payload }: { payload?: any }) => {
      if (payload?.mode !== "ANNUAL") return null;
      if (payload?.anchorEndDate === "2026-04-30" && payload?.annualKwh === 12345) {
        return {
          mode: "ANNUAL",
          surface: "admin_manual_monthly_stage_one",
          summary: {
            key: "annual:2026-04-30",
            startDate: "2025-05-01",
            endDate: "2026-04-30",
            anchorEndDate: "2026-04-30",
            label: "5/1/25 - 4/30/26",
            shortLabel: "5/1/25-4/30/26",
            annualKwh: 12345,
          },
        };
      }
      return null;
    });

    const { runSharedSimulation } = await import("@/modules/onePathSim/onePathSim");
    const artifact = await runSharedSimulation(
      buildBaseEngineInput({
        inputType: "MANUAL_ANNUAL",
        simulatorMode: "MANUAL_TOTALS",
        manualConstraintMode: "MANUAL_ANNUAL",
        annualTargetKwh: 12345,
        anchorEndDate: "2026-04-30",
        runtime: {
          ...buildBaseEngineInput().runtime,
          mode: "MANUAL_TOTALS",
        },
      })
    );

    expect(runOnePathSimulatorBuild).not.toHaveBeenCalled();
    expect(artifact.dataset.summary.totalKwh).toBe(12345);
    expect(artifact.dataset.summary.end).toBe("2026-04-30");
    expect(buildOnePathManualArtifactDecorations).toHaveBeenCalledWith(
      expect.objectContaining({
        manualUsagePayload: {
          mode: "ANNUAL",
          anchorEndDate: "2026-04-30",
          annualKwh: 12345,
          travelRanges: [],
        },
      })
    );
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

  it("keeps manual monthly baseline runnable when only manual usage truth exists", async () => {
    resolveOnePathUpstreamUsageTruthForSimulation.mockResolvedValue(
      buildUsageTruth(null, {
        dataset: null,
        usageTruthSource: "missing_usage_truth",
        seedResult: null,
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
          { month: "2026-04", startDate: "2026-04-01", endDate: "2026-04-30" },
          { month: "2026-03", startDate: "2026-03-01", endDate: "2026-03-31" },
        ],
        travelRanges: [],
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
          "2026-03": 210,
          "2026-04": 270,
        },
        runtime: {
          ...buildBaseEngineInput().runtime,
          mode: "MANUAL_TOTALS",
        },
      })
    );

    expect(resolveOnePathUpstreamUsageTruthForSimulation).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        houseId: "house-1",
        actualContextHouseId: "actual-house-1",
        seedIfMissing: false,
      })
    );
    expect(artifact.dataset.summary.source).toBe("MANUAL");
    expect(artifact.dataset.meta.usageTruthSource).toBe("missing_usage_truth");
    expect(artifact.dataset.monthly).toEqual([
      { month: "2026-03", kwh: 210 },
      { month: "2026-04", kwh: 270 },
    ]);
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

  it("preserves stitched source monthly rows for baseline passthrough datasets", async () => {
    resolveOnePathUpstreamUsageTruthForSimulation.mockResolvedValue(
      buildUsageTruth({
        summary: {
          source: "GREEN_BUTTON",
          totalKwh: 2008.86,
          start: "2025-04-15",
          end: "2026-04-14",
          latest: "2026-04-14T23:45:00.000Z",
        },
        daily: [{ date: "2026-04-14", kwh: 8.4, source: "ACTUAL", sourceDetail: "GREEN_BUTTON" }],
        monthly: [
          { month: "2025-04", kwh: 717.2 },
          { month: "2025-05", kwh: 1286.66 },
          { month: "2026-04", kwh: 4.99 },
        ],
        insights: {
          stitchedMonth: {
            mode: "PRIOR_YEAR_TAIL",
            yearMonth: "2026-04",
            haveDaysThrough: 14,
            missingDaysFrom: 15,
            missingDaysTo: 30,
            borrowedFromYearMonth: "2025-04",
            completenessRule: "ACTUAL_USAGE_WINDOW",
          },
        },
        series: {
          intervals15: [{ timestamp: "2026-04-14T00:00:00.000Z", kwh: 0.25 }],
        },
        meta: {
          datasetKind: "ACTUAL",
          actualSource: "GREEN_BUTTON",
          canonicalMonths: ["2025-05", "2026-04"],
          canonicalEndMonth: "2026-04",
        },
      })
    );

    const { runSharedSimulation } = await import("@/modules/onePathSim/onePathSim");
    const artifact = await runSharedSimulation(
      buildBaseEngineInput({
        actualSource: "GREEN_BUTTON",
        simulatorMode: "GREEN_BUTTON",
        coverageWindowStart: "2025-04-15",
        coverageWindowEnd: "2026-04-14",
        canonicalMonths: ["2025-05", "2026-04"],
        canonicalEndMonth: "2026-04",
        anchorEndDate: "2026-04-14",
        runtime: {
          ...buildBaseEngineInput().runtime,
          mode: "GREEN_BUTTON",
        },
      })
    );

    expect(artifact.dataset.monthly).toEqual([
      { month: "2025-04", kwh: 717.2 },
      { month: "2025-05", kwh: 1286.66 },
      { month: "2026-04", kwh: 4.99 },
    ]);
    expect(artifact.dataset.insights?.stitchedMonth).toMatchObject({
      yearMonth: "2026-04",
      borrowedFromYearMonth: "2025-04",
    });
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
