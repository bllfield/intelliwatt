import { describe, expect, it } from "vitest";

import { buildOnePathRunReadOnlyView } from "@/modules/onePathSim/runReadOnlyView";

describe("buildOnePathRunReadOnlyView", () => {
  it("binds monthly, daily, and 15-minute sections to the simulated dataset", () => {
    const view = buildOnePathRunReadOnlyView({
      dataset: {
        summary: {
          source: "SIMULATED",
          intervalsCount: 35040,
        },
        totals: {
          importKwh: 15008.06,
          exportKwh: 0,
          netKwh: 15008.06,
        },
        monthly: [
          { month: "2026-04", kwh: 1000 },
          { month: "2026-05", kwh: 1100 },
        ],
        daily: [
          { date: "2026-04-16", kwh: 10, source: "SIMULATED" },
          { date: "2026-04-17", kwh: 11, source: "SIMULATED" },
        ],
        insights: {
          fifteenMinuteAverages: [
            { hhmm: "00:00", avgKw: 1.2 },
            { hhmm: "00:15", avgKw: 1.3 },
          ],
          weekdayVsWeekend: { weekday: 9000, weekend: 6008.06 },
          timeOfDayBuckets: [{ key: "overnight", label: "Overnight", kwh: 2500 }],
          peakDay: { date: "2026-06-01", kwh: 55 },
          peakHour: { hour: 17, kw: 4.8 },
          baseload: 0.9,
        },
        meta: {
          datasetKind: "SIMULATED",
        },
      },
    });

    expect(view).not.toBeNull();
    expect(view?.summary.source).toBe("SIMULATED");
    expect(view?.monthlyRows).toEqual([
      { month: "2026-04", kwh: 1000 },
      { month: "2026-05", kwh: 1100 },
    ]);
    expect(view?.dailyRows).toEqual([
      { date: "2026-04-16", kwh: 10, source: "SIMULATED", sourceDetail: undefined },
      { date: "2026-04-17", kwh: 11, source: "SIMULATED", sourceDetail: undefined },
    ]);
    expect(view?.fifteenMinuteAverages).toEqual([
      { hhmm: "00:00", avgKw: 1.2 },
      { hhmm: "00:15", avgKw: 1.3 },
    ]);
  });
});
