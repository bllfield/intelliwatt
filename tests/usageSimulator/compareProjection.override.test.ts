import { describe, expect, it } from "vitest";
import { overrideValidationCompareProjectionSimTotals } from "@/modules/usageSimulator/compareProjection";

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
});
