/**
 * Builds the Past curve by stitching actual 15-min intervals (unchanged months) with simulated intervals (changed/missing months).
 */

import type { SimulatedCurve } from "@/modules/simulatedUsage/types";
import type { ActualIntervalPoint } from "@/lib/usage/actualDatasetForHouse";

const INTERVAL_MINUTES = 15;
const INTERVALS_PER_DAY = (24 * 60) / INTERVAL_MINUTES; // 96
const DAY_MS = 24 * 60 * 60 * 1000;
const SLOT_MS = INTERVAL_MINUTES * 60 * 1000;

/** Date key from an interval timestamp (same convention as stitcher day grouping). LOCK: use this for grouping/enumeration/exclusion. */
export function dateKeyFromTimestamp(ts: string): string {
  return String(ts ?? "").slice(0, 10);
}

/** 96 ISO timestamps for one day (same grid as stitcher). LOCK: use this for simulated/fill slots. */
export function getDayGridTimestamps(dayStartMs: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < INTERVALS_PER_DAY; i++) {
    out.push(new Date(dayStartMs + i * SLOT_MS).toISOString());
  }
  return out;
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

function toUtcMidnight(dateKey: string): Date {
  return new Date(`${dateKey}T00:00:00.000Z`);
}

function addDaysUtc(d: Date, days: number): Date {
  return new Date(d.getTime() + days * DAY_MS);
}

function dateKeyUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function enumerateDaysInclusive(start: Date, end: Date): Date[] {
  const out: Date[] = [];
  let cur = new Date(start.getTime());
  while (cur.getTime() <= end.getTime()) {
    out.push(cur);
    cur = addDaysUtc(cur, 1);
  }
  return out;
}

export type BuildPastStitchedCurveArgs = {
  /** Actual 15-min intervals for the full window (chronological). */
  actualIntervals: ActualIntervalPoint[];
  canonicalMonths: string[];
  /** YYYY-MM months that use simulated data; rest use actual. */
  simulatedMonths: Set<string>;
  /** Past monthly totals (baseline + overlay) for simulated months. */
  pastMonthlyTotalsKwhByMonth: Record<string, number>;
  intradayShape96: number[];
  weekdayWeekendShape96?: { weekday: number[]; weekend: number[] };
  /** Optional; if provided use start/end from first/last period. */
  periods?: Array<{ id: string; startDate: string; endDate: string }>;
};

/**
 * Produces a single 15-min curve: actual intervals for "actual" days, generated intervals for "simulated" days.
 */
