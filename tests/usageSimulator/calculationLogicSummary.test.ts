import { describe, expect, it } from "vitest";
import { buildGapfillCalculationLogicSummary } from "@/modules/usageSimulator/calculationLogicSummary";

function buildFixture(args?: { selectedMode?: string; lockboxMode?: string }) {
  return {
    selectedMode: args?.selectedMode ?? "MANUAL_MONTHLY",
    dataset: {
      daily: [
        { date: "2025-06-14", kwh: 30, sourceDetail: "ACTUAL" },
        { date: "2025-06-15", kwh: 28, sourceDetail: "SIMULATED_MONTHLY_CONSTRAINED_NON_TRAVEL" },
        { date: "2025-06-16", kwh: 26, sourceDetail: "SIMULATED_INCOMPLETE_METER" },
        { date: "2025-07-04", kwh: 32, sourceDetail: "ACTUAL_VALIDATION_TEST_DAY" },
        { date: "2025-07-05", kwh: 34, sourceDetail: "SIMULATED_TEST_DAY" },
      ],
      meta: {
        sharedProducerPathUsed: true,
        weatherSourceSummary: "actual_only",
        lockboxInput: {
          mode: args?.lockboxMode ?? "MANUAL_MONTHLY",
          sourceContext: {
            sourceHouseId: "source-house-1",
            intervalFingerprint: "ifp-lockbox-1",
            weatherIdentity: "wx-lockbox-1",
            sourceDerivedAnnualTotalKwh: 12000,
          },
          profileContext: {
            profileHouseId: "test-home-1",
            testHomeId: "test-home-1",
            homeProfileSnapshotRef: "home-snap-1",
            applianceProfileSnapshotRef: "appliance-snap-1",
            usageShapeProfileIdentity: "shape-prof-1",
          },
          travelRanges: {
            ranges: [{ startDate: "2025-06-10", endDate: "2025-06-12" }],
          },
          validationKeys: {
            localDateKeys: ["2025-07-04", "2025-07-05"],
          },
        },
        lockboxPerRunTrace: {
          sourceHouseId: "source-house-1",
          testHomeId: "test-home-1",
          inputHash: "input-123",
          fullChainHash: "full-123",
        },
        lockboxPerDayTrace: [
          {
            localDate: "2025-06-15",
            simulatedReasonCode: "MONTHLY_CONSTRAINED_NON_TRAVEL_DAY",
            fallbackLevel: "weather_nearest_daytype_regime",
            dayClassification: "weather_scaled_day",
            weatherModeUsed: "cooling",
            shapeVariantUsed: "month_weekday_weather_cooling",
            donorSelectionModeUsed: "weather_nearest_daytype_regime",
            donorCandidatePoolSize: 6,
            selectedDonorLocalDates: ["2025-06-10", "2025-06-13"],
            selectedDonorWeights: [
              { localDate: "2025-06-10", weight: 0.62, distance: 1.2, dayKwh: 32 },
              { localDate: "2025-06-13", weight: 0.38, distance: 2.1, dayKwh: 29 },
            ],
            donorWeatherRegimeUsed: "cooling",
            donorMonthKeyUsed: "2025-06",
            thermalDistanceScore: 1.8,
            broadFallbackUsed: false,
            sameRegimeDonorPoolAvailable: true,
            donorPoolBlendStrategy: "distance_weighted_blend",
            donorPoolKwhSpread: 3,
            donorPoolKwhVariance: 2.25,
            donorPoolMedianKwh: 30.5,
            donorVarianceGuardrailTriggered: false,
            weatherAdjustmentModeUsed: "bounded_post_donor",
            postDonorAdjustmentCoefficient: 1.04,
          },
          {
            localDate: "2025-06-16",
            simulatedReasonCode: "INCOMPLETE_METER_DAY",
            fallbackLevel: "adjacent_month_daytype",
            dayClassification: "normal_day",
            weatherModeUsed: "neutral",
            shapeVariantUsed: "weekdayweekend_weekday",
            donorSelectionModeUsed: "calendar_fallback",
            donorCandidatePoolSize: 0,
            selectedDonorLocalDates: [],
            selectedDonorWeights: [],
            donorWeatherRegimeUsed: null,
            donorMonthKeyUsed: null,
            thermalDistanceScore: null,
            broadFallbackUsed: true,
            sameRegimeDonorPoolAvailable: false,
            donorPoolBlendStrategy: null,
            donorPoolKwhSpread: null,
            donorPoolKwhVariance: null,
            donorPoolMedianKwh: null,
            donorVarianceGuardrailTriggered: false,
            weatherAdjustmentModeUsed: "legacy_training_stats",
            postDonorAdjustmentCoefficient: 1,
          },
        ],
      },
    },
    sharedDiagnostics: {
      identityContext: {
        usageInputMode: args?.selectedMode ?? "MANUAL_MONTHLY",
        simulatorMode: args?.lockboxMode ?? "MANUAL_MONTHLY",
        sourceHouseId: "source-house-1",
        profileHouseId: "test-home-1",
        weatherLogicMode: "LAST_YEAR_ACTUAL_WEATHER",
      },
      sourceTruthContext: {
        intervalSourceIdentity: "ifp-lockbox-1",
        weatherSourceIdentity: "actual_only",
        weatherDatasetIdentity: "wx-lockbox-1",
        intervalUsageFingerprintIdentity: "shape-prof-1",
        manualMonthlyInputState: {
          enteredMonthKeys: ["2025-06", "2025-07"],
          missingMonthKeys: ["2025-08"],
          explicitZeroMonthKeys: [],
        },
        manualMonthlyWeatherEvidenceSummary: {
          dailyWeatherResponsiveness: "weather_driven",
          baseloadShare: 0.41,
          hvacShare: 0.59,
          heatingSensitivity: 0.88,
          coolingSensitivity: 1.14,
          evidenceWeight: 0.7,
          wholeHomePriorFallbackWeight: 0.3,
          eligibleBillPeriodsUsed: [
            {
              id: "2025-06",
              monthKey: "2025-06",
              startDate: "2025-05-15",
              endDate: "2025-06-14",
              targetKwh: 312.5,
              eligibleNonTravelDayCount: 27,
            },
          ],
          excludedTravelTouchedBillPeriods: [
            {
              id: "2025-07",
              monthKey: "2025-07",
              startDate: "2025-06-15",
              endDate: "2025-07-14",
              targetKwh: 330,
              travelVacantDayCount: 3,
            },
          ],
        },
        sourceDerivedMonthlyTotalsKwhByMonth:
          args?.selectedMode === "MONTHLY_FROM_SOURCE_INTERVALS"
            ? {
                "2025-06": 312.5,
                "2025-07": 330,
              }
            : null,
        manualBillPeriods: [
          {
            id: "2025-06",
            month: "2025-06",
            startDate: "2025-05-15",
            endDate: "2025-06-14",
            eligibleForConstraint: true,
          },
          {
            id: "2025-07",
            month: "2025-07",
            startDate: "2025-06-15",
            endDate: "2025-07-14",
            eligibleForConstraint: false,
            exclusionReason: "travel_overlap",
          },
        ],
        manualBillPeriodTotalsKwhById: {
          "2025-06": 312.5,
        },
        monthlyTargetConstructionDiagnostics: [
          {
            month: "2025-06",
            normalizedMonthTarget: 312.5,
            eligibleNonTravelDayCount: 27,
            travelVacantDayCountInMonth: 3,
            monthlyTargetBuildMethod: "normalized_from_non_travel_days",
          },
        ],
        intervalUsageFingerprintDiagnostics: {
          trustedIntervalFingerprintDayCount: 22,
          excludedTravelVacantFingerprintDayCount: 3,
          excludedIncompleteMeterFingerprintDayCount: 1,
          excludedLeadingMissingFingerprintDayCount: 2,
          fingerprintMonthBucketsUsed: ["2025-06"],
          fingerprintWeekdayWeekendBucketsUsed: ["weekday", "weekend"],
          fingerprintWeatherBucketsUsed: ["cooling", "neutral"],
        },
        travelRangesUsed: [{ startDate: "2025-06-10", endDate: "2025-06-12" }],
        validationTestKeysUsed: ["2025-07-04", "2025-07-05"],
      },
      lockboxExecutionSummary: {
        sharedProducerPathUsed: true,
        artifactInputHash: "artifact-hash-1",
        keepRefUtcDateKeyCount: 2,
      },
      projectionReadSummary: {
        readMode: "artifact_only",
        projectionMode: "baseline",
        validationRowsCount: 2,
      },
      tuningSummary: {
        dailySourceClassificationsSummary: {
          simulated_vacant_day: 1,
          modeled_keep_ref: 2,
        },
        selectedValidationRows: [
          { localDate: "2025-07-04", dayType: "weekday", weather: { hdd65: 0, cdd65: 4 } },
          { localDate: "2025-07-05", dayType: "weekend", weather: { hdd65: 0, cdd65: 0 } },
        ],
        fingerprintShapeSummaryByMonthDayType: {
          "2025-06": {
            weekday: { overnight: 0.18, morning: 0.2, afternoon: 0.31, evening: 0.31 },
          },
        },
      },
    },
    compareProjection: {
      rows: [{ localDate: "2025-07-04" }, { localDate: "2025-07-05" }],
      metrics: { wape: 8.1, mae: 1.7 },
    },
    sourceHouseId: "source-house-1",
    testHomeId: "test-home-1",
    sourceTravelRanges: [{ startDate: "2025-05-01", endDate: "2025-05-03" }],
    testHomeTravelRanges: [{ startDate: "2025-06-10", endDate: "2025-06-12" }],
    effectiveTravelRanges: [{ startDate: "2025-06-10", endDate: "2025-06-12" }],
    effectiveTravelRangesSource: "test_home_saved",
    rawCompareDailyRows: [
      { date: "2025-07-04", kwh: 31, source: "SIMULATED", sourceDetail: "SIMULATED_TEST_DAY" },
      { date: "2025-07-05", kwh: 34, source: "SIMULATED", sourceDetail: "SIMULATED_TEST_DAY" },
    ],
  };
}

