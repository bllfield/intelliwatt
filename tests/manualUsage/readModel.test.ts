import { describe, expect, it } from "vitest";

import {
  buildGapfillManualAnnualCompareSummary,
  buildGapfillManualMonthlyCompareRows,
} from "@/modules/manualUsage/gapfillCompare";
import { buildManualStageOnePresentationFromReadModel, buildManualUsageReadModel } from "@/modules/manualUsage/readModel";

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
      })
    ).toEqual([
      expect.objectContaining({
        month: "2025-03",
        actualIntervalKwh: 240,
        stageOneTargetKwh: 280,
        simulatedKwh: 270,
        simulatedVsActualDeltaKwh: 30,
        simulatedVsTargetDeltaKwh: -10,
        targetVsActualDeltaKwh: 40,
        eligible: true,
        parityRequirement: "exact_match_required",
        status: "delta_present",
      }),
      expect.objectContaining({
        month: "2025-04",
        actualIntervalKwh: 338,
        stageOneTargetKwh: 300,
        simulatedKwh: 309,
        simulatedVsActualDeltaKwh: -29,
        simulatedVsTargetDeltaKwh: 9,
        targetVsActualDeltaKwh: -38,
        eligible: true,
        parityRequirement: "exact_match_required",
        status: "delta_present",
      }),
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
      })
    ).toEqual(expect.objectContaining({
      actualIntervalKwh: 3285,
      stageOneTargetKwh: 3650,
      simulatedKwh: 3650,
      simulatedVsActualDeltaKwh: 365,
      simulatedVsTargetDeltaKwh: 0,
      targetVsActualDeltaKwh: 365,
      eligible: true,
      parityRequirement: "exact_match_required",
      status: "reconciled",
    }));
  });

  it("uses canonical actual-house artifact totals for annual compare when only summary/monthly truth is available", () => {
    const payload = {
      mode: "ANNUAL" as const,
      anchorEndDate: "2025-12-31",
      annualKwh: 15053.4,
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
      monthly: [
        { month: "2025-01", kwh: 1200.4 },
        { month: "2025-02", kwh: 1180.0 },
        { month: "2025-03", kwh: 1265.2 },
        { month: "2025-04", kwh: 1211.3 },
        { month: "2025-05", kwh: 1299.9 },
        { month: "2025-06", kwh: 1310.1 },
        { month: "2025-07", kwh: 1388.2 },
        { month: "2025-08", kwh: 1440.7 },
        { month: "2025-09", kwh: 1277.5 },
        { month: "2025-10", kwh: 1208.0 },
        { month: "2025-11", kwh: 1122.6 },
        { month: "2025-12", kwh: 1149.5 },
      ],
      summary: { totalKwh: 15053.4 },
    };

    const readModel = buildManualUsageReadModel({ payload, dataset, actualDataset });

    expect(readModel?.annualCompareSummary?.actualIntervalKwh).toBe(15053.4);
  });

  it("uses canonical actual-house artifact monthly truth for bill-period actuals when the bill period aligns to that month", () => {
    const payload = {
      mode: "MONTHLY" as const,
      anchorEndDate: "2025-04-30",
      monthlyKwh: [{ month: "2025-04", kwh: 300 }],
      statementRanges: [{ month: "2025-04", startDate: "2025-04-01", endDate: "2025-04-30" }],
      travelRanges: [],
    };
    const dataset = {
      meta: {
        filledMonths: [],
        manualMonthlyInputState: {
          inputKindByMonth: {
            "2025-04": "entered_nonzero",
          },
        },
      },
      daily: Array.from({ length: 30 }, (_, idx) => ({
        date: `2025-04-${String(idx + 1).padStart(2, "0")}`,
        kwh: 10,
      })),
    };
    const actualDataset = {
      monthly: [{ month: "2025-04", kwh: 338.4 }],
      summary: { totalKwh: 338.4 },
    };

    const readModel = buildManualUsageReadModel({ payload, dataset, actualDataset });

    expect(readModel?.billPeriodCompare.rows[0]?.actualIntervalTotalKwh).toBe(338.4);
    expect(readModel?.monthlyCompareRows[0]?.actualIntervalKwh).toBe(338.4);
  });

  it("uses full bill-period actual totals instead of sparse interval leftovers when source daily truth is fuller", () => {
    const payload = {
      mode: "MONTHLY" as const,
      anchorEndDate: "2025-05-31",
      monthlyKwh: [
        { month: "2025-04", kwh: 300 },
        { month: "2025-05", kwh: 310 },
      ],
      statementRanges: [
        { month: "2025-04", startDate: "2025-04-01", endDate: "2025-04-30" },
        { month: "2025-05", startDate: "2025-05-01", endDate: "2025-05-31" },
      ],
      travelRanges: [{ startDate: "2025-05-10", endDate: "2025-05-12" }],
    };
    const dataset = {
      meta: {
        timezone: "UTC",
        filledMonths: [],
        manualMonthlyInputState: {
          inputKindByMonth: {
            "2025-04": "entered_nonzero",
            "2025-05": "entered_nonzero",
          },
        },
      },
      daily: [
        ...Array.from({ length: 30 }, (_, idx) => ({
          date: `2025-04-${String(idx + 1).padStart(2, "0")}`,
          kwh: 10,
        })),
        ...Array.from({ length: 31 }, (_, idx) => ({
          date: `2025-05-${String(idx + 1).padStart(2, "0")}`,
          kwh: 10,
        })),
      ],
    };
    const actualDataset = {
      summary: { totalKwh: 611 },
      daily: [
        ...Array.from({ length: 30 }, (_, idx) => ({
          date: `2025-04-${String(idx + 1).padStart(2, "0")}`,
          kwh: 9,
        })),
        ...Array.from({ length: 31 }, (_, idx) => ({
          date: `2025-05-${String(idx + 1).padStart(2, "0")}`,
          kwh: 11,
        })),
      ],
      series: {
        intervals15: [
          { timestamp: "2025-04-01T00:00:00.000Z", kwh: 2.25 },
          { timestamp: "2025-04-01T00:15:00.000Z", kwh: 2.25 },
        ],
      },
    };

    const readModel = buildManualUsageReadModel({ payload, dataset, actualDataset });

    expect(readModel?.billPeriodCompare.rows).toEqual([
      expect.objectContaining({
        month: "2025-04",
        actualIntervalTotalKwh: 270,
        stageOneTargetTotalKwh: 300,
        simulatedStatementTotalKwh: 300,
        eligible: true,
        status: "reconciled",
      }),
      expect.objectContaining({
        month: "2025-05",
        actualIntervalTotalKwh: 341,
        stageOneTargetTotalKwh: 310,
        simulatedStatementTotalKwh: 310,
        eligible: false,
        status: "travel_overlap",
      }),
    ]);
    expect(readModel?.monthlyCompareRows).toEqual([
      expect.objectContaining({
        month: "2025-04",
        actualIntervalKwh: 270,
        stageOneTargetKwh: 300,
        simulatedKwh: 300,
      }),
      expect.objectContaining({
        month: "2025-05",
        actualIntervalKwh: 341,
        stageOneTargetKwh: 310,
        simulatedKwh: 310,
      }),
    ]);
  });

  it("publishes canonical Stage 1 monthly rows from the shared read model instead of the raw payload family", () => {
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
      travelRanges: [{ startDate: "2025-04-10", endDate: "2025-04-12" }],
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

    const readModel = buildManualUsageReadModel({ payload, dataset, actualDataset: null });
    const presentation = buildManualStageOnePresentationFromReadModel({ readModel });

    expect(presentation).toMatchObject({
      mode: "MONTHLY",
      rows: [
        expect.objectContaining({
          month: "2025-03",
          kwh: 280,
          parityRequirement: "exact_match_required",
        }),
        expect.objectContaining({
          month: "2025-04",
          kwh: 300,
          parityRequirement: "excluded_travel_overlap",
        }),
      ],
    });
  });

  it("marks non-travel periods as exact-match-required and travel-overlapped periods as excluded in the shared compare contract", () => {
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
      travelRanges: [{ startDate: "2025-04-10", endDate: "2025-04-12" }],
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
      daily: [],
    };

    const readModel = buildManualUsageReadModel({ payload, dataset, actualDataset: null });

    expect(readModel?.billPeriodCompare.rows).toEqual([
      expect.objectContaining({
        month: "2025-03",
        eligible: true,
        parityRequirement: "exact_match_required",
      }),
      expect.objectContaining({
        month: "2025-04",
        eligible: false,
        status: "travel_overlap",
        parityRequirement: "excluded_travel_overlap",
      }),
    ]);
  });

  it("keeps source-derived diagnostic month totals out of the actual column for pure manual monthly reads", () => {
    const payload = {
      mode: "MONTHLY" as const,
      anchorEndDate: "2025-04-30",
      monthlyKwh: [{ month: "2025-04", kwh: 300 }],
      statementRanges: [{ month: "2025-04", startDate: "2025-04-01", endDate: "2025-04-30" }],
      travelRanges: [],
    };
    const dataset = {
      meta: {
        lockboxInput: {
          mode: "MANUAL_MONTHLY",
        },
        filledMonths: [],
        manualMonthlyInputState: {
          inputKindByMonth: {
            "2025-04": "entered_nonzero",
          },
        },
        monthlyTargetConstructionDiagnostics: [
          {
            month: "2025-04",
            rawMonthKwhFromSource: 284,
            normalizedMonthTarget: 300,
          },
        ],
      },
      daily: Array.from({ length: 30 }, (_, idx) => ({
        date: `2025-04-${String(idx + 1).padStart(2, "0")}`,
        kwh: 10,
      })),
    };

    const readModel = buildManualUsageReadModel({ payload, dataset, actualDataset: null });

    expect(readModel?.billPeriodCompare.rows[0]).toMatchObject({
      month: "2025-04",
      actualIntervalTotalKwh: null,
      stageOneTargetTotalKwh: 300,
      simulatedStatementTotalKwh: 300,
    });
  });
});
