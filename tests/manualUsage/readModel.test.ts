import { describe, expect, it } from "vitest";

import { buildGapfillManualAnnualCompareSummary, buildGapfillManualMonthlyCompareRows } from "@/modules/manualUsage/gapfillCompare";
import { buildManualUsageReadModel } from "@/modules/manualUsage/readModel";

describe("manual usage read model", () => {
  it("publishes one bill-period-first contract for monthly manual compare surfaces", () => {
    const payload = {
      mode: "MONTHLY" as const,
      anchorEndDate: "2025-04-30",
      monthlyKwh: [
        { month: "2025-04", kwh: 300 },
        { month: "2025-03", kwh: 280 },
      ],
      statementRanges: [
        { month: "2025-04", startDate: "2025-03-31", endDate: "2025-04-30" },
        { month: "2025-03", startDate: "2025-03-01", endDate: "2025-03-30" },
      ],
      travelRanges: [],
    };
    const dataset = {
      meta: {
        filledMonths: [],
        manualMonthlyInputState: {
          inputKindByMonth: {
            "2025-04": "entered_nonzero",
            "2025-03": "entered_nonzero",
          },
        },
      },
      daily: [
        ...Array.from({ length: 30 }, (_, idx) => ({
          date: `2025-03-${String(idx + 1).padStart(2, "0")}`,
          kwh: 9,
        })),
        { date: "2025-03-31", kwh: 9 },
        ...Array.from({ length: 30 }, (_, idx) => ({
          date: `2025-04-${String(idx + 1).padStart(2, "0")}`,
          kwh: 10,
        })),
      ],
    };
    const actualDataset = {
      daily: [
        ...Array.from({ length: 30 }, (_, idx) => ({
          date: `2025-03-${String(idx + 1).padStart(2, "0")}`,
          kwh: 8,
        })),
        { date: "2025-03-31", kwh: 8 },
        ...Array.from({ length: 30 }, (_, idx) => ({
          date: `2025-04-${String(idx + 1).padStart(2, "0")}`,
          kwh: 11,
        })),
      ],
    };

    const readModel = buildManualUsageReadModel({ payload, dataset, actualDataset });
    expect(readModel?.billPeriodTargets.map((row) => row.id)).toEqual(["2025-03", "2025-04"]);
    expect(readModel?.billPeriodTotalsKwhById).toEqual({
      "2025-03": 280,
      "2025-04": 300,
    });
    expect(readModel?.billPeriodCompare.rows).toEqual([
      expect.objectContaining({
        month: "2025-03",
        actualIntervalTotalKwh: 240,
        stageOneTargetTotalKwh: 280,
        simulatedStatementTotalKwh: 270,
      }),
      expect.objectContaining({
        month: "2025-04",
        actualIntervalTotalKwh: 338,
        stageOneTargetTotalKwh: 300,
        simulatedStatementTotalKwh: 309,
      }),
    ]);
    expect(
      buildGapfillManualMonthlyCompareRows({
        manualReadModel: readModel,
        actualDataset,
      })
    ).toEqual([
      {
        month: "2025-03",
        actualIntervalKwh: 240,
        stageOneTargetKwh: 280,
        simulatedKwh: 270,
        simulatedVsActualDeltaKwh: 30,
        simulatedVsTargetDeltaKwh: -10,
        targetVsActualDeltaKwh: 40,
      },
      {
        month: "2025-04",
        actualIntervalKwh: 338,
        stageOneTargetKwh: 300,
        simulatedKwh: 309,
        simulatedVsActualDeltaKwh: -29,
        simulatedVsTargetDeltaKwh: 9,
        targetVsActualDeltaKwh: -38,
      },
    ]);
  });

  it("derives annual compare from the same shared bill-period contract", () => {
    const payload = {
      mode: "ANNUAL" as const,
      anchorEndDate: "2025-12-31",
      annualKwh: 3650,
      travelRanges: [],
    };
    const dataset = {
      meta: { filledMonths: [], manualMonthlyInputState: null },
      daily: Array.from({ length: 365 }, (_, idx) => ({
        date: new Date(Date.UTC(2025, 0, 1 + idx)).toISOString().slice(0, 10),
        kwh: 10,
      })),
    };
    const actualDataset = {
      daily: Array.from({ length: 365 }, (_, idx) => ({
        date: new Date(Date.UTC(2025, 0, 1 + idx)).toISOString().slice(0, 10),
        kwh: 9,
      })),
    };

    const readModel = buildManualUsageReadModel({ payload, dataset, actualDataset });
    expect(readModel?.billPeriodTargets).toHaveLength(1);
    expect(readModel?.billPeriodTotalsKwhById).toEqual({
      "annual:2025-12-31": 3650,
    });
    expect(
      buildGapfillManualAnnualCompareSummary({
        manualReadModel: readModel,
        actualDataset,
      })
    ).toEqual({
      actualIntervalKwh: 3285,
      stageOneTargetKwh: 3650,
      simulatedKwh: 3650,
      simulatedVsActualDeltaKwh: 365,
      simulatedVsTargetDeltaKwh: 0,
      targetVsActualDeltaKwh: 365,
    });
  });
});
