import { describe, expect, it } from "vitest";

import { completeActualIntervalsV1, buildPastSimulatedBaselineV1 } from "@/modules/simulatedUsage/engine";
import { dateKeyFromTimestamp, getDayGridTimestamps } from "@/modules/usageSimulator/pastStitchedCurve";

function intervalsForSlots(dateKey: string, slots: number[], kwh = 0.25): Array<{ timestamp: string; kwh: number }> {
  const startMs = new Date(`${dateKey}T00:00:00.000Z`).getTime();
  return slots.map((slot) => ({
    timestamp: new Date(startMs + slot * 15 * 60 * 1000).toISOString(),
    kwh,
  }));
}

describe("shared actual day completeness", () => {
  it("keeps near-complete SMT/interval days actual instead of simulating extra usage", () => {
    const intervals = intervalsForSlots(
      "2026-01-01",
      Array.from({ length: 92 }, (_, slot) => slot),
      1
    );

    const completed = completeActualIntervalsV1({
      actualIntervals: intervals,
      canonicalStartTsUtc: Date.parse("2026-01-01T00:00:00.000Z"),
      canonicalEndTsUtc: Date.parse("2026-01-01T00:00:00.000Z"),
      excludedDateKeys: new Set(),
    });

    expect(completed).toHaveLength(96);
    expect(completed.reduce((sum, row) => sum + row.kwh, 0)).toBe(92);
    expect(completed.slice(92).every((row) => row.kwh === 0)).toBe(true);
  });

  it("still simulates substantially incomplete interval days", () => {
    const intervals = intervalsForSlots(
      "2026-01-01",
      Array.from({ length: 91 }, (_, slot) => slot),
      1
    );

    const completed = completeActualIntervalsV1({
      actualIntervals: intervals,
      canonicalStartTsUtc: Date.parse("2026-01-01T00:00:00.000Z"),
      canonicalEndTsUtc: Date.parse("2026-01-01T00:00:00.000Z"),
      excludedDateKeys: new Set(),
    });

    expect(completed).toHaveLength(96);
    expect(completed.reduce((sum, row) => sum + row.kwh, 0)).not.toBe(91);
  });

  it("labels near-complete actual days as ACTUAL in the shared Past Sim engine", () => {
    const dayStartMs = Date.parse("2026-01-01T00:00:00.000Z");
    const debugOut: { dayDiagnostics?: Array<{ dateKey?: string; dayType?: string; simulatedReason?: string | null }> } = {};

    buildPastSimulatedBaselineV1({
      actualIntervals: intervalsForSlots(
        "2026-01-01",
        Array.from({ length: 92 }, (_, slot) => slot),
        1
      ),
      canonicalDayStartsMs: [dayStartMs],
      excludedDateKeys: new Set(),
      dateKeyFromTimestamp,
      getDayGridTimestamps,
      debug: { collectDayDiagnostics: true, out: debugOut },
    });

    expect(debugOut.dayDiagnostics?.[0]).toMatchObject({
      dateKey: "2026-01-01",
      dayType: "ACTUAL",
      simulatedReason: null,
    });
  });
});
