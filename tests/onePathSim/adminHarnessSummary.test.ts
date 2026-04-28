import { describe, expect, it } from "vitest";
import { buildOnePathSandboxHarnessSummary } from "@/modules/onePathSim/adminHarnessSummary";

describe("one path sandbox harness summary", () => {
  it("surfaces interval baseline parity against upstream usage truth", () => {
    const summary = buildOnePathSandboxHarnessSummary({
      lookupSourceContext: {
        actualDatasetSummary: { totalKwh: 222, source: "SMT" },
        upstreamUsageTruth: {
          currentRun: {
            statusSummary: {
              usageTruthStatus: "existing_persisted_truth",
            },
          },
        },
      },
      runResult: {
        engineInput: {
          inputType: "INTERVAL",
          simulatorMode: "SMT_BASELINE",
          scenarioId: null,
          actualContextHouseId: "house-1",
          actualMonthlyReference: { "2026-03": 110, "2026-04": 112 },
        },
        artifact: {
          dataset: {
            meta: {
              baselinePassthrough: true,
              baselineSimulationBlocked: true,
            },
          },
        },
        readModel: {
          runIdentity: {
            sharedProducerPathUsed: true,
          },
          dataset: {
            summary: { totalKwh: 222, source: "SMT" },
            monthly: [
              { month: "2026-03", kwh: 110 },
              { month: "2026-04", kwh: 112 },
            ],
            meta: {
              baselinePassthrough: true,
            },
          },
          compareProjection: { rows: [], metrics: null },
          curveCompareActualIntervals15: [],
          curveCompareSimulatedIntervals15: [],
          curveCompareSimulatedDailyRows: [],
        },
      },
    });

    expect(summary.runStatus.runType).toBe("BASELINE_PASSTHROUGH");
    expect(summary.runStatus.baselinePassthrough).toBe(true);
    expect(summary.monthlyTruthCompare.actualMonthlyReference).toEqual({
      "2026-03": 110,
      "2026-04": 112,
    });
    expect(summary.monthlyTruthCompare.datasetMonthlyRows).toEqual([
      { month: "2026-03", kwh: 110 },
      { month: "2026-04", kwh: 112 },
    ]);
    expect(summary.monthlyTruthCompare.upstreamUsageTruthStatus).toBe("existing_persisted_truth");
  });

  it("surfaces manual monthly baseline parity and reconciliation truth", () => {
    const summary = buildOnePathSandboxHarnessSummary({
      lookupSourceContext: {
        actualDatasetSummary: { totalKwh: 480, source: "SMT" },
        weatherScore: { scoringMode: "BILLING_PERIOD_BASED" },
      },
      runResult: {
        engineInput: {
          inputType: "MANUAL_MONTHLY",
          simulatorMode: "MANUAL_TOTALS",
          scenarioId: null,
          actualContextHouseId: "house-1",
          annualTargetKwh: null,
          weatherEfficiencyDerivedInput: { coolingWeight: 0.82 },
          actualMonthlyReference: { "2026-03": 190, "2026-04": 250 },
        },
        artifact: {
          dataset: {
            meta: {
              baselinePassthrough: true,
              baselineSimulationBlocked: true,
            },
          },
        },
        readModel: {
          dataset: {
            summary: { totalKwh: 480, source: "MANUAL" },
            monthly: [
              { month: "2026-03", kwh: 210 },
              { month: "2026-04", kwh: 270 },
            ],
            meta: {
              baselinePassthrough: true,
              baselinePassthroughMode: "MANUAL_MONTHLY",
            },
          },
          manualMonthlyReconciliation: {
            rows: [{ billPeriodId: "apr", actualKwh: 250, simulatedKwh: 270 }],
          },
          manualParitySummary: {
            status: "needs_tuning",
            overallParityReady: false,
          },
          effectiveSimulationVariablesUsed: {
            resolvedWeatherShapingMode: "billing_period_weather",
          },
          curveCompareActualIntervals15: [],
          curveCompareSimulatedIntervals15: [],
          curveCompareSimulatedDailyRows: [],
        },
      },
    });

    expect(summary.runStatus.selectedMode).toBe("MANUAL_MONTHLY");
    expect(summary.monthlyTruthCompare.manualParitySummary).toEqual({
      status: "needs_tuning",
      overallParityReady: false,
    });
    expect(summary.monthlyTruthCompare.manualMonthlyReconciliation).toEqual({
      rows: [{ billPeriodId: "apr", actualKwh: 250, simulatedKwh: 270 }],
    });
    expect(summary.weatherAndShape.weatherEfficiencyDerivedInput).toEqual({ coolingWeight: 0.82 });
    expect(summary.weatherAndShape.lookupWeatherScore).toEqual({ scoringMode: "BILLING_PERIOD_BASED" });
  });

  it("surfaces manual annual baseline parity without simulated shape payloads", () => {
    const summary = buildOnePathSandboxHarnessSummary({
      lookupSourceContext: {
        upstreamUsageTruth: {
          currentRun: {
            statusSummary: {
              usageTruthStatus: "existing_persisted_truth",
            },
          },
        },
      },
      runResult: {
        engineInput: {
          inputType: "MANUAL_ANNUAL",
          simulatorMode: "MANUAL_TOTALS",
          scenarioId: null,
          annualTargetKwh: 12345,
          actualContextHouseId: "house-1",
        },
        artifact: {
          dataset: {
            meta: {
              baselinePassthrough: true,
              baselinePassthroughMode: "MANUAL_ANNUAL",
            },
          },
        },
        readModel: {
          dataset: {
            summary: { totalKwh: 12345, source: "MANUAL" },
            monthly: [],
            meta: {
              baselinePassthrough: true,
              baselinePassthroughMode: "MANUAL_ANNUAL",
            },
          },
          curveCompareActualIntervals15: [],
          curveCompareSimulatedIntervals15: [],
          curveCompareSimulatedDailyRows: [],
        },
      },
    });

    expect(summary.runStatus.runType).toBe("BASELINE_PASSTHROUGH");
    expect(summary.monthlyTruthCompare.datasetMonthlyRows).toEqual([]);
    expect(summary.compareVisibility.actualCurveIntervalsCount).toBe(0);
    expect(summary.compareVisibility.simulatedCurveIntervalsCount).toBe(0);
  });

  it("surfaces compact baseline passthrough runs without a read model", () => {
    const summary = buildOnePathSandboxHarnessSummary({
      knownScenario: {
        scenarioKey: "keeper-green-button-baseline-primary",
        label: "Brian green button baseline primary",
        scenarioType: "GREEN_BUTTON_TRUTH",
      },
      runResult: {
        runType: "BASELINE_PASSTHROUGH",
        engineInput: {
          inputType: "GREEN_BUTTON",
          simulatorMode: "SMT_BASELINE",
          scenarioId: null,
          actualContextHouseId: "house-1",
        },
        runDisplayView: {
          summary: {
            source: "GREEN_BUTTON",
            coverageStart: "2025-04-15",
            coverageEnd: "2026-04-14",
            intervalsCount: 34823,
          },
          monthlyRows: [{ month: "2026-04", kwh: 13542.3 }],
        },
      },
    });

    expect(summary.runStatus.selectedMode).toBe("GREEN_BUTTON");
    expect(summary.runStatus.runType).toBe("BASELINE_PASSTHROUGH");
    expect(summary.runStatus.baselinePassthrough).toBe(true);
    expect(summary.monthlyTruthCompare.datasetSummary).toEqual({
      source: "GREEN_BUTTON",
      intervalsCount: 34823,
      start: "2025-04-15",
      end: "2026-04-14",
    });
    expect(summary.monthlyTruthCompare.datasetMonthlyRows).toEqual([{ month: "2026-04", kwh: 13542.3 }]);
  });

  it("surfaces Past Sim compare metrics, weather sensitivity, and daily shape visibility", () => {
    const summary = buildOnePathSandboxHarnessSummary({
      knownScenario: {
        scenarioKey: "interval-past-primary",
        label: "Interval Past Primary",
        scenarioType: "INTERVAL_TRUTH",
        expectedTruthSource: "persisted_usage_output",
        expectations: {
          expectedBaselineParity: true,
          expectedPastSimCompareAvailable: true,
          targetMaeMax: 5,
        },
      },
      lookupSourceContext: {
        actualDatasetSummary: { totalKwh: 430, source: "SMT" },
        weatherScore: { scoringMode: "INTERVAL_BASED", score: 0.71 },
        weatherDerivedInput: { coolingWeight: 0.77 },
      },
      runResult: {
        engineInput: {
          inputType: "INTERVAL",
          simulatorMode: "SMT_BASELINE",
          scenarioId: "past-scenario-1",
          actualContextHouseId: "house-1",
          weatherEfficiencyDerivedInput: { coolingWeight: 0.77 },
          actualMonthlyReference: { "2026-03": 210, "2026-04": 220 },
        },
        artifact: {
          dataset: {
            meta: {
              baselinePassthrough: false,
            },
          },
        },
        readModel: {
          runIdentity: {
            artifactId: "artifact-1",
            sharedProducerPathUsed: true,
          },
          dataset: {
            summary: { totalKwh: 440, source: "SIMULATED" },
            monthly: [
              { month: "2026-03", kwh: 214 },
              { month: "2026-04", kwh: 226 },
            ],
            meta: {
              baselinePassthrough: false,
            },
          },
          compareProjection: {
            rows: [{ date: "2026-04-01", actualKwh: 8.1, simulatedKwh: 7.8 }],
            metrics: { maePct: 4.2, biasPct: -1.3 },
          },
          dailyShapeTuning: {
            simulatedDayResultsCount: 18,
            intervalCount: 96,
          },
          tuningSummary: {
            compareRowsCount: 1,
          },
          effectiveSimulationVariablesUsed: {
            resolvedWeatherShapingMode: "interval_weather",
            resolvedIntradayReconstructionControls: { peakHold: 0.62 },
          },
          curveCompareActualIntervals15: [{ timestamp: "2026-04-01T00:00:00.000Z", kwh: 0.11 }],
          curveCompareSimulatedIntervals15: [{ timestamp: "2026-04-01T00:00:00.000Z", kwh: 0.13 }],
          curveCompareSimulatedDailyRows: [{ date: "2026-04-01", kwh: 7.8 }],
        },
      },
    });

    expect(summary.runStatus.runType).toBe("PAST_SIM");
    expect(summary.monthlyTruthCompare.compareProjectionMetrics).toEqual({ maePct: 4.2, biasPct: -1.3 });
    expect(summary.weatherAndShape.weatherEfficiencyDerivedInput).toEqual({ coolingWeight: 0.77 });
    expect(summary.weatherAndShape.dailyShapeTuning).toEqual({
      simulatedDayResultsCount: 18,
      intervalCount: 96,
    });
    expect(summary.compareVisibility.actualCurveIntervalsCount).toBe(1);
    expect(summary.compareVisibility.simulatedCurveIntervalsCount).toBe(1);
    expect(summary.compareVisibility.compareProjectionRowsCount).toBe(1);
    expect(summary.runStatus.knownScenarioKey).toBe("interval-past-primary");
    expect(summary.runStatus.knownScenarioType).toBe("INTERVAL_TRUTH");
    expect(summary.runStatus.knownScenarioExpectations).toEqual({
      expectedBaselineParity: true,
      expectedPastSimCompareAvailable: true,
      targetMaeMax: 5,
    });
  });
});
