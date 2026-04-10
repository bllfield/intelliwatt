import { describe, expect, it, vi, beforeEach } from "vitest";

const { logPipeline } = vi.hoisted(() => ({
  logPipeline: vi.fn(),
}));

vi.mock("@/modules/usageSimulator/simObservability", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/modules/usageSimulator/simObservability")>();
  return {
    ...mod,
    logSimPipelineEvent: logPipeline,
  };
});

import { buildPastSimulatedBaselineV1 } from "@/modules/simulatedUsage/engine";
import { dateKeyFromTimestamp, getDayGridTimestamps } from "@/modules/usageSimulator/pastStitchedCurve";

describe("buildPastSimulatedBaselineV1 low-data synthetic branch", () => {
  beforeEach(() => {
    logPipeline.mockReset();
  });

  it("emits internal stage observability and completes via the low-data synthetic fast path", () => {
    const day1StartMs = new Date("2026-01-05T00:00:00.000Z").getTime();
    const day2StartMs = new Date("2026-01-06T00:00:00.000Z").getTime();
    const day1Grid = getDayGridTimestamps(day1StartMs);
    const day2Grid = getDayGridTimestamps(day2StartMs);
    const wx = { tAvgF: 52, tMinF: 44, tMaxF: 60, hdd65: 12, cdd65: 0 };
    const debugOut: Record<string, unknown> = {};

    const out = buildPastSimulatedBaselineV1({
      actualIntervals: [],
      canonicalDayStartsMs: [day1StartMs, day2StartMs],
      excludedDateKeys: new Set<string>([
        dateKeyFromTimestamp(day1Grid[0]!),
        dateKeyFromTimestamp(day2Grid[0]!),
      ]),
      dateKeyFromTimestamp,
      getDayGridTimestamps,
      collectSimulatedDayResults: true,
      actualWxByDateKey: new Map([
        [dateKeyFromTimestamp(day1Grid[0]!), wx],
        [dateKeyFromTimestamp(day2Grid[0]!), wx],
      ]),
      usageShapeProfile: {
        weekdayAvgByMonthKey: { "2026-01": 24 },
        weekendAvgByMonthKey: { "2026-01": 18 },
      },
      lowDataSyntheticContext: {
        mode: "MANUAL_TOTALS",
        canonicalMonthKeys: ["2026-01"],
        intradayShape96: Array.from({ length: 96 }, () => 1 / 96),
        weekdayWeekendShape96: {
          weekday: Array.from({ length: 96 }, () => 1 / 96),
          weekend: Array.from({ length: 96 }, () => 1 / 96),
        },
      },
      debug: { out: debugOut as any },
      observability: {
        correlationId: "cid-low-data",
        houseId: "house-1",
        userId: "user-1",
        buildPathKind: "recalc",
        source: "unit-test",
      },
    });

    expect(out.intervals).toHaveLength(192);
    expect(out.dayResults).toHaveLength(2);
    expect(out.dayResults[0]).toMatchObject({
      fallbackLevel: "month_daytype",
      donorSelectionModeUsed: "low_data_month_daytype",
      weatherModeUsed: "neutral",
    });
    expect(debugOut).toMatchObject({
      lowDataSyntheticContextUsed: true,
      lowDataSyntheticMode: "MANUAL_TOTALS",
      exactIntervalReferencePreparationSkipped: true,
      lowDataSummarizedSourceTruthUsed: true,
      simulatedDays: 2,
    });

    const events = logPipeline.mock.calls.map(([eventName]) => eventName);
    expect(events).toEqual(
      expect.arrayContaining([
        "buildPastSimulatedBaselineV1_stage_entry",
        "buildPastSimulatedBaselineV1_stage_low_data_branch_selected",
        "buildPastSimulatedBaselineV1_stage_reference_pool_ready",
        "buildPastSimulatedBaselineV1_stage_synthetic_day_targets_ready",
        "buildPastSimulatedBaselineV1_stage_shape_context_ready",
        "buildPastSimulatedBaselineV1_stage_per_day_loop_start",
        "buildPastSimulatedBaselineV1_stage_per_day_loop_success",
        "buildPastSimulatedBaselineV1_stage_success",
      ])
    );
  });

  it("labels low-data non-travel days as manual constrained and makes them weather-responsive when evidence is attached", () => {
    const day1StartMs = new Date("2026-01-05T00:00:00.000Z").getTime();
    const day2StartMs = new Date("2026-01-06T00:00:00.000Z").getTime();
    const day1Grid = getDayGridTimestamps(day1StartMs);
    const day2Grid = getDayGridTimestamps(day2StartMs);

    const out = buildPastSimulatedBaselineV1({
      actualIntervals: [],
      canonicalDayStartsMs: [day1StartMs, day2StartMs],
      excludedDateKeys: new Set<string>(),
      dateKeyFromTimestamp,
      getDayGridTimestamps,
      collectSimulatedDayResults: true,
      actualWxByDateKey: new Map([
        [
          dateKeyFromTimestamp(day1Grid[0]!),
          { tAvgF: 35, tMinF: 28, tMaxF: 42, hdd65: 24, cdd65: 0 },
        ],
        [
          dateKeyFromTimestamp(day2Grid[0]!),
          { tAvgF: 92, tMinF: 80, tMaxF: 100, hdd65: 0, cdd65: 22 },
        ],
      ]),
      usageShapeProfile: {
        weekdayAvgByMonthKey: { "2026-01": 24 },
        weekendAvgByMonthKey: { "2026-01": 18 },
      },
      modeledKeepRefReasonCode: "MANUAL_CONSTRAINED_DAY",
      defaultModeledReasonCode: "INCOMPLETE_METER_DAY",
      lowDataSyntheticContext: {
        mode: "MANUAL_TOTALS",
        canonicalMonthKeys: ["2026-01"],
        intradayShape96: Array.from({ length: 96 }, (_, idx) => (idx >= 56 && idx < 84 ? 2 : 1)),
        weekdayWeekendShape96: {
          weekday: Array.from({ length: 96 }, (_, idx) => (idx >= 56 && idx < 84 ? 2 : 1)),
          weekend: Array.from({ length: 96 }, () => 1),
        },
        weatherEvidenceSummary: {
          inputMonthKeys: ["2026-01"],
          missingMonthKeys: [],
          explicitTravelRangesUsed: [],
          eligibleBillPeriodsUsed: [
            {
              id: "2026-01",
              monthKey: "2026-01",
              startDate: "2026-01-01",
              endDate: "2026-01-31",
              targetKwh: 620,
              eligibleNonTravelDayCount: 31,
            },
          ],
          excludedTravelTouchedBillPeriods: [],
          monthlyWeatherPressureInputsUsed: [
            {
              billPeriodId: "2026-01",
              monthKey: "2026-01",
              avgDailyTargetKwh: 20,
              avgHdd: 10,
              avgCdd: 4,
              avgTempC: 18,
            },
          ],
          evidenceWeight: 0.7,
          wholeHomePriorFallbackWeight: 0.3,
          baseloadShare: 0.35,
          hvacShare: 0.65,
          heatingSensitivity: 1.1,
          coolingSensitivity: 1.2,
          dailyWeatherResponsiveness: "weather_driven",
          byMonth: {
            "2026-01": {
              monthKey: "2026-01",
              targetAvgDailyKwh: 20,
              evidenceSource: "eligible_bill_period",
              drivingBillPeriodIds: ["2026-01"],
              eligibleNonTravelDayCount: 31,
              excludedTravelDayCount: 0,
              eligibleBillPeriodCount: 1,
              excludedTravelTouchedBillPeriodCount: 0,
              baseloadShare: 0.35,
              hvacShare: 0.65,
              heatingSensitivity: 1.1,
              coolingSensitivity: 1.2,
              referenceDailyHdd: 10,
              referenceDailyCdd: 4,
              referenceAvgTempC: 18,
            },
          },
        },
      },
    });

    expect(out.dayResults).toHaveLength(2);
    expect(out.dayResults.every((row) => row.simulatedReasonCode === "MANUAL_CONSTRAINED_DAY")).toBe(true);
    expect(out.dayResults.every((row) => row.templateSelectionKind === "shared_modeled_day_template")).toBe(true);
    expect(out.dayResults[0]?.dayClassification).toBe("weather_scaled_day");
    expect(out.dayResults[1]?.dayClassification).toBe("weather_scaled_day");
    expect(out.dayResults[0]?.weatherModeUsed).toBe("heating");
    expect(out.dayResults[1]?.weatherModeUsed).toBe("cooling");
    expect(out.dayResults[0]?.finalDayKwh).not.toBeCloseTo(out.dayResults[1]?.finalDayKwh ?? 0, 6);
  });

  it("whole_home_only still honors low-data manual evidence month targets instead of falling back to prior-only plateaus", () => {
    const janStartMs = new Date("2026-01-05T00:00:00.000Z").getTime();
    const febStartMs = new Date("2026-02-05T00:00:00.000Z").getTime();
    const janGrid = getDayGridTimestamps(janStartMs);
    const febGrid = getDayGridTimestamps(febStartMs);

    const out = buildPastSimulatedBaselineV1({
      actualIntervals: [],
      canonicalDayStartsMs: [janStartMs, febStartMs],
      excludedDateKeys: new Set<string>([
        dateKeyFromTimestamp(janGrid[0]!),
        dateKeyFromTimestamp(febGrid[0]!),
      ]),
      dateKeyFromTimestamp,
      getDayGridTimestamps,
      collectSimulatedDayResults: true,
      actualWxByDateKey: new Map([
        [dateKeyFromTimestamp(janGrid[0]!), { tAvgF: 38, tMinF: 30, tMaxF: 46, hdd65: 20, cdd65: 0 }],
        [dateKeyFromTimestamp(febGrid[0]!), { tAvgF: 78, tMinF: 70, tMaxF: 86, hdd65: 0, cdd65: 12 }],
      ]),
      usageShapeProfile: {
        weekdayAvgByMonthKey: { "2026-01": 24, "2026-02": 24 },
        weekendAvgByMonthKey: { "2026-01": 18, "2026-02": 18 },
      },
      resolvedSimFingerprint: {
        blendMode: "whole_home_only",
        underlyingSourceMix: "whole_home_only",
      } as any,
      lowDataSyntheticContext: {
        mode: "MANUAL_TOTALS",
        canonicalMonthKeys: ["2026-01", "2026-02"],
        intradayShape96: Array.from({ length: 96 }, (_, idx) => (idx >= 56 && idx < 84 ? 2 : 1)),
        weekdayWeekendShape96: {
          weekday: Array.from({ length: 96 }, (_, idx) => (idx >= 56 && idx < 84 ? 2 : 1)),
          weekend: Array.from({ length: 96 }, () => 1),
        },
        weatherEvidenceSummary: {
          inputMonthKeys: ["2026-01", "2026-02"],
          missingMonthKeys: [],
          explicitTravelRangesUsed: [{ startDate: "2026-01-10", endDate: "2026-01-12" }],
          eligibleBillPeriodsUsed: [
            {
              id: "2026-02",
              monthKey: "2026-02",
              startDate: "2026-02-01",
              endDate: "2026-02-28",
              targetKwh: 560,
              eligibleNonTravelDayCount: 28,
            },
          ],
          excludedTravelTouchedBillPeriods: [
            {
              id: "2026-01",
              monthKey: "2026-01",
              startDate: "2026-01-01",
              endDate: "2026-01-31",
              targetKwh: 620,
              travelVacantDayCount: 3,
            },
          ],
          monthlyWeatherPressureInputsUsed: [
            {
              billPeriodId: "2026-02",
              monthKey: "2026-02",
              avgDailyTargetKwh: 20,
              avgHdd: 0,
              avgCdd: 12,
              avgTempC: 24,
            },
          ],
          evidenceWeight: 0.45,
          wholeHomePriorFallbackWeight: 0.55,
          baseloadShare: 0.38,
          hvacShare: 0.62,
          heatingSensitivity: 1.05,
          coolingSensitivity: 1.1,
          dailyWeatherResponsiveness: "weather_driven",
          byMonth: {
            "2026-01": {
              monthKey: "2026-01",
              targetAvgDailyKwh: 11,
              evidenceSource: "inferred_from_eligible_periods",
              drivingBillPeriodIds: [],
              eligibleNonTravelDayCount: 0,
              excludedTravelDayCount: 3,
              eligibleBillPeriodCount: 0,
              excludedTravelTouchedBillPeriodCount: 1,
              baseloadShare: 0.38,
              hvacShare: 0.62,
              heatingSensitivity: 1.05,
              coolingSensitivity: 1.1,
              referenceDailyHdd: 18,
              referenceDailyCdd: 0,
              referenceAvgTempC: 4,
            },
            "2026-02": {
              monthKey: "2026-02",
              targetAvgDailyKwh: 20,
              evidenceSource: "eligible_bill_period",
              drivingBillPeriodIds: ["2026-02"],
              eligibleNonTravelDayCount: 28,
              excludedTravelDayCount: 0,
              eligibleBillPeriodCount: 1,
              excludedTravelTouchedBillPeriodCount: 0,
              baseloadShare: 0.38,
              hvacShare: 0.62,
              heatingSensitivity: 1.05,
              coolingSensitivity: 1.1,
              referenceDailyHdd: 0,
              referenceDailyCdd: 12,
              referenceAvgTempC: 24,
            },
          },
        },
      },
    });

    const janDay = out.dayResults.find((row) => row.localDate === "2026-01-05");
    const febDay = out.dayResults.find((row) => row.localDate === "2026-02-05");
    expect(janDay?.targetDayKwhBeforeWeather).toBeDefined();
    expect(febDay?.targetDayKwhBeforeWeather).toBeDefined();
    expect(janDay?.simulatedReasonCode).toBe("TRAVEL_VACANT");
    expect(febDay?.simulatedReasonCode).toBe("TRAVEL_VACANT");
    expect(janDay?.templateSelectionKind).toBe("shared_modeled_day_template");
    expect(febDay?.templateSelectionKind).toBe("shared_modeled_day_template");
    expect(febDay!.targetDayKwhBeforeWeather).toBeGreaterThan(janDay!.targetDayKwhBeforeWeather!);
    expect(janDay?.shapeVariantUsed).not.toBe("uniform_fallback");
    expect(febDay?.shapeVariantUsed).not.toBe("uniform_fallback");
  });

  it("reuses simulated non-travel manual days as the donor pool for pure-manual travel/vacant days", () => {
    const donorStarts = [
      "2026-01-05T00:00:00.000Z",
      "2026-01-06T00:00:00.000Z",
      "2026-01-07T00:00:00.000Z",
    ].map((value) => new Date(value).getTime());
    const travelStarts = [
      "2026-01-08T00:00:00.000Z",
      "2026-01-09T00:00:00.000Z",
    ].map((value) => new Date(value).getTime());
    const allStarts = [...donorStarts, ...travelStarts];
    const allDateKeys = allStarts.map((value) => dateKeyFromTimestamp(getDayGridTimestamps(value)[0]!));
    const debugOut: Record<string, unknown> = {};

    const out = buildPastSimulatedBaselineV1({
      actualIntervals: [],
      canonicalDayStartsMs: allStarts,
      excludedDateKeys: new Set<string>(allDateKeys.slice(3)),
      dateKeyFromTimestamp,
      getDayGridTimestamps,
      collectSimulatedDayResults: true,
      actualWxByDateKey: new Map([
        ["2026-01-05", { tAvgF: 78, tMinF: 70, tMaxF: 86, hdd65: 0, cdd65: 13 }],
        ["2026-01-06", { tAvgF: 56, tMinF: 49, tMaxF: 63, hdd65: 9, cdd65: 0 }],
        ["2026-01-07", { tAvgF: 31, tMinF: 22, tMaxF: 39, hdd65: 34, cdd65: 0 }],
        ["2026-01-08", { tAvgF: 27, tMinF: 18, tMaxF: 35, hdd65: 38, cdd65: 0 }],
        ["2026-01-09", { tAvgF: 90, tMinF: 80, tMaxF: 98, hdd65: 0, cdd65: 20 }],
      ]),
      usageShapeProfile: {
        weekdayAvgByMonthKey: { "2026-01": 24 },
        weekendAvgByMonthKey: { "2026-01": 18 },
      },
      modeledKeepRefReasonCode: "MANUAL_CONSTRAINED_DAY",
      defaultModeledReasonCode: "MANUAL_CONSTRAINED_DAY",
      lowDataSyntheticContext: {
        mode: "MANUAL_TOTALS",
        canonicalMonthKeys: ["2026-01"],
        intradayShape96: Array.from({ length: 96 }, (_, idx) => (idx >= 56 && idx < 84 ? 2 : 1)),
        weekdayWeekendShape96: {
          weekday: Array.from({ length: 96 }, (_, idx) => (idx >= 56 && idx < 84 ? 2 : 1)),
          weekend: Array.from({ length: 96 }, () => 1),
        },
        weatherEvidenceSummary: {
          inputMonthKeys: ["2026-01"],
          missingMonthKeys: [],
          explicitTravelRangesUsed: [{ startDate: "2026-01-08", endDate: "2026-01-09" }],
          eligibleBillPeriodsUsed: [
            {
              id: "2026-01",
              monthKey: "2026-01",
              startDate: "2026-01-01",
              endDate: "2026-01-31",
              targetKwh: 620,
              eligibleNonTravelDayCount: 29,
            },
          ],
          excludedTravelTouchedBillPeriods: [],
          monthlyWeatherPressureInputsUsed: [
            {
              billPeriodId: "2026-01",
              monthKey: "2026-01",
              avgDailyTargetKwh: 20,
              avgHdd: 12,
              avgCdd: 4,
              avgTempC: 16,
            },
          ],
          evidenceWeight: 0.7,
          wholeHomePriorFallbackWeight: 0.3,
          baseloadShare: 0.34,
          hvacShare: 0.66,
          heatingSensitivity: 1.1,
          coolingSensitivity: 1.15,
          dailyWeatherResponsiveness: "weather_driven",
          byMonth: {
            "2026-01": {
              monthKey: "2026-01",
              targetAvgDailyKwh: 20,
              evidenceSource: "eligible_bill_period",
              drivingBillPeriodIds: ["2026-01"],
              eligibleNonTravelDayCount: 29,
              excludedTravelDayCount: 2,
              eligibleBillPeriodCount: 1,
              excludedTravelTouchedBillPeriodCount: 0,
              baseloadShare: 0.34,
              hvacShare: 0.66,
              heatingSensitivity: 1.1,
              coolingSensitivity: 1.15,
              referenceDailyHdd: 12,
              referenceDailyCdd: 4,
              referenceAvgTempC: 16,
            },
          },
        },
      },
      debug: { out: debugOut as any },
    });

    const travelRows = out.dayResults.filter((row) => row.simulatedReasonCode === "TRAVEL_VACANT");
    expect(travelRows).toHaveLength(2);
    expect(debugOut).toMatchObject({
      manualSimulatedReferencePoolUsed: true,
      manualSimulatedReferencePoolDayCount: 3,
    });
    expect(travelRows.every((row) => (row.selectedDonorLocalDates?.length ?? 0) > 0)).toBe(true);
    expect(
      travelRows.every((row) =>
        (row.selectedDonorLocalDates ?? []).every((localDate) =>
          ["2026-01-05", "2026-01-06", "2026-01-07"].includes(localDate)
        )
      )
    ).toBe(true);
    expect(travelRows.every((row) => row.donorSelectionModeUsed !== "low_data_month_daytype")).toBe(true);
    expect(travelRows.every((row) => row.weatherAdjustmentModeUsed === "bounded_post_donor")).toBe(true);
  });

  it("keeps pure-manual travel/vacant days on the shared donor ladder instead of the flat low-data fast path", () => {
    const donorStarts = [
      "2026-01-05T00:00:00.000Z",
      "2026-01-06T00:00:00.000Z",
      "2026-01-07T00:00:00.000Z",
    ].map((value) => new Date(value).getTime());
    const travelStarts = [
      "2026-01-08T00:00:00.000Z",
      "2026-01-09T00:00:00.000Z",
    ].map((value) => new Date(value).getTime());
    const allStarts = [...donorStarts, ...travelStarts];
    const allDateKeys = allStarts.map((value) => dateKeyFromTimestamp(getDayGridTimestamps(value)[0]!));

    const out = buildPastSimulatedBaselineV1({
      actualIntervals: [],
      canonicalDayStartsMs: allStarts,
      excludedDateKeys: new Set<string>(allDateKeys.slice(3)),
      dateKeyFromTimestamp,
      getDayGridTimestamps,
      collectSimulatedDayResults: true,
      actualWxByDateKey: new Map([
        ["2026-01-05", { tAvgF: 72, tMinF: 64, tMaxF: 80, hdd65: 0, cdd65: 10 }],
        ["2026-01-06", { tAvgF: 50, tMinF: 43, tMaxF: 57, hdd65: 15, cdd65: 0 }],
        ["2026-01-07", { tAvgF: 29, tMinF: 18, tMaxF: 37, hdd65: 36, cdd65: 0 }],
        ["2026-01-08", { tAvgF: 24, tMinF: 14, tMaxF: 31, hdd65: 41, cdd65: 0 }],
        ["2026-01-09", { tAvgF: 92, tMinF: 82, tMaxF: 100, hdd65: 0, cdd65: 24 }],
      ]),
      usageShapeProfile: {
        weekdayAvgByMonthKey: { "2026-01": 23 },
        weekendAvgByMonthKey: { "2026-01": 18 },
      },
      modeledKeepRefReasonCode: "MANUAL_CONSTRAINED_DAY",
      defaultModeledReasonCode: "MANUAL_CONSTRAINED_DAY",
      lowDataSyntheticContext: {
        mode: "MANUAL_TOTALS",
        canonicalMonthKeys: ["2026-01"],
        intradayShape96: Array.from({ length: 96 }, (_, idx) => (idx >= 60 && idx < 80 ? 3 : 1)),
        weekdayWeekendShape96: {
          weekday: Array.from({ length: 96 }, (_, idx) => (idx >= 60 && idx < 80 ? 3 : 1)),
          weekend: Array.from({ length: 96 }, () => 1),
        },
        weatherEvidenceSummary: {
          inputMonthKeys: ["2026-01"],
          missingMonthKeys: [],
          explicitTravelRangesUsed: [{ startDate: "2026-01-08", endDate: "2026-01-09" }],
          eligibleBillPeriodsUsed: [
            {
              id: "2026-01",
              monthKey: "2026-01",
              startDate: "2026-01-01",
              endDate: "2026-01-31",
              targetKwh: 620,
              eligibleNonTravelDayCount: 29,
            },
          ],
          excludedTravelTouchedBillPeriods: [],
          monthlyWeatherPressureInputsUsed: [
            {
              billPeriodId: "2026-01",
              monthKey: "2026-01",
              avgDailyTargetKwh: 20,
              avgHdd: 12,
              avgCdd: 4,
              avgTempC: 16,
            },
          ],
          evidenceWeight: 0.7,
          wholeHomePriorFallbackWeight: 0.3,
          baseloadShare: 0.34,
          hvacShare: 0.66,
          heatingSensitivity: 1.1,
          coolingSensitivity: 1.15,
          dailyWeatherResponsiveness: "weather_driven",
          byMonth: {
            "2026-01": {
              monthKey: "2026-01",
              targetAvgDailyKwh: 20,
              evidenceSource: "eligible_bill_period",
              drivingBillPeriodIds: ["2026-01"],
              eligibleNonTravelDayCount: 29,
              excludedTravelDayCount: 2,
              eligibleBillPeriodCount: 1,
              excludedTravelTouchedBillPeriodCount: 0,
              baseloadShare: 0.34,
              hvacShare: 0.66,
              heatingSensitivity: 1.1,
              coolingSensitivity: 1.15,
              referenceDailyHdd: 12,
              referenceDailyCdd: 4,
              referenceAvgTempC: 16,
            },
          },
        },
      },
    });

    const coldTravelDay = out.dayResults.find((row) => row.localDate === "2026-01-08");
    const hotTravelDay = out.dayResults.find((row) => row.localDate === "2026-01-09");
    expect(coldTravelDay?.simulatedReasonCode).toBe("TRAVEL_VACANT");
    expect(hotTravelDay?.simulatedReasonCode).toBe("TRAVEL_VACANT");
    expect(coldTravelDay?.fallbackLevel).toMatch(/^weather_nearest_daytype/);
    expect(hotTravelDay?.fallbackLevel).toMatch(/^weather_nearest_daytype/);
    expect(coldTravelDay?.selectedDonorLocalDates).not.toEqual(hotTravelDay?.selectedDonorLocalDates);
    expect(coldTravelDay?.intervals15).not.toEqual(hotTravelDay?.intervals15);
  });

});
