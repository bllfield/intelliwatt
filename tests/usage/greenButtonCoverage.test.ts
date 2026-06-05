import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DateTime } from "luxon";

import {
  buildUtcRangeForChicagoLocalDateRange,
  trimGreenButtonIntervalsToCanonicalUsageWindow,
  trimGreenButtonIntervalsToLatestLocalDays,
} from "@/lib/usage/greenButtonCoverage";
import { CANONICAL_COVERAGE_LAG_DAYS } from "@/lib/usage/canonicalCoverageConfig";

function buildChicagoDayIntervals(dateKey: string) {
  const start = DateTime.fromISO(dateKey, { zone: "America/Chicago" }).startOf("day");
  return Array.from({ length: 96 }, (_, idx) => ({
    timestamp: start.plus({ minutes: idx * 15 }).toUTC().toJSDate(),
  }));
}

function buildChicagoDateRangeIntervals(startDateKey: string, dayCount: number) {
  const start = DateTime.fromISO(startDateKey, { zone: "America/Chicago" }).startOf("day");
  const out: Array<{ timestamp: Date }> = [];
  for (let dayOffset = 0; dayOffset < dayCount; dayOffset += 1) {
    out.push(...buildChicagoDayIntervals(start.plus({ days: dayOffset }).toISODate()!));
  }
  return out;
}

describe("green button coverage window", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-12-05T18:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("trims ingest to the canonical today-anchored window (partial tail days kept)", () => {
    const intervals = [
      ...buildChicagoDateRangeIntervals("2024-11-01", 40),
      ...buildChicagoDateRangeIntervals("2025-11-01", 40),
    ];

    const out = trimGreenButtonIntervalsToCanonicalUsageWindow(intervals, { totalDays: 365 });

    expect(out.endDateKey).toBe("2025-12-03");
    expect(out.startDateKey).toBe("2024-12-04");
    expect(out.trimmed.length).toBeGreaterThan(30 * 96);
    expect(out.trimmed.length).toBeLessThan(intervals.length);
  });

  it("keeps partial file tail inside the canonical window", () => {
    const partialDay = buildChicagoDayIntervals("2025-12-02").slice(0, 48);
    const intervals = [...buildChicagoDateRangeIntervals("2025-06-01", 180), ...partialDay];

    const out = trimGreenButtonIntervalsToCanonicalUsageWindow(intervals, { totalDays: 365 });

    expect(out.endDateKey).toBe("2025-12-03");
    expect(out.trimmed.some((row) => getChicagoDateKey(row) === "2025-12-02")).toBe(true);
  });

  it("builds UTC bounds from Chicago-local date keys", () => {
    const out = buildUtcRangeForChicagoLocalDateRange({
      startDateKey: "2024-12-02",
      endDateKey: "2025-12-01",
    });

    expect(out?.startInclusive.toISOString()).toBe("2024-12-02T06:00:00.000Z");
    expect(out?.endInclusive.toISOString()).toBe("2025-12-02T05:59:59.999Z");
  });

  it("legacy file-complete trim remains available for callers that need it", () => {
    const intervals = buildChicagoDateRangeIntervals("2024-12-01", 366);
    const out = trimGreenButtonIntervalsToLatestLocalDays(intervals, 365);
    expect(out.startDateKey).toBe("2024-12-02");
    expect(out.endDateKey).toBe("2025-12-01");
    expect(out.trimmed).toHaveLength(365 * 96);
  });
});

function getChicagoDateKey(row: { timestamp: Date }): string {
  const lag = CANONICAL_COVERAGE_LAG_DAYS;
  void lag;
  return DateTime.fromJSDate(row.timestamp, { zone: "America/Chicago" }).toFormat("yyyy-MM-dd");
}
