import { describe, expect, it } from "vitest";
import { buildManualGapfillAiTuningBundle } from "@/lib/admin/manualGapfillAiTuningBundle";
import { buildOnePathAiTuningBundle } from "@/lib/admin/onePathAiTuningBundle";
import { buildSimulationCodeMap, SIMULATION_CODE_MAP_VERSION } from "@/lib/admin/simulationCodeMap";

const deployment = {
  gitCommitSha: "abc123def456789",
  gitCommitRef: "main",
  deployedAt: "2026-06-06T12:00:00.000Z",
  workingTreeDirty: true,
  metadataSource: "local_git" as const,
};

describe("buildOnePathAiTuningBundle", () => {
  it("includes identity, totals, diagnostics, and interval curve export section", () => {
    const bundle = buildOnePathAiTuningBundle({
      mode: "INTERVAL",
      runResult: {
        onePathIntervalDiagnosticsV1: {
          available: true,
          dailyCompare: { rowCount: 365 },
          weatherMissDiagnostics: { topMisses: [{ date: "2025-07-01" }] },
          worstDayDiagnostics: { topAbsoluteDailyMisses: [{ date: "2025-08-01" }] },
          validationIntervalCurveDiagnostics: {
            days: [
              {
                date: "2025-07-01",
                rawIntervalWape: 0.12,
                intervalMae: 0.4,
                normalizedShapeError: 0.08,
                shapeCorrelation: 0.91,
                peakActualKwh: 2.1,
                peakSimulatedKwh: 1.9,
                peakActualLocalTime: "18:15",
                peakSimulatedLocalTime: "18:30",
                peakTimingErrorMinutes: 15,
                overnight: { actualKwh: 1, simulatedKwh: 0.9, deltaKwh: -0.1 },
                morning: { actualKwh: 2, simulatedKwh: 2.1, deltaKwh: 0.1 },
                afternoon: { actualKwh: 3, simulatedKwh: 2.8, deltaKwh: -0.2 },
                evening: { actualKwh: 4, simulatedKwh: 4.2, deltaKwh: 0.2 },
              },
            ],
          },
          exactMatchDiagnostics: { evaluatedDayCount: 14, skippedReason: null },
        },
      },
      lookup: {
        selectedHouseId: "source-house",
        sourceContext: { selectedDateKeys: ["2025-07-01"] },
      },
      simulationVariablesPayload: {
        selectedMode: "INTERVAL",
        loadedSourceContext: {
          homeProfile: { occupantsWork: 1 },
          applianceProfile: { appliances: [] },
          travelRangesFromDb: [{ startDate: "2025-08-13", endDate: "2025-08-17" }],
          weatherDerivedInput: { coolingSlopeKwhPerCDD: 1.2 },
          weatherScore: { weatherEfficiencyScore0to100: 42 },
        },
        engineInput: { preferredActualSource: "SMT", scenarioId: "scenario-1" },
        readModel: {
          compareProjection: {
            rows: [{ localDate: "2025-07-01", validationDay: true, actualKwh: 10, simulatedKwh: 9.8 }],
          },
          dataset: { summary: { totalKwh: 14456, start: "2025-04-15", end: "2026-04-14" } },
        },
        runDisplayContract: {
          coverage: { start: "2025-04-15", end: "2026-04-14", totalKwh: 14500 },
          dailyUsage: {
            rows: [{ date: "2025-07-01", actualKwh: 10, simulatedKwh: 9.8 }],
            dailyWeather: [{ date: "2025-07-01", tempF: 92 }],
          },
        },
        simRunAudit: {
          artifactIdentity: {
            artifactId: "artifact-1",
            artifactInputHash: "hash-artifact",
            buildInputsHash: "hash-build",
            engineVersion: "engine-v1",
            simulatorMode: "INTERVAL",
            inputType: "INTERVAL",
          },
          engineInputIdentity: {
            actualContextHouseId: "actual-context-1",
            scenarioId: "scenario-1",
            coverageWindowStart: "2025-04-15",
            coverageWindowEnd: "2026-04-14",
          },
        },
      },
      deployment,
    });

    expect(bundle.bundleVersion).toBe("one-path-ai-tuning-bundle-v1");
    expect(bundle.selectedMode).toBe("INTERVAL");
    expect(bundle.sourceKind).toBe("SMT");
    expect((bundle.identity as any).sourceHouseId).toBe("source-house");
    expect((bundle.identity as any).artifactInputHash).toBe("hash-artifact");
    expect((bundle.totals as any).actualKwh).toBe(14500);
    expect((bundle.totals as any).simulatedKwh).toBe(14456);
    expect(bundle.selectedValidationDateKeys).toEqual(["2025-07-01"]);
    expect((bundle.profileInputs as any).homeProfile).toEqual({ occupantsWork: 1 });
    const intervalExport = (bundle.diagnostics as any).onePathIntervalDiagnosticsV1;
    expect(intervalExport.available).toBe(true);
    expect(intervalExport.validationIntervalCurveDiagnostics.populated).toBe(true);
    expect(intervalExport.validationIntervalCurveDiagnostics.days[0].rawIntervalWape).toBe(0.12);
    expect(intervalExport.exactMatchDiagnostics.evaluatedDayCount).toBe(14);
    expect((bundle.simulationCodeMap as any).deployment.gitCommitSha).toBe(deployment.gitCommitSha);
  });

  it("surfaces export hints when interval diagnostics are unavailable", () => {
    const bundle = buildOnePathAiTuningBundle({
      mode: "INTERVAL",
      runResult: { onePathIntervalDiagnosticsV1: { available: false, unavailableReason: "missing_run" } },
      simulationVariablesPayload: { selectedMode: "INTERVAL", loadedSourceContext: {} },
    });

    const intervalExport = (bundle.diagnostics as any).onePathIntervalDiagnosticsV1;
    expect(intervalExport.available).toBe(false);
    expect(intervalExport.exportHints.length).toBeGreaterThan(0);
  });
});

