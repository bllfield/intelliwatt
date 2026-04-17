import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const resolveOnePathCanonicalUsage365CoverageWindow = vi.fn();
const buildOnePathValidationCompareProjectionSidecar = vi.fn();
const buildOnePathSharedPastSimDiagnostics = vi.fn();

vi.mock("@/modules/onePathSim/runtime", () => ({
  attachOnePathRunIdentityToEffectiveSimulationVariablesUsed: vi.fn((value: unknown) => value),
  buildOnePathDailyCurveComparePayload: vi.fn(() => null),
  buildOnePathManualBillPeriodTargets: vi.fn(() => []),
  buildOnePathSharedPastSimDiagnostics: (...args: any[]) => buildOnePathSharedPastSimDiagnostics(...args),
  buildOnePathValidationCompareProjectionSidecar: (...args: any[]) =>
    buildOnePathValidationCompareProjectionSidecar(...args),
  buildOnePathWeatherEfficiencyDerivedInput: vi.fn(() => null),
  getOnePathManualUsageInput: vi.fn(),
  resolveOnePathCanonicalUsage365CoverageWindow: (...args: any[]) =>
    resolveOnePathCanonicalUsage365CoverageWindow(...args),
  resolveOnePathManualStageOnePresentation: vi.fn(() => null),
  resolveOnePathUpstreamUsageTruthForSimulation: vi.fn(),
  resolveOnePathWeatherSensitivityEnvelope: vi.fn(() => ({ score: null, derivedInput: null })),
}));

vi.mock("@/modules/onePathSim/manualArtifactDecorations", () => ({
  buildOnePathManualArtifactDecorations: vi.fn(),
}));

vi.mock("@/modules/onePathSim/onePathTruthSummary", () => ({
  buildOnePathTruthSummary: vi.fn(() => ({
    preCutoverHarness: null,
    stageBoundaryMap: null,
    upstreamUsageTruth: null,
    sharedDerivedInputs: null,
    sourceTruthIdentity: null,
    constraintRebalance: null,
    donorFallbackExclusions: null,
    intradayReconstruction: null,
    finalSharedOutputContract: null,
    chartWindowDisplay: null,
    manualStatementAnnual: null,
    annualModeTruth: null,
    newBuildModeTruth: null,
    controlSurface: null,
  })),
}));

vi.mock("@/modules/onePathSim/serviceBridge", () => ({
  runOnePathSimulatorBuild: vi.fn(),
  readOnePathSimulatedUsageScenario: vi.fn(),
}));

vi.mock("@/modules/onePathSim/usageSimulator/simObservability", () => ({
  getMemoryRssMb: vi.fn(() => 123),
  logSimPipelineEvent: vi.fn(),
}));

