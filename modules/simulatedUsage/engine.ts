import { ManualUsagePayload, SimulatedCurve, TravelRange } from "./types";
import { billingPeriodsEndingAt } from "@/modules/manualUsage/billingPeriods";
import { anchorEndDateUtc } from "@/modules/manualUsage/anchor";
import { dateKeyFromTimestamp, getDayGridTimestamps } from "@/modules/usageSimulator/pastStitchedCurve";

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
    const anchorEndDateKey = String((payload as any).anchorEndDate ?? (payload as any).endDate ?? "").trim();
    const p = parseIsoDate(anchorEndDateKey);
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
    const anchorEndDateKey =
      typeof (payload as any).anchorEndDate === "string" && isIsoDate(String((payload as any).anchorEndDate))
        ? String((payload as any).anchorEndDate).trim()
        : typeof (payload as any).anchorEndMonth === "string" && isYearMonth(String((payload as any).anchorEndMonth))
          ? (() => {
              const endMonth = String((payload as any).anchorEndMonth).trim();
              const day = Math.max(1, Math.min(31, Math.trunc((payload as any).billEndDay || 15)));
              const d = anchorEndDateUtc(endMonth, day);
              return d ? d.toISOString().slice(0, 10) : "";
            })()
          : "";
    if (!isIsoDate(anchorEndDateKey)) throw new Error("anchorEndDate_invalid");
    const periods = billingPeriodsEndingAt(anchorEndDateKey, 12);
    if (!periods.length) throw new Error("anchorEndDate_invalid");
    windowStart = toUtcMidnight(periods[0].startDate);
    windowEnd = toUtcMidnight(periods[periods.length - 1].endDate);

    const map = new Map<string, number>();
    for (const r of payload.monthlyKwh || []) {
      const ym = String((r as any)?.month ?? "").trim();
      const kwh = ensureFiniteNumber((r as any)?.kwh);
      if (!isYearMonth(ym)) continue;
      if (kwh === null || kwh < 0) continue;
      map.set(ym, kwh);
    }

    for (const period of periods) {
      const kwh = map.get(period.id) ?? 0;
      monthTotals.set(period.id, kwh);
      const startM = toUtcMidnight(period.startDate);
      const endM = toUtcMidnight(period.endDate);
      const days = enumerateDaysInclusive(startM, endM);
      const perDay = days.length > 0 ? kwh / days.length : 0;
      for (const d of days) {
        const dk = dateKeyUtc(d);
        dayTotals.set(dk, (dayTotals.get(dk) ?? 0) + perDay);
      }
    }
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

export function generateSimulatedCurve(args: {
  canonicalMonths: string[]; // 12 months, YYYY-MM, ascending
  monthlyTotalsKwhByMonth: Record<string, number>; // YYYY-MM -> kWh (net/import-only)
  intradayShape96: number[]; // length 96, sums to 1
  weekdayWeekendShape96?: { weekday: number[]; weekend: number[] };
  travelRanges?: TravelRange[];
  periods?: Array<{ id: string; startDate: string; endDate: string }>;
}): SimulatedCurve {
  const canonicalMonths = (args.canonicalMonths || []).slice(0, 24);
  if (!canonicalMonths.length) throw new Error("canonicalMonths_required");

  const excludedDays = buildExcludedDaySet(args.travelRanges ?? []);

  const periods = Array.isArray(args.periods) && args.periods.length > 0 ? args.periods.slice(0, 24) : null;
  const windowStart = periods ? toUtcMidnight(periods[0].startDate) : monthStartUtc(canonicalMonths[0]);
  const windowEnd = periods ? toUtcMidnight(periods[periods.length - 1].endDate) : monthEndUtc(canonicalMonths[canonicalMonths.length - 1]);
  if (!windowStart || !windowEnd) throw new Error("canonicalMonths_invalid");

  const intraday = Array.isArray(args.intradayShape96) && args.intradayShape96.length === INTERVALS_PER_DAY
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

  // Build day totals from monthly totals (calendar months or billing periods).
  const dayTotals = new Map<string, number>(); // YYYY-MM-DD -> kWh
  const dayToBucket = new Map<string, string>(); // YYYY-MM-DD -> bucket id
  const bucketIntended = new Map<string, number>(); // bucket id -> intended kWh

  const buckets = periods
    ? periods.map((p) => ({ id: String(p.id), start: toUtcMidnight(p.startDate), end: toUtcMidnight(p.endDate) }))
    : canonicalMonths.map((ym) => ({ id: String(ym), start: monthStartUtc(ym), end: monthEndUtc(ym) }));

  for (const b of buckets) {
    if (!b.start || !b.end) continue;
    const days = enumerateDaysInclusive(b.start, b.end);
    const bucketKwh = Math.max(0, Number(args.monthlyTotalsKwhByMonth?.[b.id] ?? 0) || 0);
    bucketIntended.set(b.id, bucketKwh);
    const perDay = days.length > 0 ? bucketKwh / days.length : 0;
    for (const d of days) {
      const dk = dateKeyUtc(d);
      dayToBucket.set(dk, b.id);
      dayTotals.set(dk, (dayTotals.get(dk) ?? 0) + perDay);
    }
  }

  // Apply exclusions.
  let excludedDaysInWindow = 0;
  for (const dk of Array.from(dayTotals.keys())) {
    if (excludedDays.has(dk)) {
      excludedDaysInWindow += 1;
      dayTotals.set(dk, 0);
    }
  }

  // Renormalize per bucket to preserve intended totals (manual totals immutability).
  let anyRenormalized = false;
  const bucketEntries = Array.from(bucketIntended.entries());
  for (let i = 0; i < bucketEntries.length; i++) {
    const [bucketId, intendedKwh] = bucketEntries[i];
    if (intendedKwh <= 0) continue;

    let remaining = 0;
    const dayEntries = Array.from(dayTotals.entries());
    for (let j = 0; j < dayEntries.length; j++) {
      const [dk, kwh] = dayEntries[j];
      if (dayToBucket.get(dk) === bucketId) remaining += kwh;
    }
    if (remaining <= 0) throw new Error("travel_exclusions_cover_full_range");

    const factor = intendedKwh / remaining;
    if (Math.abs(factor - 1) > 1e-9) anyRenormalized = true;
    for (let j = 0; j < dayEntries.length; j++) {
      const [dk, kwh] = dayEntries[j];
      if (dayToBucket.get(dk) !== bucketId) continue;
      if (kwh <= 0) continue;
      dayTotals.set(dk, kwh * factor);
    }
  }

  // Build intervals using the intraday shape.
  const intervals = [];
  const days = enumerateDaysInclusive(windowStart, windowEnd);
  for (const day of days) {
    const dk = dateKeyUtc(day);
    const dayKwh = dayTotals.get(dk) ?? 0;

    const dow = day.getUTCDay(); // 0=Sun..6=Sat
    const shape = weekdayWeekend ? (dow === 0 || dow === 6 ? weekdayWeekend.weekend : weekdayWeekend.weekday) : intraday;

    for (let i = 0; i < INTERVALS_PER_DAY; i++) {
      const ts = new Date(day.getTime() + i * INTERVAL_MINUTES * 60 * 1000).toISOString();
      intervals.push({
        timestamp: ts,
        consumption_kwh: dayKwh * (Number(shape[i]) || 0),
        interval_minutes: 15 as const,
      });
    }
  }

  const monthlyTotalsMap = new Map<string, number>();
  const dayRows = Array.from(dayTotals.entries());
  for (let i = 0; i < dayRows.length; i++) {
    const [dk, kwh] = dayRows[i];
    const bucketId = dayToBucket.get(dk) ?? dk.slice(0, 7);
    monthlyTotalsMap.set(bucketId, (monthlyTotalsMap.get(bucketId) ?? 0) + kwh);
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
    meta: { excludedDays: excludedDaysInWindow, renormalized: anyRenormalized },
  };
}

