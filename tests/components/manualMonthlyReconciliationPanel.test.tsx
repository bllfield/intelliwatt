import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ManualMonthlyReconciliationPanel } from "@/components/usage/ManualMonthlyReconciliationPanel";

describe("ManualMonthlyReconciliationPanel", () => {
  it("keeps the same totals while rendering clearer parity and status labels", () => {
    const html = renderToStaticMarkup(
      <ManualMonthlyReconciliationPanel
        reconciliation={{
          anchorEndDate: "2026-04-08",
          eligibleRangeCount: 1,
          ineligibleRangeCount: 1,
          reconciledRangeCount: 1,
          deltaPresentRangeCount: 0,
          rows: [
            {
              month: "2026-03",
              startDate: "2026-02-09",
              endDate: "2026-03-08",
              inputKind: "entered_nonzero",
              actualIntervalTotalKwh: 1100.12,
              enteredStatementTotalKwh: 1100.12,
              stageOneTargetTotalKwh: 1100.12,
              simulatedStatementTotalKwh: 1100.12,
              deltaKwh: 0,
              eligible: true,
              parityRequirement: "exact_match_required",
              status: "reconciled",
              reason: null,
            },
            {
              month: "2026-04",
              startDate: "2026-03-09",
              endDate: "2026-04-08",
              inputKind: "missing",
              actualIntervalTotalKwh: 900.45,
              enteredStatementTotalKwh: null,
              stageOneTargetTotalKwh: null,
              simulatedStatementTotalKwh: 905.32,
              deltaKwh: null,
              eligible: false,
              parityRequirement: "excluded_travel_overlap",
              status: "travel_overlap",
              reason: null,
            },
          ],
        }}
      />
    );

    expect(html).toContain("1100.12");
    expect(html).toContain("900.45");
    expect(html).toContain("Eligible exact-match 1");
    expect(html).toContain("Excluded / other 1");
    expect(html).toContain("Exact match required");
    expect(html).toContain("Excluded: travel overlap");
    expect(html).toContain("Reconciled");
    expect(html).toContain("Excluded");
    expect(html).toContain("Missing input");
    expect(html).toContain("2026-02-09 -&gt; 2026-03-08");
  });
});