describe("read-only interval baseline preview", () => {
  beforeEach(() => {
    resolveOnePathCanonicalUsage365CoverageWindow.mockReset();
    buildOnePathValidationCompareProjectionSidecar.mockReset();
    buildOnePathSharedPastSimDiagnostics.mockReset();

    resolveOnePathCanonicalUsage365CoverageWindow.mockReturnValue({
      startDate: "2025-04-15",
      endDate: "2026-04-14",
    });
    buildOnePathValidationCompareProjectionSidecar.mockReturnValue({
      rows: [],
      metrics: { mode: "baseline" },
    });
    buildOnePathSharedPastSimDiagnostics.mockReturnValue({
      lockboxExecutionSummary: {
        sharedProducerPathUsed: false,
        baselinePassthrough: true,
      },
    });
  });

  it("builds a read-only baseline preview from shared upstream truth only", async () => {
    const { buildReadOnlyIntervalBaselinePreview } = await import("@/modules/onePathSim/onePathSim");

    const preview = await buildReadOnlyIntervalBaselinePreview({
      runtimeUserId: "user-1",
      selectedHouse: { id: "house-1", esiid: "esiid-1" },
      actualContextHouse: { id: "house-1", esiid: "esiid-1" },
      actualDataset: {
        summary: {
          source: "SMT",
          intervalsCount: 34823,
          totalKwh: 13542.3,
          start: "2025-04-14",
          end: "2026-04-14",
          latest: "2026-04-14T23:45:00.000Z",
        },
        daily: [{ date: "2026-04-14", kwh: 13542.3 }],
        monthly: [{ month: "2026-04", kwh: 13542.3 }],
        series: {
          intervals15: [{ timestamp: "2026-04-14T23:45:00.000Z", kwh: 0.3 }],
        },
        insights: {
          fifteenMinuteAverages: [{ hhmm: "00:00", avgKw: 1.2 }],
          weekdayVsWeekend: { weekday: 9800, weekend: 3742.3 },
          timeOfDayBuckets: [{ key: "overnight", label: "Overnight", kwh: 2800 }],
          peakDay: { date: "2026-04-14", kwh: 13542.3 },
          peakHour: { hour: 17, kw: 4.3 },
          baseload: 0.2,
        },
        totals: {
          importKwh: 13542.3,
          exportKwh: 0,
          netKwh: 13542.3,
        },
        meta: {
          datasetKind: "ACTUAL",
          actualSource: "SMT",
          canonicalMonths: ["2025-04", "2026-04"],
          weatherDatasetIdentity: "wx-1",
        },
      },
      usageTruthSource: "persisted_usage_output",
      usageTruthSeedResult: null,
      upstreamUsageTruth: {
        title: "Upstream Usage Truth",
        summary: "baseline passthrough source",
        currentRun: {},
        sharedOwners: [],
      },
      manualUsagePayload: null,
      homeProfile: null,
      applianceProfile: null,
      weatherEnvelope: {
        score: {
          scoringMode: "INTERVAL_BASED",
          weatherEfficiencyScore0to100: 32,
          coolingSensitivityScore0to100: 40,
          heatingSensitivityScore0to100: 22,
          confidenceScore0to100: 81,
          shoulderBaselineKwhPerDay: 20,
          coolingSlopeKwhPerCDD: 1,
          heatingSlopeKwhPerHDD: 1,
          coolingResponseRatio: 0.2,
          heatingResponseRatio: 0.2,
          estimatedWeatherDrivenLoadShare: 0.3,
          estimatedBaseloadShare: 0.7,
          requiredInputAdjustmentsApplied: [],
          poolAdjustmentApplied: false,
          hvacAdjustmentApplied: false,
          occupancyAdjustmentApplied: false,
          thermostatAdjustmentApplied: false,
          excludedSimulatedDayCount: 0,
          excludedIncompleteMeterDayCount: 0,
          scoreVersion: "v1",
          calculationVersion: "v1",
          recommendationFlags: {
            appearsWeatherSensitive: false,
            needsMoreApplianceDetail: false,
            needsEnvelopeDetail: false,
            confidenceLimited: false,
          },
          explanationSummary: "stable",
          nextDetailPromptType: "NONE",
        },
        derivedInput: null,
      },
    });

    expect(preview.readModel.dataset.summary.intervalsCount).toBe(34823);
    expect(preview.readModel.dataset.summary.totalKwh).toBe(13542.3);
    expect(preview.readModel.dataset.summary.start).toBe("2025-04-15");
    expect(preview.readModel.dataset.summary.end).toBe("2026-04-14");
    expect(preview.readModel.dataset.daily).toEqual([{ date: "2026-04-14", kwh: 13542.3 }]);
    expect(preview.readModel.dataset.monthly).toEqual([{ month: "2026-04", kwh: 13542.3 }]);
    expect(preview.readModel.dataset.series.intervals15).toEqual([
      { timestamp: "2026-04-14T23:45:00.000Z", kwh: 0.3 },
    ]);
    expect(preview.weatherScore).toEqual(
      expect.objectContaining({
        weatherEfficiencyScore0to100: 32,
      })
    );
    expect(preview.parityAudit).toEqual(
      expect.objectContaining({
        parityStatus: "matched_shared_baseline_truth",
        intervalCountParity: true,
        totalKwhParity: true,
        monthlyParity: true,
        dailyParity: true,
      })
    );
  });
});
