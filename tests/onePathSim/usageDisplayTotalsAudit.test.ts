import { describe, expect, it } from "vitest";
import { buildUsageDisplayTotalsAudit } from "@/modules/onePathSim/usageDisplayTotalsAudit";

describe("one path usage display totals audit", () => {
  it("shows how stitched monthly display totals can diverge from raw interval bucket totals", () => {
    const audit = buildUsageDisplayTotalsAudit({
      dataset: {
        summary: {
          totalKwh: 13546.27,
        },
        series: {
          intervals15: [
            { timestamp: "2026-04-14T00:00:00.000Z", kwh: 10000 },
            { timestamp: "2026-04-14T00:15:00.000Z", kwh: 3542.3 },
          ],
        },
        monthly: [
          { month: "2026-03", kwh: 12000 },
          { month: "2026-04", kwh: 1542.3 },
          { month: "2025-04", kwh: 4 },
        ],
        insights: {
          stitchedMonth: {
            yearMonth: "2026-04",
            borrowedFromYearMonth: "2025-04",
          },
          weekdayVsWeekend: {
            weekday: 10000,
            weekend: 3542.3,
          },
          timeOfDayBuckets: [
            { key: "overnight", label: "Overnight", kwh: 2000 },
            { key: "day", label: "Day", kwh: 11542.3 },
          ],
        },
        totals: {
          importKwh: 13546.3,
          exportKwh: 0,
          netKwh: 13546.3,
        },
      },
    });

    expect(audit.rawIntervalTotalKwh).toBe(13542.3);
    expect(audit.monthlyDisplayedTotalKwh).toBe(13546.3);
    expect(audit.dashboardHeadlineTotalKwh).toBe(13546.3);
    expect(audit.weekdayWeekendBreakdownTotalKwh).toBe(13542.3);
    expect(audit.timeOfDayBucketTotalKwh).toBe(13542.3);
    expect(audit.firstDivergenceOwner).toBe("lib/usage/actualDatasetForHouse.ts :: totalsForDataset / summary.totalKwh");
    expect(audit.mismatchClassification).toBe("expected_stitched_latest_month_display_behavior");
  });

  it("stays aligned when raw intervals, totals, and buckets all match", () => {
    const audit = buildUsageDisplayTotalsAudit({
      dataset: {
        summary: {
          totalKwh: 120,
        },
        series: {
          intervals15: [{ timestamp: "2026-04-14T00:00:00.000Z", kwh: 120 }],
        },
        monthly: [{ month: "2026-04", kwh: 120 }],
        insights: {
          stitchedMonth: null,
          weekdayVsWeekend: {
            weekday: 100,
            weekend: 20,
          },
          timeOfDayBuckets: [{ key: "all", label: "All day", kwh: 120 }],
        },
        totals: {
          importKwh: 120,
          exportKwh: 0,
          netKwh: 120,
        },
      },
    });

    expect(audit.rawIntervalTotalKwh).toBe(120);
    expect(audit.dashboardHeadlineTotalKwh).toBe(120);
    expect(audit.weekdayWeekendBreakdownTotalKwh).toBe(120);
    expect(audit.firstDivergenceOwner).toBe(null);
    expect(audit.mismatchClassification).toBe("aligned");
  });

  it("uses the full baseline truth total instead of a preview fifteen-minute slice", () => {
    const audit = buildUsageDisplayTotalsAudit({
      dataset: {
        summary: {
          totalKwh: 13539.41,
        },
        daily: [
          { date: "2026-04-13", kwh: 6769.7 },
          { date: "2026-04-14", kwh: 6769.71 },
        ],
        series: {
          intervals15: [
            { timestamp: "2026-04-14T00:00:00.000Z", kwh: 20.25 },
            { timestamp: "2026-04-14T00:15:00.000Z", kwh: 20.25 },
            { timestamp: "2026-04-14T00:30:00.000Z", kwh: 20.25 },
            { timestamp: "2026-04-14T00:45:00.000Z", kwh: 20.25 },
          ],
        },
        monthly: [
          { month: "2026-04", kwh: 13539.41 },
        ],
        insights: {
          stitchedMonth: null,
          weekdayVsWeekend: {
            weekday: 10000,
            weekend: 3539.41,
          },
          timeOfDayBuckets: [{ key: "all", label: "All day", kwh: 13539.41 }],
        },
        totals: {
          importKwh: 13539.41,
          exportKwh: 0,
          netKwh: 13539.41,
        },
      },
    });

    expect(audit.rawIntervalTotalKwh).toBe(13539.41);
    expect(audit.summaryTotalKwh).toBe(13539.41);
    expect(audit.datasetTotalsNetKwh).toBe(13539.41);
    expect(audit.firstDivergenceOwner).toBe(null);
  });
});
