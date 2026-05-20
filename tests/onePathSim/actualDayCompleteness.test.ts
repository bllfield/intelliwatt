import { describe, expect, it } from "vitest";

import { completeActualIntervalsV1, buildPastSimulatedBaselineV1 } from "@/modules/onePathSim/simulatedUsage/engine";
import { dateKeyFromTimestamp, getDayGridTimestamps } from "@/modules/onePathSim/usageSimulator/pastStitchedCurve";

function intervalsForSlots(dateKey: string, slots: number[], kwh = 0.25): Array<{ timestamp: string; kwh: number }> {
  const startMs = new Date(`${dateKey}T00:00:00.000Z`).getTime();
  return slots.map((slot) => ({
    timestamp: new Date(startMs + slot * 15 * 60 * 1000).toISOString(),
    kwh,
  }));
}

describe("One Path actual day completeness", () => {
  it("keeps full 96-slot SMT/interval days actual instead of simulating extra usage", () => {
    const intervals = intervalsForSlots(
      "2026-01-01",
      Array.from({ length: 96 }, (_, slot) => slot),
      1
    );

    const completed = completeActualIntervalsV1({
      actualIntervals: intervals,
      canonicalStartTsUtc: Date.parse("2026-01-01T00:00:00.000Z"),
      canonicalEndTsUtc: Date.parse("2026-01-01T00:00:00.000Z"),
      excludedDateKeys: new Set(),
    });

    expect(completed).toHaveLength(96);
    expect(completed.reduce((sum, row) => sum + row.kwh, 0)).toBe(96);
  });

  it("simulates interval days with 1–95 present slots (strict 96/96)", () => {
    const intervals95 = intervalsForSlots(
      "2026-01-01",
      Array.from({ length: 95 }, (_, slot) => slot),
      1
    );

    const completed95 = completeActualIntervalsV1({
      actualIntervals: intervals95,
      canonicalStartTsUtc: Date.parse("2026-01-01T00:00:00.000Z"),
      canonicalEndTsUtc: Date.parse("2026-01-01T00:00:00.000Z"),
      excludedDateKeys: new Set(),
    });

    expect(completed95).toHaveLength(96);
    expect(completed95.reduce((sum, row) => sum + row.kwh, 0)).not.toBe(95);
  });

  it("labels full 96-slot actual days as ACTUAL in the Past Sim engine", () => {
    const dayStartMs = Date.parse("2026-01-01T00:00:00.000Z");
    const debugOut: { dayDiagnostics?: Array<{ dateKey?: string; dayType?: string; simulatedReason?: string | null }> } = {};

    buildPastSimulatedBaselineV1({
      actualIntervals: intervalsForSlots(
        "2026-01-01",
        Array.from({ length: 96 }, (_, slot) => slot),
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
