import { afterEach, describe, expect, test, vi } from "vitest";
import { canonicalUsageWindowChicago, canonicalUsageWindowForTimezone } from "@/lib/time/chicago";

vi.unmock("@/lib/usage/canonicalCoverageConfig");

function dayDiffInclusive(startDate: string, endDate: string): number {
  const s = new Date(`${startDate}T12:00:00.000Z`).getTime();
  const e = new Date(`${endDate}T12:00:00.000Z`).getTime();
  return Math.floor((e - s) / (24 * 60 * 60 * 1000)) + 1;
}

describe("canonicalUsageWindowChicago", () => {
  afterEach(() => {
    vi.resetModules();
  });

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

  test("config lag 3 shifts endDate one calendar day earlier than lag 2", async () => {
    vi.resetModules();
    vi.doMock("@/lib/usage/canonicalCoverageConfig", () => ({
      CANONICAL_COVERAGE_LAG_DAYS: 3,
      CANONICAL_COVERAGE_TOTAL_DAYS: 365,
    }));
    const { canonicalUsageWindowChicago: windowChicago } = await import("@/lib/time/chicago");
    const now = new Date("2026-03-12T12:00:00.000Z");
    const lag2 = windowChicago({ now, reliableLagDays: 2 });
    const lag3Default = windowChicago({ now });
    expect(lag2.endDate).toBe("2026-03-10");
    expect(lag3Default.endDate).toBe("2026-03-09");
  });
});

describe("canonicalUsageWindowForTimezone", () => {
  test("uses requested timezone day boundary instead of fixed Chicago boundary", () => {
    const now = new Date("2026-03-12T04:30:00.000Z");
    const chicago = canonicalUsageWindowForTimezone({ now, timezone: "America/Chicago" });
    const newYork = canonicalUsageWindowForTimezone({ now, timezone: "America/New_York" });

    expect(chicago.endDate).toBe("2026-03-09");
    expect(newYork.endDate).toBe("2026-03-10");
    expect(dayDiffInclusive(chicago.startDate, chicago.endDate)).toBe(365);
    expect(dayDiffInclusive(newYork.startDate, newYork.endDate)).toBe(365);
  });
});
