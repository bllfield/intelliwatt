import { describe, expect, it } from "vitest";
import { buildSimulationVariableCopyPayload } from "@/modules/onePathSim/simulationVariablePresentation";

describe("one path simulation variable copy payload", () => {
  it("adds explicit top-level page truth sections for AI review", () => {
    const houseContract = {
      houseId: "house-1",
      label: "Home",
      address: { line1: "123 Main", city: "Dallas", state: "TX" },
      esiid: "esiid-1",
      dataset: {
        summary: {
          source: "SMT",
          intervalsCount: 4,
          totalKwh: 10,
          start: "2025-04-15",
          end: "2026-04-14",
          latest: "2026-04-14T23:45:00.000Z",
        },
        meta: {
          actualSource: "SMT",
        },
        daily: [
          { date: "2025-04-16", kwh: 4 },
          { date: "2025-04-17", kwh: 6 },
        ],
        monthly: [{ month: "2025-04", kwh: 10 }],
        series: {
          intervals15: [
            { timestamp: "2026-04-14T00:00:00.000Z", kwh: 2.5 },
            { timestamp: "2026-04-14T00:15:00.000Z", kwh: 2.5 },
            { timestamp: "2026-04-14T00:30:00.000Z", kwh: 2.5 },
            { timestamp: "2026-04-14T00:45:00.000Z", kwh: 2.5 },
          ],
        },
        insights: {
          fifteenMinuteAverages: [
            { hhmm: "00:00", avgKw: 1.2 },
            { hhmm: "00:15", avgKw: 1.4 },
          ],
          weekdayVsWeekend: { weekday: 6, weekend: 4.4 },
          timeOfDayBuckets: [{ key: "overnight", label: "Overnight", kwh: 10.4 }],
          peakDay: { date: "2025-04-16", kwh: 6 },
          peakHour: { hour: 20, kw: 1.4 },
          baseload: 0.2,
        },
        totals: {
          importKwh: 10,
          exportKwh: 0,
          netKwh: 10,
        },
      },
      alternatives: { smt: null, greenButton: null },
      datasetError: null,
      weatherSensitivityScore: {
        scoringMode: "INTERVAL_BASED",
        weatherEfficiencyScore0to100: 31,
        explanationSummary: "Weather-sensitive home.",
      },
      weatherEfficiencyDerivedInput: {
        weatherEfficiencyScore0to100: 31,
      },
    } as any;

    const payload = buildSimulationVariableCopyPayload({
      mode: "INTERVAL",
      response: {
        familyMeta: {},
        defaults: {},
        effectiveByMode: { INTERVAL: {} },
        overrides: {},
      },
      currentControls: {
        mode: "INTERVAL",
      },
      loadedSourceContext: {
        actualDatasetSummary: { totalKwh: 10 },
        actualDatasetMeta: { actualSource: "SMT" },
        usageTruthSource: "persisted_usage_output",
        usageTruthSeedResult: null,
        upstreamUsageTruth: { currentRun: { statusSummary: { usageTruthStatus: "existing_persisted_truth" } } },
        manualUsagePayload: null,
        manualUsageUpdatedAt: null,
        travelRangesFromDb: [{ startDate: "2025-08-13", endDate: "2025-08-17" }],
        homeProfile: { occupantsWork: 1, fuelConfiguration: "all_electric" },
        applianceProfile: { fuelConfiguration: "all_electric", appliances: [] },
        weatherScore: { weatherEfficiencyScore0to100: 31 },
        weatherDerivedInput: { coolingSlopeKwhPerCDD: 1.5 },
        userUsagePageBaselineContract: houseContract,
      } as any,
      baselineParityReport: {
        overallMatch: true,
        firstDivergenceField: null,
        matchedKeys: ["source", "coverageStart"],
        mismatchedKeys: [],
      } as any,
      baselineParityAudit: {
        parityStatus: "matched_shared_baseline_truth",
      } as any,
      runtimeEnvParityTrace: {
        parityStatus: "runtime_env_parity_ok",
      } as any,
      intervalPastReadinessTrace: {
        compareCapableNow: false,
        classification: "unreadable_field_in_past_path_only",
      } as any,
      readOnlyAudit: {
        homeDetailsReady: true,
        manualMonthlyPayloadReady: false,
        manualAnnualPayloadReady: false,
        usageTruthReady: true,
        compareCapableNow: false,
        blockingReasons: ["Complete Home Details (required fields)."],
        applianceProfileReady: true,
        baselineRunnableNow: true,
        validatorAudit: {
          homeDetails: { ready: true },
        },
      } as any,
    } as any);

    expect(payload).toHaveProperty("loadedSourceContext");
    expect(payload).toHaveProperty("userUsageDashboardViewModel");
    expect(payload).toHaveProperty("baselineParityReport");
    expect(payload).toHaveProperty("baselineParityAudit");
    expect(payload).toHaveProperty("displayTotalsAudit");
    expect(payload).toHaveProperty("runtimeEnvParityTrace");
    expect(payload).toHaveProperty("intervalPastReadinessTrace");
    expect(payload).toHaveProperty("readOnlyAudit");
    expect(payload).toHaveProperty("aiPayloadMeta");
    expect((payload.loadedSourceContext as any).actualDatasetSummary).toEqual({ totalKwh: 10 });
    expect((payload.readOnlyAudit as any)).toEqual(
      expect.objectContaining({
        homeDetailsReady: true,
        usageTruthReady: true,
        compareCapableNow: false,
      })
    );
    expect((payload.userUsageDashboardViewModel as any).coverage).toEqual(
      expect.objectContaining({
        source: "SMT",
      })
    );
    expect((payload.userUsageDashboardViewModel as any).monthlyRows).toEqual([{ month: "2025-04", kwh: 10 }]);
    expect((payload.userUsageDashboardViewModel as any).dailyRowsCount).toBe(2);
    expect((payload.userUsageDashboardViewModel as any).fifteenMinuteCurve).toEqual(
      expect.objectContaining({
        rowsCount: 2,
      })
    );
    expect((payload.displayTotalsAudit as any)).toEqual(
      expect.objectContaining({
        rawIntervalTotalKwh: 10,
        summaryTotalKwh: 10,
        datasetTotalsNetKwh: 10,
      })
    );
    expect((payload.aiPayloadMeta as any)).toEqual(
      expect.objectContaining({
        payloadVersion: expect.any(String),
        selectedMode: "INTERVAL",
        includesDashboardViewModel: true,
        includesParitySections: true,
        includesEnvReadinessTraceSections: true,
      })
    );
  });

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