describe("buildGapfillCalculationLogicSummary", () => {
  it("explains pure manual monthly as manual-driven with source actuals compare-only", () => {
    const summary = buildGapfillCalculationLogicSummary(buildFixture());

    expect(summary.modeFamily).toBe("manual_monthly");
    expect(summary.modeLabel).toContain("Pure Manual Monthly");
    expect(summary.stageOnePath).toContain("saved manual-monthly payload");
    expect(summary.inputGroups.find((group) => group.key === "manual-monthly")?.used).toBe(true);
    expect(summary.inputGroups.find((group) => group.key === "manual-monthly")?.details.join(" ")).toContain("Bill-range semantics");
    expect(summary.inputGroups.find((group) => group.key === "manual-monthly")?.status).toBe("hard truth");
    expect(summary.inputGroups.find((group) => group.key === "source-actual-intervals")?.status).toBe("context only");
    expect(summary.inputGroups.find((group) => group.key === "source-actual-intervals")?.whereEntered).toEqual([
      "compare only",
      "diagnostics only",
    ]);
    expect(summary.inputGroups.find((group) => group.key === "source-actual-intervals")?.priorityBand).toBe("Not Used");
    expect(summary.inputGroups.find((group) => group.key === "manual-monthly")?.evidence.join(" ")).toContain(
      "No source-derived month anchors were attached"
    );
    expect(summary.layers.find((layer) => layer.key === "monthly-target-layer")?.summary).toContain(
      "without using source intervals as Stage 2 drivers"
    );
    expect(summary.dailyTotalLogic.ladder[0]).toMatchObject({
      key: "month_daytype_neighbor",
      observedCount: null,
    });
    expect(summary.dailyTotalLogic.ladder[1]).toMatchObject({
      key: "month_daytype",
      observedCount: null,
    });
    expect(summary.intervalCurveLogic.ladder[0]?.label).toContain("Month + day-type + weather regime");
    expect(summary.sharedProducerPathUsed).toBe(true);
    expect(summary.artifactDecisionSummary.find((item) => item.label === "Manual month coverage")?.value).toContain(
      "Entered: 2025-06, 2025-07"
    );
    expect(
      summary.artifactDecisionSummary.find((item) => item.label === "Stage 1 normalized month targets")?.value
    ).toContain("2025-06: 312.50");
    expect(summary.weatherExplanation.rows.find((row) => row.label === "Manual monthly weather evidence")?.value).toContain(
      "Responsiveness: weather_driven"
    );
    expect(summary.weatherExplanation.rows.find((row) => row.label === "Manual monthly weather evidence")?.value).toContain(
      "Eligible bill periods: 1"
    );
    expect(summary.weatherExplanation.rows.find((row) => row.label === "Whole-home prior blend")?.value).toContain(
      "Prior fallback weight: 0.30"
    );
  });

  it("keeps monthly-from-source mode distinct and source-derived in the explanation", () => {
    const summary = buildGapfillCalculationLogicSummary(
      buildFixture({
        selectedMode: "MONTHLY_FROM_SOURCE_INTERVALS",
        lockboxMode: "MANUAL_MONTHLY",
      })
    );

    expect(summary.modeLabel).toContain("Monthly From Source Intervals");
    expect(summary.modeOverview).toContain("source-derived monthly");
    expect(summary.inputGroups.find((group) => group.key === "source-actual-intervals")?.priorityBand).toBe("Secondary Driver");
    expect(summary.inputGroups.find((group) => group.key === "source-actual-intervals")?.whereEntered).toContain(
      "source-derived monthly fitting"
    );
    expect(summary.inputGroups.find((group) => group.key === "manual-monthly")?.evidence.join(" ")).toContain(
      "Source-derived month anchors survived"
    );
  });

  it("explains annual constraints without surfacing monthly-statement logic", () => {
    const summary = buildGapfillCalculationLogicSummary(
      buildFixture({
        selectedMode: "ANNUAL_FROM_SOURCE_INTERVALS",
        lockboxMode: "MANUAL_ANNUAL",
      })
    );

    expect(summary.modeFamily).toBe("manual_annual");
    expect(summary.modeLabel).toContain("Manual Annual");
    expect(summary.inputGroups.find((group) => group.key === "manual-annual")?.used).toBe(true);
    expect(summary.inputGroups.find((group) => group.key === "manual-monthly")?.used).toBe(false);
    const monthlyLayer = summary.layers.find((layer) => layer.key === "monthly-target-layer");
    expect(monthlyLayer?.summary).toContain("annual total is fixed first");
    expect(monthlyLayer?.modeSpecificRules.join(" ")).not.toContain("Bill-range");
    expect(summary.modeOverview).toContain("annual total stays fixed");
  });

  it("explains actual-backed modes around trusted reference truth and compare scope", () => {
    const summary = buildGapfillCalculationLogicSummary(
      buildFixture({
        selectedMode: "EXACT_INTERVALS",
        lockboxMode: "ACTUAL_INTERVAL_BASELINE",
      })
    );

    expect(summary.modeFamily).toBe("actual_backed");
    expect(summary.modeLabel).toContain("Actual-Backed");
    expect(summary.inputGroups.find((group) => group.key === "source-actual-intervals")?.priorityBand).toBe("Reference Truth Pool");
    expect(summary.layers.find((layer) => layer.key === "compare-layer")?.summary).toContain("artifact-backed");
    expect(summary.priorityItems.some((item) => item.label === "Actual interval pool")).toBe(true);
    expect(summary.compositionSections[0]?.title).toContain("Final stitched output");
    expect(summary.inputGroups.find((group) => group.key === "usage-shape-profile")?.status).toBe("modeled-subset-only");
    expect(summary.inputGroups.find((group) => group.key === "home-profile")).toMatchObject({
      status: "context only",
    });
    expect(summary.dailyTotalLogic.ladder[0]).toMatchObject({
      key: "weather_nearest_daytype_regime",
      observedCount: 1,
    });
    expect(summary.weatherExplanation.rows.find((row) => row.label === "Donor-path usage")?.value).toContain(
      "weather_nearest_daytype_regime: 1"
    );
    expect(summary.weatherExplanation.rows.find((row) => row.label === "True broad fallback usage")?.value).toContain(
      "adjacent_month_daytype: 1"
    );
  });

  it("uses shared diagnostics identities and counts as the source of truth", () => {
    const summary = buildGapfillCalculationLogicSummary(buildFixture());

    expect(summary.sourceHouseId).toBe("source-house-1");
    expect(summary.testHomeId).toBe("test-home-1");
    expect(summary.inputGroups.find((group) => group.key === "weather")?.sourceOfTruth).toContain("LAST_YEAR_ACTUAL_WEATHER");
    expect(summary.exclusions.find((item) => item.label === "Validation/test modeled keep-ref logic")?.value).toBe("2");
    expect(summary.rawDiagnostics.sourceTruthContext).toMatchObject({
      intervalSourceIdentity: "ifp-lockbox-1",
      weatherDatasetIdentity: "wx-lockbox-1",
    });
    expect(summary.compositionSections.find((section) => section.key === "final-output")?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "ACTUAL", dayCount: 1 }),
        expect.objectContaining({ label: "SIMULATED_TEST_DAY", dayCount: 1 }),
      ])
    );
    expect(summary.compositionSections.find((section) => section.key === "compare-output")?.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "SIMULATED_TEST_DAY", dayCount: 2 }),
      ])
    );
    expect(summary.inputGroups.find((group) => group.key === "home-profile")).toMatchObject({
      status: "modeled-subset-only",
    });
    expect(summary.inputGroups.find((group) => group.key === "usage-shape-profile")?.sourceOfTruth).toContain("shape-prof-1");
    expect(summary.weatherExplanation.rows.find((row) => row.label === "Normal vs weather-scaled counts")?.value).toContain(
      "weather_scaled_day: 1"
    );
    expect(summary.runImpactSummary.find((item) => item.label === "Profile-input materiality")?.value).toContain(
      "modeled-subset-only"
    );
    expect(summary.artifactDecisionSummary.find((item) => item.label === "Donor-path usage")?.value).toContain(
      "weather_nearest_daytype_regime: 1"
    );
    expect(summary.artifactDecisionSummary.find((item) => item.label === "True broad daily fallback levels")?.value).toContain(
      "adjacent_month_daytype: 1"
    );
    expect(summary.weatherExplanation.rows.find((row) => row.label === "Donor blend / guardrail usage")?.value).toContain(
      "distance_weighted_blend: 1"
    );
    expect(summary.artifactDecisionSummary.find((item) => item.label === "Most common shape variants")?.value).toContain(
      "month_weekday_weather_cooling: 1"
    );
    expect(summary.shapeBucketSummaries[0]).toMatchObject({
      monthKey: "2025-06",
      dayType: "weekday",
      evening: 0.31,
    });
    expect(summary.inputGroups.find((group) => group.key === "travel-validation")?.details.join(" ")).toContain(
      "Latest effective travel source: test_home_saved"
    );
    expect(summary.rawDiagnostics.sourceTravelRanges).toEqual([{ startDate: "2025-05-01", endDate: "2025-05-03" }]);
    expect(summary.rawDiagnostics.testHomeTravelRanges).toEqual([{ startDate: "2025-06-10", endDate: "2025-06-12" }]);
  });
});
