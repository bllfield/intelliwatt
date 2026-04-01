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
});
