import { describe, expect, it } from "vitest";
import { buildSharedPastSimDiagnostics } from "@/modules/usageSimulator/sharedDiagnostics";

describe("buildSharedPastSimDiagnostics manual monthly constrained artifact fields", () => {
  it("surfaces persisted manual evidence, bill-period contract, and source-derived monthly anchors", () => {
    const diagnostics = buildSharedPastSimDiagnostics({
      callerType: "gapfill_test",
      scenarioId: "past-s1",
      usageInputMode: "MONTHLY_FROM_SOURCE_INTERVALS",
      readMode: "artifact_only",
      projectionMode: "baseline",
      compareProjection: {
        rows: [{ localDate: "2025-07-04", simulatedDayKwh: 31, actualDayKwh: 30 }],
        metrics: { wape: 4.2 },
      },
      dataset: {
        daily: [{ date: "2025-07-04", kwh: 30, source: "ACTUAL_VALIDATION_TEST_DAY" }],
        meta: {
          weatherSourceSummary: "actual_only",
          validationOnlyDateKeysLocal: ["2025-07-04"],
          manualTravelVacantDonorSource: "same_run_simulated_non_travel_days",
          manualTravelVacantDonorDayCount: 27,
          manualMonthlyInputState: {
            enteredMonthKeys: ["2025-06", "2025-07"],
            missingMonthKeys: [],
          },
          manualMonthlyWeatherEvidenceSummary: {
            dailyWeatherResponsiveness: "weather_driven",
            baseloadShare: 0.39,
            hvacShare: 0.61,
            heatingSensitivity: 0.91,
            coolingSensitivity: 1.08,
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
          manualBillPeriods: [
            {
              id: "2025-06",
              month: "2025-06",
              startDate: "2025-05-15",
              endDate: "2025-06-14",
              eligibleForConstraint: true,
            },
          ],
          manualBillPeriodTotalsKwhById: {
            "2025-06": 312.5,
          },
          sourceDerivedMonthlyTotalsKwhByMonth: {
            "2025-06": 312.5,
            "2025-07": 330,
          },
          lockboxInput: {
            mode: "MANUAL_MONTHLY",
            sourceContext: {
              sourceHouseId: "source-house-1",
            },
            validationKeys: {
              localDateKeys: ["2025-07-04"],
            },
          },
        },
      },
    });

    expect(diagnostics.sourceTruthContext.manualMonthlyWeatherEvidenceSummary).toMatchObject({
      dailyWeatherResponsiveness: "weather_driven",
      wholeHomePriorFallbackWeight: 0.3,
    });
    expect(diagnostics.sourceTruthContext).toMatchObject({
      manualTravelVacantDonorSource: "same_run_simulated_non_travel_days",
      manualTravelVacantDonorDayCount: 27,
    });
    expect(diagnostics.sourceTruthContext.manualBillPeriods).toEqual([
      expect.objectContaining({
        id: "2025-06",
        eligibleForConstraint: true,
      }),
    ]);
    expect(diagnostics.sourceTruthContext.manualBillPeriodTotalsKwhById).toMatchObject({
      "2025-06": 312.5,
    });
    expect(diagnostics.sourceTruthContext.sourceDerivedMonthlyTotalsKwhByMonth).toMatchObject({
      "2025-06": 312.5,
      "2025-07": 330,
    });
    expect(diagnostics.projectionReadSummary.compareProjectionSummary).toMatchObject({
      validationRowsCount: 1,
    });
  });

  it("copies source and profile house identities into shared source-truth diagnostics for header projection fallback", () => {
    const diagnostics = buildSharedPastSimDiagnostics({
      callerType: "gapfill_actual",
      scenarioId: "past-s1",
      dataset: {
        meta: {
          lockboxInput: {
            sourceContext: {
              sourceHouseId: "source-house-1",
              intervalFingerprint: "ifp-1",
              weatherIdentity: "wx-1",
            },
            profileContext: {
              profileHouseId: "profile-house-1",
            },
          },
          lockboxPerRunTrace: {
            sourceHouseId: "",
            profileHouseId: "",
          },
        },
      },
    });

    expect(diagnostics.sourceTruthContext).toMatchObject({
      sourceHouseId: "source-house-1",
      profileHouseId: "profile-house-1",
      intervalSourceIdentity: "ifp-1",
      weatherDatasetIdentity: "wx-1",
    });
  });

  it("makes pure manual monthly isolation explicit in shared diagnostics", () => {
    const diagnostics = buildSharedPastSimDiagnostics({
      callerType: "gapfill_test",
      scenarioId: "past-s2",
      usageInputMode: "MANUAL_MONTHLY",
      dataset: {
        meta: {
          trustedIntervalFingerprintDayCount: 0,
          validationOnlyDateKeysLocal: ["2025-07-04"],
          manualBillPeriods: [
            {
              id: "2025-06",
              month: "2025-06",
              startDate: "2025-05-15",
              endDate: "2025-06-14",
              eligibleForConstraint: true,
            },
          ],
          manualBillPeriodTotalsKwhById: {
            "2025-06": 312.5,
          },
          lockboxInput: {
            mode: "MANUAL_MONTHLY",
            sourceContext: {
              sourceHouseId: "source-house-1",
            },
            validationKeys: {
              localDateKeys: ["2025-07-04"],
            },
          },
        },
      },
      compareProjection: {
        rows: [{ localDate: "2025-07-04", simulatedDayKwh: 31, actualDayKwh: 30 }],
        metrics: { wape: 4.2 },
      },
    });

    expect(diagnostics.sourceTruthContext.manualMonthlySimulationPoolIsolation).toMatchObject({
      sourceIntervalsInPool: false,
      trustedIntervalFingerprintInPool: false,
      sourceDerivedMonthlyAnchorsInPool: false,
      compareRowsInPool: false,
      manualMonthlyTotalsHardConstraint: true,
    });
  });
});
