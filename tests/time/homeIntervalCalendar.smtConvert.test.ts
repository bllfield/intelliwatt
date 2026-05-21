import { describe, expect, it } from "vitest";

import {
  convertSmtPersistedRowsToHome,
  tailIntervals15,
} from "@/lib/time/smtPersistedIntervalConvert";

describe("smtPersistedIntervalConvert", () => {
  it("maps UTC persisted instants to Chicago home slots", () => {
    const result = convertSmtPersistedRowsToHome([
      { ts: new Date("2026-05-19T04:30:00.000Z"), kwh: 0.5 },
    ]);
    expect(result.intervals[0]?.homeDateKey).toBe("2026-05-18");
    expect(result.intervals[0]?.homeSlot).toBe(94);
  });

  it("returns last N intervals for intervals15 tail", () => {
    const startSec = Math.floor(Date.UTC(2026, 4, 1, 12, 0, 0) / 1000);
    const rows = Array.from({ length: 200 }, (_, i) => ({
      ts: new Date((startSec + i * 900) * 1000),
      kwh: 0.1,
    }));
    const converted = convertSmtPersistedRowsToHome(rows);
    const tail = tailIntervals15(converted.intervals, 192);
    expect(tail).toHaveLength(192);
    expect(tail[tail.length - 1]?.timestamp).toBe(converted.intervals[converted.intervals.length - 1]?.tsUtc);
  });
});
