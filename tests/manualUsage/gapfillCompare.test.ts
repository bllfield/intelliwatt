import { describe, expect, it } from "vitest";

import {
  buildGapfillManualAnnualCompareSummary,
  buildGapfillManualMonthlyCompareRows,
} from "@/modules/manualUsage/gapfillCompare";
import { buildManualUsageReadModel } from "@/modules/manualUsage/readModel";

describe("gapfill manual usage compare helpers", () => {
  it("reconciles actual, Stage 1, and simulated monthly totals from the shared read model", () => {
    const payload = {
      mode: "MONTHLY" as const,
      anchorEndDate: "2025-02-28",
      monthlyKwh: [
        { month: "2025-02", kwh: 115 },
        { month: "2025-01", kwh: 110 },
      ],
      statementRanges: [
        { month: "2025-02", startDate: "2025-02-01", endDate: "2025-02-28" },
        { month: "2025-01", startDate: "2025-01-01", endDate: "2025-01-31" },
      ],
      travelRanges: [],
    };
    const readModel = buildManualUsageReadModel({
      payload,
      dataset: {
        meta: {
          filledMonths: [],
          manualMonthlyInputState: {
            inputKindByMonth: {
              "2025-01": "entered_nonzero",
              "2025-02": "entered_nonzero",
            },
          },
        },
        daily: [
          ...Array.from({ length: 31 }, (_, idx) => ({
            date: `2025-01-${String(idx + 1).padStart(2, "0")}`,
            kwh: 108 / 31,
          })),
          ...Array.from({ length: 28 }, (_, idx) => ({
            date: `2025-02-${String(idx + 1).padStart(2, "0")}`,
            kwh: 117 / 28,
          })),
        ],
      },
      actualDataset: {
        daily: [
          ...Array.from({ length: 31 }, (_, idx) => ({
            date: `2025-01-${String(idx + 1).padStart(2, "0")}`,
            kwh: 100 / 31,
          })),
          ...Array.from({ length: 28 }, (_, idx) => ({
            date: `2025-02-${String(idx + 1).padStart(2, "0")}`,
            kwh: 120 / 28,
          })),
        ],
      },
    });

    expect(
      buildGapfillManualMonthlyCompareRows({
        manualReadModel: readModel,
      })
    ).toEqual([
      expect.objectContaining({
        month: "2025-01",
        actualIntervalKwh: 100,
        stageOneTargetKwh: 110,
        simulatedKwh: 108,
        simulatedVsActualDeltaKwh: 8,
        simulatedVsTargetDeltaKwh: -2,
        targetVsActualDeltaKwh: 10,
        eligible: true,
        parityRequirement: "exact_match_required",
        status: "delta_present",
      }),
      expect.objectContaining({
        month: "2025-02",
        actualIntervalKwh: 120,
        stageOneTargetKwh: 115,
        simulatedKwh: 117,
        simulatedVsActualDeltaKwh: -3,
        simulatedVsTargetDeltaKwh: 2,
        targetVsActualDeltaKwh: -5,
        eligible: true,
        parityRequirement: "exact_match_required",
        status: "delta_present",
      }),
    ]);
  });

  it("reconciles actual, Stage 1, and simulated annual totals from the shared read model", () => {
    const payload = {
      mode: "ANNUAL" as const,
      anchorEndDate: "2025-02-28",
      annualKwh: 230,
      travelRanges: [],
    };
    const actualDataset = {
      daily: [
        ...Array.from({ length: 31 }, (_, idx) => ({
          date: `2025-01-${String(idx + 1).padStart(2, "0")}`,
          kwh: 100 / 31,
        })),
        ...Array.from({ length: 28 }, (_, idx) => ({
          date: `2025-02-${String(idx + 1).padStart(2, "0")}`,
          kwh: 120 / 28,
        })),
      ],
    };
    const readModel = buildManualUsageReadModel({
      payload,
      dataset: {
        meta: { filledMonths: [], manualMonthlyInputState: null },
        daily: [
          ...Array.from({ length: 31 }, (_, idx) => ({
            date: `2025-01-${String(idx + 1).padStart(2, "0")}`,
            kwh: 108 / 31,
          })),
          ...Array.from({ length: 28 }, (_, idx) => ({
            date: `2025-02-${String(idx + 1).padStart(2, "0")}`,
            kwh: 117 / 28,
          })),
        ],
      },
      actualDataset,
    });

    expect(
      buildGapfillManualAnnualCompareSummary({
        manualReadModel: readModel,
      })
    ).toEqual(expect.objectContaining({
      actualIntervalKwh: 220,
      stageOneTargetKwh: 230,
      simulatedKwh: 225,
      simulatedVsActualDeltaKwh: 5,
      simulatedVsTargetDeltaKwh: -5,
      targetVsActualDeltaKwh: 10,
      eligible: true,
      parityRequirement: "exact_match_required",
      status: "delta_present",
    }));
  });

  it("keeps actual compare fields unavailable instead of zero-falling back", () => {
    const readModel = buildManualUsageReadModel({
      payload: {
        mode: "MONTHLY" as const,
        anchorEndDate: "2025-02-28",
        monthlyKwh: [{ month: "2025-02", kwh: 115 }],
        statementRanges: [{ month: "2025-02", startDate: "2025-02-01", endDate: "2025-02-28" }],
        travelRanges: [],
      },
      dataset: {
        meta: {
          filledMonths: [],
          manualMonthlyInputState: {
            inputKindByMonth: { "2025-02": "entered_nonzero" },
          },
        },
        daily: Array.from({ length: 28 }, (_, idx) => ({
          date: `2025-02-${String(idx + 1).padStart(2, "0")}`,
          kwh: 117 / 28,
        })),
      },
    });

    expect(
      buildGapfillManualMonthlyCompareRows({
        manualReadModel: readModel,
      })
    ).toEqual([
      expect.objectContaining({
        month: "2025-02",
        eligible: true,
        parityRequirement: "exact_match_required",
        status: "delta_present",
        actualIntervalKwh: null,
        stageOneTargetKwh: 115,
        simulatedKwh: 117,
        simulatedVsActualDeltaKwh: null,
        simulatedVsTargetDeltaKwh: 2,
        targetVsActualDeltaKwh: null,
      }),
    ]);
  });

  it("keeps non-travel periods exact-match-required and marks travel-overlapped periods as excluded", () => {
    const readModel = buildManualUsageReadModel({
      payload: {
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
      },
      dataset: {
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
            kwh: 280 / 30,
          })),
          { date: "2025-03-31", kwh: 10 },
          ...Array.from({ length: 30 }, (_, idx) => ({
            date: `2025-04-${String(idx + 1).padStart(2, "0")}`,
            kwh: 300 / 30,
          })),
        ],
      },
      actualDataset: {
        daily: [
          ...Array.from({ length: 30 }, (_, idx) => ({
            date: `2025-03-${String(idx + 1).padStart(2, "0")}`,
            kwh: 280 / 30,
          })),
          { date: "2025-03-31", kwh: 10 },
          ...Array.from({ length: 30 }, (_, idx) => ({
            date: `2025-04-${String(idx + 1).padStart(2, "0")}`,
            kwh: 300 / 30,
          })),
        ],
      },
    });

    expect(
      buildGapfillManualMonthlyCompareRows({
        manualReadModel: readModel,
      })
    ).toEqual([
      expect.objectContaining({
        month: "2025-03",
        eligible: true,
        parityRequirement: "exact_match_required",
      }),
      expect.objectContaining({
        month: "2025-04",
        eligible: true,
        parityRequirement: "exact_match_required",
        status: "delta_present",
      }),
    ]);
  });
});
