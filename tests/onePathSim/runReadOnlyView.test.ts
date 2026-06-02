import { describe, expect, it } from "vitest";

import { resolveCanonicalUsage365CoverageWindow } from "@/lib/usage/canonicalMetadataWindow";
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
      { hhmm: "19:00", avgKw: 2 },
      { hhmm: "19:15", avgKw: 3 },
    ]);
    expect(view?.fifteenMinuteCurveSourceOwner).toBe(
      "resolvePastSimDisplayFifteenMinuteCurve(...).intervals15Fallback"
    );
  });

  it("prefers current run intervals over stored 15-minute insights to avoid stale display curves", () => {
    const view = buildOnePathRunReadOnlyView({
      dataset: {
        summary: {
          source: "GREEN_BUTTON with simulated fill for Travel/Vacant",
          intervalsCount: 4,
        },
        daily: [{ date: "2026-01-02", kwh: 2.5, source: "ACTUAL" }],
        monthly: [{ month: "2026-01", kwh: 2.5 }],
        insights: {
          fifteenMinuteAverages: [
            { hhmm: "17:00", avgKw: 99 },
            { hhmm: "17:15", avgKw: 1 },
          ],
          weekdayVsWeekend: { weekday: 2.5, weekend: 0 },
          timeOfDayBuckets: [],
          peakDay: null,
          peakHour: null,
          baseload: 1,
        },
        series: {
          intervals15: [
            { timestamp: "2026-01-02T23:00:00.000Z", kwh: 0.25 },
            { timestamp: "2026-01-02T23:15:00.000Z", kwh: 0.5 },
            { timestamp: "2026-01-02T23:30:00.000Z", kwh: 0.75 },
            { timestamp: "2026-01-02T23:45:00.000Z", kwh: 1 },
          ],
        },
        meta: {
          datasetKind: "SIMULATED",
          actualSource: "GREEN_BUTTON",
          timezone: "America/Chicago",
          monthProvenanceByMonth: { "2026-01": "SIMULATED" },
        },
      },
    });

    expect(view?.fifteenMinuteAverages).toEqual([
      { hhmm: "17:00", avgKw: 1 },
      { hhmm: "17:15", avgKw: 2 },
      { hhmm: "17:30", avgKw: 3 },
      { hhmm: "17:45", avgKw: 4 },
    ]);
    expect(view?.fifteenMinuteCurveSourceOwner).toBe(
      "greenButtonPersistedIntervalConvert.buildGreenButtonLoadCurveInsightsFromSeriesRows"
    );
  });

  it("buckets Green Button Past intervals in home-local time (same as user Usage dashboard)", () => {
    const view = buildOnePathRunReadOnlyView({
      dataset: {
        summary: {
          source: "GREEN_BUTTON with simulated fill for Travel/Vacant",
          intervalsCount: 4,
        },
        daily: [{ date: "2026-05-12", kwh: 2.5, source: "ACTUAL" }],
        monthly: [{ month: "2026-05", kwh: 2.5 }],
        insights: {
          fifteenMinuteAverages: [],
          weekdayVsWeekend: { weekday: 2.5, weekend: 0 },
          timeOfDayBuckets: [],
          peakDay: null,
          peakHour: null,
          baseload: 1,
        },
        series: {
          intervals15: [
            { timestamp: "2026-05-12T19:00:00.000Z", kwh: 0.25 },
            { timestamp: "2026-05-12T19:15:00.000Z", kwh: 0.5 },
            { timestamp: "2026-05-12T19:30:00.000Z", kwh: 0.75 },
            { timestamp: "2026-05-12T19:45:00.000Z", kwh: 1 },
          ],
        },
        meta: {
          datasetKind: "SIMULATED",
          actualSource: "GREEN_BUTTON",
          timezone: "America/Chicago",
          greenButtonIntervalTimestampMode: "utcDayGrid",
          monthProvenanceByMonth: { "2026-05": "SIMULATED" },
        },
      },
    });

    expect(view?.fifteenMinuteAverages).toEqual([
      { hhmm: "14:00", avgKw: 1 },
      { hhmm: "14:15", avgKw: 2 },
      { hhmm: "14:30", avgKw: 3 },
      { hhmm: "14:45", avgKw: 4 },
    ]);
    expect(view?.fifteenMinuteCurveSourceOwner).toBe(
      "greenButtonPersistedIntervalConvert.buildGreenButtonLoadCurveInsightsFromSeriesRows"
    );
  });

  it("rebuilds Green Button Past curves from intervals when cached artifacts omit explicit grid metadata", () => {
    const view = buildOnePathRunReadOnlyView({
      dataset: {
        summary: {
          source: "GREEN_BUTTON with simulated fill for Travel/Vacant",
          intervalsCount: 2,
        },
        daily: [{ date: "2026-05-12", kwh: 0.75, source: "ACTUAL" }],
        monthly: [{ month: "2026-05", kwh: 0.75 }],
        insights: {
          fifteenMinuteAverages: [],
          weekdayVsWeekend: { weekday: 0.75, weekend: 0 },
          timeOfDayBuckets: [],
          peakDay: null,
          peakHour: null,
          baseload: 1,
        },
        series: {
          intervals15: [
            { timestamp: "2026-05-12T19:00:00.000Z", kwh: 0.25 },
            { timestamp: "2026-05-12T19:15:00.000Z", kwh: 0.5 },
          ],
        },
        meta: {
          datasetKind: "SIMULATED",
          actualSource: "GREEN_BUTTON",
          timezone: "America/Chicago",
          greenButtonCoverageIntervalCount: 2,
          greenButtonSourceDateByTargetDate: {
            "2026-05-12": "2025-05-12",
          },
          monthProvenanceByMonth: { "2026-05": "SIMULATED" },
        },
      },
    });

    expect(view?.fifteenMinuteAverages).toEqual([
      { hhmm: "14:00", avgKw: 1 },
      { hhmm: "14:15", avgKw: 2 },
    ]);
  });

  it("averages padded Green Button slots in home-local time without admin-only redistribution", () => {
    const view = buildOnePathRunReadOnlyView({
      dataset: {
        summary: {
          source: "GREEN_BUTTON with simulated fill for Travel/Vacant",
          intervalsCount: 4,
        },
        daily: [{ date: "2026-05-12", kwh: 1.5, source: "ACTUAL" }],
        monthly: [{ month: "2026-05", kwh: 1.5 }],
        insights: {
          fifteenMinuteAverages: [],
          weekdayVsWeekend: { weekday: 1.5, weekend: 0 },
          timeOfDayBuckets: [],
          peakDay: null,
          peakHour: null,
          baseload: 1,
        },
        series: {
          intervals15: [
            { timestamp: "2026-05-12T19:15:00.000Z", kwh: 0 },
            { timestamp: "2026-05-13T19:15:00.000Z", kwh: 0.5 },
            { timestamp: "2026-05-12T19:30:00.000Z", kwh: 0.25 },
            { timestamp: "2026-05-13T19:30:00.000Z", kwh: 0.75 },
          ],
        },
        meta: {
          datasetKind: "SIMULATED",
          actualSource: "GREEN_BUTTON",
          timezone: "America/Chicago",
          greenButtonIntervalTimestampMode: "utcDayGrid",
          greenButtonPaddedIntervalCount: 1,
          monthProvenanceByMonth: { "2026-05": "SIMULATED" },
        },
      },
    });

    expect(view?.fifteenMinuteAverages).toEqual([
      { hhmm: "14:15", avgKw: 0 },
      { hhmm: "14:30", avgKw: 1 },
    ]);
  });

  it("averages cross-day padded Green Button dumps in home-local slots", () => {
    const view = buildOnePathRunReadOnlyView({
      dataset: {
        summary: {
          source: "GREEN_BUTTON with simulated fill for Travel/Vacant",
          intervalsCount: 6,
        },
        daily: [
          { date: "2026-05-12", kwh: 1.25, source: "ACTUAL" },
          { date: "2026-05-13", kwh: 1, source: "ACTUAL" },
        ],
        monthly: [{ month: "2026-05", kwh: 2.25 }],
        insights: {
          fifteenMinuteAverages: [],
          weekdayVsWeekend: { weekday: 2.25, weekend: 0 },
          timeOfDayBuckets: [],
          peakDay: null,
          peakHour: null,
          baseload: 1,
        },
        series: {
          intervals15: [
            { timestamp: "2026-05-12T19:00:00.000Z", kwh: 1 },
            { timestamp: "2026-05-12T19:15:00.000Z", kwh: 0 },
            { timestamp: "2026-05-12T19:30:00.000Z", kwh: 0.25 },
            { timestamp: "2026-05-13T19:00:00.000Z", kwh: 0.25 },
            { timestamp: "2026-05-13T19:15:00.000Z", kwh: 0.5 },
            { timestamp: "2026-05-13T19:30:00.000Z", kwh: 0.25 },
          ],
        },
        meta: {
          datasetKind: "SIMULATED",
          actualSource: "GREEN_BUTTON",
          timezone: "America/Chicago",
          greenButtonIntervalTimestampMode: "utcDayGrid",
          greenButtonPaddedIntervalCount: 1,
          monthProvenanceByMonth: { "2026-05": "SIMULATED" },
        },
      },
    });

    expect(view?.fifteenMinuteAverages).toEqual([
      { hhmm: "14:00", avgKw: 2.5 },
      { hhmm: "14:15", avgKw: 1 },
      { hhmm: "14:30", avgKw: 1 },
    ]);
  });

  it("uses pool-corrected Green Button intervals as-is for the shared Past display curve", () => {
    const view = buildOnePathRunReadOnlyView({
      dataset: {
        summary: {
          source: "GREEN_BUTTON with simulated fill for Travel/Vacant",
          intervalsCount: 3,
        },
        daily: [{ date: "2026-05-12", kwh: 1.25, source: "ACTUAL" }],
        monthly: [{ month: "2026-05", kwh: 1.25 }],
        insights: {
          fifteenMinuteAverages: [],
          weekdayVsWeekend: { weekday: 1.25, weekend: 0 },
          timeOfDayBuckets: [],
          peakDay: null,
          peakHour: null,
          baseload: 1,
        },
        series: {
          intervals15: [
            { timestamp: "2026-05-12T19:00:00.000Z", kwh: 0.25 },
            { timestamp: "2026-05-12T19:15:00.000Z", kwh: 0.5 },
            { timestamp: "2026-05-12T19:30:00.000Z", kwh: 0.5 },
          ],
        },
        meta: {
          datasetKind: "SIMULATED",
          actualSource: "GREEN_BUTTON",
          timezone: "America/Chicago",
          greenButtonIntervalTimestampMode: "utcDayGrid",
          greenButtonPaddedIntervalCount: 1,
          greenButtonZeroRedistributedIntervalCount: 1,
          monthProvenanceByMonth: { "2026-05": "SIMULATED" },
        },
      },
    });

    expect(view?.fifteenMinuteAverages).toEqual([
      { hhmm: "14:00", avgKw: 1 },
      { hhmm: "14:15", avgKw: 2 },
      { hhmm: "14:30", avgKw: 2 },
    ]);
  });

  it("prefers Chicago-local daily rows from intervals when stored UTC daily rows stop before the coverage end", () => {
    const canonicalWindow = resolveCanonicalUsage365CoverageWindow();
    const intervals15: Array<{ timestamp: string; kwh: number }> = [];
    const start = new Date("2026-05-01T00:00:00.000Z").getTime();
    const end = new Date("2026-05-03T23:45:00.000Z").getTime();
    for (let ts = start; ts <= end; ts += 15 * 60 * 1000) {
      intervals15.push({ timestamp: new Date(ts).toISOString(), kwh: 0.25 });
    }

    const view = buildOnePathRunReadOnlyView({
      dataset: {
        summary: {
          source: "SIMULATED",
          intervalsCount: intervals15.length,
        },
        daily: [
          { date: "2026-05-01", kwh: 24, source: "SIMULATED" },
          { date: "2026-05-02", kwh: 24, source: "SIMULATED" },
        ],
        monthly: [{ month: "2026-05", kwh: 72 }],
        insights: {
          fifteenMinuteAverages: [],
          weekdayVsWeekend: { weekday: 48, weekend: 24 },
          timeOfDayBuckets: [],
          peakDay: null,
          peakHour: null,
          baseload: 1,
        },
        series: {
          intervals15,
        },
        meta: {
          datasetKind: "SIMULATED",
          timezone: "America/Chicago",
          coverageStart: "2026-05-01",
          coverageEnd: "2026-05-03",
        },
      },
    });

    expect(view?.summary.coverageStart).toBe(canonicalWindow.startDate);
    expect(view?.summary.coverageEnd).toBe(canonicalWindow.endDate);
    expect(view?.dailyRows.map((row) => row.date)).toEqual([
      "2026-04-30",
      "2026-05-01",
      "2026-05-02",
      "2026-05-03",
    ]);
    expect(view?.dailyRows[3]).toMatchObject({
      date: "2026-05-03",
      source: "ACTUAL",
      sourceDetail: "ACTUAL",
    });
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

  it("uses the shared usage dashboard contract for baseline passthrough instead of artifact interval tails", () => {
    const view = buildOnePathRunReadOnlyView({
      dataset: {
        summary: {
          source: "SMT",
          intervalsCount: 34875,
          totalKwh: 14355,
          start: "2025-05-19",
          end: "2026-05-18",
        },
        daily: [
          { date: "2026-05-17", kwh: 34.26, source: "ACTUAL" },
          {
            date: "2026-05-18",
            kwh: 37.78,
            source: "ACTUAL",
            sourceDetail: "ACTUAL_INTERVALS_NOT_AVAILABLE_YET",
          },
        ],
        monthly: [{ month: "2026-05", kwh: 900 }],
        insights: {
          fifteenMinuteAverages: [
            { hhmm: "00:00", avgKw: 0.2 },
            { hhmm: "12:00", avgKw: 1.5 },
          ],
          weekdayVsWeekend: { weekday: 10348.7, weekend: 4005.8 },
          timeOfDayBuckets: [{ key: "evening", label: "Evening", kwh: 4509.1 }],
          peakDay: { date: "2026-01-25", kwh: 80.79 },
          peakHour: { hour: 20, kw: 2.3 },
          baseload: 0.2,
          baseloadDaily: 15.16,
          baseloadMonthly: 362.01,
        },
        totals: { importKwh: 14355, exportKwh: 0, netKwh: 14355 },
        meta: {
          datasetKind: "ACTUAL",
          actualSource: "SMT",
          baselinePassthrough: true,
          coverageStart: "2025-05-19",
          coverageEnd: "2026-05-18",
          smtPendingIntervalDateKeys: ["2026-05-18"],
        },
        series: {
          intervals15: [
            { timestamp: "2026-05-18T00:00:00.000Z", kwh: 51.47 },
            { timestamp: "2026-05-18T00:15:00.000Z", kwh: 51.47 },
          ],
        },
      },
    });

    expect(view?.dailyRows).toEqual([
      { date: "2026-05-17", kwh: 34.26, source: "ACTUAL", sourceDetail: undefined },
      {
        date: "2026-05-18",
        kwh: 37.78,
        source: "ACTUAL",
        sourceDetail: "ACTUAL_INTERVALS_NOT_AVAILABLE_YET",
      },
    ]);
    expect(view?.fifteenMinuteAverages).toEqual([
      { hhmm: "00:00", avgKw: 0.2 },
      { hhmm: "12:00", avgKw: 1.5 },
    ]);
    expect(view?.fifteenMinuteCurveSourceOwner).toBe(
      "buildOnePathRunReadOnlyView(...).dataset.insights.fifteenMinuteAverages"
    );
    expect(view?.summary.baseload).toBe(0.2);
  });

  it("rebuilds the baseline passthrough 15-minute curve from intervals when chart insights are missing", () => {
    const view = buildOnePathRunReadOnlyView({
      dataset: {
        summary: {
          source: "GREEN_BUTTON",
          intervalsCount: 34562,
          totalKwh: 14082,
          start: "2025-05-14",
          end: "2026-05-13",
        },
        daily: [{ date: "2026-05-13", kwh: 45.04, source: "ACTUAL" }],
        monthly: [{ month: "2026-05", kwh: 900 }],
        insights: {
          baseload: 0.34,
          weekdayVsWeekend: { weekday: 9799.3, weekend: 4272.8 },
          timeOfDayBuckets: [],
          peakDay: { date: "2026-01-25", kwh: 189.31 },
          peakHour: null,
        },
        totals: { importKwh: 14082, exportKwh: 0, netKwh: 14082 },
        meta: {
          datasetKind: "ACTUAL",
          actualSource: "GREEN_BUTTON",
          baselinePassthrough: true,
          coverageStart: "2025-05-14",
          coverageEnd: "2026-05-13",
          timezone: "America/Chicago",
        },
        series: {
          intervals15: [
            { timestamp: "2026-05-13T12:00:00.000Z", kwh: 0.25 },
            { timestamp: "2026-05-13T12:15:00.000Z", kwh: 0.5 },
            { timestamp: "2026-05-14T12:00:00.000Z", kwh: 0.75 },
            { timestamp: "2026-05-14T12:15:00.000Z", kwh: 1.0 },
          ],
        },
      },
    });

    expect(view?.fifteenMinuteAverages.length).toBeGreaterThan(0);
    expect(view?.fifteenMinuteCurveSourceOwner).toBe("buildOnePathRunReadOnlyView(...).dataset.series.intervals15");
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

  it("drops pre-window daily rows so Past Sim display stays at 365 canonical days", () => {
    const canonicalWindow = resolveCanonicalUsage365CoverageWindow();
    const view = buildOnePathRunReadOnlyView({
      dataset: {
        summary: {
          source: "SMT with simulated fill for Travel/Vacant",
          intervalsCount: 96 * 2,
          start: "2025-05-18",
          end: "2026-05-18",
        },
        daily: [
          { date: "2025-05-18", kwh: 11.32, source: "ACTUAL" },
          { date: "2026-05-18", kwh: 45.08, source: "ACTUAL" },
        ],
        monthly: [{ month: "2026-05", kwh: 45.08 }],
        insights: {
          fifteenMinuteAverages: [{ hhmm: "00:00", avgKw: 1.2 }],
          weekdayVsWeekend: { weekday: 45.08, weekend: 0 },
          timeOfDayBuckets: [],
          peakDay: { date: "2026-05-18", kwh: 45.08 },
          peakHour: { hour: 20, kw: 2.1 },
          baseload: 0.2,
        },
        meta: {
          datasetKind: "SIMULATED",
          actualSource: "SMT",
          timezone: "America/Chicago",
          coverageStart: "2025-05-18",
          coverageEnd: "2026-05-18",
        },
        series: {
          intervals15: [
            ...Array.from({ length: 96 }, (_, slot) => ({
              timestamp: new Date(Date.UTC(2025, 4, 18, 0, slot * 15, 0, 0)).toISOString(),
              kwh: 11.32 / 96,
            })),
            ...Array.from({ length: 96 }, (_, slot) => ({
              timestamp: new Date(Date.UTC(2026, 4, 18, 0, slot * 15, 0, 0)).toISOString(),
              kwh: 45.08 / 96,
            })),
          ],
        },
      },
      sageActualDaily: [{ date: "2026-05-18", kwh: 51.47 }],
    });

    expect(view?.dailyRows.map((row) => row.date)).toEqual(["2026-05-18"]);
    expect(view?.summary.coverageStart).toBe(canonicalWindow.startDate);
    expect(view?.summary.coverageEnd).toBe(canonicalWindow.endDate);
  });

  it("overlays sage actual daily kWh for Past Sim ACTUAL-labeled days instead of stitched interval re-sums", () => {
    const view = buildOnePathRunReadOnlyView({
      dataset: {
        summary: {
          source: "SMT with simulated fill for Travel/Vacant",
          intervalsCount: 96,
          start: "2026-05-18",
          end: "2026-05-18",
        },
        daily: [{ date: "2026-05-18", kwh: 45.08, source: "ACTUAL" }],
        monthly: [{ month: "2026-05", kwh: 45.08 }],
        insights: {
          fifteenMinuteAverages: [{ hhmm: "00:00", avgKw: 1.2 }],
          weekdayVsWeekend: { weekday: 45.08, weekend: 0 },
          timeOfDayBuckets: [],
          peakDay: { date: "2026-05-18", kwh: 45.08 },
          peakHour: { hour: 20, kw: 2.1 },
          baseload: 0.2,
        },
        meta: {
          datasetKind: "SIMULATED",
          actualSource: "SMT",
          timezone: "America/Chicago",
          coverageStart: "2026-05-18",
          coverageEnd: "2026-05-18",
        },
        series: {
          intervals15: Array.from({ length: 96 }, (_, slot) => ({
            timestamp: new Date(Date.UTC(2026, 4, 18, 5, slot * 15, 0, 0)).toISOString(),
            kwh: 45.08 / 96,
          })),
        },
      },
      sageActualDaily: [{ date: "2026-05-18", kwh: 51.47 }],
    });

    expect(view?.dailyRows).toEqual([
      { date: "2026-05-18", kwh: 51.47, source: "ACTUAL", sourceDetail: undefined },
    ]);
  });

  it("shows Weather Efficiency Score on baseline passthrough when score is on engine input but not dataset meta", () => {
    const view = buildOnePathRunReadOnlyView({
      dataset: {
        summary: {
          source: "SMT",
          intervalsCount: 96,
          totalKwh: 14435,
          start: "2025-05-20",
          end: "2026-05-19",
        },
        totals: { importKwh: 14435, exportKwh: 0, netKwh: 14435 },
        monthly: [{ month: "2026-05", kwh: 14435 }],
        daily: [{ date: "2026-05-19", kwh: 39.5, source: "ACTUAL", sourceDetail: "ACTUAL" }],
        insights: {
          fifteenMinuteAverages: [{ hhmm: "20:00", avgKw: 2.3 }],
          weekdayVsWeekend: { weekday: 10000, weekend: 4435 },
          timeOfDayBuckets: [{ key: "evening", label: "Evening", kwh: 4000 }],
          peakDay: { date: "2026-01-25", kwh: 79.5 },
          peakHour: { hour: 20, kw: 2.3 },
          baseload: 0.41,
          baseloadDaily: 15.09,
          baseloadMonthly: 679,
        },
        meta: {
          datasetKind: "ACTUAL",
          baselinePassthrough: true,
          weatherSourceSummary: "actual_only",
        },
        series: { intervals15: [] },
      },
      weatherSensitivityScore: {
        scoringMode: "INTERVAL_BASED",
        weatherEfficiencyScore0to100: 49,
        coolingSensitivityScore0to100: 100,
        heatingSensitivityScore0to100: 64,
        confidenceScore0to100: 100,
        explanationSummary: "Moderate weather response.",
        recommendationFlags: { appearsWeatherSensitive: true },
        nextDetailPromptType: null,
        requiredInputAdjustmentsApplied: [],
        poolAdjustmentApplied: false,
        hvacAdjustmentApplied: false,
        occupancyAdjustmentApplied: false,
        thermostatAdjustmentApplied: false,
        scoreVersion: "v1",
        calculationVersion: "v1",
      },
    });

    expect(view?.weatherScore?.weatherEfficiencyScore0to100).toBe(49);
    expect(view?.weatherScore?.coolingSensitivityScore0to100).toBe(100);
    expect(view?.weatherScore?.heatingSensitivityScore0to100).toBe(64);
    expect(view?.weatherScore?.confidenceScore0to100).toBe(100);
  });
});
