import { describe, expect, it } from "vitest";
import {
  buildValidationCompareProjectionFromDatasets,
  overrideValidationCompareProjectionSimTotals,
  projectBaselineFromCanonicalDataset,
} from "@/modules/usageSimulator/compareProjection";

describe("overrideValidationCompareProjectionSimTotals", () => {
  it("rewrites compare sim totals from raw manual daily rows", () => {
    const out = overrideValidationCompareProjectionSimTotals({
      compareProjection: {
        rows: [
          {
            localDate: "2025-06-03",
            dayType: "weekday",
            actualDayKwh: 50.45,
            simulatedDayKwh: 49.93,
            errorKwh: -0.52,
            percentError: 1.03,
          },
          {
            localDate: "2025-06-04",
            dayType: "weekday",
            actualDayKwh: 42.23,
            simulatedDayKwh: 42.31,
            errorKwh: 0.08,
            percentError: 0.19,
          },
        ],
        metrics: { wape: 0.95 },
      },
      simulatedDailyRows: [
        { date: "2025-06-03", kwh: 50.45 },
        { date: "2025-06-04", kwh: 42.23 },
      ],
    });

    expect(out.rows).toEqual([
      expect.objectContaining({
        localDate: "2025-06-03",
        simulatedDayKwh: 50.45,
        errorKwh: 0,
        percentError: 0,
      }),
      expect.objectContaining({
        localDate: "2025-06-04",
        simulatedDayKwh: 42.23,
        errorKwh: 0,
        percentError: 0,
      }),
    ]);
    expect(out.metrics).toEqual(
      expect.objectContaining({
        mae: 0,
        rmse: 0,
        wape: 0,
        totalActualKwhMasked: 92.68,
        totalSimKwhMasked: 92.68,
        deltaKwhMasked: 0,
        mapeFilteredCount: 2,
      })
    );
  });

  it("rebuilds manual compare rows from explicit actual and simulated datasets", () => {
    const out = buildValidationCompareProjectionFromDatasets({
      validationSourceDataset: {
        meta: { validationOnlyDateKeysLocal: ["2025-06-03", "2025-06-04"], timezone: "America/Chicago" },
      },
      actualDataset: {
        daily: [
          { date: "2025-06-03", kwh: 50.45 },
          { date: "2025-06-04", kwh: 42.23 },
        ],
        dailyWeather: {
          "2025-06-03": { tAvgF: 77.8, tMinF: 69.6, tMaxF: 89.4, hdd65: 0, cdd65: 12.8 },
        },
      },
      simulatedDataset: {
        daily: [
          { date: "2025-06-03", kwh: 49.93 },
          { date: "2025-06-04", kwh: 42.31 },
        ],
      },
    });

    expect(out.rows).toEqual([
      expect.objectContaining({
        localDate: "2025-06-03",
        actualDayKwh: 50.45,
        simulatedDayKwh: 49.93,
        errorKwh: -0.52,
        percentError: 1.03,
      }),
      expect.objectContaining({
        localDate: "2025-06-04",
        actualDayKwh: 42.23,
        simulatedDayKwh: 42.31,
        errorKwh: 0.08,
        percentError: 0.19,
      }),
    ]);
    expect(out.metrics).toEqual(
      expect.objectContaining({
        totalActualKwhMasked: 92.68,
        totalSimKwhMasked: 92.24,
        deltaKwhMasked: -0.44,
      })
    );
  });

  it("does not relabel simulated validation days as actual when actual truth is missing", () => {
    const out = projectBaselineFromCanonicalDataset(
      {
        daily: [{ date: "2025-06-03", kwh: 49.93, source: "SIMULATED", sourceDetail: "SIMULATED" }],
        series: {
          daily: [{ timestamp: "2025-06-03T00:00:00.000Z", kwh: 49.93, source: "SIMULATED" }],
          intervals15: [{ timestamp: "2025-06-03T00:00:00.000Z", kwh: 1.25 }],
        },
        meta: { validationOnlyDateKeysLocal: ["2025-06-03"], timezone: "America/Chicago" },
      },
      "America/Chicago",
      new Map()
    );

    expect(out.daily[0]).toEqual(
      expect.objectContaining({
        date: "2025-06-03",
        kwh: 49.93,
        source: "SIMULATED",
      })
    );
    expect(out.series.daily[0]).toEqual(
      expect.objectContaining({
        kwh: 49.93,
        source: "SIMULATED",
      })
    );
  });
});
