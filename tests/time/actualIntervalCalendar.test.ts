import { describe, expect, test } from "vitest";
import {
  buildHomeDayGridContext,
  countPresentSlotsForIntervalDay,
  countPresentUnitsForIntervalDay,
  dayMeetsTrustedIntervalThreshold,
  trustedIntervalThresholdForDateKey,
} from "@/lib/time/actualIntervalCalendar";
import { smtHomeIntervalCalendar } from "@/lib/time/homeIntervalCalendar";
import { convertSmtPersistedRowsToHome } from "@/lib/time/smtPersistedIntervalConvert";
import { DateTime } from "luxon";

describe("actualIntervalCalendar", () => {
  test("spring-forward day requires 92 SMT intervals for trusted pool", () => {
    expect(trustedIntervalThresholdForDateKey("2026-03-08", "SMT")).toBe(92);
  });

  test("fall-back day caps SMT trusted threshold at 96 when 100 slots exist", () => {
    expect(trustedIntervalThresholdForDateKey("2025-11-02", "SMT")).toBe(96);
  });

  test("Green Button trusted threshold uses full DST-aware expected slots (92/96/100)", () => {
    expect(trustedIntervalThresholdForDateKey("2026-03-08", "GREEN_BUTTON")).toBe(92);
    expect(trustedIntervalThresholdForDateKey("2025-05-20", "GREEN_BUTTON")).toBe(96);
    expect(trustedIntervalThresholdForDateKey("2025-11-02", "GREEN_BUTTON")).toBe(100);
  });

  test("home day grid emits 92 timestamps on spring-forward day", () => {
    const home = smtHomeIntervalCalendar();
    const grid = buildHomeDayGridContext({
      startDateKey: "2026-03-08",
      endDateKey: "2026-03-08",
      home,
    });
    expect(grid.canonicalDayStartsMs).toHaveLength(1);
    const timestamps = grid.getDayGridTimestamps(grid.canonicalDayStartsMs[0]!);
    expect(timestamps).toHaveLength(92);
  });

  test("SMT trusted-day check uses interval-row count (DST fall-back), not distinct slot indices only", () => {
    const dateKey = "2025-11-02";
    const home = smtHomeIntervalCalendar();
    const intervals: Array<{ timestamp: string; homeDateKey: string; homeSlot: number }> = [];
    for (let i = 0; i < 96; i += 1) {
      intervals.push({
        timestamp: `2025-11-02T06:${String(i).padStart(2, "0")}:00.000Z`,
        homeDateKey: dateKey,
        homeSlot: i % 92,
      });
    }
    expect(intervals).toHaveLength(96);
    expect(countPresentSlotsForIntervalDay(intervals, dateKey)).toBe(92);
    expect(countPresentUnitsForIntervalDay({ intervals, dateKey, source: "SMT" })).toBe(96);
    expect(
      dayMeetsTrustedIntervalThreshold({
        intervals,
        dateKey,
        source: "SMT",
        home,
      }),
    ).toBe(true);
  });

  test("dayMeetsTrustedIntervalThreshold uses homeSlot projection", () => {
    const home = smtHomeIntervalCalendar();
    const dateKey = "2026-03-08";
    const { startUtc, endUtcExclusive } = (() => {
      const start = DateTime.fromISO(dateKey, { zone: home.timezone }).startOf("day");
      const end = start.plus({ days: 1 });
      return { startUtc: start.toUTC().toJSDate(), endUtcExclusive: end.toUTC().toJSDate() };
    })();
    const rows: Array<{ ts: Date; kwh: number }> = [];
    for (let ms = startUtc.getTime(); ms < endUtcExclusive.getTime(); ms += 15 * 60 * 1000) {
      rows.push({ ts: new Date(ms), kwh: 0.25 });
    }
    const converted = convertSmtPersistedRowsToHome(rows, home.timezone);
    const intervals = converted.intervals.map((row) => ({
      timestamp: row.tsUtc,
      homeDateKey: row.homeDateKey,
      homeSlot: row.homeSlot,
    }));
    expect(
      dayMeetsTrustedIntervalThreshold({
        intervals,
        dateKey,
        source: "SMT",
        home,
      }),
    ).toBe(true);
  });
});
