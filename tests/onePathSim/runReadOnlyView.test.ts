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
    expect(view?.summary.baseload).toBe(0.9);
    expect(view?.summary.weekdayKwh).toBe(9000);
    expect(view?.summary.weekendKwh).toBe(6008.06);
    expect(view?.summary.timeOfDayBuckets).toEqual([{ key: "overnight", label: "Overnight", kwh: 2500 }]);
  });

  it("keeps daily weather and monthly baseload truth when the simulated dataset already carries them", () => {
    const view = buildOnePathRunReadOnlyView({
      dataset: {
        summary: {
          source: "SIMULATED",
          intervalsCount: 35040,
        },
        daily: [{ date: "2026-04-16", kwh: 10, source: "SIMULATED" }],
        dailyWeather: {
          "2026-04-16": {
            tAvgF: 72.3,
            tMinF: 61.1,
            tMaxF: 84.4,
            hdd65: 0,
            cdd65: 7.3,
            source: "actual",
          },
        },
        monthly: [
          { month: "2025-05", kwh: 650 },
          { month: "2025-06", kwh: 688.52 },
          { month: "2025-07", kwh: 710 },
        ],
        totals: {
          importKwh: 15008.06,
          exportKwh: 0,
          netKwh: 15008.06,
        },
        insights: {
          fifteenMinuteAverages: [{ hhmm: "00:00", avgKw: 1.2 }],
          weekdayVsWeekend: { weekday: 9000, weekend: 6008.06 },
          timeOfDayBuckets: [{ key: "overnight", label: "Overnight", kwh: 2500 }],
          peakDay: null,
          peakHour: null,
          baseload: 0.95,
          baseloadDaily: 22.75,
          baseloadMonthly: 688.52,
        },
        meta: {
          datasetKind: "SIMULATED",
          weatherSourceSummary: "actual_only",
        },
      },
    });

    expect(view?.dailyWeather?.["2026-04-16"]).toEqual({
      tAvgF: 72.3,
      tMinF: 61.1,
      tMaxF: 84.4,
      hdd65: 0,
      cdd65: 7.3,
      source: "actual",
    });
    expect(view?.summary.baseload).toBe(0.95);
    expect(view?.summary.baseloadDaily).toBe(22.75);
    expect(view?.summary.baseloadMonthly).toBe(688.52);
    expect(view?.summary.timeOfDayBuckets.length).toBe(1);
    expect(view?.fifteenMinuteAverages).toEqual([{ hhmm: "00:00", avgKw: 1.2 }]);
  });

  it("rebuilds the 15-minute load curve from simulated interval truth when stored curve insights are missing", () => {
    const view = buildOnePathRunReadOnlyView({
      dataset: {
        summary: {
          source: "SIMULATED",
          intervalsCount: 35040,
        },
        daily: [
          { date: "2026-04-16", kwh: 10, source: "SIMULATED" },
          { date: "2026-04-17", kwh: 12, source: "SIMULATED" },
        ],
        monthly: [{ month: "2026-04", kwh: 22 }],
        insights: {
          weekdayVsWeekend: { weekday: 22, weekend: 0 },
          timeOfDayBuckets: [],
          peakDay: null,
          peakHour: null,
          baseload: 0.8,
        },
        series: {
          intervals15: [
            { timestamp: "2026-04-16T00:00:00.000Z", kwh: 0.25 },
            { timestamp: "2026-04-16T00:15:00.000Z", kwh: 0.5 },
            { timestamp: "2026-04-17T00:00:00.000Z", kwh: 0.75 },
            { timestamp: "2026-04-17T00:15:00.000Z", kwh: 1.0 },
          ],
        },
        meta: {
          datasetKind: "SIMULATED",
        },
      },
    });

    expect(view?.fifteenMinuteAverages).toEqual([
      { hhmm: "00:00", avgKw: 2 },
      { hhmm: "00:15", avgKw: 3 },
    ]);
  });

  it("reuses shared stitched-month display metadata so One Path monthly rows match the user chart contract", () => {
    const view = buildOnePathRunReadOnlyView({
      dataset: {
        summary: {
          source: "SIMULATED",
          intervalsCount: 35040,
        },
        monthly: [
          { month: "2025-04", kwh: 523.53 },
          { month: "2025-05", kwh: 100 },
          { month: "2026-04", kwh: 419.69 },
        ],
        daily: [{ date: "2026-04-16", kwh: 10, source: "SIMULATED" }],
        insights: {
          fifteenMinuteAverages: [{ hhmm: "00:00", avgKw: 1.2 }],
          weekdayVsWeekend: { weekday: 10, weekend: 0 },
          timeOfDayBuckets: [],
          peakDay: null,
          peakHour: null,
          baseload: 0.8,
        },
        meta: {
          datasetKind: "SIMULATED",
        },
      },
      readModel: {
        sharedDiagnostics: {
          simulatedChartStitchedMonth: {
            mode: "PRIOR_YEAR_TAIL",
            yearMonth: "2026-04",
            haveDaysThrough: 15,
            missingDaysFrom: 16,
            missingDaysTo: 30,
            borrowedFromYearMonth: "2025-04",
            completenessRule: "borrow_prior_year_tail",
          },
        },
      },
    });

    expect(view?.monthlyRows).toEqual([
      { month: "2025-05", kwh: 100 },
      { month: "2026-04", kwh: 943.22 },
    ]);
    expect(view?.stitchedMonth).toEqual({
      mode: "PRIOR_YEAR_TAIL",
      yearMonth: "2026-04",
      haveDaysThrough: 15,
      missingDaysFrom: 16,
      missingDaysTo: 30,
      borrowedFromYearMonth: "2025-04",
      completenessRule: "borrow_prior_year_tail",
    });
  });

  it("suppresses shared stitched-month fallback for manual display-window remaps", () => {
    const view = buildOnePathRunReadOnlyView({
      dataset: {
        summary: {
          source: "SIMULATED",
          intervalsCount: 34944,
        },
        monthly: [
          { month: "2025-05", kwh: 100 },
          { month: "2026-04", kwh: 200 },
        ],
        daily: [{ date: "2026-04-21", kwh: 10, source: "SIMULATED" }],
        insights: {
          fifteenMinuteAverages: [{ hhmm: "00:00", avgKw: 1.2 }],
          weekdayVsWeekend: { weekday: 10, weekend: 0 },
          timeOfDayBuckets: [],
          peakDay: null,
          peakHour: null,
          baseload: 0.8,
          stitchedMonth: null,
        },
        meta: {
          datasetKind: "SIMULATED",
          manualDisplayWindowStitch: {
            simulationWindowStart: "2025-03-17",
            simulationWindowEnd: "2026-03-15",
            displayWindowStart: "2025-04-23",
            displayWindowEnd: "2026-04-21",
          },
        },
      },
      readModel: {
        sharedDiagnostics: {
          simulatedChartStitchedMonth: {
            mode: "PRIOR_YEAR_TAIL",
            yearMonth: "2026-04",
            haveDaysThrough: 21,
            missingDaysFrom: 22,
            missingDaysTo: 30,
            borrowedFromYearMonth: "2025-04",
            completenessRule: "borrow_prior_year_tail",
          },
        },
      },
    });

    expect(view?.monthlyRows).toEqual([
      { month: "2025-05", kwh: 100 },
      { month: "2026-04", kwh: 200 },
    ]);
    expect(view?.stitchedMonth).toBeNull();
  });

  it("binds validation compare rows and metrics from the persisted read model", () => {
    const view = buildOnePathRunReadOnlyView({
      dataset: {
        summary: {
          source: "SIMULATED",
          intervalsCount: 1344,
        },
        daily: [
          { date: "2026-04-16", kwh: 99, source: "ACTUAL" },
          { date: "2026-04-17", kwh: 100, source: "ACTUAL" },
        ],
        monthly: [{ month: "2026-04", kwh: 199 }],
        insights: {
          fifteenMinuteAverages: [{ hhmm: "00:00", avgKw: 1.2 }],
          weekdayVsWeekend: { weekday: 100, weekend: 99 },
          timeOfDayBuckets: [],
          peakDay: null,
          peakHour: null,
          baseload: 0.9,
        },
        meta: {
          datasetKind: "SIMULATED",
        },
      },
      readModel: {
        compareProjection: {
          rows: [
            {
              localDate: "2026-04-16",
              dayType: "weekday",
              actualDayKwh: 8.1,
              simulatedDayKwh: 7.8,
              errorKwh: -0.3,
              percentError: 3.7,
              weather: {
                tAvgF: 71.2,
                tMinF: 60.1,
                tMaxF: 84.4,
                hdd65: 0,
                cdd65: 6.2,
                source: "actual",
                weatherMissing: false,
              },
            },
          ],
          metrics: {
            wape: 3.7,
            mae: 0.3,
            rmse: 0.3,
          },
        },
        tuningSummary: {
          selectedValidationRows: [
            {
              localDate: "2026-04-18",
              dayType: "weekend",
              actualDayKwh: 55,
            },
          ],
        },
      },
    });

    expect(view?.compare.metrics).toEqual({
      wape: 3.7,
      mae: 0.3,
      rmse: 0.3,
    });
    expect(view?.compare.rows).toEqual([
      {
        localDate: "2026-04-16",
        dayType: "weekday",
        actualDayKwh: 8.1,
        simulatedDayKwh: 7.8,
        errorKwh: -0.3,
        percentError: 3.7,
        weather: {
          tAvgF: 71.2,
          tMinF: 60.1,
          tMaxF: 84.4,
          hdd65: 0,
          cdd65: 6.2,
          source: "actual",
          weatherMissing: false,
        },
      },
    ]);
    expect(view?.compare.rows[0]?.actualDayKwh).toBe(8.1);
    expect(view?.compare.selectedValidationRows).toEqual([
      {
        localDate: "2026-04-18",
        dayType: "weekend",
        actualDayKwh: 55,
      },
    ]);
  });
});
