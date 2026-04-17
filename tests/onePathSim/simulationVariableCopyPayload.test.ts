import { describe, expect, it } from "vitest";
import { buildSimulationVariableCopyPayload } from "@/modules/onePathSim/simulationVariablePresentation";

describe("one path simulation variable copy payload", () => {
  it("includes known-scenario identity, expectations, and sandbox summary for repeated tuning runs", () => {
    const payload = buildSimulationVariableCopyPayload({
      mode: "INTERVAL",
      response: {
        familyMeta: {
          weatherShaping: {
            title: "Weather Shaping",
            description: "Shared weather shaping controls",
          },
        },
        defaults: {
          weatherShaping: {
            coolingWeight: 0.7,
          },
        },
        effectiveByMode: {
          INTERVAL: {
            weatherShaping: {
              coolingWeight: 0.77,
            },
          },
        },
        overrides: {},
      },
      runSnapshot: {
        inputType: "INTERVAL",
        runIdentityLinkage: {
          artifactId: "artifact-1",
        },
        familyByFamilyResolvedValues: {
          weatherShaping: {
            resolvedValues: {
              coolingWeight: 0.77,
            },
            valuesByKey: {
              coolingWeight: {
                valueSource: "shared default",
              },
            },
          },
        },
      } as any,
      currentControls: {
        mode: "INTERVAL",
      },
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
      sandboxSummary: {
        runStatus: {
          runType: "PAST_SIM",
        },
        monthlyTruthCompare: {
          compareProjectionMetrics: { maePct: 4.2 },
        },
        weatherAndShape: {
          weatherEfficiencyDerivedInput: { coolingWeight: 0.77 },
        },
      },
      readModel: {
        dataset: {
          summary: { totalKwh: 440 },
        },
        compareProjection: {
          rows: [{ date: "2026-04-01" }],
          metrics: { maePct: 4.2 },
        },
        tuningSummary: {
          compareRowsCount: 1,
        },
        dailyShapeTuning: {
          simulatedDayResultsCount: 18,
        },
      },
      artifact: {
        artifactId: "artifact-1",
        inputType: "INTERVAL",
        simulatorMode: "SMT_BASELINE",
      },
    });

    expect(payload).toHaveProperty("knownScenario");
    expect(payload).toHaveProperty("sandboxSummary");
    expect(payload).toHaveProperty("tuningCycleSummary");
    expect(payload.knownScenario).toEqual({
      scenarioKey: "interval-past-primary",
      label: "Interval Past Primary",
      scenarioType: "INTERVAL_TRUTH",
      expectedTruthSource: "persisted_usage_output",
      expectations: {
        expectedBaselineParity: true,
        expectedPastSimCompareAvailable: true,
        targetMaeMax: 5,
      },
    });
    expect((payload.sandboxSummary as any).monthlyTruthCompare.compareProjectionMetrics).toEqual({ maePct: 4.2 });
    expect(payload.tuningCycleSummary).toEqual({
      presetName: "Interval Past Primary",
      presetKey: "interval-past-primary",
      mode: "INTERVAL",
      runType: "PAST_SIM",
      compareMetrics: {
        wape: null,
        mae: null,
        rmse: null,
      },
      biggestDriftReason: "Expected compare surfaces are not available for this preset yet.",
      thresholdStatus: {
        baselineParity: false,
        compareAvailability: false,
        wape: null,
        mae: null,
        rmse: null,
      },
      keyVariablesUsed: {
        resolvedWeatherShapingMode: null,
        resolvedIntradayReconstructionControls: null,
        weatherEfficiencyDerivedInput: { coolingWeight: 0.77 },
      },
    });
  });
});
