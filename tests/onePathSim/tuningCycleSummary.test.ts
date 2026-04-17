import { describe, expect, it } from "vitest";
import { buildOnePathTuningCycleSummary } from "@/modules/onePathSim/tuningCycleSummary";

describe("one path tuning cycle summary", () => {
  it("surfaces threshold pass/fail and the biggest drift reason from manual parity", () => {
    const summary = buildOnePathTuningCycleSummary({
      selectedMode: "MANUAL_ANNUAL",
      knownScenario: {
        scenarioKey: "manual-annual",
        label: "Manual Annual",
        mode: "MANUAL_ANNUAL",
        expectations: {
          expectedBaselineParity: false,
          expectedPastSimCompareAvailable: false,
          targetWapeMax: 15,
        },
      },
      sandboxSummary: {
        runStatus: {
          selectedMode: "MANUAL_ANNUAL",
          runType: "BASELINE_PASSTHROUGH",
          baselinePassthrough: true,
        },
        monthlyTruthCompare: {
          compareProjectionMetrics: {
            wape: 22,
          },
          manualParitySummary: {
            parity_verdicts: {
              stage1Parity: false,
              stage1ParityReason: "Artifact bill-period contract does not match the shared manual read model.",
            },
          },
        },
        weatherAndShape: {
          resolvedWeatherShapingMode: "weather_sensitive_curve",
          resolvedIntradayReconstructionControls: { donorMode: "seasonal_shape" },
        },
        compareVisibility: {
          compareProjectionRowsCount: 0,
        },
      },
    });

    expect(summary.presetKey).toBe("manual-annual");
    expect(summary.thresholdStatus).toEqual({
      baselineParity: false,
      compareAvailability: true,
      wape: false,
      mae: null,
      rmse: null,
    });
    expect(summary.biggestDriftReason).toBe(
      "Artifact bill-period contract does not match the shared manual read model."
    );
    expect(summary.keyVariablesUsed).toEqual({
      resolvedWeatherShapingMode: "weather_sensitive_curve",
      resolvedIntradayReconstructionControls: { donorMode: "seasonal_shape" },
      weatherEfficiencyDerivedInput: null,
    });
  });

  it("prefers the run error when the cycle is blocked before compare surfaces exist", () => {
    const summary = buildOnePathTuningCycleSummary({
      selectedMode: "INTERVAL",
      knownScenario: {
        label: "Interval Past",
        expectations: {
          expectedPastSimCompareAvailable: true,
        },
      },
      sandboxSummary: {
        runStatus: {
          selectedMode: "INTERVAL",
          runType: "PAST_SIM",
          baselinePassthrough: false,
        },
        monthlyTruthCompare: {},
        weatherAndShape: {},
        compareVisibility: {
          compareProjectionRowsCount: 0,
        },
      },
      runError: "requirements_unmet: Complete Home Details (required fields).",
    });

    expect(summary.biggestDriftReason).toBe("requirements_unmet: Complete Home Details (required fields).");
    expect(summary.thresholdStatus).toEqual({
      baselineParity: null,
      compareAvailability: false,
      wape: null,
      mae: null,
      rmse: null,
    });
  });
});
