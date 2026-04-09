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
          baseloadShare: 0.35,
          hvacShare: 0.65,
          heatingSensitivity: 1.1,
          coolingSensitivity: 1.2,
          dailyWeatherResponsiveness: "weather_driven",
          byMonth: {
            "2026-01": {
              monthKey: "2026-01",
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
    expect(out.dayResults[0]?.dayClassification).toBe("weather_scaled_day");
    expect(out.dayResults[1]?.dayClassification).toBe("weather_scaled_day");
    expect(out.dayResults[0]?.weatherModeUsed).toBe("heating");
    expect(out.dayResults[1]?.weatherModeUsed).toBe("cooling");
    expect(out.dayResults[0]?.finalDayKwh).not.toBeCloseTo(out.dayResults[1]?.finalDayKwh ?? 0, 6);
  });
});
