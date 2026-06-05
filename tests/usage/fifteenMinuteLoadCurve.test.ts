import { describe, expect, it } from "vitest";
import {
  buildFifteenMinuteAveragesFromIntervalRows,
  buildLoadCurveInsightsFromIntervalRows,
  derivePeakHourFromFifteenMinuteCurve,
  filterIntervalRowsToActualDailyDates,
  hhmmInHomeTimezone,
} from "@/lib/usage/fifteenMinuteLoadCurve";

describe("fifteenMinuteLoadCurve", () => {
  it("buckets by home-local wall time, not UTC ISO substring", () => {
    const timezone = "America/Chicago";
    const tsChicagoMidnight = "2026-06-01T05:00:00.000Z";
    expect(hhmmInHomeTimezone(tsChicagoMidnight, timezone)).toBe("00:00");

    const utcSliceWouldBe = tsChicagoMidnight.slice(11, 16);
    expect(utcSliceWouldBe).toBe("05:00");

    const curve = buildFifteenMinuteAveragesFromIntervalRows(
      [{ timestamp: tsChicagoMidnight, kwh: 1 }],
      timezone
    );
    expect(curve).toEqual([{ hhmm: "00:00", avgKw: 4 }]);
  });

  it("matches Usage-style evening peak placement for repeated local slots", () => {
    const timezone = "America/Chicago";
    const rows = [
      { timestamp: "2026-01-15T12:00:00.000Z", kwh: 0.5 },
      { timestamp: "2026-02-15T12:00:00.000Z", kwh: 0.5 },
    ];
    const curve = buildFifteenMinuteAveragesFromIntervalRows(rows, timezone);
    const sixAm = curve.find((row) => row.hhmm === "06:00");
    expect(sixAm?.avgKw).toBe(2);
    expect(curve.find((row) => row.hhmm === "05:00")).toBeUndefined();
  });

  it("filterIntervalRowsToActualDailyDates drops simulated travel/vacant days", () => {
    const timezone = "America/Chicago";
    const rows = [
      { timestamp: "2026-06-01T12:00:00.000Z", kwh: 10 },
      { timestamp: "2026-06-02T12:00:00.000Z", kwh: 1 },
    ];
    const daily = [
      { date: "2026-06-01", source: "ACTUAL" },
      { date: "2026-06-02", source: "SIMULATED", sourceDetail: "SIMULATED (TRAVEL/VACANT)" },
    ];
    const filtered = filterIntervalRowsToActualDailyDates(rows, daily, timezone);
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.kwh).toBe(10);
  });

  it("derivePeakHourFromFifteenMinuteCurve picks the highest 15-minute slot", () => {
    expect(
      derivePeakHourFromFifteenMinuteCurve([
        { hhmm: "14:00", avgKw: 5.23 },
        { hhmm: "14:15", avgKw: 4.84 },
        { hhmm: "13:00", avgKw: 2.27 },
      ])
    ).toEqual({ hour: 14, kw: 5.23 });
  });

  it("buildLoadCurveInsightsFromIntervalRows matches separate 15m and time-of-day builders", () => {
    const timezone = "America/Chicago";
    const rows = [
      { timestamp: "2026-01-15T12:00:00.000Z", kwh: 0.25 },
      { timestamp: "2026-01-15T18:00:00.000Z", kwh: 0.75 },
      { timestamp: "2026-06-01T05:00:00.000Z", kwh: 1 },
    ];
    const combined = buildLoadCurveInsightsFromIntervalRows(rows, timezone);
    const separate15 = buildFifteenMinuteAveragesFromIntervalRows(rows, timezone);
    expect(combined.fifteenMinuteAverages).toEqual(separate15);
    expect(combined.timeOfDayBuckets.reduce((sum, row) => sum + row.kwh, 0)).toBeCloseTo(2, 5);
  });
});
