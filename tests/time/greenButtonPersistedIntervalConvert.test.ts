import { describe, expect, it } from "vitest";

import {
  buildGreenButtonLoadCurveInsightsFromPersistedIntervalRows,
  buildGreenButtonLoadCurveInsightsFromSeriesRows,
  convertGreenButtonSeriesRowsToHome,
  persistedGreenButtonTimestampHhmm,
  resolveGreenButtonIntervalDeliveryFromMeta,
  shouldRebuildGreenButtonFifteenMinuteCurveFromSeries,
} from "@/lib/time/greenButtonPersistedIntervalConvert";

describe("greenButtonPersistedIntervalConvert persisted chart aggregate", () => {
  it("labels slots from UTC wall clock (Postgres double AT TIME ZONE parity)", () => {
    const eveningChicago = new Date("2026-06-02T00:00:00.000Z");
    expect(persistedGreenButtonTimestampHhmm(eveningChicago, "America/Chicago")).toBe("19:00");

    const morningChicago = new Date("2026-06-01T10:00:00.000Z");
    expect(persistedGreenButtonTimestampHhmm(morningChicago, "America/Chicago")).toBe("05:00");
  });

  it("aggregates stored consumptionKwh without changing totals", () => {
    const rows = [
      { timestamp: new Date("2026-04-14T18:00:00.000Z"), consumptionKwh: 1.55 },
      { timestamp: new Date("2026-04-14T18:15:00.000Z"), consumptionKwh: 1.65 },
      { timestamp: new Date("2026-04-15T05:00:00.000Z"), consumptionKwh: 0.5 },
    ];
    const insights = buildGreenButtonLoadCurveInsightsFromPersistedIntervalRows(rows, "America/Chicago");
    expect(insights.fifteenMinuteAverages).toEqual([
      { hhmm: "00:00", avgKw: 2 },
      { hhmm: "13:00", avgKw: 6.2 },
      { hhmm: "13:15", avgKw: 6.6 },
    ]);
    const bucketKwh = insights.timeOfDayBuckets.reduce((sum, row) => sum + row.kwh, 0);
    expect(bucketKwh).toBeCloseTo(3.7, 5);
  });
});

describe("greenButtonPersistedIntervalConvert display curve", () => {
  it("rebuilds curve from series when Past has full-year intervals15", () => {
    expect(
      shouldRebuildGreenButtonFifteenMinuteCurveFromSeries({
        meta: { greenButtonFullYearIntervals15: true },
        intervals15Count: 96,
        hasSimulatedFill: false,
      })
    ).toBe(true);
    expect(
      shouldRebuildGreenButtonFifteenMinuteCurveFromSeries({
        meta: { actualSource: "GREEN_BUTTON" },
        intervals15Count: 192,
        hasSimulatedFill: false,
      })
    ).toBe(false);
  });

  it("uses home_local delivery for producer-style persisted instants", () => {
    const rows = [{ timestamp: "2026-06-01T05:00:00.000Z", kwh: 1 }];
    const delivery = resolveGreenButtonIntervalDeliveryFromMeta({
      greenButtonIntervalTimestampMode: "home_local",
      actualSource: "GREEN_BUTTON",
    });
    expect(delivery.encoding).toBe("instant_iso");
    const home = convertGreenButtonSeriesRowsToHome(rows, {
      homeTimezone: "America/Chicago",
      meta: { greenButtonIntervalTimestampMode: "home_local" },
    });
    expect(home[0]?.homeDateKey).toBe("2026-06-01");
    const curve = buildGreenButtonLoadCurveInsightsFromSeriesRows(rows, {
      homeTimezone: "America/Chicago",
      meta: { greenButtonIntervalTimestampMode: "home_local", actualSource: "GREEN_BUTTON" },
    }).fifteenMinuteAverages;
    expect(curve).toEqual([{ hhmm: "00:00", avgKw: 4 }]);
  });

  it("uses utc_day_grid delivery for legacy cached artifacts", () => {
    const rows = [{ timestamp: "2026-05-12T19:00:00.000Z", kwh: 0.25 }];
    const delivery = resolveGreenButtonIntervalDeliveryFromMeta({
      greenButtonIntervalTimestampMode: "utcDayGrid",
      actualSource: "GREEN_BUTTON",
    });
    expect(delivery.encoding).toBe("utc_day_grid");
    const curve = buildGreenButtonLoadCurveInsightsFromSeriesRows(rows, {
      homeTimezone: "America/Chicago",
      meta: { greenButtonIntervalTimestampMode: "utcDayGrid", actualSource: "GREEN_BUTTON" },
    }).fifteenMinuteAverages;
    expect(curve.find((row) => row.hhmm === "14:00")?.avgKw).toBe(1);
  });
});
