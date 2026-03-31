import { describe, expect, it } from "vitest";
import {
  enrichPastDailyRowsWithSourceDetailFromMeta,
  reconcileRestoredPastDatasetFromDecodedIntervals,
  simulatedDateKeysFromPastDatasetDaily,
  simulatedDateKeysUnionFromPastDatasetMeta,
} from "@/modules/usageSimulator/dataset";

describe("reconcileRestoredPastDatasetFromDecodedIntervals", () => {
  it("replaces stale daily rows with interval-derived rows (drops ghost dates)", () => {
    const intervals = [
      { timestamp: "2020-06-01T00:00:00.000Z", kwh: 10 },
      { timestamp: "2020-06-02T00:00:00.000Z", kwh: 20 },
      { timestamp: "2020-06-03T00:00:00.000Z", kwh: 10 },
    ];
    const dataset: any = {
      summary: { end: "2020-06-03" },
      meta: {
        simulatedTravelVacantDateKeysLocal: ["2020-06-01"],
        simulatedTestModeledDateKeysLocal: [],
        simulatedSourceDetailByDate: { "2020-06-01": "SIMULATED_TRAVEL_VACANT" },
      },
      daily: [
        { date: "2020-06-01", kwh: 10, source: "SIMULATED", sourceDetail: "SIMULATED_OTHER" },
        { date: "2020-06-02", kwh: 20, source: "SIMULATED", sourceDetail: "SIMULATED_OTHER" },
        { date: "2020-06-03", kwh: 10, source: "ACTUAL" },
        { date: "2020-12-01", kwh: 0, source: "SIMULATED", sourceDetail: "SIMULATED_OTHER" },
      ],
      monthly: [{ month: "2020-06", kwh: 999 }],
      usageBucketsByMonth: { "2020-06": { a: 1 } },
      series: { daily: [], monthly: [], annual: [] },
      insights: { weekdayVsWeekend: { weekday: 0, weekend: 0 }, peakDay: null, stitchedMonth: null },
      totals: {},
    };

    reconcileRestoredPastDatasetFromDecodedIntervals({
      dataset,
      decodedIntervals: intervals,
      fallbackEndDate: "2020-06-03",
    });

    expect(dataset.daily.map((d: any) => d.date)).toEqual(["2020-06-01", "2020-06-02", "2020-06-03"]);
    const byDate = Object.fromEntries(dataset.daily.map((d: any) => [d.date, d]));
    expect(byDate["2020-06-01"].source).toBe("SIMULATED");
    expect(byDate["2020-06-01"].sourceDetail).toBe("SIMULATED_TRAVEL_VACANT");
    expect(byDate["2020-06-02"].source).toBe("ACTUAL");
    expect(byDate["2020-06-02"].sourceDetail).toBe("ACTUAL");
    expect(byDate["2020-12-01"]).toBeUndefined();
    expect(dataset.series.daily.length).toBe(3);
  });

  it("when meta lists/maps are empty, does not inherit stale SIMULATED from daily (all ACTUAL for interval days)", () => {
    const intervals = [{ timestamp: "2020-06-01T00:00:00.000Z", kwh: 5 }];
    const dataset: any = {
      summary: { end: "2020-06-01" },
      meta: {
        simulatedTravelVacantDateKeysLocal: [],
        simulatedTestModeledDateKeysLocal: [],
        simulatedSourceDetailByDate: {},
      },
      daily: [{ date: "2020-06-01", kwh: 5, source: "SIMULATED", sourceDetail: "SIMULATED_OTHER" }],
      monthly: [],
      series: { daily: [], monthly: [], annual: [] },
      insights: {},
      totals: {},
    };

    reconcileRestoredPastDatasetFromDecodedIntervals({
      dataset,
      decodedIntervals: intervals,
      fallbackEndDate: "2020-06-01",
    });

    expect(dataset.daily[0].source).toBe("ACTUAL");
    expect(dataset.daily[0].sourceDetail).toBe("ACTUAL");
  });

  it("preserves TRAVEL_VACANT vs TEST sourceDetail from meta after replacement", () => {
    const intervals = [
      { timestamp: "2020-06-01T00:00:00.000Z", kwh: 1 },
      { timestamp: "2020-06-02T00:00:00.000Z", kwh: 2 },
    ];
    const dataset: any = {
      summary: { end: "2020-06-02" },
      meta: {
        simulatedTravelVacantDateKeysLocal: ["2020-06-01"],
        simulatedTestModeledDateKeysLocal: ["2020-06-02"],
        simulatedSourceDetailByDate: {
          "2020-06-01": "SIMULATED_TRAVEL_VACANT",
          "2020-06-02": "SIMULATED_TEST_DAY",
        },
      },
      daily: [],
      monthly: [],
      series: { daily: [], monthly: [], annual: [] },
      insights: {},
      totals: {},
    };

    reconcileRestoredPastDatasetFromDecodedIntervals({
      dataset,
      decodedIntervals: intervals,
      fallbackEndDate: "2020-06-02",
    });

    const byDate = Object.fromEntries(dataset.daily.map((d: any) => [d.date, d]));
    expect(byDate["2020-06-01"].sourceDetail).toBe("SIMULATED_TRAVEL_VACANT");
    expect(byDate["2020-06-02"].sourceDetail).toBe("SIMULATED_TEST_DAY");
  });

  it("legacy: when meta is absent, simulated keys still come from stored daily SIMULATED rows", () => {
    const keys = simulatedDateKeysUnionFromPastDatasetMeta(undefined);
    expect(keys.size).toBe(0);

    const legacy = simulatedDateKeysFromPastDatasetDaily([
      { date: "2020-01-01", source: "SIMULATED" },
      { date: "2020-01-02", source: "ACTUAL" },
    ]);
    expect(Array.from(legacy).sort()).toEqual(["2020-01-01"]);
  });

  it("enrichPastDailyRowsWithSourceDetailFromMeta maps SIMULATED_OTHER when meta has no detail for that date", () => {
    const rows = enrichPastDailyRowsWithSourceDetailFromMeta(
      [{ date: "2020-01-01", kwh: 1, source: "SIMULATED" }],
      { simulatedSourceDetailByDate: {} }
    );
    expect(rows[0].sourceDetail).toBe("SIMULATED_OTHER");
  });
});
