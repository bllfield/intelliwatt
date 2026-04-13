import { describe, expect, it } from "vitest";
import {
  buildDailyCurveComparePayload,
  buildDailyCurveCompareSummary,
} from "@/modules/usageSimulator/dailyCurveCompareSummary";

describe("buildDailyCurveCompareSummary", () => {
  it("filters actual and simulated interval payloads to compare-day dates only", () => {
    const payload = buildDailyCurveComparePayload({
      timezone: "America/Chicago",
      compareRows: [
        {
          localDate: "2025-07-04",
          dayType: "weekday",
          actualDayKwh: 3,
          simulatedDayKwh: 3.5,
          errorKwh: 0.5,
          percentError: 16.7,
        },
      ],
      actualDataset: {
        series: {
          intervals15: [
            { timestamp: "2025-07-04T05:00:00.000Z", kwh: 1 },
            { timestamp: "2025-07-05T05:00:00.000Z", kwh: 9 },
          ],
        },
      },
      simulatedDataset: {
        series: {
          intervals15: [
            { timestamp: "2025-07-04T05:00:00.000Z", kwh: 0.5 },
            { timestamp: "2025-07-05T05:00:00.000Z", kwh: 8 },
          ],
        },
        daily: [
          { date: "2025-07-04", kwh: 3.5, source: "SIMULATED", sourceDetail: "SIMULATED_TEST_DAY" },
          { date: "2025-07-05", kwh: 8, source: "SIMULATED", sourceDetail: "SIMULATED_TEST_DAY" },
        ],
      },
    });

    expect(payload).toEqual({
      selectedDateKeys: ["2025-07-04"],
      actualIntervals15: [{ timestamp: "2025-07-04T05:00:00.000Z", kwh: 1 }],
      simulatedIntervals15: [{ timestamp: "2025-07-04T05:00:00.000Z", kwh: 0.5 }],
      simulatedDailyRows: [{ date: "2025-07-04", kwh: 3.5, source: "SIMULATED", sourceDetail: "SIMULATED_TEST_DAY" }],
    });
  });

  it("builds per-day overlays, aggregates, and slot metrics from artifact-backed compare dates only", () => {
    const summary = buildDailyCurveCompareSummary({
      timezone: "America/Chicago",
      compareRows: [
        {
          localDate: "2025-07-04",
          dayType: "weekday",
          actualDayKwh: 3,
          simulatedDayKwh: 3.5,
          errorKwh: 0.5,
          percentError: 16.7,
          weather: { cdd65: 4, hdd65: 0 },
        },
      ],
      actualDataset: {
        series: {
          intervals15: [
            { timestamp: "2025-07-04T05:00:00.000Z", kwh: 1 },
            { timestamp: "2025-07-04T05:15:00.000Z", kwh: 2 },
            { timestamp: "2025-07-05T05:00:00.000Z", kwh: 9 },
          ],
        },
      },
      simulatedDataset: {
        series: {
          intervals15: [
            { timestamp: "2025-07-04T05:00:00.000Z", kwh: 0.5 },
            { timestamp: "2025-07-04T05:15:00.000Z", kwh: 3 },
            { timestamp: "2025-07-05T05:00:00.000Z", kwh: 8 },
          ],
        },
      },
      rawDailyRows: [
        { date: "2025-07-04", kwh: 3.5, source: "SIMULATED", sourceDetail: "SIMULATED_TEST_DAY" },
      ],
      perDayTrace: [
        {
          localDate: "2025-07-04",
          simulatedReasonCode: "TEST_MODELED_KEEP_REF",
          fallbackLevel: "month_daytype_neighbor",
          shapeVariantUsed: "month_weekday_weather_cooling",
          dayClassification: "weather_scaled_day",
          weatherModeUsed: "cooling",
        },
      ],
    });

    expect(summary).not.toBeNull();
    expect(summary?.selectedDateKeys).toEqual(["2025-07-04"]);
    expect(summary?.days[0]).toMatchObject({
      localDate: "2025-07-04",
      weatherRegime: "cooling",
      peakTimingErrorSlots: 0,
      modeledReasonCode: "TEST_MODELED_KEEP_REF",
      fallbackLevel: "month_daytype_neighbor",
      shapeVariantUsed: "month_weekday_weather_cooling",
      weatherClassification: "weather_scaled_day",
      passthroughStatus: "modeled",
    });
    expect(summary?.days[0]?.slots[0]).toMatchObject({
      actualKwh: 1,
      simulatedKwh: 0.5,
      deltaKwh: -0.5,
    });
    expect(summary?.days[0]?.actualDayKwh).toBe(3);
    expect(summary?.days[0]?.simulatedDayKwh).toBe(3.5);
    expect(summary?.days[0]?.compareSimulatedDayKwh).toBe(3.5);
    expect(summary?.aggregates.some((aggregate) => aggregate.key === "day_type:weekday")).toBe(true);
    expect(summary?.slotMetrics[0]).toMatchObject({
      hhmm: "00:00",
      maeKwh: 0.5,
      rmseKwh: 0.5,
      biasKwh: -0.5,
      sampleCount: 1,
    });
    expect(summary?.metrics.meanPeakMagnitudeErrorKwh).not.toBe(0);
    expect(summary?.metrics.meanCurveCorrelation).not.toBe(1);
    expect(summary?.hourBlockBiases.find((row) => row.label === "Overnight")?.meanBiasKwh).not.toBe(0);
    expect(summary?.rawContext.intervalSources).toMatchObject({
      actual: "actual_house_persisted_intervals15",
      simulated: "test_house_raw_artifact_intervals15",
    });
  });
});
