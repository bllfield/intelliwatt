import { describe, expect, it } from "vitest";
import { buildDailyCurveCompareSummary } from "@/modules/usageSimulator/dailyCurveCompareSummary";

describe("buildDailyCurveCompareSummary", () => {
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
            { timestamp: "2025-07-04T05:00:00.000Z", kwh: 1.5 },
            { timestamp: "2025-07-04T05:15:00.000Z", kwh: 2 },
            { timestamp: "2025-07-05T05:00:00.000Z", kwh: 8 },
          ],
        },
      },
    });

    expect(summary).not.toBeNull();
    expect(summary?.selectedDateKeys).toEqual(["2025-07-04"]);
    expect(summary?.days[0]).toMatchObject({
      localDate: "2025-07-04",
      weatherRegime: "cooling",
      peakTimingErrorSlots: 0,
    });
    expect(summary?.days[0]?.slots[0]).toMatchObject({
      actualKwh: 1,
      simulatedKwh: 1.5,
      deltaKwh: 0.5,
    });
    expect(summary?.aggregates.some((aggregate) => aggregate.key === "day_type:weekday")).toBe(true);
    expect(summary?.slotMetrics[0]).toMatchObject({
      hhmm: "00:00",
      maeKwh: 0.5,
      rmseKwh: 0.5,
      biasKwh: 0.5,
      sampleCount: 1,
    });
    expect(summary?.hourBlockBiases.find((row) => row.label === "Overnight")?.meanBiasKwh).toBeGreaterThan(0);
  });
});
