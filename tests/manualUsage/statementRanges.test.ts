import { describe, expect, it } from "vitest";
import {
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
});
