import { describe, expect, it } from "vitest";
import { chicagoSlot96FromTs, smtCoverageDateKey } from "@/lib/time/chicago";
import { normalizeSmtIntervals } from "@/app/lib/smt/normalize";

function buildStartLabeledDayCsv(): string {
  const rows = ["ESIID,Meter,Usage Date,Interval End Time,kWh"];
  for (let slot = 0; slot < 96; slot += 1) {
    const hour = Math.floor(slot / 4);
    const minute = (slot % 4) * 15;
    const hh = String(hour).padStart(2, "0");
    const mm = String(minute).padStart(2, "0");
    rows.push(`10400511114390001,M1,05/18/2026,${hh}:${mm},0.5`);
  }
  return rows.join("\n");
}

describe("normalizeSmtIntervals ingest timestamps", () => {
  it("keeps interval-start labels on a full Chicago day (slot 95 at 23:45)", () => {
    const { intervals, stats } = normalizeSmtIntervals(buildStartLabeledDayCsv(), {
      esiid: "10400511114390001",
      meter: "M1",
    });

    expect(stats.processedRows).toBe(96);
    expect(intervals).toHaveLength(96);

    const may18 = intervals.filter((row) => smtCoverageDateKey(row.ts) === "2026-05-18");
    expect(may18).toHaveLength(96);

    const slots = new Set(may18.map((row) => chicagoSlot96FromTs(row.ts)));
    expect(slots.size).toBe(96);
    expect(slots.has(95)).toBe(true);

    const tsMax = may18.reduce((current, row) => (row.ts > current ? row.ts : current), may18[0]!.ts);
    expect(tsMax.toISOString()).toBe("2026-05-19T04:45:00.000Z");
  });

  it("still converts true period-end labels (00:15 .. 00:00) to interval starts", () => {
    const rows = ["ESIID,Meter,Usage Date,Interval End Time,kWh"];
    for (let slot = 0; slot < 96; slot += 1) {
      const totalMinutes = (slot + 1) * 15;
      const hour = Math.floor(totalMinutes / 60) % 24;
      const minute = totalMinutes % 60;
      const day = totalMinutes >= 24 * 60 ? "05/19/2026" : "05/18/2026";
      const hh = String(hour).padStart(2, "0");
      const mm = String(minute).padStart(2, "0");
      rows.push(`10400511114390001,M1,${day},${hh}:${mm},0.5`);
    }
    const { intervals } = normalizeSmtIntervals(rows.join("\n"), {
      esiid: "10400511114390001",
      meter: "M1",
    });

    const may18 = intervals.filter((row) => smtCoverageDateKey(row.ts) === "2026-05-18");
    expect(may18).toHaveLength(96);
    expect(new Set(may18.map((row) => chicagoSlot96FromTs(row.ts))).has(95)).toBe(true);
    expect(
      may18.reduce((current, row) => (row.ts > current ? row.ts : current), may18[0]!.ts).toISOString()
    ).toBe("2026-05-19T04:45:00.000Z");
  });
});
