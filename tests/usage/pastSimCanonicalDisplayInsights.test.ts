import { describe, expect, it } from "vitest";

import { syncPastSimDisplayInsightsFromCanonicalIntervals } from "@/lib/usage/pastSimCanonicalDisplayInsights";
import { reconcilePastDatasetDisplayTotals } from "@/lib/usage/reconcilePastDatasetDisplayTotals";
import { buildUserUsageDashboardViewModel } from "@/lib/usage/userUsageDashboardViewModel";
import { buildOnePathRunReadOnlyView } from "@/modules/onePathSim/runReadOnlyView";
import { auditIntervalReadModelInvariants } from "@/lib/usage/intervalReadModelInvariants";

describe("pastSimCanonicalDisplayInsights", () => {
  it("keeps time-of-day totals aligned with canonical past interval totals", () => {
    const dataset: Record<string, unknown> = {
      summary: { source: "GREEN_BUTTON", intervalsCount: 4, totalKwh: 4, start: "2026-06-01", end: "2026-06-02" },
      totals: { importKwh: 4, exportKwh: 0, netKwh: 4 },
      daily: [
        { date: "2026-06-01", kwh: 2, source: "ACTUAL" },
        { date: "2026-06-02", kwh: 2, source: "ACTUAL" },
      ],
      monthly: [{ month: "2026-05", kwh: 1 }],
      series: {
        intervals15: [
          { timestamp: "2026-06-01T11:00:00.000Z", kwh: 2 },
          { timestamp: "2026-06-02T11:00:00.000Z", kwh: 2 },
        ],
      },
      insights: {
        timeOfDayBuckets: [
          { key: "overnight", label: "Overnight", kwh: 0 },
          { key: "morning", label: "Morning", kwh: 0 },
          { key: "afternoon", label: "Afternoon", kwh: 0 },
          { key: "evening", label: "Evening", kwh: 0 },
        ],
      },
      meta: {
        datasetKind: "SIMULATED",
        actualSource: "GREEN_BUTTON",
        timezone: "America/Chicago",
      },
    };

    reconcilePastDatasetDisplayTotals(dataset);
    const audit = syncPastSimDisplayInsightsFromCanonicalIntervals(dataset);
    const invariants = auditIntervalReadModelInvariants({ dataset });

    expect(audit?.timeOfDayTotalKwh).toBe(4);
    expect(audit?.canonicalTotalKwh).toBe(4);
    expect(Math.abs((audit?.timeOfDayVsCanonicalDeltaKwh ?? 0))).toBeLessThanOrEqual(0.1);
    expect(audit?.timeOfDayDroppedIntervalCount).toBe(0);
    expect(invariants.ok).toBe(true);

    const driftedDataset: Record<string, unknown> = {
      ...dataset,
      totals: { importKwh: 4.52, exportKwh: 0, netKwh: 4.52 },
      summary: { ...(dataset.summary as object), totalKwh: 4.52 },
      insights: {
        timeOfDayBuckets: [
          { key: "overnight", label: "Overnight", kwh: 1 },
          { key: "morning", label: "Morning", kwh: 1 },
          { key: "afternoon", label: "Afternoon", kwh: 1 },
          { key: "evening", label: "Evening", kwh: 1 },
        ],
      },
    };
    const driftAudit = syncPastSimDisplayInsightsFromCanonicalIntervals(driftedDataset);
    expect(driftAudit?.timeOfDayTotalKwh).toBe(4.52);
    expect(driftAudit?.canonicalTotalKwh).toBe(4.52);

    const userVm = buildUserUsageDashboardViewModel({ dataset });
    const adminView = buildOnePathRunReadOnlyView({ dataset });
    expect(userVm?.derived.timeOfDayBuckets).toEqual(adminView?.summary.timeOfDayBuckets);
  });
});
