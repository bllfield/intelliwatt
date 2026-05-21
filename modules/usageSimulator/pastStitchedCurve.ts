/**
 * Past interval grid + stitched curve. Grid helpers delegate to lib/time (home-local only).
 */

import type { SimulatedCurve } from "@/modules/simulatedUsage/types";
import type { ActualIntervalPoint } from "@/lib/usage/actualDatasetForHouse";
import {
  createPastIntervalGridForWindow,
  type PastIntervalGrid,
} from "@/lib/time/pastIntervalGrid";
import { dateKeyFromIntervalPoint } from "@/lib/time/actualIntervalCalendar";
import { createHomeIntervalCalendar, enumerateLocalDateKeys, localDayBoundsUtc } from "@/lib/time/homeIntervalCalendar";

const INTERVAL_MINUTES = 15;
const INTERVALS_PER_DAY = (24 * 60) / INTERVAL_MINUTES;
const SLOT_MS = INTERVAL_MINUTES * 60 * 1000;

export { createPastIntervalGridForWindow, type PastIntervalGrid };

/** @deprecated Use createPastIntervalGridForWindow or buildHomeDayGridContext. */
export function dateKeyFromTimestamp(ts: string, homeTimezone: string): string {
  return dateKeyFromIntervalPoint({ timestamp: ts });
}

/** Home-local 15-minute grid for one canonical day start (from enumerateDayStartsMsForWindow). */
export function getDayGridTimestamps(dayStartMs: number, homeTimezone: string): string[] {
  const home = createHomeIntervalCalendar(homeTimezone);
  const iso = new Date(dayStartMs).toISOString();
  const dateKey = dateKeyFromIntervalPoint({ timestamp: iso });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return [];
  const { startUtc } = localDayBoundsUtc(dateKey, home);
  if (startUtc.getTime() !== dayStartMs) {
    const keys = enumerateLocalDateKeys(dateKey, dateKey, home);
    const key = keys[0] ?? dateKey;
    const grid = createPastIntervalGridForWindow({
      homeTimezone,
      startDateKey: key,
      endDateKey: key,
    });
    return grid.getDayGridTimestamps(startUtc.getTime());
  }
  const grid = createPastIntervalGridForWindow({
    homeTimezone,
    startDateKey: dateKey,
    endDateKey: dateKey,
  });
  return grid.getDayGridTimestamps(dayStartMs);
}

/** Inclusive home-local date window → day-start UTC ms (DST-aware). */
export function enumerateDayStartsMsForWindow(
  startIso: string,
  endIso: string,
  homeTimezone: string,
): number[] {
  const startDateKey = String(startIso ?? "").slice(0, 10);
  const endDateKey = String(endIso ?? "").slice(0, 10);
  return createPastIntervalGridForWindow({ homeTimezone, startDateKey, endDateKey }).enumerateDayStartsMsForWindow(
    startDateKey,
    endDateKey,
  );
}

function parseYearMonth(ym: string): { year: number; month1: number } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(String(ym ?? "").trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month1 = Number(m[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month1) || month1 < 1 || month1 > 12) return null;
  return { year, month1 };
}

function monthStartUtc(ym: string): Date | null {
  const p = parseYearMonth(ym);
  if (!p) return null;
  return new Date(Date.UTC(p.year, p.month1 - 1, 1, 0, 0, 0, 0));
}

function monthEndUtc(ym: string): Date | null {
  const p = parseYearMonth(ym);
  if (!p) return null;
  return new Date(Date.UTC(p.year, p.month1, 0, 23, 59, 59, 999));
}

export type BuildPastStitchedCurveArgs = {
  actualIntervals: ActualIntervalPoint[];
  canonicalMonths: string[];
  simulatedMonths: Set<string>;
  pastMonthlyTotalsKwhByMonth: Record<string, number>;
  intradayShape96: number[];
  weekdayWeekendShape96?: { weekday: number[]; weekend: number[] };
  periods?: Array<{ id: string; startDate: string; endDate: string }>;
  homeTimezone: string;
};

