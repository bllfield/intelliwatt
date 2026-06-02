import { describe, expect, it } from "vitest";

import {
  buildGreenButtonLoadCurveInsightsFromSeriesRows,
  convertGreenButtonSeriesRowsToHome,
  resolveGreenButtonIntervalDeliveryFromMeta,
} from "@/lib/time/greenButtonPersistedIntervalConvert";

describe("greenButtonPersistedIntervalConvert display curve", () => {
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
