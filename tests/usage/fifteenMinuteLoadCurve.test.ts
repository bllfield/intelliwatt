import { describe, expect, it } from "vitest";
import {
  buildFifteenMinuteAveragesFromIntervalRows,
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
});
