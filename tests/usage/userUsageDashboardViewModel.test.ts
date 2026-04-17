import { describe, expect, it } from "vitest";
import { buildUserUsageDashboardViewModel } from "@/lib/usage/userUsageDashboardViewModel";

describe("user usage dashboard view model", () => {
  it("builds the same baseline display sections from the shared user-usage contract", () => {
    const viewModel = buildUserUsageDashboardViewModel({
      houseId: "house-1",
      label: "Home",
      address: {
        line1: "123 Main",
        city: "Dallas",
        state: "TX",
      },
      esiid: "esiid-1",
      dataset: {
        summary: {
          source: "SMT",
          intervalsCount: 34823,
          totalKwh: 13542.3,
          start: "2025-04-14",
          end: "2026-04-14",
          latest: "2026-04-14T23:45:00.000Z",
        },
        totals: {
          importKwh: 13542.3,
          exportKwh: 0,
          netKwh: 13542.3,
        },
        monthly: [
          { month: "2026-04", kwh: 542.3 },
          { month: "2026-03", kwh: 13000 },
        ],
        daily: [{ date: "2026-04-14", kwh: 13542.3, source: "ACTUAL", sourceDetail: "ACTUAL" }],
        series: {
          intervals15: [{ timestamp: "2026-04-14T23:45:00.000Z", kwh: 0.3 }],
          hourly: [],
          daily: [],
          monthly: [],
          annual: [],
        },
        insights: {
          monthlyTotals: [
            { month: "2026-04", kwh: 542.3 },
            { month: "2026-03", kwh: 13000 },
          ],
          weekdayVsWeekend: { weekday: 11000, weekend: 2546.3 },
          timeOfDayBuckets: [{ key: "overnight", label: "Overnight", kwh: 4000 }],
          fifteenMinuteAverages: [{ hhmm: "00:15", avgKw: 1.2 }],
          peakDay: { date: "2026-04-14", kwh: 55.1 },
          peakHour: { hour: 18, kw: 6.8 },
          baseload: 0.42,
          baseloadDaily: 24.2,
          baseloadMonthly: 800.5,
        },
        meta: {
          weatherBasis: "ACTUAL",
        },
      },
      alternatives: { smt: null, greenButton: null },
      datasetError: null,
      weatherSensitivityScore: {
        weatherEfficiencyScore0to100: 32,
        scoringMode: "INTERVAL_BASED",
        explanationSummary: "Weather score summary",
      },
      weatherEfficiencyDerivedInput: null,
    });

    expect(viewModel?.coverage).toMatchObject({
      source: "SMT",
      start: "2025-04-16",
      end: "2026-04-15",
      intervalsCount: 34823,
    });
    expect(viewModel?.derived.totals).toEqual({
      importKwh: 13542.3,
      exportKwh: 0,
      netKwh: 13542.3,
    });
    expect(viewModel?.derived.monthly).toEqual([
      { month: "2026-03", kwh: 13000 },
      { month: "2026-04", kwh: 542.3 },
    ]);
    expect(viewModel?.derived.daily).toEqual([
      { date: "2026-04-14", kwh: 13542.3, source: "ACTUAL", sourceDetail: "ACTUAL" },
    ]);
    expect(viewModel?.derived.fifteenCurve).toEqual([{ hhmm: "00:15", avgKw: 1.2 }]);
  });
});