export function buildPastStitchedCurve(args: BuildPastStitchedCurveArgs): SimulatedCurve {
  const canonicalMonths = (args.canonicalMonths ?? []).slice(0, 24);
  if (!canonicalMonths.length) throw new Error("canonicalMonths_required");

  const periods = Array.isArray(args.periods) && args.periods.length > 0 ? args.periods.slice(0, 24) : null;
  const windowStart = periods
    ? toUtcMidnight(periods[0].startDate)
    : monthStartUtc(canonicalMonths[0]);
  const windowEnd = periods
    ? toUtcMidnight(periods[periods.length - 1].endDate)
    : monthEndUtc(canonicalMonths[canonicalMonths.length - 1]);
  if (!windowStart || !windowEnd) throw new Error("canonicalMonths_invalid");

  const intraday =
    Array.isArray(args.intradayShape96) && args.intradayShape96.length === INTERVALS_PER_DAY
      ? args.intradayShape96
      : Array.from({ length: INTERVALS_PER_DAY }, () => 1 / INTERVALS_PER_DAY);
  const weekdayWeekend = args.weekdayWeekendShape96
    ? {
        weekday:
          Array.isArray(args.weekdayWeekendShape96.weekday) && args.weekdayWeekendShape96.weekday.length === INTERVALS_PER_DAY
            ? args.weekdayWeekendShape96.weekday
            : intraday,
        weekend:
          Array.isArray(args.weekdayWeekendShape96.weekend) && args.weekdayWeekendShape96.weekend.length === INTERVALS_PER_DAY
            ? args.weekdayWeekendShape96.weekend
            : intraday,
      }
    : null;

  // Group actual intervals by date key (YYYY-MM-DD); use shared helper for alignment.
  const actualByDate = new Map<string, ActualIntervalPoint[]>();
  for (const p of args.actualIntervals ?? []) {
    const dk = dateKeyFromTimestamp(p.timestamp ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dk)) continue;
    const list = actualByDate.get(dk) ?? [];
    list.push(p);
    actualByDate.set(dk, list);
  }
  for (const list of Array.from(actualByDate.values())) {
    list.sort((a: ActualIntervalPoint, b: ActualIntervalPoint) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  }

  // Day totals for simulated months (distribute monthly kWh across days).
  const buckets = periods
    ? periods.map((p) => ({ id: String(p.id), start: toUtcMidnight(p.startDate), end: toUtcMidnight(p.endDate) }))
    : canonicalMonths.map((ym) => ({
        id: String(ym),
        start: monthStartUtc(ym),
        end: monthEndUtc(ym),
      }));
  const byMonth = args.pastMonthlyTotalsKwhByMonth ?? {};
  const simulatedDayKwh = new Map<string, number>();
  for (const b of buckets) {
    if (!b.start || !b.end) continue;
    const days = enumerateDaysInclusive(b.start, b.end);
    // Resolve bucket kWh: by-month keys are YYYY-MM; period id may be e.g. "anchor", so sum overlapping months.
    let bucketKwh: number;
    if (/^\d{4}-\d{2}$/.test(b.id)) {
      bucketKwh = Math.max(0, Number(byMonth[b.id] ?? 0) || 0);
    } else {
      let sum = 0;
      for (const ym of canonicalMonths) {
        const mStart = monthStartUtc(ym);
        const mEnd = monthEndUtc(ym);
        if (mStart && mEnd && b.start && b.end && mStart.getTime() <= b.end.getTime() && mEnd.getTime() >= b.start.getTime()) {
          sum += Number(byMonth[ym] ?? 0) || 0;
        }
      }
      bucketKwh = Math.max(0, sum);
    }
    const perDay = days.length > 0 ? bucketKwh / days.length : 0;
    for (const d of days) {
      const dk = dateKeyUtc(d);
      simulatedDayKwh.set(dk, (simulatedDayKwh.get(dk) ?? 0) + perDay);
    }
  }

  const intervals: Array<{ timestamp: string; consumption_kwh: number; interval_minutes: 15 }> = [];
  const days = enumerateDaysInclusive(windowStart, windowEnd);

  for (const day of days) {
    const dk = dateKeyFromTimestamp(day.toISOString());
    const ym = dk.slice(0, 7);
    const useSimulated = args.simulatedMonths.has(ym);

    if (useSimulated) {
      const dayKwh = simulatedDayKwh.get(dk) ?? 0;
      const dow = day.getUTCDay();
      const shape = weekdayWeekend ? (dow === 0 || dow === 6 ? weekdayWeekend.weekend : weekdayWeekend.weekday) : intraday;
      for (let i = 0; i < INTERVALS_PER_DAY; i++) {
        const ts = new Date(day.getTime() + i * INTERVAL_MINUTES * 60 * 1000).toISOString();
        intervals.push({
          timestamp: ts,
          consumption_kwh: dayKwh * (Number(shape[i]) || 0),
          interval_minutes: 15 as const,
        });
      }
    } else {
      const list = actualByDate.get(dk) ?? [];
      const slotKwh = new Array<number>(INTERVALS_PER_DAY).fill(0);
      for (const p of list) {
        const t = new Date(p.timestamp);
        const dayStart = day.getTime();
        const slotMs = t.getTime() - dayStart;
        const slot = Math.floor(slotMs / (INTERVAL_MINUTES * 60 * 1000));
        if (slot >= 0 && slot < INTERVALS_PER_DAY) {
          slotKwh[slot] = (slotKwh[slot] || 0) + (Number(p.kwh) || 0);
        }
      }
      for (let i = 0; i < INTERVALS_PER_DAY; i++) {
        const ts = new Date(day.getTime() + i * INTERVAL_MINUTES * 60 * 1000).toISOString();
        intervals.push({
          timestamp: ts,
          consumption_kwh: slotKwh[i] || 0,
          interval_minutes: 15 as const,
        });
      }
    }
  }

  const monthlyTotalsMap = new Map<string, number>();
  for (const iv of intervals) {
    const ym = iv.timestamp.slice(0, 7);
    monthlyTotalsMap.set(ym, (monthlyTotalsMap.get(ym) ?? 0) + (Number(iv.consumption_kwh) || 0));
  }
  const monthlyTotals = Array.from(monthlyTotalsMap.entries())
    .map(([month, kwh]) => ({ month, kwh: Math.round(kwh * 100) / 100 }))
    .sort((a, b) => (a.month < b.month ? -1 : 1));
  const annualTotalKwh = monthlyTotals.reduce((s, m) => s + m.kwh, 0);

  return {
    start: windowStart.toISOString(),
    end: windowEnd.toISOString(),
    intervals,
    monthlyTotals,
    annualTotalKwh: Math.round(annualTotalKwh * 100) / 100,
    meta: { excludedDays: 0, renormalized: false },
  };
}