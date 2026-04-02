import { describe, expect, it } from "vitest";
import {
  buildManualAnnualStageOneSummary,
  buildManualBillPeriodTargets,
  buildMonthlyPayloadFromStatementRows,
  buildStatementRowsFromMonthlyPayload,
} from "@/modules/manualUsage/statementRanges";

describe("manual usage statement ranges", () => {
  it("builds Stage 1 monthly payload rows with inferred newer start dates", () => {
    const built = buildMonthlyPayloadFromStatementRows([
      {
        endDate: "2025-04-30",
        startDate: "",
        kwh: 420,
      },
      {
        endDate: "2025-03-30",
        startDate: "2025-03-01",
        kwh: 390,
      },
    ]);

    expect(built.ok).toBe(true);
    if (!built.ok) return;

    expect(built.anchorEndDate).toBe("2025-04-30");
    expect(built.monthlyKwh).toEqual([
      { month: "2025-04", kwh: 420 },
      { month: "2025-03", kwh: 390 },
    ]);
    expect(built.statementRanges).toEqual([
      {
        month: "2025-04",
        startDate: "2025-03-31",
        endDate: "2025-04-30",
      },
      {
        month: "2025-03",
        startDate: "2025-03-01",
        endDate: "2025-03-30",
      },
    ]);
  });

  it("rebuilds bill rows from stored payload statement ranges", () => {
    const rows = buildStatementRowsFromMonthlyPayload({
      mode: "MONTHLY",
      anchorEndDate: "2025-04-30",
      monthlyKwh: [
        { month: "2025-04", kwh: 420 },
        { month: "2025-03", kwh: 390 },
      ],
      statementRanges: [
        { month: "2025-04", startDate: "2025-03-31", endDate: "2025-04-30" },
        { month: "2025-03", startDate: "2025-03-01", endDate: "2025-03-30" },
      ],
      travelRanges: [],
    });

    expect(rows).toEqual([
      {
        startDate: "2025-03-31",
        endDate: "2025-04-30",
        kwh: 420,
      },
      {
        startDate: "2025-03-01",
        endDate: "2025-03-30",
        kwh: 390,
      },
    ]);
  });

  it("builds an annual Stage 1 summary from the anchor range", () => {
    const summary = buildManualAnnualStageOneSummary({
      anchorEndDate: "2025-12-31",
      annualKwh: 5432.1,
    });

    expect(summary).toMatchObject({
      startDate: "2025-01-01",
      endDate: "2025-12-31",
      anchorEndDate: "2025-12-31",
      annualKwh: 5432.1,
    });
    expect(summary?.label).toBe("1/1/25 - 12/31/25");
  });

  it("marks travel-touched bill periods as excluded from manual bill-period constraints", () => {
    const periods = buildManualBillPeriodTargets({
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
      travelRanges: [{ startDate: "2025-04-10", endDate: "2025-04-12" }],
    });

    expect(periods).toMatchObject([
      {
        id: "2025-03",
        eligibleForConstraint: true,
        exclusionReason: null,
      },
      {
        id: "2025-04",
        eligibleForConstraint: false,
        exclusionReason: "travel_overlap",
      },
    ]);
  });
});
