import { ManualUsagePayload, SimulatedCurve, TravelRange } from "./types";
import { monthsEndingAt } from "@/modules/manualUsage/anchor";

const DAY_MS = 24 * 60 * 60 * 1000;
const INTERVAL_MINUTES = 15;
const INTERVALS_PER_DAY = (24 * 60) / INTERVAL_MINUTES; // 96

function isYearMonth(s: string): boolean {
  return /^\d{4}-\d{2}$/.test(String(s ?? "").trim());
}

function isIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s ?? "").trim());
}

function toUtcMidnight(dateKey: string): Date {
  // dateKey is YYYY-MM-DD
  return new Date(`${dateKey}T00:00:00.000Z`);
}

function addDaysUtc(d: Date, days: number): Date {
  return new Date(d.getTime() + days * DAY_MS);
}

function dateKeyUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function monthKeyUtc(d: Date): string {
  return d.toISOString().slice(0, 7);
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

function normalizeRanges(ranges: TravelRange[]): Array<{ start: string; end: string }> {
  return (ranges || [])
    .map((r) => ({ start: String(r.startDate || "").slice(0, 10), end: String(r.endDate || "").slice(0, 10) }))
    .filter((r) => isIsoDate(r.start) && isIsoDate(r.end));
}

function buildExcludedDaySet(ranges: TravelRange[]): Set<string> {
  const set = new Set<string>();
  const norm = normalizeRanges(ranges);
  for (const r of norm) {
    const a = toUtcMidnight(r.start);
    const b = toUtcMidnight(r.end);
    if (!Number.isFinite(a.getTime()) || !Number.isFinite(b.getTime())) continue;
    const start = a.getTime() <= b.getTime() ? a : b;
    const end = a.getTime() <= b.getTime() ? b : a;
    for (const day of enumerateDaysInclusive(start, end)) {
      set.add(dateKeyUtc(day));
    }
  }
  return set;
}

function ensureFiniteNumber(n: unknown): number | null {
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function lastDayOfMonthUtc(year: number, month1: number): number {
  // month1: 1..12
  const d = new Date(Date.UTC(year, month1, 0)); // day 0 of next month
  return d.getUTCDate();
}

function parseYearMonth(ym: string): { year: number; month1: number } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(String(ym ?? "").trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month1 = Number(m[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month1) || month1 < 1 || month1 > 12) return null;
  return { year, month1 };
}

function parseIsoDate(d: string): { year: number; month1: number; day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(d ?? "").trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month1 = Number(m[2]);
  const day = Number(m[3]);
  if (!Number.isFinite(year) || !Number.isFinite(month1) || !Number.isFinite(day)) return null;
  return { year, month1, day };
}

function monthStartUtc(ym: string): Date | null {
  const p = parseYearMonth(ym);
  if (!p) return null;
  return new Date(Date.UTC(p.year, p.month1 - 1, 1, 0, 0, 0, 0));
}

function monthEndUtc(ym: string): Date | null {
  const p = parseYearMonth(ym);
  if (!p) return null;
  return new Date(Date.UTC(p.year, p.month1, 0, 0, 0, 0, 0));
}

function sum(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0);
}

export function generateSimulatedCurveFromManual(payload: ManualUsagePayload): SimulatedCurve {
  const excludedDays = buildExcludedDaySet(payload.travelRanges ?? []);

  // Build target daily totals.
  const dayTotals = new Map<string, number>(); // YYYY-MM-DD -> kWh
  const monthTotals = new Map<string, number>(); // YYYY-MM -> kWh

  let windowStart: Date;
  let windowEnd: Date;

  if (payload.mode === "ANNUAL") {
    const p = parseIsoDate(payload.endDate);
    if (!p) throw new Error("endDate_invalid");
    const end = new Date(Date.UTC(p.year, p.month1 - 1, p.day, 0, 0, 0, 0));
    if (!Number.isFinite(end.getTime())) throw new Error("endDate_invalid");
    windowEnd = end;
    windowStart = addDaysUtc(windowEnd, -364);

    const annual = ensureFiniteNumber(payload.annualKwh);
    if (annual === null || annual < 0) throw new Error("annualKwh_invalid");

    const days = enumerateDaysInclusive(windowStart, windowEnd);
    const perDay = annual / days.length;
    for (const d of days) {
      const key = dateKeyUtc(d);
      dayTotals.set(key, perDay);
      const mk = monthKeyUtc(d);
      monthTotals.set(mk, (monthTotals.get(mk) ?? 0) + perDay);
    }
  } else {
    if (!isYearMonth(payload.anchorEndMonth)) throw new Error("anchorEndMonth_invalid");
    const months = monthsEndingAt(payload.anchorEndMonth, 12);
    const billEndDay = Math.max(1, Math.min(31, Math.trunc(payload.billEndDay || 15)));

    // We define the monthly window as month-by-month, using billEndDay as the end-of-bill boundary anchor.
    // For v1 baseline: interpret each month as the calendar month and ignore billEndDay for segmentation,
    // but store it and keep anchor stable for labeling. (We can refine billing boundary later.)
    // Window = first day of first month .. last day of last month.
    const start = monthStartUtc(months[0]);
    const end = monthEndUtc(months[months.length - 1]);
    if (!start || !end) throw new Error("anchorEndMonth_invalid");
    windowStart = start;
    windowEnd = end;

    const map = new Map<string, number>();
    for (const r of payload.monthlyKwh || []) {
      const ym = String((r as any)?.month ?? "").trim();
      const kwh = ensureFiniteNumber((r as any)?.kwh);
      if (!isYearMonth(ym)) continue;
      if (kwh === null || kwh < 0) continue;
      map.set(ym, kwh);
    }

    for (const ym of months) {
      const kwh = map.get(ym) ?? 0;
      monthTotals.set(ym, kwh);
      const startM = monthStartUtc(ym)!;
      const endM = monthEndUtc(ym)!;
      const days = enumerateDaysInclusive(startM, endM);
      const perDay = days.length > 0 ? kwh / days.length : 0;
      for (const d of days) {
        const dk = dateKeyUtc(d);
        dayTotals.set(dk, (dayTotals.get(dk) ?? 0) + perDay);
      }
    }

    // Silence unused warning for now; billEndDay is persisted/validated elsewhere.
    void billEndDay;
  }

  // Apply exclusions and renormalize totals to preserve the intended totals.
  const intendedTotal = sum(Array.from(dayTotals.values()));
  let excludedKwh = 0;
  const dayTotalRows = Array.from(dayTotals.entries());
  let excludedDaysInWindow = 0;
  for (let i = 0; i < dayTotalRows.length; i++) {
    const [dk, kwh] = dayTotalRows[i];
    if (excludedDays.has(dk)) {
      excludedKwh += kwh;
      excludedDaysInWindow += 1;
      dayTotals.set(dk, 0);
    }
  }

  const remainingTotal = sum(Array.from(dayTotals.values()));
  if (intendedTotal > 0 && (remainingTotal === 0 || excludedDaysInWindow === dayTotals.size)) {
    throw new Error("travel_exclusions_cover_full_range");
  }

  const renormalizeFactor = intendedTotal > 0 && remainingTotal > 0 ? intendedTotal / remainingTotal : 1;
  const renormalized = Math.abs(renormalizeFactor - 1) > 1e-9;
  if (renormalized) {
    const rows = Array.from(dayTotals.entries());
    for (let i = 0; i < rows.length; i++) {
      const [dk, kwh] = rows[i];
      if (kwh <= 0) continue;
      dayTotals.set(dk, kwh * renormalizeFactor);
    }
  }

  // Build 15-minute intervals with flat distribution per day.
  const intervals = [];
  const days = enumerateDaysInclusive(windowStart, windowEnd);
  for (const day of days) {
    const dk = dateKeyUtc(day);
    const dayKwh = dayTotals.get(dk) ?? 0;
    const perInterval = dayKwh / INTERVALS_PER_DAY;
    for (let i = 0; i < INTERVALS_PER_DAY; i++) {
      const ts = new Date(day.getTime() + i * INTERVAL_MINUTES * 60 * 1000).toISOString();
      intervals.push({ timestamp: ts, consumption_kwh: perInterval, interval_minutes: 15 as const });
    }
  }

  // Recompute monthly totals from dayTotals (post exclusions/renorm) for reporting.
  const monthlyTotalsMap = new Map<string, number>();
  const rows = Array.from(dayTotals.entries());
  for (let i = 0; i < rows.length; i++) {
    const [dk, kwh] = rows[i];
    const ym = dk.slice(0, 7);
    monthlyTotalsMap.set(ym, (monthlyTotalsMap.get(ym) ?? 0) + kwh);
  }
  const monthlyTotals = Array.from(monthlyTotalsMap.entries())
    .map(([month, kwh]) => ({ month, kwh }))
    .sort((a, b) => (a.month < b.month ? -1 : 1));

  const annualTotalKwh = sum(monthlyTotals.map((m) => m.kwh));

  return {
    start: windowStart.toISOString(),
    end: windowEnd.toISOString(),
    intervals,
    monthlyTotals,
    annualTotalKwh,
    meta: {
      excludedDays: excludedDays.size,
      renormalized,
    },
  };
}

// Future stubs (do not implement yet)
export type UsagePatch = { start: string; end: string; reason: string };
export function applyScenarioDeltasStub() {
  throw new Error("not_implemented");
}

