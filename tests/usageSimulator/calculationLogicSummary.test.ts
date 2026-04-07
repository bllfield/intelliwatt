import { describe, expect, it } from "vitest";
import { buildGapfillCalculationLogicSummary } from "@/modules/usageSimulator/calculationLogicSummary";

function buildFixture(args?: { selectedMode?: string; lockboxMode?: string }) {
  return {
    selectedMode: args?.selectedMode ?? "MONTHLY_FROM_SOURCE_INTERVALS",
    dataset: {
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
            fallbackLevel: "month_daytype_neighbor",
            dayClassification: "weather_scaled_day",
            weatherModeUsed: "cooling",
            shapeVariantUsed: "month_weekday_weather_cooling",
          },
          {
            localDate: "2025-06-16",
            simulatedReasonCode: "INCOMPLETE_METER_DAY",
            fallbackLevel: "adjacent_month_daytype",
            dayClassification: "normal_day",
            weatherModeUsed: "neutral",
            shapeVariantUsed: "weekdayweekend_weekday",
          },
        ],
      },
    },
    sharedDiagnostics: {
      identityContext: {
        usageInputMode: args?.selectedMode ?? "MONTHLY_FROM_SOURCE_INTERVALS",
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
        monthlyTargetConstructionDiagnostics: [
          {
            month: "2025-06",
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
  };
}

describe("buildGapfillCalculationLogicSummary", () => {
  it("explains manual monthly constraints and bill-range semantics", () => {
    const summary = buildGapfillCalculationLogicSummary(buildFixture());

    expect(summary.modeFamily).toBe("manual_monthly");
    expect(summary.modeLabel).toContain("Manual Monthly");
    expect(summary.stageOnePath).toContain("manual-monthly");
    expect(summary.inputGroups.find((group) => group.key === "manual-monthly")?.used).toBe(true);
    expect(summary.inputGroups.find((group) => group.key === "manual-monthly")?.details.join(" ")).toContain("Bill-range semantics");
    expect(summary.layers.find((layer) => layer.key === "monthly-target-layer")?.summary).toContain("Monthly totals are fixed first");
    expect(summary.sharedProducerPathUsed).toBe(true);
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
    expect(summary.inputGroups.find((group) => group.key === "travel-validation")?.details.join(" ")).toContain(
      "Latest effective travel source: test_home_saved"
    );
    expect(summary.rawDiagnostics.sourceTravelRanges).toEqual([{ startDate: "2025-05-01", endDate: "2025-05-03" }]);
    expect(summary.rawDiagnostics.testHomeTravelRanges).toEqual([{ startDate: "2025-06-10", endDate: "2025-06-12" }]);
  });
});
