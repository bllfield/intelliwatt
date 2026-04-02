import { describe, expect, it } from "vitest";
import { buildManualMonthlyReconciliation } from "@/modules/manualUsage/reconciliation";

describe("manual monthly reconciliation", () => {
  it("marks later-filled ranges ineligible", () => {
    const out = buildManualMonthlyReconciliation({
      payload: {
        mode: "MONTHLY",
        anchorEndDate: "2025-04-30",
        monthlyKwh: [{ month: "2025-04", kwh: "" }],
        travelRanges: [],
      },
      dataset: {
        meta: {
          filledMonths: ["2025-04"],
          manualMonthlyInputState: {
            inputKindByMonth: { "2025-04": "missing" },
          },
        },
        daily: [{ date: "2025-04-01", kwh: 10 }],
      },
    });

    const april = out?.rows.find((row) => row.month === "2025-04");
    expect(april).toMatchObject({
      eligible: false,
      status: "missing_input",
    });
  });

  it("marks travel-overlapped entered ranges ineligible", () => {
    const out = buildManualMonthlyReconciliation({
      payload: {
        mode: "MONTHLY",
        anchorEndDate: "2025-04-30",
        monthlyKwh: [{ month: "2025-04", kwh: 300 }],
        travelRanges: [{ startDate: "2025-04-10", endDate: "2025-04-12" }],
      },
      dataset: {
        meta: {
          filledMonths: [],
          manualMonthlyInputState: {
            inputKindByMonth: { "2025-04": "entered_nonzero" },
          },
        },
        daily: Array.from({ length: 30 }, (_, idx) => ({
          date: `2025-04-${String(idx + 1).padStart(2, "0")}`,
          kwh: 10,
        })),
      },
    });

    const april = out?.rows.find((row) => row.month === "2025-04");
    expect(april).toMatchObject({
      eligible: false,
      status: "travel_overlap",
    });
  });

  it("uses explicit statement ranges when present", () => {
    const out = buildManualMonthlyReconciliation({
      payload: {
        mode: "MONTHLY",
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
            kwh: 9,
          })),
          {
            date: "2025-03-31",
            kwh: 9,
          },
          ...Array.from({ length: 31 }, (_, idx) => ({
            date: `2025-04-${String(idx + 1).padStart(2, "0")}`,
            kwh: 10,
          })),
        ],
      },
    });

    expect(out?.rows).toHaveLength(2);
    expect(out?.rows[0]).toMatchObject({
      month: "2025-03",
      startDate: "2025-03-01",
      endDate: "2025-03-30",
      simulatedStatementTotalKwh: 270,
    });
    expect(out?.rows[1]).toMatchObject({
      month: "2025-04",
      startDate: "2025-03-31",
      endDate: "2025-04-30",
      simulatedStatementTotalKwh: 309,
    });
  });
});