export function buildPastStitchedCurve(args: BuildPastStitchedCurveArgs): SimulatedCurve {
  const home = createHomeIntervalCalendar(args.homeTimezone);
  const canonicalMonths = (args.canonicalMonths ?? []).slice(0, 24);
  if (!canonicalMonths.length) throw new Error("canonicalMonths_required");

  const periods = Array.isArray(args.periods) && args.periods.length > 0 ? args.periods.slice(0, 24) : null;
  const windowStartKey = periods
    ? String(periods[0].startDate).slice(0, 10)
    : `${canonicalMonths[0]}-01`;
  const windowEndKey = periods
    ? String(periods[periods.length - 1].endDate).slice(0, 10)
    : String(canonicalMonths[canonicalMonths.length - 1] ?? "").slice(0, 7) + "-28";
  const grid = createPastIntervalGridForWindow({
    homeTimezone: args.homeTimezone,
    startDateKey: windowStartKey,
    endDateKey: windowEndKey,
  });

  const intraday =
    Array.isArray(args.intradayShape96) && args.intradayShape96.length === INTERVALS_PER_DAY
      ? args.intradayShape96
      : Array.from({ length: INTERVALS_PER_DAY }, () => 1 / INTERVALS_PER_DAY);
  const weekdayWeekend = args.weekdayWeekendShape96
    ? {
        weekday:
          Array.isArray(args.weekdayWeekendShape96.weekday) &&
          args.weekdayWeekendShape96.weekday.length === INTERVALS_PER_DAY
            ? args.weekdayWeekendShape96.weekday
            : intraday,
        weekend:
          Array.isArray(args.weekdayWeekendShape96.weekend) &&
          args.weekdayWeekendShape96.weekend.length === INTERVALS_PER_DAY
            ? args.weekdayWeekendShape96.weekend
            : intraday,
      }
    : null;

  const actualByDate = new Map<string, ActualIntervalPoint[]>();
  for (const p of args.actualIntervals ?? []) {
    const dk = dateKeyFromIntervalPoint(p);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dk)) continue;
    const list = actualByDate.get(dk) ?? [];
    list.push(p);
    actualByDate.set(dk, list);
  }
  for (const list of Array.from(actualByDate.values())) {
    list.sort(
      (a: ActualIntervalPoint, b: ActualIntervalPoint) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );
  }

  const byMonth = args.pastMonthlyTotalsKwhByMonth ?? {};
  const simulatedDayKwh = new Map<string, number>();
  for (const dateKey of enumerateLocalDateKeys(windowStartKey, windowEndKey, home)) {
    const ym = dateKey.slice(0, 7);
    if (!args.simulatedMonths.has(ym)) continue;
    const bucketKwh = Math.max(0, Number(byMonth[ym] ?? 0) || 0);
    const monthKeys = enumerateLocalDateKeys(`${ym}-01`, `${ym}-28`, home).filter((k) => k.startsWith(ym));
    const perDay = monthKeys.length > 0 ? bucketKwh / monthKeys.length : 0;
    simulatedDayKwh.set(dateKey, (simulatedDayKwh.get(dateKey) ?? 0) + perDay);
  }

  const intervals: Array<{ timestamp: string; consumption_kwh: number; interval_minutes: 15 }> = [];

  for (const dayStartMs of grid.canonicalDayStartsMs) {
    const dk = grid.dateKeyFromTimestamp(new Date(dayStartMs).toISOString());
    const ym = dk.slice(0, 7);
    const useSimulated = args.simulatedMonths.has(ym);
    const gridTs = grid.getDayGridTimestamps(dayStartMs);

    if (useSimulated) {
      const dayKwh = simulatedDayKwh.get(dk) ?? 0;
      const { startUtc } = localDayBoundsUtc(dk, home);
      const dow = new Date(startUtc).getUTCDay();
      const shape = weekdayWeekend
        ? dow === 0 || dow === 6
          ? weekdayWeekend.weekend
          : weekdayWeekend.weekday
        : intraday;
      for (let i = 0; i < gridTs.length; i++) {
        intervals.push({
          timestamp: gridTs[i]!,
          consumption_kwh: dayKwh * (Number(shape[i % shape.length]) || 0),
          interval_minutes: 15 as const,
        });
      }
    } else {
      const list = actualByDate.get(dk) ?? [];
      const slotKwh = new Map<number, number>();
      for (const p of list) {
        const slot = typeof p.homeSlot === "number" ? Math.trunc(p.homeSlot) : -1;
        if (slot >= 0) slotKwh.set(slot, (slotKwh.get(slot) ?? 0) + (Number(p.kwh) || 0));
      }
      for (let i = 0; i < gridTs.length; i++) {
        intervals.push({
          timestamp: gridTs[i]!,
          consumption_kwh: slotKwh.get(i) ?? 0,
          interval_minutes: 15 as const,
        });
      }
    }
  }

  const monthlyTotalsMap = new Map<string, number>();
  for (const iv of intervals) {
    const dk = grid.dateKeyFromTimestamp(iv.timestamp);
    const ym = dk.slice(0, 7);
    monthlyTotalsMap.set(ym, (monthlyTotalsMap.get(ym) ?? 0) + (Number(iv.consumption_kwh) || 0));
  }
  const monthlyTotals = Array.from(monthlyTotalsMap.entries())
    .map(([month, kwh]) => ({ month, kwh: Math.round(kwh * 100) / 100 }))
    .sort((a, b) => (a.month < b.month ? -1 : 1));
  const annualTotalKwh = monthlyTotals.reduce((s, m) => s + m.kwh, 0);
  const windowStart = localDayBoundsUtc(windowStartKey, home).startUtc;
  const windowEnd = localDayBoundsUtc(windowEndKey, home).endUtcExclusive;

  return {
    start: windowStart.toISOString(),
    end: new Date(windowEnd.getTime() - 1).toISOString(),
    intervals,
    monthlyTotals,
    annualTotalKwh: Math.round(annualTotalKwh * 100) / 100,
    meta: { excludedDays: 0, renormalized: false },
  };
}
