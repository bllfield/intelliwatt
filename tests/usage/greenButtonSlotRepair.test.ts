import { describe, expect, it } from "vitest";

import { addGreenButtonReadingToHomeLocalBuckets } from "@/lib/usage/greenButtonHomeLocalBuckets";
import { normalizeGreenButtonReadingsTo15Min } from "@/lib/usage/greenButtonNormalize";
import {
  repairGreenButtonDaySlots,
  repairGreenButtonIntervalSeries,
} from "@/lib/usage/greenButtonSlotRepair";
import {
  createHomeIntervalCalendar,
  localDateKey,
  localSlotIndex,
} from "@/lib/time/homeIntervalCalendar";

const HOME = createHomeIntervalCalendar("America/Chicago");

describe("greenButtonSlotRepair", () => {
  it("raises a suspicious 19:15 dip when duplicate-sum was stacked on 19:00 (slot 76)", () => {
    const slots = new Map<number, number>([
      [76, 3.737],
      [77, 0.305],
      [78, 1.75],
    ]);
    const collisions = new Map<number, number>([[76, 2]]);
    const repairs = repairGreenButtonDaySlots(slots, collisions, "2025-04-28", HOME);

    expect(repairs).toBeGreaterThan(0);
    expect(slots.get(76)).toBeCloseTo(1.8685, 3);
    expect(slots.get(77)).toBeCloseTo(1.8685, 3);
    expect(slots.get(78)).toBe(1.75);
  });

  it("does not overwrite 19:30 when only slot 77 had duplicate collisions", () => {
    const slots = new Map<number, number>([
      [77, 3.737],
      [78, 1.159],
    ]);
    const collisions = new Map<number, number>([[77, 2]]);
    const repairs = repairGreenButtonDaySlots(slots, collisions, "2025-04-28", HOME);

    expect(repairs).toBeGreaterThan(0);
    expect(slots.get(77)).toBeCloseTo(1.8685, 3);
    expect(slots.get(78)).toBe(1.159);
  });

  it("splits an overfilled slot when the next quarter-hour is missing but usage resumes after", () => {
    const slots = new Map<number, number>([
      [76, 3.737],
      [78, 1.159],
    ]);
    const collisions = new Map<number, number>([[76, 2]]);
    const repairs = repairGreenButtonDaySlots(slots, collisions, "2025-04-28", HOME);

    expect(repairs).toBeGreaterThan(0);
    expect(slots.get(76)).toBeCloseTo(1.8685, 3);
    expect(slots.get(77)).toBeCloseTo(1.8685, 3);
    expect(slots.get(78)).toBe(1.159);
  });

  it("redistributes a gap between two filled neighbors across three slots (/3)", () => {
    const slots = new Map<number, number>([
      [40, 0.9],
      [42, 1.2],
    ]);
    const repairs = repairGreenButtonDaySlots(slots, null, "2026-05-12", HOME);

    expect(repairs).toBeGreaterThan(0);
    expect(slots.get(40)).toBeCloseTo(0.7, 2);
    expect(slots.get(41)).toBeCloseTo(0.7, 2);
    expect(slots.get(42)).toBeCloseTo(0.7, 2);
    expect((slots.get(40) ?? 0) + (slots.get(41) ?? 0) + (slots.get(42) ?? 0)).toBeCloseTo(2.1, 2);
  });

  it("splits an explicit zero padding from the only filled neighbor (/2)", () => {
    const slots = new Map<number, number>([
      [76, 0.25],
      [77, 0],
    ]);
    const repairs = repairGreenButtonDaySlots(slots, null, "2026-05-12", HOME);

    expect(repairs).toBeGreaterThan(0);
    expect(slots.get(76)).toBe(0.125);
    expect(slots.get(77)).toBe(0.125);
  });

  it("splits straddling interval energy by overlap instead of dumping into one slot", () => {
    const buckets = new Map<number, { kwh: number; collisionCount: number }>();
    // 2025-04-28 19:07 Chicago = 8 min in slot 76, 7 min in slot 77 (900s total).
    addGreenButtonReadingToHomeLocalBuckets({
      intervalStartUtc: new Date("2025-04-29T00:07:00.000Z"),
      durationSeconds: 900,
      totalKwh: 0.9,
      home: HOME,
      buckets,
    });

    const daySlots = new Map<number, number>();
    for (const [ms, cell] of buckets) {
      const iso = new Date(ms).toISOString();
      if (localDateKey(iso, HOME) !== "2025-04-28") continue;
      daySlots.set(localSlotIndex(iso, HOME), cell.kwh);
    }

    expect(daySlots.get(76) ?? 0).toBeCloseTo(0.48, 2);
    expect(daySlots.get(77) ?? 0).toBeCloseTo(0.42, 2);
    expect((daySlots.get(76) ?? 0) + (daySlots.get(77) ?? 0)).toBeCloseTo(0.9, 2);
    for (const cell of buckets.values()) {
      expect(cell.collisionCount).toBe(1);
    }
  });

  it("repairs the SMT Green Button duplicate-start + skipped 19:15 pattern from GreenButtonDatanew.xml", () => {
    const normalized = normalizeGreenButtonReadingsTo15Min(
      [
        { timestamp: "1745884800", durationSeconds: 900, value: 1829, unit: "Wh" },
        { timestamp: "1745884800", durationSeconds: 900, value: 1908, unit: "Wh" },
        { timestamp: "1745886600", durationSeconds: 900, value: 1159, unit: "Wh" },
      ],
      { maxKwhPerInterval: 10 }
    );

    expect(normalized.length).toBeGreaterThanOrEqual(3);

    const daySlots = new Map<number, number>();
    for (const row of normalized) {
      const iso = row.timestamp.toISOString();
      if (localDateKey(iso, HOME) !== "2025-04-28") continue;
      daySlots.set(localSlotIndex(iso, HOME), row.consumptionKwh);
    }

    expect(daySlots.has(77)).toBe(true);
    expect(daySlots.get(76) ?? 0).toBeCloseTo(1.8685, 2);
    expect(daySlots.get(77) ?? 0).toBeCloseTo(1.8685, 2);
    expect(daySlots.get(78) ?? 0).toBeCloseTo(1.159, 2);
  });
});
