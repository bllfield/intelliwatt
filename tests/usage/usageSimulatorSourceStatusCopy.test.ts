import { describe, expect, it } from "vitest";

import {
  isManualTotalsActiveUsageSource,
  resolveUsageSimulatorActiveSourceKind,
  resolveUsageSimulatorSourceStatusCopy,
} from "@/lib/usage/usageSimulatorSourceStatusCopy";

const monthlyPayload = {
  mode: "MONTHLY" as const,
  anchorEndDate: "2026-03-15",
  monthlyKwh: Array.from({ length: 12 }, (_, index) => ({
    month: `2025-${String(((index + 3) % 12) + 1).padStart(2, "0")}`,
    kwh: index === 0 ? 2882.5 : 2882.5,
  })),
  statementRanges: [
    { month: "2025-03", startDate: "2025-03-17", endDate: "2025-04-15" },
    { month: "2025-04", startDate: "2025-04-16", endDate: "2025-05-15" },
    { month: "2025-05", startDate: "2025-05-16", endDate: "2025-06-15" },
    { month: "2025-06", startDate: "2025-06-16", endDate: "2025-07-15" },
    { month: "2025-07", startDate: "2025-07-16", endDate: "2025-08-15" },
    { month: "2025-08", startDate: "2025-08-16", endDate: "2025-09-15" },
    { month: "2025-09", startDate: "2025-09-16", endDate: "2025-10-15" },
    { month: "2025-10", startDate: "2025-10-16", endDate: "2025-11-15" },
    { month: "2025-11", startDate: "2025-11-16", endDate: "2025-12-15" },
    { month: "2025-12", startDate: "2025-12-16", endDate: "2026-01-15" },
    { month: "2026-01", startDate: "2026-01-16", endDate: "2026-02-15" },
    { month: "2026-02", startDate: "2026-02-16", endDate: "2026-03-15" },
  ],
  travelRanges: [],
};

describe("usageSimulatorSourceStatusCopy", () => {
  it("treats manual monthly as the active usage source even when a baseline build exists without intervals", () => {
    expect(
      resolveUsageSimulatorActiveSourceKind({
        mode: "MANUAL_TOTALS",
        normalizedIntent: "MANUAL",
        hasActualIntervals: false,
        manualUsagePayload: monthlyPayload,
      })
    ).toBe("MANUAL_TOTALS");
  });

  it("manual monthly active usage source displays manual totals status", () => {
    const copy = resolveUsageSimulatorSourceStatusCopy({
      mode: "MANUAL_TOTALS",
      normalizedIntent: "MANUAL",
      hasActualIntervals: false,
      manualUsagePayload: monthlyPayload,
      pastSimAvailable: true,
    });

    expect(copy.kind).toBe("MANUAL_TOTALS");
    expect(copy.stepSummary).toContain("Manual totals (bill-period based)");
    expect(copy.stepSummary).not.toContain("Actual usage");
    expect(copy.coverageLine).toContain("Manual bills:");
    expect(copy.coverageLine).toContain("03/17/2025");
    expect(copy.coverageLine).toContain("03/15/2026");
    expect(copy.coverageLine).toContain("12 statements");
    expect(copy.secondaryStatus).toContain("Actual interval data: not connected");
    expect(copy.secondaryStatus).toContain("Past simulated usage is available");
  });

  it("manual monthly does not display actual read-only status when actual interval count is 0", () => {
    const copy = resolveUsageSimulatorSourceStatusCopy({
      mode: "MANUAL_TOTALS",
      normalizedIntent: "MANUAL",
      hasActualIntervals: false,
      manualUsagePayload: monthlyPayload,
    });

    expect(copy.coverageLine).not.toContain("ACTUAL");
    expect(copy.coverageLine).not.toContain("0 intervals");
    expect(copy.stepSummary).not.toContain("Actual usage");
  });

  it("actual SMT/GB source still displays actual status and coverage", () => {
    const copy = resolveUsageSimulatorSourceStatusCopy({
      mode: "SMT_BASELINE",
      normalizedIntent: null,
      hasActualIntervals: true,
      manualUsagePayload: null,
      actualSource: "SMT",
      actualCoverage: { start: "2025-06-08", end: "2026-06-07", intervalsCount: 35040 },
    });

    expect(copy.kind).toBe("ACTUAL_INTERVALS");
    expect(copy.stepSummary).toContain("Actual usage");
    expect(copy.coverageLine).toContain("SMT");
    expect(copy.coverageLine).toContain("35040 intervals");
  });

  it("manual totals remain active over actual context when mode is MANUAL_TOTALS with saved payload", () => {
    expect(
      isManualTotalsActiveUsageSource({
        mode: "MANUAL_TOTALS",
        normalizedIntent: null,
        manualUsagePayload: monthlyPayload,
      })
    ).toBe(true);

    const copy = resolveUsageSimulatorSourceStatusCopy({
      mode: "MANUAL_TOTALS",
      normalizedIntent: null,
      hasActualIntervals: true,
      manualUsagePayload: monthlyPayload,
      actualSource: "SMT",
      actualCoverage: { start: "2025-06-08", end: "2026-06-07", intervalsCount: 35040 },
    });

    expect(copy.kind).toBe("MANUAL_TOTALS");
    expect(copy.stepSummary).toContain("Manual totals");
    expect(copy.coverageLine).not.toContain("35040 intervals");
  });
});
