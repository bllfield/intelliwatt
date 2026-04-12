import { describe, expect, it } from "vitest";

import { buildActualVsTestMonthlyRows, buildGapfillCompareMonthlyTotals } from "@/modules/usageSimulator/monthlyCompareRows";

describe("monthly compare rows", () => {
  it("merges the borrowed prior-year month into the stitched current month for compare display", () => {
    const actualTotals = buildGapfillCompareMonthlyTotals({
      monthly: [
        { month: "2025-04", kwh: 717.2 },
        { month: "2025-05", kwh: 1286.66 },
        { month: "2026-04", kwh: 225.94 },
      ],
      insights: {
        stitchedMonth: {
          yearMonth: "2026-04",
          borrowedFromYearMonth: "2025-04",
        },
      },
    });

    expect(Array.from(actualTotals.entries())).toEqual([
      ["2025-05", 1286.66],
      ["2026-04", 943.14],
    ]);
  });

  it("builds actual-vs-test rows from stitched display months instead of raw donor months", () => {
    expect(
      buildActualVsTestMonthlyRows({
        actualDataset: {
          monthly: [
            { month: "2025-04", kwh: 717.2 },
            { month: "2025-05", kwh: 1286.66 },
            { month: "2026-04", kwh: 225.94 },
          ],
          insights: {
            stitchedMonth: {
              yearMonth: "2026-04",
              borrowedFromYearMonth: "2025-04",
            },
          },
        },
        testDataset: {
          monthly: [
            { month: "2025-05", kwh: 1268.79 },
            { month: "2026-04", kwh: 1010.74 },
          ],
          insights: {
            stitchedMonth: {
              yearMonth: "2026-04",
              borrowedFromYearMonth: "2025-04",
            },
          },
        },
      })
    ).toEqual([
      {
        month: "2025-05",
        actual: 1286.66,
        test: 1268.79,
        delta: -17.87,
      },
      {
        month: "2026-04",
        actual: 943.14,
        test: 1010.74,
        delta: 67.6,
      },
    ]);
  });
});