describe("buildManualGapfillAiTuningBundle", () => {
  it("includes MG steps, compare diagnostics, travel classification, and guardrails", () => {
    const bundle = buildManualGapfillAiTuningBundle({
      identityKey: "user:source:lab:MONTHLY_FROM_SOURCE_INTERVALS",
      userEmail: "test@example.com",
      userId: "user-1",
      sourceHouseId: "source-1",
      labHouseId: "lab-1",
      mode: "MONTHLY_FROM_SOURCE_INTERVALS",
      esiid: "E123",
      includeDiagnostics: true,
      anchorEndDate: "",
      includeDailyRows: true,
      policySnapshot: { selectedDateKeys: ["2025-07-01", "2025-08-01"] },
      step1: {
        identityKey: "user:source:lab:MONTHLY_FROM_SOURCE_INTERVALS",
        data: {
          sourceHouseId: "source-1",
          actualSourceKind: "SMT",
          coverage: { coverageStart: "2025-04-15", coverageEnd: "2026-04-14" },
          travelRanges: [{ startDate: "2024-01-01", endDate: "2024-01-07" }],
        },
      },
      step2Preview: null,
      step3: null,
      step4: {
        identityKey: "user:source:lab:MONTHLY_FROM_SOURCE_INTERVALS",
        data: { manualRunIsolation: "manual_totals_only", readback: { totalKwh: 100 } },
      },
      step5: {
        identityKey: "user:source:lab:MONTHLY_FROM_SOURCE_INTERVALS",
        data: {
          compare: {
            actualTotalKwh: 14456,
            simulatedTotalKwh: 14455,
            deltaKwh: -1,
            percentDelta: -0.01,
            dailyRows: [{ date: "2025-07-01", actualKwh: 40, simulatedKwh: 39.5, deltaKwh: -0.5 }],
          },
          diagnosticsV1: {
            dailyWeatherMissDiagnostics: [{ date: "2025-07-01", missScore: 0.2 }],
            weatherDiagnostics: { weatherDiagnosticsAvailable: true },
            travelDiagnostics: { travelDiagnosticsAvailable: true },
            billPeriodAllocationDiagnostics: { billPeriodCount: 12 },
            validationIntervalCurveDiagnostics: { selectedValidationDayCount: 2 },
            worstDayDiagnostics: { topAbsoluteDailyMisses: [{ date: "2025-07-01" }] },
            dashboardSummary: { dailyWape: 0.0037 },
          },
          diagnostics: { diagnosticsV1Built: true },
          sourceActualDataset: {
            series: {
              intervals15: [{ timestamp: "2025-07-01T12:00:00.000Z", kwh: 1.2 }],
            },
          },
          labDataset: {
            series: {
              intervals15: [{ timestamp: "2025-07-01T12:00:00.000Z", kwh: 1.1 }],
            },
          },
        },
      },
      isStepStale: () => false,
      deployment,
    });

    expect(bundle.bundleVersion).toBe("manual-gapfill-ai-tuning-bundle-v1");
    expect((bundle.steps as any).mg1_sourceContext.stepId).toBe("MG-1");
    expect((bundle.steps as any).mg5_compare.response.compare.actualTotalKwh).toBe(14456);
    expect((bundle.diagnostics as any).dashboardSummary.dailyWape).toBe(0.0037);
    expect((bundle.travelClassification as any).travelShouldReduceManualSim).toBe(false);
    expect((bundle.travelClassification as any).manualSimExpectedToEstimateNormalCounterfactualUsage).toBe(true);
    expect((bundle.isolationGuardrails as any).travelShouldReduceManualSim).toBe(false);
    expect((bundle.isolationGuardrails as any).manualSimExpectedToEstimateNormalCounterfactualUsage).toBe(true);
    expect((bundle.validationDayIntervalSeries as any).sourceActualByDate["2025-07-01"]).toHaveLength(1);
    expect((bundle.simulationCodeMap as any).surface).toBe("manual_gapfill_lab");
  });
});

describe("buildSimulationCodeMap", () => {
  it("includes required module owners and deployment metadata without secrets", () => {
    const codeMap = buildSimulationCodeMap({ surface: "one_path_admin", deployment });

    expect(codeMap.version).toBe(SIMULATION_CODE_MAP_VERSION);
    expect(codeMap.readOnly).toBe(true);
    expect((codeMap.guardrails as any).secretsIncluded).toBe(false);
    expect((codeMap.guardrails as any).envValuesIncluded).toBe(false);
    expect((codeMap.deployment as any).workingTreeDirty).toBe(true);
    const moduleIds = (codeMap.modules as any[]).map((row) => row.moduleId);
    expect(moduleIds).toContain("past_sim_orchestrator");
    expect(moduleIds).toContain("manual_gapfill_compare_diagnostics");
    expect(moduleIds).toContain("one_path_interval_compare_diagnostics");
  });
});
