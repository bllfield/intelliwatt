import { describe, expect, test } from "vitest";
import { deriveUsageShapeProfile, type IntervalInput } from "@/modules/usageShapeProfile/derive";

function enumerateUtcDatesInclusive(startDate: string, endDate: string): string[] {
  const out: string[] = [];
  let cur = new Date(`${startDate}T12:00:00.000Z`).getTime();
  const end = new Date(`${endDate}T12:00:00.000Z`).getTime();
  while (cur <= end) {
    out.push(new Date(cur).toISOString().slice(0, 10));
    cur += 24 * 60 * 60 * 1000;
  }
  return out;
}

describe("deriveUsageShapeProfile", () => {
  test("keeps all local month keys when canonical 365-day window spans 13 YYYY-MM labels", () => {
    const startDate = "2025-03-11";
    const endDate = "2026-03-10";
    const intervals: IntervalInput[] = enumerateUtcDatesInclusive(startDate, endDate).map((d) => ({
      tsUtc: `${d}T12:00:00.000Z`,
      kwh: 1,
    }));

    const out = deriveUsageShapeProfile(
      intervals,
      "America/Chicago",
      `${startDate}T00:00:00.000Z`,
      `${endDate}T23:59:59.999Z`
    );

    expect(Object.keys(out.shapeByMonth96)).toContain("2025-03");
    expect(Object.keys(out.shapeByMonth96)).toContain("2026-03");
    expect(Object.keys(out.shapeByMonth96).length).toBe(13);
    expect(out.avgKwhPerDayWeekdayByMonth.length).toBe(12);
    expect(out.avgKwhPerDayWeekendByMonth.length).toBe(12);
    expect(out.peakHourByMonth.length).toBe(12);
    expect(out.p95KwByMonth.length).toBe(12);
  });

  test("uses Chicago-local month/day semantics instead of raw UTC slicing", () => {
    const intervals: IntervalInput[] = [
      // 2026-02-28 23:30 Chicago (belongs to February locally)
      { tsUtc: "2026-03-01T05:30:00.000Z", kwh: 1 },
      // 2026-03-01 00:00 Chicago (belongs to March locally)
      { tsUtc: "2026-03-01T06:00:00.000Z", kwh: 1 },
    ];

    const out = deriveUsageShapeProfile(
      intervals,
      "America/Chicago",
      "2026-02-01T00:00:00.000Z",
      "2026-03-31T23:59:59.999Z"
    );

    expect(Object.keys(out.shapeByMonth96)).toContain("2026-02");
    expect(Object.keys(out.shapeByMonth96)).toContain("2026-03");
  });
});
