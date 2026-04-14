import { describe, expect, it } from "vitest";
import { buildGapfillFullTuningPayload } from "@/modules/usageSimulator/tuningPayload";

describe("buildGapfillFullTuningPayload", () => {
  it("shapes one full shared tuning payload with the required sections", () => {
    const payload = buildGapfillFullTuningPayload(
      {
        formState: {
          sourceHouseId: "source-house-1",
          adminLabTreatmentMode: "MANUAL_MONTHLY",
          timezone: "America/Chicago",
        },
        result: {
          sourceUserId: "user-1",
          sourceHouseId: "source-house-1",
          testHomeId: "test-house-1",
          scenarioId: "scenario-1",
          simulatorMode: "MANUAL_TOTALS",
          treatmentMode: "MANUAL_MONTHLY",
          adminValidationMode: "stratified_weather_balanced",
          effectiveValidationSelectionMode: "stratified_weather_balanced",
          buildId: "build-1",
          buildInputsHash: "build-hash-1",
          artifactId: "artifact-1",
          artifactInputHash: "artifact-hash-1",
          correlationId: "corr-1",
          artifactEngineVersion: "engine-v1",
          manualAnchorEndDate: "2026-04-07",
          manualBillEndDay: "7",
          manualDateSourceMode: "AUTO_DATES",
          manualReadModel: {
            manualBillPeriods: [{ id: "bp-1", monthKey: "2026-03", startDate: "2026-03-01", endDate: "2026-03-31", enteredKwh: 900, eligibleForConstraint: true }],
            manualBillPeriodTotalsKwhById: { "bp-1": 900 },
            normalizedMonthTargetsByMonth: { "2026-03": 900 },
            parityRows: [
              {
                month: "2026-03",
                billPeriod: "Mar",
                actualIntervalKwh: 940,
                stage1TargetKwh: 900,
                simulatedKwh: 910,
                simVsActualKwh: -30,
                simVsTargetKwh: 10,
                parityContract: "eligible_exact_match",
                status: "close",
              },
            ],
          },
          manualParitySummary: {
            monthlyConstraintQuality: "strong",
            validationComposition: "balanced",
            weatherScalingBehavior: "moderate",
            shapeBucketQuality: "good",
            fallbackFrequency: "low",
            trustedReferencePoolQuality: "high",
          },
          compareProjection: {
            metrics: {
              wape: 0.08,
              mae: 1.2,
              rmse: 1.8,
              maxAbs: 3.4,
              totalActualKwhMasked: 100,
              totalSimKwhMasked: 96,
              deltaKwhMasked: -4,
              compareRowsCount: 2,
            },
            rows: [
              {
                localDate: "2026-03-10",
                dayType: "weekday",
                avgTempF: 74,
                minTempF: 61,
                maxTempF: 83,
                hdd65: 0,
                cdd65: 9,
                actualDayKwh: 31,
                simulatedDayKwh: 29,
                errorKwh: -2,
                percentError: -0.0645,
              },
            ],
          },
          manualMonthlyWeatherCompare: {
            sourceInterval: {
              score: {
                scoringMode: "INTERVAL_BASED",
                weatherEfficiencyScore0to100: 62,
                coolingSensitivityScore0to100: 70,
                heatingSensitivityScore0to100: 28,
                confidenceScore0to100: 80,
                shoulderBaselineKwhPerDay: 21,
                coolingSlopeKwhPerCDD: 1.7,
                heatingSlopeKwhPerHDD: 0.6,
                coolingResponseRatio: 1.1,
                heatingResponseRatio: 0.8,
                estimatedWeatherDrivenLoadShare: 0.48,
                estimatedBaseloadShare: 0.52,
                requiredInputAdjustmentsApplied: ["square_footage"],
                poolAdjustmentApplied: false,
                hvacAdjustmentApplied: true,
                occupancyAdjustmentApplied: false,
                thermostatAdjustmentApplied: true,
                excludedSimulatedDayCount: 0,
                excludedIncompleteMeterDayCount: 0,
                scoreVersion: "weather-sensitivity-v1",
                calculationVersion: "weather-sensitivity-v1",
                recommendationFlags: {
                  appearsWeatherSensitive: false,
                  needsMoreApplianceDetail: false,
                  needsEnvelopeDetail: false,
                  confidenceLimited: false,
                },
                explanationSummary: "actual interval summary",
                nextDetailPromptType: "NONE",
              },
              derivedInput: {
                derivedInputAttached: true,
                simulationActive: true,
                scoringMode: "INTERVAL_BASED",
                weatherEfficiencyScore0to100: 62,
                coolingSensitivityScore0to100: 70,
                heatingSensitivityScore0to100: 28,
                confidenceScore0to100: 80,
                shoulderBaselineKwhPerDay: 21,
                coolingSlopeKwhPerCDD: 1.7,
                heatingSlopeKwhPerHDD: 0.6,
                coolingResponseRatio: 1.1,
                heatingResponseRatio: 0.8,
                estimatedWeatherDrivenLoadShare: 0.48,
                estimatedBaseloadShare: 0.52,
                requiredInputAdjustmentsApplied: ["square_footage"],
                poolAdjustmentApplied: false,
                hvacAdjustmentApplied: true,
                occupancyAdjustmentApplied: false,
                thermostatAdjustmentApplied: true,
                scoreVersion: "weather-sensitivity-v1",
                calculationVersion: "weather-sensitivity-v1",
              },
            },
            manualMonthly: {
              score: {
                scoringMode: "BILLING_PERIOD_BASED",
                weatherEfficiencyScore0to100: 54,
                coolingSensitivityScore0to100: 61,
                heatingSensitivityScore0to100: 25,
                confidenceScore0to100: 69,
                shoulderBaselineKwhPerDay: 19,
                coolingSlopeKwhPerCDD: 1.3,
                heatingSlopeKwhPerHDD: 0.5,
                coolingResponseRatio: 0.9,
                heatingResponseRatio: 0.7,
                estimatedWeatherDrivenLoadShare: 0.4,
                estimatedBaseloadShare: 0.6,
                requiredInputAdjustmentsApplied: ["square_footage"],
                poolAdjustmentApplied: false,
                hvacAdjustmentApplied: true,
                occupancyAdjustmentApplied: false,
                thermostatAdjustmentApplied: true,
                excludedSimulatedDayCount: 0,
                excludedIncompleteMeterDayCount: 0,
                scoreVersion: "weather-sensitivity-v1",
                calculationVersion: "weather-sensitivity-v1",
                recommendationFlags: {
                  appearsWeatherSensitive: false,
                  needsMoreApplianceDetail: false,
                  needsEnvelopeDetail: false,
                  confidenceLimited: false,
                },
                explanationSummary: "manual summary",
                nextDetailPromptType: "NONE",
              },
              derivedInput: {
                derivedInputAttached: true,
                simulationActive: true,
                scoringMode: "BILLING_PERIOD_BASED",
                weatherEfficiencyScore0to100: 54,
                coolingSensitivityScore0to100: 61,
                heatingSensitivityScore0to100: 25,
                confidenceScore0to100: 69,
                shoulderBaselineKwhPerDay: 19,
                coolingSlopeKwhPerCDD: 1.3,
                heatingSlopeKwhPerHDD: 0.5,
                coolingResponseRatio: 0.9,
                heatingResponseRatio: 0.7,
                estimatedWeatherDrivenLoadShare: 0.4,
                estimatedBaseloadShare: 0.6,
                requiredInputAdjustmentsApplied: ["square_footage"],
                poolAdjustmentApplied: false,
                hvacAdjustmentApplied: true,
                occupancyAdjustmentApplied: false,
                thermostatAdjustmentApplied: true,
                scoreVersion: "weather-sensitivity-v1",
                calculationVersion: "weather-sensitivity-v1",
              },
            },
          },
          baselineDatasetProjection: {
            dataset: {
              meta: {
                buildInputsHash: "build-hash-1",
                fullChainHash: "full-chain-hash-1",
                actualContextHouseId: "source-house-1",
                weatherLogicMode: "LAST_YEAR_ACTUAL_WEATHER",
                sharedProducerPathUsed: true,
                sourceDerivedMonthlyTotalsKwhByMonth: { "2026-03": 940 },
                sourceDerivedAnnualTotalKwh: 11280,
                excludedDateKeysCount: 2,
                excludedDateKeysFingerprint: "travel-1",
                intervalUsageFingerprintIdentity: "shape-identity-1",
                lockboxInput: {
                  sourceContext: {
                    sourceHouseId: "source-house-1",
                    intervalFingerprint: "interval-fingerprint-1",
                    weatherIdentity: "weather-identity-1",
                    sourceDerivedMonthlyTotalsKwhByMonth: { "2026-03": 940 },
                    sourceDerivedAnnualTotalKwh: 11280,
                  },
                  profileContext: {
                    profileHouseId: "test-house-1",
                    usageShapeProfileIdentity: "shape-identity-1",
                  },
                  travelRanges: {
                    ranges: [{ startDate: "2026-03-15", endDate: "2026-03-16" }],
                  },
                  validationKeys: {
                    localDateKeys: ["2026-03-10"],
                    selectionMode: "stratified_weather_balanced",
                  },
                },
                lockboxPerDayTrace: [
                  {
                    localDate: "2026-03-10",
                    simulatedReasonCode: "MANUAL_CONSTRAINED_DAY",
                    dayClassification: "weather_scaled_day",
                    finalDayKwh: 29,
                    displayDayKwh: 29,
                    intervalSumKwh: 29,
                  },
                ],
                simulatedDayDiagnosticsSample: [
                  {
                    localDate: "2026-03-10",
                    targetDayKwhBeforeWeather: 26,
                    weatherAdjustedDayKwh: 29,
                    dayTypeUsed: "weekday",
                    shapeVariantUsed: "month_weekday",
                    finalDayKwh: 29,
                    intervalSumKwh: 29,
                    fallbackLevel: "month_daytype",
                  },
                ],
                manualMonthlyWeatherEvidenceSummary: {
                  dailyWeatherResponsiveness: "weather_driven",
                  baseloadShare: 0.52,
                  hvacShare: 0.48,
                  heatingSensitivity: 0.7,
                  coolingSensitivity: 1.2,
                },
                monthlyTargetConstructionDiagnostics: [{ month: "2026-03", targetKwh: 900 }],
                weatherEfficiencyDerivedInput: {
                  derivedInputAttached: true,
                  simulationActive: true,
                  scoringMode: "BILLING_PERIOD_BASED",
                },
              },
              monthly: [{ month: "2026-03", totalKwh: 910 }],
              daily: [{ date: "2026-03-10", kwh: 29 }],
              series: { intervals15: [{ timestamp: "2026-03-10T00:00:00.000Z", kwh: 0.2 }] },
            },
          },
        },
        pastSimSnapshot: {
          reads: {
            baselineProjection: {
              dataset: {
                meta: {
                  weatherSensitivityScore: {
                    scoringMode: "INTERVAL_BASED",
                    weatherEfficiencyScore0to100: 62,
                  },
                },
              },
            },
          },
        },
        derived: {
          actualHouseCompareProjection: {
            rows: [{ localDate: "2026-03-10", actualDayKwh: 31, simulatedDayKwh: 29 }],
          },
          testHouseCompareProjection: {
            rows: [{ localDate: "2026-03-10", actualDayKwh: 31, simulatedDayKwh: 29 }],
          },
        },
        requestDebug: [{ step: "run_test_home_canonical_recalc", ok: true }],
      },
      new Date("2026-04-09T18:30:00.000Z")
    );

    expect(payload.exportedAt).toBe("2026-04-09T18:30:00.000Z");
    expect(payload.runIdentity).toMatchObject({
      sourceUserId: "user-1",
      sourceHouseId: "source-house-1",
      testHouseId: "test-house-1",
      scenarioId: "scenario-1",
      simulatorMode: "MANUAL_TOTALS",
      usageInputMode: "MANUAL_MONTHLY",
      adminSimulationTreatmentMode: "MANUAL_MONTHLY",
      weatherLogicMode: "LAST_YEAR_ACTUAL_WEATHER",
      validationMode: "stratified_weather_balanced",
      buildId: "build-1",
      buildInputsHash: "build-hash-1",
      artifactId: "artifact-1",
      artifactInputHash: "artifact-hash-1",
      fullChainHash: "full-chain-hash-1",
      artifactEngineVersion: "engine-v1",
      correlationId: "corr-1",
      anchorEndDate: "2026-04-07",
      billEndDay: "7",
      dateSourceMode: "AUTO_DATES",
    });
    expect(payload.sourceTruthContext).toMatchObject({
      sourceIntervalFingerprint: "interval-fingerprint-1",
      weatherIdentity: "weather-identity-1",
      usageShapeProfileIdentity: "shape-identity-1",
    });
    expect(payload.manualStage1Contract).toMatchObject({
      anchorEndDate: "2026-04-07",
      billEndDay: "7",
      manualBillPeriodTotalsKwhById: { "bp-1": 900 },
      normalizedMonthTargetsByMonth: { "2026-03": 900 },
    });
    expect(payload.sharedWeatherEfficiency).toMatchObject({
      actualIntervalWeather: {
        scoringMode: "INTERVAL_BASED",
        simulationActive: true,
      },
      manualMonthlyWeather: {
        scoringMode: "BILLING_PERIOD_BASED",
        simulationActive: true,
      },
      weatherDeltaVsActual: {
        weatherEfficiencyScoreDelta: -8,
        coolingSensitivityScoreDelta: -9,
      },
    });
    expect(payload.sharedCalculationInputs).toMatchObject({
      weatherEfficiencyDerivedInput: {
        derivedInputAttached: true,
        simulationActive: true,
      },
      manualMonthlyWeatherEvidenceSummary: {
        dailyWeatherResponsiveness: "weather_driven",
      },
      monthlyTargetConstructionDiagnostics: [{ month: "2026-03", targetKwh: 900 }],
      exclusionCounts: {
        excludedDateKeysCount: 2,
      },
    });
    expect(payload.stage2SimOutputs).toMatchObject({
      monthlyTotalsByMonth: [{ month: "2026-03", totalKwh: 910 }],
      intervalCount: 1,
      dailyRowCount: 1,
      sharedProducerPathUsed: true,
    });
    expect(payload.parityAndReconciliation.parityRows).toHaveLength(1);
    expect(payload.actualVsSimCompare).toMatchObject({
      compareMetrics: {
        WAPE: 0.08,
        compareRowsCount: 2,
      },
    });
    expect(payload.actualVsSimCompare.compareRows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          date: "2026-03-10",
          actualKwh: 31,
          simKwh: 29,
        }),
      ])
    );
    expect(payload.dailyShapeTuning).toMatchObject({
      rawPerDayActualVsSimCurveCompareSummaries: expect.any(Array),
      slotLevelMetricsSummaries: expect.any(Array),
    });
    expect(payload.tuningLeversSummary).toMatchObject({
      monthlyConstraintQuality: "strong",
      weatherScalingBehavior: "moderate",
      fallbackFrequency: "low",
      trustedReferencePoolQuality: "high",
    });
  });
});