const SLOT_MS = INTERVAL_MINUTES * 60 * 1000;

/**
 * Completes actual 15-min intervals over the canonical window: fills excluded (travel/vacant) days,
 * and optionally fills any day with missing/incomplete intervals using hourly-then-quarter simulation.
 * Used only for Past (Corrected) builds with ACTUAL baseline. LOCK: uses dateKeyFromTimestamp and
 * getDayGridTimestamps from pastStitchedCurve so date keys and interval grid match the stitcher.
 */
export function completeActualIntervalsV1(args: {
  actualIntervals: Array<{ timestamp: string; kwh: number }>;
  canonicalStartTsUtc: number;
  canonicalEndTsUtc: number;
  excludedDateKeys: Set<string>;
  simulateIncompleteDays?: boolean;
}): Array<{ timestamp: string; kwh: number }> {
  const { actualIntervals, canonicalStartTsUtc, canonicalEndTsUtc, excludedDateKeys } = args;
  const simulateIncompleteDays = args.simulateIncompleteDays ?? true;

  const firstDayStart = new Date(new Date(canonicalStartTsUtc).toISOString().slice(0, 10) + "T00:00:00.000Z");
  const lastDayStart = new Date(new Date(canonicalEndTsUtc).toISOString().slice(0, 10) + "T00:00:00.000Z");
  const days = enumerateDaysInclusive(firstDayStart, lastDayStart);

  const dayIntervals = new Map<string, Array<{ timestamp: string; kwh: number }>>();
  for (const p of actualIntervals) {
    const dk = dateKeyFromTimestamp(p.timestamp);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dk)) continue;
    const list = dayIntervals.get(dk) ?? [];
    list.push(p);
    dayIntervals.set(dk, list);
  }
  for (const list of Array.from(dayIntervals.values())) {
    list.sort((a: { timestamp: string; kwh: number }, b: { timestamp: string; kwh: number }) =>
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
  }

  const usableDays = new Set<string>();
  for (const [dk, list] of Array.from(dayIntervals.entries())) {
    if (!excludedDateKeys.has(dk) && list.length === INTERVALS_PER_DAY) usableDays.add(dk);
  }

  // Build slot-aligned kWh per day from timestamp-derived slot index so we don't assume list[i] = grid slot i.
  const daySlotKwh = new Map<string, number[]>();
  const dayHourly: Record<string, number[]> = {};
  const dayTotal: Record<string, number> = {};
  for (const dk of Array.from(usableDays)) {
    const list = dayIntervals.get(dk) ?? [];
    const dayStartMs = new Date(dk + "T00:00:00.000Z").getTime();
    const slotKwh = new Array<number>(INTERVALS_PER_DAY).fill(0);
    for (const p of list) {
      const t = new Date(p.timestamp).getTime();
      const slot = Math.floor((t - dayStartMs) / SLOT_MS);
      if (slot >= 0 && slot < INTERVALS_PER_DAY) slotKwh[slot] += Number(p.kwh) || 0;
    }
    daySlotKwh.set(dk, slotKwh);
    const hourly = Array.from({ length: 24 }, (_, h) => {
      let s = 0;
      for (let q = 0; q < 4; q++) s += slotKwh[h * 4 + q] ?? 0;
      return s;
    });
    dayHourly[dk] = hourly;
    dayTotal[dk] = slotKwh.reduce((a, b) => a + b, 0);
  }

  const avgHourly: Record<string, Record<number, number[]>> = {};
  const avgTotal: Record<string, Record<number, number>> = {};
  const avgHourlyMonth: Record<string, number[]> = {};
  const avgTotalMonth: Record<string, number> = {};
  const quarterShape: Record<string, Record<number, Record<number, number[]>>> = {};

  for (const dk of Array.from(usableDays)) {
    const ym = dk.slice(0, 7);
    const dow = new Date(dk + "T12:00:00.000Z").getUTCDay();
    if (!avgHourly[ym]) avgHourly[ym] = {};
    if (!avgHourly[ym][dow]) avgHourly[ym][dow] = Array.from({ length: 24 }, () => 0);
    if (!avgTotal[ym]) avgTotal[ym] = {};
    if (!avgTotal[ym][dow]) avgTotal[ym][dow] = 0;
    if (!avgHourlyMonth[ym]) avgHourlyMonth[ym] = Array.from({ length: 24 }, () => 0);
    if (!(ym in avgTotalMonth)) avgTotalMonth[ym] = 0;
    if (!quarterShape[ym]) quarterShape[ym] = {};
    if (!quarterShape[ym][dow]) quarterShape[ym][dow] = {};
    const hourly = dayHourly[dk] ?? [];
    const slotKwh = daySlotKwh.get(dk) ?? [];
    for (let h = 0; h < 24; h++) {
      avgHourly[ym][dow][h] += hourly[h] ?? 0;
      avgHourlyMonth[ym][h] += hourly[h] ?? 0;
    }
    avgTotal[ym][dow] += dayTotal[dk] ?? 0;
    avgTotalMonth[ym] += dayTotal[dk] ?? 0;
    for (let h = 0; h < 24; h++) {
      if (!quarterShape[ym][dow][h]) quarterShape[ym][dow][h] = [0, 0, 0, 0];
      const sum = (hourly[h] ?? 0) || 1;
      for (let q = 0; q < 4; q++) {
        const v = Number(slotKwh[h * 4 + q]) || 0;
        quarterShape[ym][dow][h][q] += v / sum;
      }
    }
  }

  const nByMonthDow: Record<string, Record<number, number>> = {};
  for (const dk of Array.from(usableDays)) {
    const ym = dk.slice(0, 7);
    const dow = new Date(dk + "T12:00:00.000Z").getUTCDay();
    if (!nByMonthDow[ym]) nByMonthDow[ym] = {};
    nByMonthDow[ym][dow] = (nByMonthDow[ym][dow] ?? 0) + 1;
  }

  for (const ym of Object.keys(avgHourly ?? {})) {
    for (const dow of Object.keys(avgHourly[ym] ?? {})) {
      const n = nByMonthDow[ym]?.[Number(dow)] ?? 0;
      if (n > 0) {
        for (let h = 0; h < 24; h++) avgHourly[ym][Number(dow)][h] /= n;
        avgTotal[ym][Number(dow)] /= n;
      }
    }
  }
  for (const ym of Object.keys(avgHourlyMonth)) {
    const n = Array.from(usableDays).filter((dk) => dk.startsWith(ym + "-")).length;
    if (n > 0) {
      for (let h = 0; h < 24; h++) avgHourlyMonth[ym][h] /= n;
      avgTotalMonth[ym] /= n;
    }
  }
  for (const ym of Object.keys(quarterShape ?? {})) {
    for (const dow of Object.keys(quarterShape[ym] ?? {})) {
      const n = nByMonthDow[ym]?.[Number(dow)] ?? 0;
      if (n > 0) {
        const dowMap = quarterShape[ym][Number(dow)];
        if (dowMap) {
          for (let h = 0; h < 24; h++) {
            const qs = dowMap[h];
            if (qs) {
              const s = qs.reduce((a: number, b: number) => a + b, 0) || 1;
              for (let q = 0; q < 4; q++) qs[q] /= s;
            }
          }
        }
      }
    }
  }

  const usableArr = Array.from(usableDays);
  const globalHourly = Array.from({ length: 24 }, (_, h) => {
    let sum = 0;
    for (const dk of usableArr) sum += (dayHourly[dk] ?? [])[h] ?? 0;
    return sum;
  });
  const globalTotal = usableArr.length > 0 ? usableArr.reduce((s, dk) => s + (dayTotal[dk] ?? 0), 0) / usableArr.length : 0;
  const globalHourlySum = globalHourly.reduce((a, b) => a + b, 0) || 1;
  for (let h = 0; h < 24; h++) globalHourly[h] /= globalHourlySum;

  const out: Array<{ timestamp: string; kwh: number }> = [];

  for (const day of days) {
    const dk = dateKeyFromTimestamp(day.toISOString());
    const ym = dk.slice(0, 7);
    const dow = day.getUTCDay();
    const list = dayIntervals.get(dk) ?? [];
    const needSimulate = excludedDateKeys.has(dk) || (simulateIncompleteDays && list.length !== INTERVALS_PER_DAY);
    const gridTs = getDayGridTimestamps(day.getTime());

    if (needSimulate) {
      let hourWeights = avgHourly[ym]?.[dow];
      if (!hourWeights || hourWeights.every((w) => w === 0)) hourWeights = avgHourlyMonth[ym];
      if (!hourWeights || hourWeights.every((w) => w === 0)) hourWeights = globalHourly;
      if (!hourWeights || hourWeights.every((w) => w === 0)) hourWeights = Array.from({ length: 24 }, () => 1 / 24);

      let targetTotal = avgTotal[ym]?.[dow];
      if (targetTotal == null || !Number.isFinite(targetTotal)) targetTotal = avgTotalMonth[ym];
      if (targetTotal == null || !Number.isFinite(targetTotal)) targetTotal = globalTotal;
      if (targetTotal == null || !Number.isFinite(targetTotal)) targetTotal = 0;

      const sumW = hourWeights.reduce((a, b) => a + b, 0) || 1;
      const hourKwh = hourWeights.map((w) => (targetTotal * w) / sumW);

      const qsByHour = quarterShape[ym]?.[dow];
      for (let h = 0; h < 24; h++) {
        const qShare = qsByHour?.[h] ?? [0.25, 0.25, 0.25, 0.25];
        const qSum = qShare.reduce((a, b) => a + b, 0) || 1;
        for (let q = 0; q < 4; q++) {
          const idx = h * 4 + q;
          const kwh = (hourKwh[h] * (qShare[q] ?? 0.25)) / qSum;
          out.push({ timestamp: gridTs[idx], kwh });
        }
      }
    } else {
      const slotKwh = new Array<number>(INTERVALS_PER_DAY).fill(0);
      for (const p of list) {
        const t = new Date(p.timestamp).getTime();
        const slot = Math.floor((t - day.getTime()) / SLOT_MS);
        if (slot >= 0 && slot < INTERVALS_PER_DAY) slotKwh[slot] += Number(p.kwh) || 0;
      }
      for (let i = 0; i < INTERVALS_PER_DAY; i++) {
        out.push({ timestamp: gridTs[i], kwh: slotKwh[i] ?? 0 });
      }
    }
  }

  out.sort(
    (a: { timestamp: string; kwh: number }, b: { timestamp: string; kwh: number }) =>
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
  return out;
}

export type PastFallbackLevel = "NEAREST_WEATHER" | "MONTH_DOW" | "MONTH" | "GLOBAL" | "UNIFORM" | "ZERO";

export type PastSimulatedDayDiagnostic = {
  dateKey: string;
  monthKey: string;
  dow: number;
  dayType: "ACTUAL" | "SIMULATED";
  simulatedReason: "EXCLUDED" | "LEADING_MISSING" | null;
  dayIsExcluded: boolean;
  dayIsLeadingMissing: boolean;
  weatherUsed: boolean;
  wx: { tAvgF: number; hdd65: number; cdd65: number } | null;
  hourFallbackLevel: PastFallbackLevel | null;
  totalFallbackLevel: PastFallbackLevel | null;
  referenceCandidateCount: number;
  referencePickedCount: number;
  weatherDistanceAvg: number | null;
  baseNonHvacKwh: number | null;
  hvacKwh: number | null;
  targetTotalKwh: number | null;
};

export type PastSimulationDebug = {
  totalDays: number;
  excludedDays: number;
  leadingMissingDays: number;
  referenceDaysUsed: number;
  simulatedDays: number;
  dayDiagnostics: PastSimulatedDayDiagnostic[];
};

function hasHvacAppliance(applianceProfile: any): boolean {
  const appliances = Array.isArray(applianceProfile?.appliances) ? applianceProfile.appliances : [];
  return appliances.some((a: any) => String(a?.type ?? "").toLowerCase() === "hvac");
}

function parseHeatingType(applianceProfile: any): "HEAT_STRIP" | "HEAT_PUMP" | "UNKNOWN" {
  const appliances = Array.isArray(applianceProfile?.appliances) ? applianceProfile.appliances : [];
  const hvac = appliances.find((a: any) => String(a?.type ?? "").toLowerCase() === "hvac");
  const s = String(
    hvac?.data?.heating_type ??
      hvac?.data?.heat_type ??
      hvac?.data?.heat_source ??
      hvac?.data?.fuel_type ??
      ""
  ).toLowerCase();
  if (s.includes("strip") || s.includes("resistance")) return "HEAT_STRIP";
  if (s.includes("heat_pump") || s.includes("heat pump")) return "HEAT_PUMP";
  return "UNKNOWN";
}

function isGasHeating(homeProfile: any, applianceProfile: any): boolean {
  const fuel = String(homeProfile?.fuelConfiguration ?? applianceProfile?.fuelConfiguration ?? "").toLowerCase();
  return fuel.includes("gas") || fuel.includes("natural_gas");
}

function isElectricHeating(homeProfile: any, applianceProfile: any): boolean {
  const fuel = String(homeProfile?.fuelConfiguration ?? applianceProfile?.fuelConfiguration ?? "").toLowerCase();
  return fuel.includes("all_electric") || fuel.includes("electric");
}

function weatherAwareHvacKwh(args: {
  wx: { hdd65: number; cdd65: number } | null;
  homeProfile: any;
  applianceProfile: any;
}): { hvacKwh: number; electricHeat: boolean } {
  if (!args.wx || !hasHvacAppliance(args.applianceProfile)) return { hvacKwh: 0, electricHeat: false };

  const hdd65 = Math.max(0, Number(args.wx?.hdd65) || 0);
  const cdd65 = Math.max(0, Number(args.wx?.cdd65) || 0);
  const gasHeat = isGasHeating(args.homeProfile, args.applianceProfile);
  const electricHeat = !gasHeat && isElectricHeating(args.homeProfile, args.applianceProfile);
  const heatingType = parseHeatingType(args.applianceProfile);

  let kHeat = gasHeat ? 0.02 : 0.16;
  if (electricHeat && heatingType === "HEAT_STRIP") kHeat = 0.30;
  if (electricHeat && heatingType === "HEAT_PUMP") kHeat = 0.18;
  let kCool = 0.12;

  const summerTemp = Number(args.homeProfile?.summerTemp);
  const winterTemp = Number(args.homeProfile?.winterTemp);
  const coolAdj = Number.isFinite(summerTemp) ? Math.max(0.8, Math.min(1.2, 1 - (summerTemp - 72) * 0.01)) : 1;
  const heatAdj = Number.isFinite(winterTemp) ? Math.max(0.8, Math.min(1.2, 1 - (68 - winterTemp) * 0.01)) : 1;
  kCool *= coolAdj;
  kHeat *= heatAdj;

  const hvacRaw = kHeat * hdd65 + kCool * cdd65;
  const hvacKwh = Math.max(0, Math.min(60, hvacRaw)); // Temporary guardrail while tuning.
  return { hvacKwh, electricHeat };
}

function applyWeatherTiltHourWeights(args: {
  hourWeights: number[];
  wx: { hdd65: number; cdd65: number } | null;
  electricHeat: boolean;
}): number[] {
  const base = Array.isArray(args.hourWeights) && args.hourWeights.length === 24 ? [...args.hourWeights] : Array.from({ length: 24 }, () => 1 / 24);
  const wx = args.wx;
  if (!wx) return base;

  const cdd65 = Math.max(0, Number(wx.cdd65) || 0);
  const hdd65 = Math.max(0, Number(wx.hdd65) || 0);

  const afternoonBoost = 1 + Math.min(0.55, cdd65 * 0.015);
  for (const h of [14, 15, 16, 17, 18, 19]) base[h] *= afternoonBoost;

  const heatScale = args.electricHeat ? 0.015 : 0.006;
  const heatBoost = 1 + Math.min(0.45, hdd65 * heatScale);
  for (const h of [6, 7, 8, 9, 17, 18, 19, 20, 21, 22]) base[h] *= heatBoost;

  const s = base.reduce((a, b) => a + b, 0);
  if (!Number.isFinite(s) || s <= 0) return Array.from({ length: 24 }, () => 1 / 24);
  return base.map((w) => w / s);
}

export function buildPastSimulatedBaselineV1(args: {
  actualIntervals: Array<{ timestamp: string; kwh: number }>;
  canonicalDayStartsMs: number[];
  excludedDateKeys: Set<string>;
  dateKeyFromTimestamp: (ts: string) => string;
  getDayGridTimestamps: (dayStartMs: number) => string[];
  homeProfile?: any;
  applianceProfile?: any;
  actualWxByDateKey?: Map<string, { tAvgF: number; tMinF: number; tMaxF: number; hdd65: number; cdd65: number }>;
  _normalWxByDateKey?: Map<string, { tAvgF: number; tMinF: number; tMaxF: number; hdd65: number; cdd65: number }>;
  debug?: {
    collectDayDiagnostics?: boolean;
    maxDayDiagnostics?: number;
    out?: PastSimulationDebug;
  };
}): Array<{ timestamp: string; kwh: number }> {
  const actualByTs = new Map<string, number>();
  let oldestActualTsMs = Number.POSITIVE_INFINITY;
  for (const p of args.actualIntervals ?? []) {
    const ts = String(p?.timestamp ?? "");
    if (!ts) continue;
    const ms = new Date(ts).getTime();
    if (Number.isFinite(ms) && ms < oldestActualTsMs) oldestActualTsMs = ms;
    actualByTs.set(ts, (actualByTs.get(ts) ?? 0) + (Number(p?.kwh) || 0));
  }

  const analyzeDay = (dayStartMs: number) => {
    const gridTs = args.getDayGridTimestamps(dayStartMs);
    const dateKey = gridTs.length > 0 ? args.dateKeyFromTimestamp(gridTs[0]) : "";
    const dayIsExcluded = Boolean(dateKey) && args.excludedDateKeys.has(dateKey);
    const dayIsLeadingMissing =
      oldestActualTsMs !== Number.POSITIVE_INFINITY &&
      gridTs.length > 0 &&
      new Date(gridTs[0]).getTime() < oldestActualTsMs;
    const shouldSimulateDay = dayIsExcluded || dayIsLeadingMissing;
    const isReferenceDay = !dayIsExcluded && !dayIsLeadingMissing;
    return {
      gridTs,
      dateKey,
      dayIsExcluded,
      dayIsLeadingMissing,
      shouldSimulateDay,
      isReferenceDay,
    };
  };

  const referenceDays: Array<{
    dayStartMs: number;
    dateKey: string;
    monthKey: string;
    dow: number;
    slotKwh: number[];
    hourly: number[];
    total: number;
    hourlyWeights: number[];
    quarterShapeByHour: number[][];
    wx: { tAvgF: number; hdd65: number; cdd65: number } | null;
    hvacKwh: number;
  }> = [];
  for (const dayStartMs of args.canonicalDayStartsMs ?? []) {
    if (!Number.isFinite(dayStartMs)) continue;
    const day = analyzeDay(dayStartMs);
    if (!day.gridTs.length || !day.dateKey) continue;
    if (!day.isReferenceDay) continue;

    const slotKwh = new Array<number>(INTERVALS_PER_DAY).fill(0);
    for (let i = 0; i < INTERVALS_PER_DAY; i++) slotKwh[i] = Number(actualByTs.get(day.gridTs[i]) ?? 0) || 0;

    const hourly = Array.from({ length: 24 }, (_, h) => {
      let s = 0;
      for (let q = 0; q < 4; q++) s += slotKwh[h * 4 + q] ?? 0;
      return s;
    });
    const total = slotKwh.reduce((a, b) => a + b, 0);
    const totalForWeights = total > 0 ? total : 1;
    const hourlyWeights = hourly.map((h) => (Number(h) || 0) / totalForWeights);
    const sHourly = hourlyWeights.reduce((a, b) => a + b, 0) || 1;
    for (let h = 0; h < 24; h++) hourlyWeights[h] = (hourlyWeights[h] ?? 0) / sHourly;

    const quarterShapeByHour: number[][] = [];
    for (let h = 0; h < 24; h++) {
      const hourSum = (hourly[h] ?? 0) || 0;
      const q = [0.25, 0.25, 0.25, 0.25];
      if (hourSum > 0) {
        for (let i = 0; i < 4; i++) q[i] = Math.max(0, (Number(slotKwh[h * 4 + i]) || 0) / hourSum);
        const qs = q.reduce((a, b) => a + b, 0) || 1;
        for (let i = 0; i < 4; i++) q[i] /= qs;
      }
      quarterShapeByHour.push(q);
    }

    const wxRaw = args.actualWxByDateKey?.get(day.dateKey) ?? null;
    const wx = wxRaw
      ? {
          tAvgF: Number(wxRaw.tAvgF) || 0,
          hdd65: Number(wxRaw.hdd65) || 0,
          cdd65: Number(wxRaw.cdd65) || 0,
        }
      : null;
    const hvacRef = weatherAwareHvacKwh({
      wx,
      homeProfile: args.homeProfile,
      applianceProfile: args.applianceProfile,
    });
    referenceDays.push({
      dayStartMs,
      dateKey: day.dateKey,
      monthKey: day.dateKey.slice(0, 7),
      dow: new Date(dayStartMs).getUTCDay(),
      slotKwh,
      hourly,
      total,
      hourlyWeights,
      quarterShapeByHour,
      wx,
      hvacKwh: Number(hvacRef.hvacKwh) || 0,
    });
  }

  const avgHourly: Record<string, Record<number, number[]>> = {};
  const avgTotal: Record<string, Record<number, number>> = {};
  const avgHourlyMonth: Record<string, number[]> = {};
  const avgTotalMonth: Record<string, number> = {};
  const quarterShape: Record<string, Record<number, Record<number, number[]>>> = {};
  const nByMonthDow: Record<string, Record<number, number>> = {};
  const nByMonth: Record<string, number> = {};

  for (const d of referenceDays) {
    const ym = d.monthKey;
    const dow = d.dow;
    if (!avgHourly[ym]) avgHourly[ym] = {};
    if (!avgHourly[ym][dow]) avgHourly[ym][dow] = Array.from({ length: 24 }, () => 0);
    if (!avgTotal[ym]) avgTotal[ym] = {};
    if (!avgTotal[ym][dow]) avgTotal[ym][dow] = 0;
    if (!avgHourlyMonth[ym]) avgHourlyMonth[ym] = Array.from({ length: 24 }, () => 0);
    if (!(ym in avgTotalMonth)) avgTotalMonth[ym] = 0;
    if (!quarterShape[ym]) quarterShape[ym] = {};
    if (!quarterShape[ym][dow]) quarterShape[ym][dow] = {};
    if (!nByMonthDow[ym]) nByMonthDow[ym] = {};
    nByMonthDow[ym][dow] = (nByMonthDow[ym][dow] ?? 0) + 1;
    nByMonth[ym] = (nByMonth[ym] ?? 0) + 1;

    for (let h = 0; h < 24; h++) {
      avgHourly[ym][dow][h] += d.hourly[h] ?? 0;
      avgHourlyMonth[ym][h] += d.hourly[h] ?? 0;
    }
    avgTotal[ym][dow] += d.total;
    avgTotalMonth[ym] += d.total;

    for (let h = 0; h < 24; h++) {
      if (!quarterShape[ym][dow][h]) quarterShape[ym][dow][h] = [0, 0, 0, 0];
      const sum = (d.hourly[h] ?? 0) || 1;
      for (let q = 0; q < 4; q++) {
        quarterShape[ym][dow][h][q] += (Number(d.slotKwh[h * 4 + q]) || 0) / sum;
      }
    }
  }

  for (const ym of Object.keys(avgHourly)) {
    for (const dowStr of Object.keys(avgHourly[ym] ?? {})) {
      const dow = Number(dowStr);
      const n = nByMonthDow[ym]?.[dow] ?? 0;
      if (n <= 0) continue;
      for (let h = 0; h < 24; h++) avgHourly[ym][dow][h] /= n;
      avgTotal[ym][dow] /= n;
    }
  }
  for (const ym of Object.keys(avgHourlyMonth)) {
    const n = nByMonth[ym] ?? 0;
    if (n <= 0) continue;
    for (let h = 0; h < 24; h++) avgHourlyMonth[ym][h] /= n;
    avgTotalMonth[ym] /= n;
  }
  for (const ym of Object.keys(quarterShape)) {
    for (const dowStr of Object.keys(quarterShape[ym] ?? {})) {
      const dow = Number(dowStr);
      const dowMap = quarterShape[ym]?.[dow];
      if (!dowMap) continue;
      for (let h = 0; h < 24; h++) {
        const qs = dowMap[h];
        if (!qs) continue;
        const s = qs.reduce((a, b) => a + b, 0) || 1;
        for (let q = 0; q < 4; q++) qs[q] /= s;
      }
    }
  }

  const globalHourly = Array.from({ length: 24 }, (_, h) => {
    let s = 0;
    for (const d of referenceDays) s += d.hourly[h] ?? 0;
    return s;
  });
  const globalTotal =
    referenceDays.length > 0 ? referenceDays.reduce((s, d) => s + d.total, 0) / referenceDays.length : 0;
  const globalHourlySum = globalHourly.reduce((a, b) => a + b, 0) || 1;
  for (let h = 0; h < 24; h++) globalHourly[h] /= globalHourlySum;

  const NEAREST_WEATHER_K = 7;
  const NEAREST_WEATHER_MIN_CANDS = 4;
  const NEAREST_WEATHER_HVAC_BLEND = 0.5;
  const modDow = (n: number) => ((n % 7) + 7) % 7;

  const nearestWeatherProfileForDay = (target: {
    dateKey: string;
    dow: number;
  }):
    | {
        hourWeights: number[];
        quarterShapeByHour: number[][];
        baseTotalKwh: number;
        avgRefHvacKwh: number;
        candidateCount: number;
        pickedCount: number;
        weatherDistanceAvg: number | null;
      }
    | null => {
    const targetWxRaw = args.actualWxByDateKey?.get(target.dateKey) ?? null;
    if (!targetWxRaw) return null;
    const targetWx = {
      tAvgF: Number(targetWxRaw.tAvgF) || 0,
      hdd65: Number(targetWxRaw.hdd65) || 0,
      cdd65: Number(targetWxRaw.cdd65) || 0,
    };

    const allWeatherCandidates = referenceDays.filter((d) => d.wx != null);
    if (allWeatherCandidates.length < NEAREST_WEATHER_MIN_CANDS) return null;

    const sameDow = allWeatherCandidates.filter((d) => d.dow === target.dow);
    let scoped =
      sameDow.length >= NEAREST_WEATHER_MIN_CANDS
        ? sameDow
        : allWeatherCandidates.filter((d) => {
            const allowed = new Set<number>([target.dow, modDow(target.dow - 1), modDow(target.dow + 1)]);
            return allowed.has(d.dow);
          });
    if (scoped.length < NEAREST_WEATHER_MIN_CANDS) scoped = allWeatherCandidates;
    if (scoped.length < NEAREST_WEATHER_MIN_CANDS) return null;

    const scored = scoped
      .map((d) => {
        const wx = d.wx as { tAvgF: number; hdd65: number; cdd65: number };
        const weatherDist = Math.abs(wx.hdd65 - targetWx.hdd65) + Math.abs(wx.cdd65 - targetWx.cdd65);
        const tempDist = Math.abs((wx.tAvgF ?? 0) - (targetWx.tAvgF ?? 0));
        return { d, weatherDist, tempDist };
      })
      .sort((a, b) => {
        if (a.weatherDist !== b.weatherDist) return a.weatherDist - b.weatherDist;
        if (a.tempDist !== b.tempDist) return a.tempDist - b.tempDist;
        return a.d.dateKey.localeCompare(b.d.dateKey);
      });

    const pickedCount = Math.min(NEAREST_WEATHER_K, scored.length);
    if (pickedCount <= 0) return null;
    const picked = scored.slice(0, pickedCount);

    const hourWeights = Array.from({ length: 24 }, () => 0);
    const quarterShapeByHour: number[][] = Array.from({ length: 24 }, () => [0, 0, 0, 0]);
    let baseTotalKwh = 0;
    let avgRefHvacKwh = 0;
    let weatherDistanceAvg = 0;
    for (const p of picked) {
      baseTotalKwh += Number(p.d.total) || 0;
      avgRefHvacKwh += Number(p.d.hvacKwh) || 0;
      weatherDistanceAvg += p.weatherDist;
      for (let h = 0; h < 24; h++) {
        hourWeights[h] += Number(p.d.hourlyWeights[h]) || 0;
        const q = p.d.quarterShapeByHour[h] ?? [0.25, 0.25, 0.25, 0.25];
        for (let i = 0; i < 4; i++) quarterShapeByHour[h][i] += Number(q[i]) || 0;
      }
    }
    baseTotalKwh /= pickedCount;
    avgRefHvacKwh /= pickedCount;
    weatherDistanceAvg /= pickedCount;

    const hourSum = hourWeights.reduce((a, b) => a + b, 0) || 1;
    for (let h = 0; h < 24; h++) {
      hourWeights[h] = (hourWeights[h] ?? 0) / hourSum;
      const q = quarterShapeByHour[h];
      const qSum = q.reduce((a, b) => a + b, 0) || 1;
      for (let i = 0; i < 4; i++) q[i] /= qSum;
    }

    return {
      hourWeights,
      quarterShapeByHour,
      baseTotalKwh,
      avgRefHvacKwh,
      candidateCount: scored.length,
      pickedCount,
      weatherDistanceAvg: Number.isFinite(weatherDistanceAvg) ? weatherDistanceAvg : null,
    };
  };

  const out: Array<{ timestamp: string; kwh: number }> = [];
  let totalDays = 0;
  let excludedDays = 0;
  let leadingMissingDays = 0;
  let simulatedDays = 0;
  const collectDayDiagnostics = Boolean(args.debug?.collectDayDiagnostics);
  const maxDayDiagnostics = Math.max(0, Number(args.debug?.maxDayDiagnostics ?? 0) || 0);
  const dayDiagnostics: PastSimulatedDayDiagnostic[] = [];
  for (const dayStartMs of args.canonicalDayStartsMs ?? []) {
    if (!Number.isFinite(dayStartMs)) continue;
    const day = analyzeDay(dayStartMs);
    const gridTs = day.gridTs;
    const dateKey = day.dateKey;
    if (!gridTs.length || !dateKey) continue;
    totalDays += 1;
    if (day.dayIsExcluded) excludedDays += 1;
    if (day.dayIsLeadingMissing) leadingMissingDays += 1;
    const ym = dateKey.slice(0, 7);
    const dow = new Date(dayStartMs).getUTCDay();
    const shouldSimulateDay = day.shouldSimulateDay;

    if (shouldSimulateDay) {
      simulatedDays += 1;
      const simulatedReason: "EXCLUDED" | "LEADING_MISSING" = day.dayIsExcluded ? "EXCLUDED" : "LEADING_MISSING";

      // Use ACTUAL_LAST_YEAR weather when available; if missing, keep pattern-only totals/weights.
      const wx = args.actualWxByDateKey?.get(dateKey) ?? null;
      const hvac = weatherAwareHvacKwh({
        wx,
        homeProfile: args.homeProfile,
        applianceProfile: args.applianceProfile,
      });

      let hourWeights: number[] = Array.from({ length: 24 }, () => 1 / 24);
      let qShapeByHour: number[][] | undefined;
      let baseBeforeHvac = 0;
      let targetTotal = 0;
      let hourFallbackLevel: PastFallbackLevel = "MONTH_DOW";
      let totalFallbackLevel: PastFallbackLevel = "MONTH_DOW";
      let referenceCandidateCount = 0;
      let referencePickedCount = 0;
      let weatherDistanceAvg: number | null = null;

      const nearest = nearestWeatherProfileForDay({ dateKey, dow });
      if (nearest) {
        hourWeights = nearest.hourWeights;
        qShapeByHour = nearest.quarterShapeByHour;
        const hvacTarget = wx ? Number(hvac.hvacKwh) || 0 : 0;
        const hvacDelta = hvacTarget - (Number(nearest.avgRefHvacKwh) || 0);
        baseBeforeHvac = Number(nearest.baseTotalKwh) || 0;
        targetTotal = Math.max(0, baseBeforeHvac + hvacDelta * NEAREST_WEATHER_HVAC_BLEND);
        hourFallbackLevel = "NEAREST_WEATHER";
        totalFallbackLevel = "NEAREST_WEATHER";
        referenceCandidateCount = nearest.candidateCount;
        referencePickedCount = nearest.pickedCount;
        weatherDistanceAvg = nearest.weatherDistanceAvg;
      } else {
        hourWeights = avgHourly[ym]?.[dow];
        if (!hourWeights || hourWeights.every((w) => w === 0)) {
          hourWeights = avgHourlyMonth[ym];
          hourFallbackLevel = "MONTH";
        }
        if (!hourWeights || hourWeights.every((w) => w === 0)) {
          hourWeights = globalHourly;
          hourFallbackLevel = "GLOBAL";
        }
        if (!hourWeights || hourWeights.every((w) => w === 0)) {
          hourWeights = Array.from({ length: 24 }, () => 1 / 24);
          hourFallbackLevel = "UNIFORM";
        }

        let baseNonHvac = avgTotal[ym]?.[dow];
        if (baseNonHvac == null || !Number.isFinite(baseNonHvac)) {
          baseNonHvac = avgTotalMonth[ym];
          totalFallbackLevel = "MONTH";
        }
        if (baseNonHvac == null || !Number.isFinite(baseNonHvac)) {
          baseNonHvac = globalTotal;
          totalFallbackLevel = "GLOBAL";
        }
        if (baseNonHvac == null || !Number.isFinite(baseNonHvac)) {
          baseNonHvac = 0;
          totalFallbackLevel = "ZERO";
        }
        baseBeforeHvac = Number(baseNonHvac ?? 0) || 0;
        targetTotal = Math.max(0, baseBeforeHvac + (wx ? Number(hvac.hvacKwh) || 0 : 0));
      }

      const tiltedHourWeights = applyWeatherTiltHourWeights({
        hourWeights,
        wx,
        electricHeat: hvac.electricHeat,
      });

      const sumW = tiltedHourWeights.reduce((a, b) => a + b, 0) || 1;
      const hourKwh = tiltedHourWeights.map((w) => (targetTotal * w) / sumW);
      for (let h = 0; h < 24; h++) {
        const qShare = qShapeByHour?.[h] ?? quarterShape[ym]?.[dow]?.[h] ?? [0.25, 0.25, 0.25, 0.25];
        const qSum = qShare.reduce((a, b) => a + b, 0) || 1;
        for (let q = 0; q < 4; q++) {
          const idx = h * 4 + q;
          out.push({ timestamp: gridTs[idx], kwh: (hourKwh[h] * (qShare[q] ?? 0.25)) / qSum });
        }
      }
      if (collectDayDiagnostics && (maxDayDiagnostics <= 0 || dayDiagnostics.length < maxDayDiagnostics)) {
        dayDiagnostics.push({
          dateKey,
          monthKey: ym,
          dow,
          dayType: "SIMULATED",
          simulatedReason,
          dayIsExcluded: day.dayIsExcluded,
          dayIsLeadingMissing: day.dayIsLeadingMissing,
          weatherUsed: Boolean(wx),
          wx: wx
            ? {
                tAvgF: Number(wx.tAvgF) || 0,
                hdd65: Number(wx.hdd65) || 0,
                cdd65: Number(wx.cdd65) || 0,
              }
            : null,
          hourFallbackLevel,
          totalFallbackLevel,
          referenceCandidateCount,
          referencePickedCount,
          weatherDistanceAvg,
          baseNonHvacKwh: baseBeforeHvac,
          hvacKwh: wx ? Number(hvac.hvacKwh) || 0 : 0,
          targetTotalKwh: Number(targetTotal) || 0,
        });
      }
    } else {
      for (let i = 0; i < INTERVALS_PER_DAY; i++) {
        const ts = gridTs[i];
        out.push({ timestamp: ts, kwh: Number(actualByTs.get(ts) ?? 0) || 0 });
      }
      if (collectDayDiagnostics && (maxDayDiagnostics <= 0 || dayDiagnostics.length < maxDayDiagnostics)) {
        const wx = args.actualWxByDateKey?.get(dateKey) ?? null;
        dayDiagnostics.push({
          dateKey,
          monthKey: ym,
          dow,
          dayType: "ACTUAL",
          simulatedReason: null,
          dayIsExcluded: day.dayIsExcluded,
          dayIsLeadingMissing: day.dayIsLeadingMissing,
          weatherUsed: Boolean(wx),
          wx: wx
            ? {
                tAvgF: Number(wx.tAvgF) || 0,
                hdd65: Number(wx.hdd65) || 0,
                cdd65: Number(wx.cdd65) || 0,
              }
            : null,
          hourFallbackLevel: null,
          totalFallbackLevel: null,
          referenceCandidateCount: 0,
          referencePickedCount: 0,
          weatherDistanceAvg: null,
          baseNonHvacKwh: null,
          hvacKwh: null,
          targetTotalKwh: null,
        });
      }
    }
  }

  if (args.debug?.out) {
    args.debug.out.totalDays = totalDays;
    args.debug.out.excludedDays = excludedDays;
    args.debug.out.leadingMissingDays = leadingMissingDays;
    args.debug.out.referenceDaysUsed = referenceDays.length;
    args.debug.out.simulatedDays = simulatedDays;
    args.debug.out.dayDiagnostics = dayDiagnostics;
  }

  if (process.env.NODE_ENV !== "production") {
    console.debug(
      "[simulatedUsage] past-v1 day stats",
      JSON.stringify({
        totalDays,
        excludedDays,
        leadingMissingDays,
        referenceDaysUsed: referenceDays.length,
        simulatedDays,
      })
    );
  }

  out.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  return out;
}

// Future stubs (do not implement yet)
export type UsagePatch = { start: string; end: string; reason: string };
export function applyScenarioDeltasStub() {
  throw new Error("not_implemented");
}