import { describe, expect, it } from "vitest";

import {
  buildHomeDayGridContext,
  homeProjectedIntervalFromRecord,
} from "@/lib/time/actualIntervalCalendar";
import { localDayBoundsUtc, smtHomeIntervalCalendar } from "@/lib/time/homeIntervalCalendar";
import { convertSmtPersistedRowsToHome } from "@/lib/time/smtPersistedIntervalConvert";
import { completeActualIntervalsV1, buildPastSimulatedBaselineV1 } from "@/modules/onePathSim/simulatedUsage/engine";

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
    const dateKey = "2026-01-01";
    const home = smtHomeIntervalCalendar();
    const homeDayGrid = buildHomeDayGridContext({
      startDateKey: dateKey,
      endDateKey: dateKey,
      home,
    });
    const debugOut: { dayDiagnostics?: Array<{ dateKey?: string; dayType?: string; simulatedReason?: string | null }> } = {};

    buildPastSimulatedBaselineV1({
      actualIntervals: intervalsForSlots(
        dateKey,
        Array.from({ length: 96 }, (_, slot) => slot),
        1
      ),
      canonicalDayStartsMs: homeDayGrid.canonicalDayStartsMs,
      excludedDateKeys: new Set(),
      dateKeyFromTimestamp: homeDayGrid.dateKeyFromTimestamp,
      getDayGridTimestamps: homeDayGrid.getDayGridTimestamps,
      debug: { collectDayDiagnostics: true, out: debugOut },
    });

    expect(debugOut.dayDiagnostics?.[0]).toMatchObject({
      dateKey: "2026-01-01",
      dayType: "ACTUAL",
      simulatedReason: null,
    });
  });

  it("keeps DST fall-back days ACTUAL when 96 SMT rows are present despite stale ledger incomplete-meter", () => {
    const dateKey = "2025-11-02";
    const home = smtHomeIntervalCalendar();
    const { startUtc, endUtcExclusive } = localDayBoundsUtc(dateKey, home);
    const smtRows: Array<{ ts: Date; kwh: number }> = [];
    const seenTs = new Set<string>();
    for (let ms = startUtc.getTime(); ms < endUtcExclusive.getTime(); ms += 15 * 60 * 1000) {
      const ts = new Date(ms);
      const tsKey = ts.toISOString();
      if (seenTs.has(tsKey)) continue;
      seenTs.add(tsKey);
      smtRows.push({ ts, kwh: 0.36 });
      if (smtRows.length >= 96) break;
    }
    expect(smtRows).toHaveLength(96);

    const actualIntervals = convertSmtPersistedRowsToHome(smtRows).intervals.map(homeProjectedIntervalFromRecord);
    const homeDayGrid = buildHomeDayGridContext({
      startDateKey: dateKey,
      endDateKey: dateKey,
      home,
    });
    const debugOut: { dayDiagnostics?: Array<{ dateKey?: string; dayType?: string; simulatedReason?: string | null }> } =
      {};

    buildPastSimulatedBaselineV1({
      actualIntervals,
      canonicalDayStartsMs: homeDayGrid.canonicalDayStartsMs,
      excludedDateKeys: new Set(),
      dateKeyFromTimestamp: homeDayGrid.dateKeyFromTimestamp,
      getDayGridTimestamps: homeDayGrid.getDayGridTimestamps,
      ledgerIncompleteMeterDateKeys: new Set([dateKey]),
      debug: { collectDayDiagnostics: true, out: debugOut },
    });

    expect(debugOut.dayDiagnostics?.[0]).toMatchObject({
      dateKey,
      dayType: "ACTUAL",
      simulatedReason: null,
    });
  });
});
