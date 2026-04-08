import { describe, expect, it } from "vitest";

import {
  buildGapfillManualAnnualCompareSummary,
  buildGapfillManualMonthlyCompareRows,
} from "@/modules/manualUsage/gapfillCompare";

describe("gapfill manual usage compare helpers", () => {
  it("reconciles actual, Stage 1, and simulated monthly totals by month", () => {
    expect(
      buildGapfillManualMonthlyCompareRows({
        actualMonthlyTotals: [
          { month: "2025-01", kwh: 100 },
          { month: "2025-02", kwh: 120 },
        ],
        stageOneMonthlyTotalsKwhByMonth: {
          "2025-01": 110,
          "2025-02": 115,
        },
        simulatedMonthlyTotals: [
          { month: "2025-01", kwh: 108 },
          { month: "2025-02", kwh: 117 },
        ],
      })
    ).toEqual([
      {
        month: "2025-01",
        actualIntervalKwh: 100,
        stageOneTargetKwh: 110,
        simulatedKwh: 108,
        simulatedVsActualDeltaKwh: 8,
        simulatedVsTargetDeltaKwh: -2,
        targetVsActualDeltaKwh: 10,
      },
      {
        month: "2025-02",
        actualIntervalKwh: 120,
        stageOneTargetKwh: 115,
        simulatedKwh: 117,
        simulatedVsActualDeltaKwh: -3,
        simulatedVsTargetDeltaKwh: 2,
        targetVsActualDeltaKwh: -5,
      },
    ]);
  });

  it("reconciles actual, Stage 1, and simulated annual totals", () => {
    expect(
      buildGapfillManualAnnualCompareSummary({
        actualMonthlyTotals: [
          { month: "2025-01", kwh: 100 },
          { month: "2025-02", kwh: 120 },
        ],
        stageOneAnnualTotalKwh: 230,
        simulatedMonthlyTotals: [
          { month: "2025-01", kwh: 108 },
          { month: "2025-02", kwh: 117 },
        ],
      })
    ).toEqual({
      actualIntervalKwh: 220,
      stageOneTargetKwh: 230,
      simulatedKwh: 225,
      simulatedVsActualDeltaKwh: 5,
      simulatedVsTargetDeltaKwh: -5,
      targetVsActualDeltaKwh: 10,
    });
  });
});
