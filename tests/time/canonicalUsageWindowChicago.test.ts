import { describe, expect, test } from "vitest";
import { canonicalUsageWindowChicago } from "@/lib/time/chicago";

function dayDiffInclusive(startDate: string, endDate: string): number {
  const s = new Date(`${startDate}T12:00:00.000Z`).getTime();
  const e = new Date(`${endDate}T12:00:00.000Z`).getTime();
  return Math.floor((e - s) / (24 * 60 * 60 * 1000)) + 1;
}

describe("canonicalUsageWindowChicago", () => {
  test("defaults to inclusive 365-day window with two-day reliability lag", () => {
    const out = canonicalUsageWindowChicago({ now: new Date("2026-03-12T12:00:00.000Z") });
    expect(out.endDate).toBe("2026-03-10");
    expect(out.startDate).toBe("2025-03-11");
    expect(dayDiffInclusive(out.startDate, out.endDate)).toBe(365);
  });

  test("handles leap-year spans with stable inclusive day count", () => {
    const out = canonicalUsageWindowChicago({ now: new Date("2024-03-03T12:00:00.000Z") });
    expect(out.endDate).toBe("2024-03-01");
    expect(dayDiffInclusive(out.startDate, out.endDate)).toBe(365);
  });

  test("supports explicit totalDays override", () => {
    const out = canonicalUsageWindowChicago({
      now: new Date("2026-03-12T12:00:00.000Z"),
      reliableLagDays: 2,
      totalDays: 30,
    });
    expect(dayDiffInclusive(out.startDate, out.endDate)).toBe(30);
  });
});
