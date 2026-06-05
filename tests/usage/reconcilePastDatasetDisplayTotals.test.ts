import { describe, expect, it } from "vitest";

import { reconcilePastDatasetDisplayTotals } from "@/lib/usage/reconcilePastDatasetDisplayTotals";
import { auditIntervalReadModelInvariants } from "@/lib/usage/intervalReadModelInvariants";

describe("reconcilePastDatasetDisplayTotals", () => {
  it("replaces stale monthly-derived totals with daily truth", () => {
    const dataset: Record<string, unknown> = {
      meta: { datasetKind: "SIMULATED" },
      summary: { totalKwh: 14332.14 },
      totals: { importKwh: 14332.14, exportKwh: 0, netKwh: 14332.14 },
      monthly: [{ month: "2026-06", kwh: 14332.14 }],
      daily: [
        { date: "2026-06-01", kwh: 40, source: "ACTUAL" },
        { date: "2026-06-02", kwh: 39.93, source: "ACTUAL" },
      ],
      series: {
        intervals15: [
          { timestamp: "2026-06-01T12:00:00.000Z", kwh: 40 },
          { timestamp: "2026-06-02T12:00:00.000Z", kwh: 39.93 },
        ],
        annual: [{ timestamp: "2026-01-01T00:00:00.000Z", kwh: 14332.14 }],
      },
      insights: {
        weekdayVsWeekend: { weekday: 79.93, weekend: 0 },
        timeOfDayBuckets: [
          { key: "overnight", kwh: 20 },
          { key: "morning", kwh: 20 },
          { key: "afternoon", kwh: 20 },
          { key: "evening", kwh: 19.93 },
        ],
      },
    };

    reconcilePastDatasetDisplayTotals(dataset);

    expect((dataset.totals as { netKwh: number }).netKwh).toBe(79.93);
    expect((dataset.summary as { totalKwh: number }).totalKwh).toBe(79.93);
    expect(((dataset.series as { annual: Array<{ kwh: number }> }).annual[0]?.kwh)).toBe(79.93);

    const invariants = auditIntervalReadModelInvariants({ dataset });
    expect(invariants.netUsageKwh).toBe(79.93);
    expect(invariants.dailySumKwh).toBe(79.93);
    expect(invariants.violations).not.toContain("daily sum 79.93 != net usage 14332.14");
  });
});
