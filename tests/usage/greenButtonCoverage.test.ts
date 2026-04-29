import { describe, expect, it } from "vitest";
import { DateTime } from "luxon";

import {
  buildUtcRangeForChicagoLocalDateRange,
  trimGreenButtonIntervalsToLatestLocalDays,
} from "@/lib/usage/greenButtonCoverage";

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
  it("keeps the latest 365 complete Chicago-local days from the uploaded file", () => {
    const intervals = buildChicagoDateRangeIntervals("2024-12-01", 366);

    const out = trimGreenButtonIntervalsToLatestLocalDays(intervals, 365);

    expect(out.startDateKey).toBe("2024-12-02");
    expect(out.endDateKey).toBe("2025-12-01");
    expect(out.trimmed).toHaveLength(365 * 96);
  });

  it("builds UTC bounds from Chicago-local date keys", () => {
    const out = buildUtcRangeForChicagoLocalDateRange({
      startDateKey: "2024-12-02",
      endDateKey: "2025-12-01",
    });

    expect(out?.startInclusive.toISOString()).toBe("2024-12-02T06:00:00.000Z");
    expect(out?.endInclusive.toISOString()).toBe("2025-12-02T05:59:59.999Z");
  });
});
