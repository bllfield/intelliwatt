import { describe, expect, it } from "vitest";
import { buildUserUsageDashboardViewModel } from "@/lib/usage/userUsageDashboardViewModel";
import { resolveCanonicalUsage365CoverageWindow } from "@/modules/usageSimulator/metadataWindow";

describe("user usage dashboard view model", () => {
  it("builds the same baseline display sections from the shared user-usage contract", () => {
    const canonicalWindow = resolveCanonicalUsage365CoverageWindow();
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
      start: canonicalWindow.startDate,
      end: canonicalWindow.endDate,
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

  it("uses explicit manual display coverage and derives bucket totals from displayed rows", () => {
    const viewModel = buildUserUsageDashboardViewModel({
      dataset: {
        summary: {
          source: "SIMULATED",
          intervalsCount: 4,
          totalKwh: 999,
          start: "2025-03-17",
          end: "2026-03-15",
        },
        totals: {
          importKwh: 999,
          exportKwh: 0,
          netKwh: 999,
        },
        monthly: [{ month: "2026-04", kwh: 18 }],
        daily: [
          { date: "2026-04-18", kwh: 5, source: "SIMULATED", sourceDetail: "SIMULATED_MANUAL_CONSTRAINED" },
          { date: "2026-04-19", kwh: 6, source: "SIMULATED", sourceDetail: "SIMULATED_MANUAL_CONSTRAINED" },
          { date: "2026-04-20", kwh: 7, source: "SIMULATED", sourceDetail: "SIMULATED_MANUAL_CONSTRAINED" },
        ],
        series: {
          intervals15: [
            { timestamp: "2026-04-18T01:00:00.000Z", kwh: 5 },
            { timestamp: "2026-04-19T07:00:00.000Z", kwh: 6 },
            { timestamp: "2026-04-20T13:00:00.000Z", kwh: 7 },
          ],
          hourly: [],
          daily: [],
          monthly: [],
          annual: [],
        },
        insights: {
          weekdayVsWeekend: { weekday: 900, weekend: 99 },
          timeOfDayBuckets: [{ key: "all", label: "All day", kwh: 999 }],
          peakDay: { date: "2025-01-01", kwh: 999 },
          fifteenMinuteAverages: [],
        },
        meta: {
          datasetKind: "SIMULATED",
          coverageStart: "2026-04-18",
          coverageEnd: "2026-04-20",
          manualDisplayWindowStitch: {
            simulationWindowStart: "2025-03-17",
            simulationWindowEnd: "2026-03-15",
            displayWindowStart: "2026-04-18",
            displayWindowEnd: "2026-04-20",
          },
        },
      },
      datasetError: null,
    });

    expect(viewModel?.coverage).toMatchObject({
      source: "SIMULATED",
      start: "2026-04-18",
      end: "2026-04-20",
      intervalsCount: 4,
    });
    expect(viewModel?.derived.totals).toEqual({
      importKwh: 18,
      exportKwh: 0,
      netKwh: 18,
    });
    expect(viewModel?.derived.weekdayKwh).toBe(7);
    expect(viewModel?.derived.weekendKwh).toBe(11);
    expect(viewModel?.derived.timeOfDayBuckets).toEqual([
      { key: "overnight", label: "Overnight (12am–6am)", kwh: 6 },
      { key: "morning", label: "Morning (6am–12pm)", kwh: 7 },
      { key: "afternoon", label: "Afternoon (12pm–6pm)", kwh: 0 },
      { key: "evening", label: "Evening (6pm–12am)", kwh: 5 },
    ]);
    expect(viewModel?.derived.peakDay).toEqual({
      date: "2026-04-20",
      kwh: 7,
      source: "SIMULATED",
      sourceDetail: "SIMULATED_MANUAL_CONSTRAINED",
    });
  });
});
