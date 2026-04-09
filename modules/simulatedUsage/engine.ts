import { createHash } from "crypto";
import { ManualUsagePayload, SimulatedCurve, TravelRange } from "./types";
import { billingPeriodsEndingAt } from "@/modules/manualUsage/billingPeriods";
import { anchorEndDateUtc } from "@/modules/manualUsage/anchor";
import { dateKeyFromTimestamp, getDayGridTimestamps } from "@/modules/usageSimulator/pastStitchedCurve";
import {
  buildPastDaySimulationContext,
  simulatePastDay,
  SOURCE_OF_DAY_SIMULATION_CORE,
} from "@/modules/simulatedUsage/pastDaySimulator";
import type {
  PastDayProfileLite,
  PastDayTrainingWeatherStats,
  PastDayWeatherFeatures,
  PastDayFallbackLevel,
  SimulatedDayResult,
  PastShapeVariants,
  PastNeighborDayTotals,
  PastDayTypeKey,
  PastWeatherRegimeKey,
  PastWeatherDonorSample,
} from "@/modules/simulatedUsage/pastDaySimulatorTypes";
import { buildTrainingWeatherStats } from "@/lib/admin/gapfillLab";
import type { DailyWeatherFeatures } from "@/lib/admin/gapfillLab";
import type { ResolvedSimFingerprint } from "@/modules/usageSimulator/resolvedSimFingerprintTypes";
import { getMemoryRssMb, logSimPipelineEvent } from "@/modules/usageSimulator/simObservability";

/** Map shared simulator fallback level to engine diagnostic enum. */
function pastDayFallbackToEngineLevel(level: PastDayFallbackLevel): PastFallbackLevel {
  const map: Record<PastDayFallbackLevel, PastFallbackLevel> = {
    weather_nearest_daytype_regime: "NEAREST_WEATHER",
    weather_nearest_daytype: "NEAREST_WEATHER",
    month_daytype_neighbor: "MONTH_DOW",
    month_daytype: "MONTH_DOW",
    adjacent_month_daytype: "MONTH_DOW",
    month_overall: "MONTH",
    season_overall: "MONTH",
    global_daytype: "GLOBAL",
    global_overall: "GLOBAL",
  };
  return map[level] ?? "MONTH_DOW";
}

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

/** Convert engine weather (F, HDD65/CDD65) to shared PastDayWeatherFeatures (C, severity). */
function engineWxToPastDayWeather(
  wx: { tAvgF: number; tMinF?: number; tMaxF?: number; hdd65: number; cdd65: number } | null
): PastDayWeatherFeatures | null {
  if (!wx) return null;
  const tAvgC = ((Number(wx.tAvgF) || 0) - 32) * (5 / 9);
  const tMinC = wx.tMinF != null ? ((Number(wx.tMinF) || 0) - 32) * (5 / 9) : null;
  const tMaxC = wx.tMaxF != null ? ((Number(wx.tMaxF) || 0) - 32) * (5 / 9) : null;
  const dailyMinTempC = tMinC != null ? tMinC : tAvgC;
  const freezeHoursCount = dailyMinTempC <= 0 ? 24 : 0;
  return {
    dailyAvgTempC: Number.isFinite(tAvgC) ? tAvgC : null,
    dailyMinTempC: tMinC != null && Number.isFinite(tMinC) ? tMinC : (Number.isFinite(tAvgC) ? tAvgC : null),
    dailyMaxTempC: tMaxC != null && Number.isFinite(tMaxC) ? tMaxC : null,
    heatingDegreeSeverity: Math.max(0, Number(wx.hdd65) || 0),
    coolingDegreeSeverity: Math.max(0, Number(wx.cdd65) || 0),
    freezeHoursCount,
  };
}

const SHAPE_WEATHER_SEVERITY_THRESHOLD = 2;

function weatherRegimeForShape(wx: { hdd65: number; cdd65: number } | null): PastWeatherRegimeKey {
  if (!wx) return "neutral";
  const hdd = Math.max(0, Number(wx.hdd65) || 0);
  const cdd = Math.max(0, Number(wx.cdd65) || 0);
  if (hdd > cdd && hdd > SHAPE_WEATHER_SEVERITY_THRESHOLD) return "heating";
  if (cdd > hdd && cdd > SHAPE_WEATHER_SEVERITY_THRESHOLD) return "cooling";
  return "neutral";
}

function emptyShape96Array(): number[] {
  return Array.from({ length: INTERVALS_PER_DAY }, () => 0);
}

function normalizeShape96OrNull(shape: number[] | undefined): number[] | null {
  if (!Array.isArray(shape) || shape.length !== INTERVALS_PER_DAY) return null;
  const safe = shape.map((v) => Math.max(0, Number(v) || 0));
  const sum = safe.reduce((a, b) => a + b, 0);
  if (!Number.isFinite(sum) || sum <= 0) return null;
  return safe.map((v) => v / sum);
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

export type PastFallbackLevel = "NEAREST_WEATHER" | "USAGE_SHAPE_PROFILE" | "MONTH_DOW" | "MONTH" | "GLOBAL" | "UNIFORM" | "ZERO";

export type PastSimulatedDayDiagnostic = {
  dateKey: string;
  monthKey: string;
  dow: number;
  dayType: "ACTUAL" | "SIMULATED";
  simulatedReason:
    | "EXCLUDED"
    | "LEADING_MISSING"
    | "LOW_DATA_CONSTRAINED"
    | "INCOMPLETE"
    | "FORCED_SELECTED_DAY"
    | "GAPFILL_MODELED_KEEP_REF"
    | null;
  dayIsExcluded: boolean;
  dayIsLeadingMissing: boolean;
  weatherUsed: boolean;
  wx: { tAvgF: number; hdd65: number; cdd65: number } | null;
  hourFallbackLevel: PastFallbackLevel | null;
  totalFallbackLevel: PastFallbackLevel | null;
  referenceCandidateCount: number;
  referencePickedCount: number;
  weatherDistanceAvg: number | null;
  poolApplied: boolean;
  poolKwh: number | null;
  baseNonHvacKwh: number | null;
  hvacKwh: number | null;
  targetTotalKwh: number | null;
  /** When set, indicates the day was simulated with the shared past-day simulator core. */
  sourceOfDaySimulationCore?: string;
  rawDayKwh?: number | null;
  targetDayKwhBeforeWeather?: number | null;
  weatherAdjustedDayKwh?: number | null;
  dayTypeUsed?: string | null;
  shapeVariantUsed?: string | null;
  finalDayKwh?: number | null;
  displayDayKwh?: number | null;
  intervalSumKwh?: number | null;
  donorSelectionModeUsed?: string | null;
  donorCandidatePoolSize?: number | null;
  selectedDonorLocalDates?: string[] | null;
  selectedDonorWeights?: Array<{ localDate: string; weight: number; distance: number; dayKwh: number }> | null;
  donorWeatherRegimeUsed?: string | null;
  donorMonthKeyUsed?: string | null;
  thermalDistanceScore?: number | null;
  broadFallbackUsed?: boolean | null;
  sameRegimeDonorPoolAvailable?: boolean | null;
  donorPoolBlendStrategy?: string | null;
  donorPoolKwhSpread?: number | null;
  donorPoolKwhVariance?: number | null;
  donorPoolMedianKwh?: number | null;
  donorVarianceGuardrailTriggered?: boolean | null;
  weatherAdjustmentModeUsed?: string | null;
  postDonorAdjustmentCoefficient?: number | null;
};

export type PastSimulationDebug = {
  totalDays: number;
  excludedDays: number;
  leadingMissingDays: number;
  referenceDaysUsed: number;
  simulatedDays: number;
  lowDataSyntheticContextUsed?: boolean;
  lowDataSyntheticMode?: "MANUAL_TOTALS" | "NEW_BUILD_ESTIMATE" | null;
  actualBackedReferencePoolUsed?: boolean;
  actualIntervalPayloadAttached?: boolean;
  actualIntervalPayloadCount?: number;
  suppressedActualIntervalPayloadCount?: number;
  exactIntervalReferencePreparationSkipped?: boolean;
  lowDataSummarizedSourceTruthUsed?: boolean;
  intervalUsageFingerprintIdentity?: string;
  trustedIntervalFingerprintDayCount?: number;
  excludedTravelVacantFingerprintDayCount?: number;
  excludedIncompleteMeterFingerprintDayCount?: number;
  excludedLeadingMissingFingerprintDayCount?: number;
  excludedOtherUntrustedFingerprintDayCount?: number;
  fingerprintMonthBucketsUsed?: string[];
  fingerprintWeekdayWeekendBucketsUsed?: string[];
  fingerprintWeatherBucketsUsed?: string[];
  fingerprintShapeSummaryByMonthDayType?: Record<string, Record<string, Record<string, number>>>;
  dayDiagnostics: PastSimulatedDayDiagnostic[];
};

function hasHvacAppliance(applianceProfile: any): boolean {
  const appliances = Array.isArray(applianceProfile?.appliances) ? applianceProfile.appliances : [];
  return appliances.some((a: any) => String(a?.type ?? "").toLowerCase() === "hvac");
}

function hasHomeHvacSignal(homeProfile: any): boolean {
  const hvacType = String(homeProfile?.hvacType ?? "").trim();
  const heatingType = String(homeProfile?.heatingType ?? "").trim();
  return hvacType.length > 0 || heatingType.length > 0;
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

function parseHomeHeatingType(homeProfile: any): "HEAT_STRIP" | "HEAT_PUMP" | "UNKNOWN" {
  const s = String(homeProfile?.heatingType ?? "").toLowerCase();
  if (s.includes("electric")) return "HEAT_STRIP";
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
  if (!args.wx || (!hasHvacAppliance(args.applianceProfile) && !hasHomeHvacSignal(args.homeProfile))) {
    return { hvacKwh: 0, electricHeat: false };
  }

  const hdd65 = Math.max(0, Number(args.wx?.hdd65) || 0);
  const cdd65 = Math.max(0, Number(args.wx?.cdd65) || 0);
  const gasHeat = isGasHeating(args.homeProfile, args.applianceProfile);
  const electricHeat = !gasHeat && isElectricHeating(args.homeProfile, args.applianceProfile);
  const heatingTypeFromHome = parseHomeHeatingType(args.homeProfile);
  const heatingTypeFromAppliance = parseHeatingType(args.applianceProfile);
  const heatingType = heatingTypeFromHome !== "UNKNOWN" ? heatingTypeFromHome : heatingTypeFromAppliance;

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

function poolSeasonalKwh(args: { dateKey: string; homeProfile: any }): number {
  if (!args?.homeProfile?.hasPool) return 0;
  const pumpType = String(args.homeProfile?.poolPumpType ?? "").toLowerCase();
  const hpRaw = Number(args.homeProfile?.poolPumpHp);
  const hp = Number.isFinite(hpRaw) ? Math.max(0, Math.min(5, hpRaw)) : 1;
  const summerRunRaw = Number(args.homeProfile?.poolSummerRunHoursPerDay);
  const winterRunRaw = Number(args.homeProfile?.poolWinterRunHoursPerDay);
  const summerRun = Number.isFinite(summerRunRaw) ? Math.max(0, Math.min(24, summerRunRaw)) : 8;
  const winterRun = Number.isFinite(winterRunRaw) ? Math.max(0, Math.min(24, winterRunRaw)) : 2;

  let pumpKwPerHp = 0.75;
  if (pumpType === "dual_speed") pumpKwPerHp = 0.65;
  if (pumpType === "variable_speed") pumpKwPerHp = 0.45;
  const pumpKw = hp * pumpKwPerHp;

  const month = Number(String(args.dateKey ?? "").slice(5, 7));
  const summerMonths = new Set([5, 6, 7, 8, 9]);
  const shoulderMonths = new Set([3, 4, 10, 11]);
  const seasonHours = summerMonths.has(month) ? summerRun : shoulderMonths.has(month) ? (summerRun + winterRun) / 2 : winterRun;
  const pumpKwh = Math.max(0, pumpKw * seasonHours);

  const hasHeater = Boolean(args.homeProfile?.hasPoolHeater);
  const heaterType = String(args.homeProfile?.poolHeaterType ?? "").toLowerCase();
  const heaterAdder = hasHeater && (heaterType === "electric" || heaterType === "heat_pump") && summerMonths.has(month) ? 1.25 : 0;

  return Math.max(0, Math.min(40, pumpKwh + heaterAdder));
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

/** Local date key (YYYY-MM-DD) and dow (0–6, 0=Sun) for a UTC day-start in the given timezone. */
function getLocalDateKeyAndDow(dayStartMs: number, timezone: string): { dateKey: string; monthKey: string; dow: number } {
  const d = new Date(dayStartMs);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const y = get("year");
  const m = get("month");
  const day = get("day");
  const weekday = get("weekday");
  const dowMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    dateKey: `${y}-${m}-${day}`,
    monthKey: `${y}-${m}`,
    dow: dowMap[weekday] ?? 0,
  };
}

/**
 * Blend reference-interval profile with usage-shape-merged profile.
 * `usageWeight` is the weight on the merged (usage-side) profile; `(1-usageWeight)` on reference.
 */
function blendPastDayProfileLite(
  reference: PastDayProfileLite,
  merged: PastDayProfileLite,
  usageWeight: number
): PastDayProfileLite {
  const w = Math.min(1, Math.max(0, Number(usageWeight) || 0));
  const keys = Array.from(new Set([...reference.monthKeys, ...merged.monthKeys])).sort();
  const idxOf = (p: PastDayProfileLite, ym: string) => p.monthKeys.indexOf(ym);
  const wdByMonth: number[] = [];
  const weByMonth: number[] = [];
  const wdCount: Record<string, number> = {};
  const weCount: Record<string, number> = {};
  const monthOverallAvg: Record<string, number> = {};
  const monthOverallCount: Record<string, number> = {};
  for (let i = 0; i < keys.length; i++) {
    const ym = keys[i]!;
    const ri = idxOf(reference, ym);
    const mi = idxOf(merged, ym);
    const rWd = ri >= 0 ? reference.avgKwhPerDayWeekdayByMonth[ri] ?? 0 : 0;
    const mWd = mi >= 0 ? merged.avgKwhPerDayWeekdayByMonth[mi] ?? 0 : 0;
    const rWe = ri >= 0 ? reference.avgKwhPerDayWeekendByMonth[ri] ?? 0 : 0;
    const mWe = mi >= 0 ? merged.avgKwhPerDayWeekendByMonth[mi] ?? 0 : 0;
    wdByMonth[i] = (1 - w) * rWd + w * mWd;
    weByMonth[i] = (1 - w) * rWe + w * mWe;
    const rcWd = reference.weekdayCountByMonth[ym] ?? 0;
    const rcWe = reference.weekendCountByMonth[ym] ?? 0;
    const mcWd = merged.weekdayCountByMonth[ym] ?? 0;
    const mcWe = merged.weekendCountByMonth[ym] ?? 0;
    wdCount[ym] = Math.round((1 - w) * rcWd + w * mcWd) || (w >= 0.5 ? mcWd : rcWd);
    weCount[ym] = Math.round((1 - w) * rcWe + w * mcWe) || (w >= 0.5 ? mcWe : rcWe);
    monthOverallCount[ym] = wdCount[ym]! + weCount[ym]!;
    monthOverallAvg[ym] =
      monthOverallCount[ym]! > 0
        ? (wdByMonth[i]! * wdCount[ym]! + weByMonth[i]! * weCount[ym]!) / monthOverallCount[ym]!
        : 0;
  }
  return {
    monthKeys: keys,
    avgKwhPerDayWeekdayByMonth: wdByMonth,
    avgKwhPerDayWeekendByMonth: weByMonth,
    weekdayCountByMonth: wdCount,
    weekendCountByMonth: weCount,
    monthOverallAvgByMonth: monthOverallAvg,
    monthOverallCountByMonth: monthOverallCount,
  };
}

const WHOLE_HOME_SYNTHETIC_MIN_DAYS = 4;

function uniformShape96(): number[] {
  return Array.from({ length: 96 }, () => 1 / 96);
}

function usesWholeHomeOnlyPrior(resolvedSimFingerprint: ResolvedSimFingerprint | null | undefined): boolean {
  return (
    resolvedSimFingerprint?.blendMode === "whole_home_only" ||
    resolvedSimFingerprint?.underlyingSourceMix === "whole_home_only"
  );
}

/**
 * Intraday shape for `whole_home_only`: uniform 96-slot curves only (no reference-interval aggregation).
 * Populates `PastShapeVariants` so `selectShape96` never falls through to meter-derived `legacyByMonth96`.
 */
function syntheticWholeHomeShapeVariants(monthKeys: string[]): PastShapeVariants {
  const u = uniformShape96();
  const keys = monthKeys.length > 0 ? monthKeys : ["2000-01"];
  const byMonth96: Record<string, number[]> = {};
  const byMonthDayType96: NonNullable<PastShapeVariants["byMonthDayType96"]> = {};
  const byMonthWeatherDayType96: NonNullable<PastShapeVariants["byMonthWeatherDayType96"]> = {};
  for (const ym of keys) {
    byMonth96[ym] = u;
    byMonthDayType96[ym] = { weekday: u, weekend: u };
    byMonthWeatherDayType96[ym] = {
      weekday: { heating: u, cooling: u, neutral: u },
      weekend: { heating: u, cooling: u, neutral: u },
    };
  }
  return {
    byMonth96,
    byMonthDayType96,
    byMonthWeatherDayType96,
    weekdayWeekend96: { weekday: u, weekend: u },
    weekdayWeekendWeather96: {
      weekday: { heating: u, cooling: u, neutral: u },
      weekend: { heating: u, cooling: u, neutral: u },
    },
  };
}

/**
 * Whole-home prior profile for `ResolvedSimFingerprint.blendMode === "whole_home_only"`:
 * derived only from `homeProfile` / `applianceProfile` (same feature family as WholeHomeFingerprint), not from
 * interval reference pools or usage-shape merge.
 */
function syntheticWholeHomePastDayProfileLite(args: {
  monthKeys: string[];
  homeProfile?: any;
  applianceProfile?: any;
}): PastDayProfileLite {
  const monthKeys = args.monthKeys.length > 0 ? args.monthKeys : ["2000-01"];
  const h = args.homeProfile ?? {};
  const sqft = Math.max(500, Math.min(20000, Number(h.squareFeet) || 2000));
  const evRaw = Number(h.evAvgKwhPerDay);
  const evKwh = Number.isFinite(evRaw) && evRaw > 0 ? Math.min(80, evRaw) : 0;
  let baseWd = 10 + (sqft / 2500) * 28;
  baseWd += evKwh * 0.35;
  if (Boolean(h.hasPool)) baseWd += 3;
  baseWd = Math.max(8, Math.min(120, baseWd));
  const baseWe = baseWd * 0.93;
  const wdByMonth: number[] = [];
  const weByMonth: number[] = [];
  const wdCount: Record<string, number> = {};
  const weCount: Record<string, number> = {};
  const monthOverallAvg: Record<string, number> = {};
  const monthOverallCount: Record<string, number> = {};
  for (let i = 0; i < monthKeys.length; i++) {
    const ym = monthKeys[i]!;
    const monthNum = Number(ym.slice(5, 7)) || 6;
    const season =
      monthNum >= 11 || monthNum <= 2 ? 1.12 : monthNum >= 6 && monthNum <= 8 ? 1.08 : 1;
    wdByMonth[i] = baseWd * season;
    weByMonth[i] = baseWe * season;
    wdCount[ym] = WHOLE_HOME_SYNTHETIC_MIN_DAYS;
    weCount[ym] = WHOLE_HOME_SYNTHETIC_MIN_DAYS;
    monthOverallCount[ym] = WHOLE_HOME_SYNTHETIC_MIN_DAYS * 2;
    monthOverallAvg[ym] =
      monthOverallCount[ym]! > 0
        ? (wdByMonth[i]! * wdCount[ym]! + weByMonth[i]! * weCount[ym]!) / monthOverallCount[ym]!
        : 0;
  }
  return {
    monthKeys,
    avgKwhPerDayWeekdayByMonth: wdByMonth,
    avgKwhPerDayWeekendByMonth: weByMonth,
    weekdayCountByMonth: wdCount,
    weekendCountByMonth: weCount,
    monthOverallAvgByMonth: monthOverallAvg,
    monthOverallCountByMonth: monthOverallCount,
  };
}

function buildLowDataSyntheticShapeVariants(args: {
  monthKeys: string[];
  intradayShape96?: number[] | null;
  weekdayWeekendShape96?: { weekday?: number[] | null; weekend?: number[] | null } | null;
}): PastShapeVariants {
  const monthKeys = args.monthKeys.length > 0 ? args.monthKeys : ["2000-01"];
  const fallback =
    normalizeShape96OrNull(args.intradayShape96 ?? undefined) ??
    Array.from({ length: INTERVALS_PER_DAY }, () => 1 / INTERVALS_PER_DAY);
  const weekday = normalizeShape96OrNull(args.weekdayWeekendShape96?.weekday ?? undefined) ?? fallback;
  const weekend = normalizeShape96OrNull(args.weekdayWeekendShape96?.weekend ?? undefined) ?? fallback;
  const byMonth96: Record<string, number[]> = {};
  const byMonthDayType96: Record<string, Record<PastDayTypeKey, number[] | null>> = {};
  const byMonthWeatherDayType96: Record<
    string,
    Record<PastDayTypeKey, Record<PastWeatherRegimeKey, number[] | null>>
  > = {};
  for (const monthKey of monthKeys) {
    byMonth96[monthKey] = [...fallback];
    byMonthDayType96[monthKey] = {
      weekday: [...weekday],
      weekend: [...weekend],
    };
    byMonthWeatherDayType96[monthKey] = {
      weekday: {
        heating: [...weekday],
        cooling: [...weekday],
        neutral: [...weekday],
      },
      weekend: {
        heating: [...weekend],
        cooling: [...weekend],
        neutral: [...weekend],
      },
    };
  }
  return {
    byMonth96,
    byMonthDayType96,
    byMonthWeatherDayType96,
    weekdayWeekend96: {
      weekday: [...weekday],
      weekend: [...weekend],
    },
    weekdayWeekendWeather96: {
      weekday: {
        heating: [...weekday],
        cooling: [...weekday],
        neutral: [...weekday],
      },
      weekend: {
        heating: [...weekend],
        cooling: [...weekend],
        neutral: [...weekend],
      },
    },
  };
}

function buildLowDataSyntheticDayKwhByMonthDayType(profile: PastDayProfileLite): Record<string, { weekday: number; weekend: number }> {
  const out: Record<string, { weekday: number; weekend: number }> = {};
  for (let i = 0; i < profile.monthKeys.length; i++) {
    const monthKey = profile.monthKeys[i];
    if (!monthKey) continue;
    const weekday = Number(profile.avgKwhPerDayWeekdayByMonth[i] ?? profile.monthOverallAvgByMonth[monthKey] ?? 0) || 0;
    const weekend = Number(profile.avgKwhPerDayWeekendByMonth[i] ?? profile.monthOverallAvgByMonth[monthKey] ?? 0) || 0;
    out[monthKey] = { weekday, weekend };
  }
  return out;
}

function applyLowDataWeatherEvidenceToProfile(args: {
  profile: PastDayProfileLite;
  weatherEvidenceSummary?: import("@/modules/simulatedUsage/pastDaySimulatorTypes").PastLowDataWeatherEvidenceSummary | null;
}): PastDayProfileLite {
  const evidence = args.weatherEvidenceSummary ?? null;
  if (!evidence || typeof evidence.byMonth !== "object" || evidence.byMonth == null) return args.profile;
  const evidenceMonthKeys = Object.keys(evidence.byMonth).filter((value) => /^\d{4}-\d{2}$/.test(value));
  if (evidenceMonthKeys.length === 0) return args.profile;
  const monthKeys = Array.from(new Set([...args.profile.monthKeys, ...evidenceMonthKeys])).sort();
  const nextWeekday: number[] = [];
  const nextWeekend: number[] = [];
  const nextWeekdayCount: Record<string, number> = {};
  const nextWeekendCount: Record<string, number> = {};
  const nextMonthOverallAvg: Record<string, number> = {};
  const nextMonthOverallCount: Record<string, number> = {};
  const idxOf = (monthKey: string) => args.profile.monthKeys.indexOf(monthKey);
  for (let i = 0; i < monthKeys.length; i += 1) {
    const monthKey = monthKeys[i]!;
    const profileIdx = idxOf(monthKey);
    const evidenceMonth = evidence.byMonth[monthKey] ?? null;
    const weekdayCount =
      args.profile.weekdayCountByMonth[monthKey] ??
      (profileIdx >= 0 ? Number(args.profile.weekdayCountByMonth[monthKey] ?? 0) : 0) ??
      WHOLE_HOME_SYNTHETIC_MIN_DAYS;
    const weekendCount =
      args.profile.weekendCountByMonth[monthKey] ??
      (profileIdx >= 0 ? Number(args.profile.weekendCountByMonth[monthKey] ?? 0) : 0) ??
      WHOLE_HOME_SYNTHETIC_MIN_DAYS;
    const safeWeekdayCount = Math.max(1, Number(weekdayCount) || WHOLE_HOME_SYNTHETIC_MIN_DAYS);
    const safeWeekendCount = Math.max(1, Number(weekendCount) || WHOLE_HOME_SYNTHETIC_MIN_DAYS);
    const weekdayBase =
      profileIdx >= 0
        ? Number(
            args.profile.avgKwhPerDayWeekdayByMonth[profileIdx] ??
              args.profile.monthOverallAvgByMonth[monthKey] ??
              0
          ) || 0
        : Number(args.profile.monthOverallAvgByMonth[monthKey] ?? 0) || 0;
    const weekendBase =
      profileIdx >= 0
        ? Number(
            args.profile.avgKwhPerDayWeekendByMonth[profileIdx] ??
              args.profile.monthOverallAvgByMonth[monthKey] ??
              0
          ) || 0
        : Number(args.profile.monthOverallAvgByMonth[monthKey] ?? 0) || 0;
    const weightedBaseAvg =
      (weekdayBase * safeWeekdayCount + weekendBase * safeWeekendCount) / Math.max(1, safeWeekdayCount + safeWeekendCount);
    const baseAvg = weightedBaseAvg > 0 ? weightedBaseAvg : Math.max(weekdayBase, weekendBase, 0.01);
    const targetAvgDailyKwh =
      evidenceMonth && Number.isFinite(Number(evidenceMonth.targetAvgDailyKwh))
        ? Math.max(0, Number(evidenceMonth.targetAvgDailyKwh) || 0)
        : baseAvg;
    const weekdayRatio = Math.min(1.18, Math.max(0.82, weekdayBase / Math.max(baseAvg, 1e-6)));
    const weekendRatio = Math.min(1.18, Math.max(0.82, weekendBase / Math.max(baseAvg, 1e-6)));
    const weightedRatioAvg =
      (weekdayRatio * safeWeekdayCount + weekendRatio * safeWeekendCount) / Math.max(1, safeWeekdayCount + safeWeekendCount);
    const normalizationScale = targetAvgDailyKwh / Math.max(weightedRatioAvg, 1e-6);
    const weekdayValue = Math.max(0, weekdayRatio * normalizationScale);
    const weekendValue = Math.max(0, weekendRatio * normalizationScale);
    nextWeekday[i] = weekdayValue;
    nextWeekend[i] = weekendValue;
    nextWeekdayCount[monthKey] = safeWeekdayCount;
    nextWeekendCount[monthKey] = safeWeekendCount;
    nextMonthOverallCount[monthKey] = safeWeekdayCount + safeWeekendCount;
    nextMonthOverallAvg[monthKey] =
      (weekdayValue * safeWeekdayCount + weekendValue * safeWeekendCount) / Math.max(1, nextMonthOverallCount[monthKey]!);
  }
  return {
    monthKeys,
    avgKwhPerDayWeekdayByMonth: nextWeekday,
    avgKwhPerDayWeekendByMonth: nextWeekend,
    weekdayCountByMonth: nextWeekdayCount,
    weekendCountByMonth: nextWeekendCount,
    monthOverallAvgByMonth: nextMonthOverallAvg,
    monthOverallCountByMonth: nextMonthOverallCount,
  };
}

export function buildPastSimulatedBaselineV1(args: {
  actualIntervals: Array<{ timestamp: string; kwh: number }>;
  canonicalDayStartsMs: number[];
  excludedDateKeys: Set<string>;
  dateKeyFromTimestamp: (ts: string) => string;
  getDayGridTimestamps: (dayStartMs: number) => string[];
  homeProfile?: any;
  applianceProfile?: any;
  /** When set, daily total for excluded days (no weather) uses weekday/weekend avg from profile (lookup by YYYY-MM). */
  usageShapeProfile?: {
    weekdayAvgByMonthKey?: Record<string, number>;
    weekendAvgByMonthKey?: Record<string, number>;
  };
  /** Timezone for local date/dow when using usageShapeProfile (e.g. America/Chicago). */
  timezoneForProfile?: string;
  actualWxByDateKey?: Map<string, { tAvgF: number; tMinF: number; tMaxF: number; hdd65: number; cdd65: number }>;
  _normalWxByDateKey?: Map<string, { tAvgF: number; tMinF: number; tMaxF: number; hdd65: number; cdd65: number }>;
  debug?: {
    collectDayDiagnostics?: boolean;
    maxDayDiagnostics?: number;
    out?: PastSimulationDebug;
  };
  /**
   * Optional memory-saving mode for artifact-only rebuild flows that do not need
   * per-simulated-day payloads. Defaults to true for existing callers.
   */
  collectSimulatedDayResults?: boolean;
  /**
   * Optional cap for retained simulated-day payloads when collection is enabled.
   * Useful for lab diagnostics where we only need a bounded sample.
   */
  collectSimulatedDayResultsLimit?: number;
  /**
   * Optional local-day keys to retain in `dayResults` when collection is enabled.
   * Simulation still runs for all required days; this only narrows the retained payload.
   */
  collectSimulatedDayResultsDateKeys?: Set<string>;
  /**
   * Optional memory-saving mode: retain only scalar simulated-day metadata and
   * omit per-day interval arrays from `dayResults`.
   */
  compactSimulatedDayResults?: boolean;
  /**
   * Optional: force simulation for specific UTC date keys (`dateKeyFromTimestamp` for the grid day).
   * Forced-simulated days are excluded from reference-day selection (e.g. expanded selected-day forcing).
   */
  forceSimulateDateKeys?: Set<string>;
  /**
   * Gap-Fill Lab graded test days: same UTC keys as `forceSimulateDateKeys`, but **actual** intervals for
   * these days **remain** in the reference-day pool while **stitched output** is modeled via `simulatePastDay`
   * (same core as travel/vacant fills). Mutually exclusive use: do not duplicate keys in `forceSimulateDateKeys`.
   */
  forceModeledOutputKeepReferencePoolDateKeys?: Set<string>;
  modeledKeepRefReasonCode?: "TEST_MODELED_KEEP_REF" | "MONTHLY_CONSTRAINED_NON_TRAVEL_DAY" | "MANUAL_CONSTRAINED_DAY";
  defaultModeledReasonCode?: "INCOMPLETE_METER_DAY" | "MONTHLY_CONSTRAINED_NON_TRAVEL_DAY" | "MANUAL_CONSTRAINED_DAY";
  /**
   * Optional: when false, omit passthrough actual intervals for non-simulated days.
   * Useful for selected-day fresh compare scoring where only simulated-day intervals are needed.
   */
  emitAllIntervals?: boolean;
  /**
   * Optional: `ResolvedSimFingerprint` from `resolveSimFingerprint` — shapes how reference-interval
   * profile vs usage-shape merge participates in `PastDayProfileLite` (shared sim input contract).
   * `whole_home_only` replaces that merged/reference profile with a home/appliance-only synthetic
   * `PastDayProfileLite`, clears neighbor-day totals and usage-anchored training stats for day-total
   * selection, and uses synthetic uniform intraday shapes (no reference-interval shape aggregation).
   */
  resolvedSimFingerprint?: ResolvedSimFingerprint | null;
  modeledDaySelectionStrategy?: "calendar_first" | "weather_donor_first";
  lowDataSyntheticContext?: {
    mode: "MANUAL_TOTALS" | "NEW_BUILD_ESTIMATE";
    canonicalMonthKeys?: string[];
    intradayShape96?: number[] | null;
    weekdayWeekendShape96?: { weekday?: number[] | null; weekend?: number[] | null } | null;
    weatherEvidenceSummary?: import("@/modules/simulatedUsage/pastDaySimulatorTypes").PastDaySimulationContext["lowDataWeatherEvidence"];
  } | null;
  observability?: {
    correlationId?: string;
    houseId?: string;
    sourceHouseId?: string;
    userId?: string;
    buildPathKind?: string;
    source?: string;
  };
}): {
  intervals: Array<{ timestamp: string; kwh: number }>;
  dayResults: SimulatedDayResult[];
} {
  const forcedDateKeys = args.forceSimulateDateKeys ?? new Set<string>();
  const keepRefModeledKeys = args.forceModeledOutputKeepReferencePoolDateKeys ?? new Set<string>();
  const emitAllIntervals = args.emitAllIntervals !== false;
  const lowDataSyntheticContext = args.lowDataSyntheticContext ?? null;
  const useLowDataSyntheticContext = Boolean(lowDataSyntheticContext);
  const actualIntervalsInput = args.actualIntervals ?? [];
  const actualIntervals = useLowDataSyntheticContext ? [] : actualIntervalsInput;
  const suppressedActualIntervalPayloadCount = useLowDataSyntheticContext ? actualIntervalsInput.length : 0;
  const actualIntervalPayloadAttached = actualIntervals.length > 0;
  const observability = args.observability ?? null;
  const baselineStartedAt = Date.now();
  const emitStage = (
    event: string,
    extra: Record<string, string | number | boolean | null | undefined> = {}
  ) => {
    if (!observability?.correlationId) return;
    logSimPipelineEvent(event, {
      correlationId: observability.correlationId,
      houseId: observability.houseId,
      sourceHouseId: observability.sourceHouseId,
      userId: observability.userId,
      buildPathKind: observability.buildPathKind,
      source: observability.source ?? "buildPastSimulatedBaselineV1",
      lowDataSyntheticContextUsed: useLowDataSyntheticContext,
      lowDataSyntheticMode: lowDataSyntheticContext?.mode ?? null,
      canonicalDayCount: Array.isArray(args.canonicalDayStartsMs) ? args.canonicalDayStartsMs.length : 0,
      actualIntervalsCount: actualIntervals.length,
      intervalCount: 0,
      modeledDayCount: 0,
      memoryRssMb: getMemoryRssMb(),
      elapsedMs: Date.now() - baselineStartedAt,
      ...extra,
    });
  };
  emitStage("buildPastSimulatedBaselineV1_stage_entry", {
    actualIntervalPayloadAttached,
    suppressedActualIntervalPayloadCount,
  });
  if (useLowDataSyntheticContext) {
    emitStage("buildPastSimulatedBaselineV1_stage_low_data_branch_selected", {
      exactIntervalReferencePreparationSkipped: true,
      lowDataSummarizedSourceTruthUsed: true,
    });
  }
  const actualByTs = new Map<string, number>();
  let oldestActualTsMs = Number.POSITIVE_INFINITY;
  for (const p of actualIntervals) {
    const ts = String(p?.timestamp ?? "");
    if (!ts) continue;
    const ms = new Date(ts).getTime();
    if (Number.isFinite(ms) && ms < oldestActualTsMs) oldestActualTsMs = ms;
    actualByTs.set(ts, (actualByTs.get(ts) ?? 0) + (Number(p?.kwh) || 0));
  }

  const analyzeDay = (dayStartMs: number) => {
    const gridTs = args.getDayGridTimestamps(dayStartMs);
    const dateKey = gridTs.length > 0 ? args.dateKeyFromTimestamp(gridTs[0]) : "";
    const presentSlotCount = gridTs.reduce((acc, ts) => acc + (actualByTs.has(ts) ? 1 : 0), 0);
    const dayIsExcluded = Boolean(dateKey) && args.excludedDateKeys.has(dateKey);
    const dayIsForcedSimulate = Boolean(dateKey) && forcedDateKeys.has(dateKey);
    const dayIsForceModeledKeepRef = Boolean(dateKey) && keepRefModeledKeys.has(dateKey);
    const dayIsLeadingMissing =
      oldestActualTsMs !== Number.POSITIVE_INFINITY &&
      gridTs.length > 0 &&
      new Date(gridTs[0]).getTime() < oldestActualTsMs;
    const dayIsLowDataSyntheticModeled =
      useLowDataSyntheticContext &&
      !dayIsExcluded &&
      !dayIsLeadingMissing &&
      !dayIsForcedSimulate &&
      !dayIsForceModeledKeepRef;
    const dayIsIncomplete =
      !dayIsLowDataSyntheticModeled &&
      !dayIsExcluded &&
      !dayIsLeadingMissing &&
      presentSlotCount < INTERVALS_PER_DAY;
    const shouldSimulateDay =
      dayIsForcedSimulate ||
      dayIsExcluded ||
      dayIsLeadingMissing ||
      dayIsIncomplete ||
      dayIsForceModeledKeepRef ||
      dayIsLowDataSyntheticModeled;
    /** Reference pool: good at-home days only; excludes travel (forced elsewhere) and incomplete/leading; includes Gap-Fill test days (keep-ref modeled). */
    const isReferenceDayForPool =
      !dayIsForcedSimulate && !dayIsExcluded && !dayIsLeadingMissing && !dayIsIncomplete;
    return {
      gridTs,
      dateKey,
      presentSlotCount,
      dayIsForcedSimulate,
      dayIsForceModeledKeepRef,
      dayIsExcluded,
      dayIsLeadingMissing,
      dayIsLowDataSyntheticModeled,
      dayIsIncomplete,
      shouldSimulateDay,
      isReferenceDayForPool,
    };
  };

  const wholeHomeOnlyPrior = usesWholeHomeOnlyPrior(args.resolvedSimFingerprint);
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
  let excludedTravelVacantFingerprintDayCount = 0;
  let excludedIncompleteMeterFingerprintDayCount = 0;
  let excludedLeadingMissingFingerprintDayCount = 0;
  let excludedOtherUntrustedFingerprintDayCount = 0;
  const referencePrepStartedAt = Date.now();
  if (!wholeHomeOnlyPrior && !useLowDataSyntheticContext) {
    for (const dayStartMs of args.canonicalDayStartsMs ?? []) {
      if (!Number.isFinite(dayStartMs)) continue;
      const day = analyzeDay(dayStartMs);
      if (!day.gridTs.length || !day.dateKey) continue;
      if (!day.isReferenceDayForPool) {
        if (day.dayIsExcluded) excludedTravelVacantFingerprintDayCount += 1;
        else if (day.dayIsIncomplete) excludedIncompleteMeterFingerprintDayCount += 1;
        else if (day.dayIsLeadingMissing) excludedLeadingMissingFingerprintDayCount += 1;
        else if (day.dayIsForcedSimulate) excludedOtherUntrustedFingerprintDayCount += 1;
        continue;
      }

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
  }
  emitStage("buildPastSimulatedBaselineV1_stage_reference_pool_ready", {
    elapsedMs: Date.now() - referencePrepStartedAt,
    trustedReferenceDayCount: referenceDays.length,
    excludedTravelVacantFingerprintDayCount,
    excludedIncompleteMeterFingerprintDayCount,
    excludedLeadingMissingFingerprintDayCount,
    excludedOtherUntrustedFingerprintDayCount,
  });

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

  // Build shared past-day simulator context from reference days so simulated days use the same core as GapFill Lab.
  const weatherByDateKeyPast = new Map<string, PastDayWeatherFeatures>();
  const wxEntries = Array.from((args.actualWxByDateKey ?? new Map()).entries());
  for (const [dk, wx] of wxEntries) {
    const pf = engineWxToPastDayWeather(wx);
    if (pf) weatherByDateKeyPast.set(dk, pf);
  }
  const monthKeysRef = Array.from(new Set(referenceDays.map((d) => d.monthKey))).sort();
  const weekdayCountByMonthRef: Record<string, number> = {};
  const weekendCountByMonthRef: Record<string, number> = {};
  const monthOverallAvgByMonthRef: Record<string, number> = {};
  const monthOverallCountByMonthRef: Record<string, number> = {};
  for (const ym of monthKeysRef) {
    const inMonth = referenceDays.filter((d) => d.monthKey === ym);
    const weekdays = inMonth.filter((d) => d.dow >= 1 && d.dow <= 5);
    const weekends = inMonth.filter((d) => d.dow === 0 || d.dow === 6);
    weekdayCountByMonthRef[ym] = weekdays.length;
    weekendCountByMonthRef[ym] = weekends.length;
    monthOverallCountByMonthRef[ym] = inMonth.length;
    monthOverallAvgByMonthRef[ym] =
      inMonth.length > 0 ? inMonth.reduce((s, d) => s + d.total, 0) / inMonth.length : 0;
  }
  const avgKwhPerDayWeekdayByMonthRef = monthKeysRef.map(
    (ym) =>
      (weekdayCountByMonthRef[ym] > 0
        ? referenceDays
            .filter((d) => d.monthKey === ym && d.dow >= 1 && d.dow <= 5)
            .reduce((s, d) => s + d.total, 0) / weekdayCountByMonthRef[ym]
        : 0)
  );
  const avgKwhPerDayWeekendByMonthRef = monthKeysRef.map(
    (ym) =>
      (weekendCountByMonthRef[ym] > 0
        ? referenceDays
            .filter((d) => d.monthKey === ym && (d.dow === 0 || d.dow === 6))
            .reduce((s, d) => s + d.total, 0) / weekendCountByMonthRef[ym]
        : 0)
  );
  const pastProfile: PastDayProfileLite = {
    monthKeys: monthKeysRef,
    avgKwhPerDayWeekdayByMonth: avgKwhPerDayWeekdayByMonthRef,
    avgKwhPerDayWeekendByMonth: avgKwhPerDayWeekendByMonthRef,
    weekdayCountByMonth: weekdayCountByMonthRef,
    weekendCountByMonth: weekendCountByMonthRef,
    monthOverallAvgByMonth: monthOverallAvgByMonthRef,
    monthOverallCountByMonth: monthOverallCountByMonthRef,
  };

  const monthKeysFromCanonical = Array.from(
    new Set(
      (args.canonicalDayStartsMs ?? [])
        .filter((ms) => Number.isFinite(ms))
        .map((ms) => {
          const gridTs = args.getDayGridTimestamps(ms);
          return gridTs.length > 0 ? args.dateKeyFromTimestamp(gridTs[0]).slice(0, 7) : "";
        })
        .filter((k) => isYearMonth(k))
    )
  ).sort();

  // When usageShapeProfile is provided, merge it so excluded months get profile-based daily totals (then weather-scaled).
  // Otherwise months with few reference days (e.g. one day in March during travel) produce a flat repeated value.
  // Profile month keys are from the training window (e.g. 2024-03..2025-02); simulation may use 2025-03. Use same-calendar-month fallback.
  const MIN_DAYS_FOR_PROFILE_USE = 4;
  const profileMonthFallback = (ym: string, kind: "weekday" | "weekend"): number | undefined => {
    const map = kind === "weekday" ? args.usageShapeProfile?.weekdayAvgByMonthKey : args.usageShapeProfile?.weekendAvgByMonthKey;
    if (!map) return undefined;
    const exact = map[ym];
    if (exact != null && Number.isFinite(exact) && exact > 0) return exact;
    const monthPart = ym.slice(5, 7);
    const sameMonth = Object.entries(map).find(([k]) => k.slice(5, 7) === monthPart);
    const v = sameMonth?.[1];
    return v != null && Number.isFinite(v) && v > 0 ? v : undefined;
  };
  const rf = args.resolvedSimFingerprint ?? undefined;
  const skipUsageShapeMerge = usesWholeHomeOnlyPrior(rf);

  let finalProfile: PastDayProfileLite = pastProfile;
  let mergedFromUsageShape: PastDayProfileLite | null = null;
  if (
    !skipUsageShapeMerge &&
    (args.usageShapeProfile?.weekdayAvgByMonthKey || args.usageShapeProfile?.weekendAvgByMonthKey)
  ) {
    const fullMonthKeys = Array.from(new Set([...pastProfile.monthKeys, ...monthKeysFromCanonical])).sort();
    const wdByMonth: number[] = [];
    const weByMonth: number[] = [];
    const wdCount: Record<string, number> = {};
    const weCount: Record<string, number> = {};
    const monthOverallAvg: Record<string, number> = {};
    const monthOverallCount: Record<string, number> = {};
    for (let i = 0; i < fullMonthKeys.length; i++) {
      const ym = fullMonthKeys[i]!;
      const profileWd = profileMonthFallback(ym, "weekday");
      const profileWe = profileMonthFallback(ym, "weekend");
      const refIdx = pastProfile.monthKeys.indexOf(ym);
      const hasProfileValue =
        (profileWd != null && Number.isFinite(profileWd) && profileWd > 0) ||
        (profileWe != null && Number.isFinite(profileWe) && profileWe > 0);
      if (hasProfileValue) {
        wdByMonth[i] =
          profileWd != null && Number.isFinite(profileWd) && profileWd > 0
            ? profileWd
            : (refIdx >= 0 ? pastProfile.avgKwhPerDayWeekdayByMonth[refIdx] : 0) ?? 0;
        weByMonth[i] =
          profileWe != null && Number.isFinite(profileWe) && profileWe > 0
            ? profileWe
            : (refIdx >= 0 ? pastProfile.avgKwhPerDayWeekendByMonth[refIdx] : 0) ?? 0;
        const useWdCount = profileWd != null && Number.isFinite(profileWd) && profileWd > 0;
        const useWeCount = profileWe != null && Number.isFinite(profileWe) && profileWe > 0;
        wdCount[ym] = useWdCount ? MIN_DAYS_FOR_PROFILE_USE : (pastProfile.weekdayCountByMonth[ym] ?? 0);
        weCount[ym] = useWeCount ? MIN_DAYS_FOR_PROFILE_USE : (pastProfile.weekendCountByMonth[ym] ?? 0);
        monthOverallCount[ym] = wdCount[ym]! + weCount[ym]!;
        monthOverallAvg[ym] =
          monthOverallCount[ym]! > 0
            ? (wdByMonth[i]! * wdCount[ym]! + weByMonth[i]! * weCount[ym]!) / monthOverallCount[ym]!
            : 0;
      } else {
        wdByMonth[i] = refIdx >= 0 ? (pastProfile.avgKwhPerDayWeekdayByMonth[refIdx] ?? 0) : 0;
        weByMonth[i] = refIdx >= 0 ? (pastProfile.avgKwhPerDayWeekendByMonth[refIdx] ?? 0) : 0;
        wdCount[ym] = pastProfile.weekdayCountByMonth[ym] ?? 0;
        weCount[ym] = pastProfile.weekendCountByMonth[ym] ?? 0;
        monthOverallCount[ym] = pastProfile.monthOverallCountByMonth[ym] ?? 0;
        monthOverallAvg[ym] = pastProfile.monthOverallAvgByMonth[ym] ?? 0;
      }
    }
    finalProfile = {
      monthKeys: fullMonthKeys,
      avgKwhPerDayWeekdayByMonth: wdByMonth,
      avgKwhPerDayWeekendByMonth: weByMonth,
      weekdayCountByMonth: wdCount,
      weekendCountByMonth: weCount,
      monthOverallAvgByMonth: monthOverallAvg,
      monthOverallCountByMonth: monthOverallCount,
    };
    mergedFromUsageShape = finalProfile;
  }

  if (rf?.blendMode === "blended" && mergedFromUsageShape != null) {
    finalProfile = blendPastDayProfileLite(pastProfile, mergedFromUsageShape, rf.usageBlendWeight);
  }

  if (usesWholeHomeOnlyPrior(rf)) {
    const mk =
      monthKeysFromCanonical.length > 0 ? monthKeysFromCanonical : pastProfile.monthKeys;
    finalProfile = syntheticWholeHomePastDayProfileLite({
      monthKeys: mk,
      homeProfile: args.homeProfile,
      applianceProfile: args.applianceProfile,
    });
  }
  if (useLowDataSyntheticContext && lowDataSyntheticContext?.weatherEvidenceSummary) {
    finalProfile = applyLowDataWeatherEvidenceToProfile({
      profile: finalProfile,
      weatherEvidenceSummary: lowDataSyntheticContext.weatherEvidenceSummary,
    });
  }
  const lowDataSyntheticDayKwhByMonthDayType = useLowDataSyntheticContext
    ? buildLowDataSyntheticDayKwhByMonthDayType(finalProfile)
    : null;
  emitStage("buildPastSimulatedBaselineV1_stage_synthetic_day_targets_ready", {
    elapsedMs: Date.now() - baselineStartedAt,
    syntheticTargetMonthCount: lowDataSyntheticDayKwhByMonthDayType
      ? Object.keys(lowDataSyntheticDayKwhByMonthDayType).length
      : 0,
  });

  const trainingDayKwhByDate = new Map<string, number>();
  for (const d of referenceDays) trainingDayKwhByDate.set(d.dateKey, d.total);
  const isWeekendRef = (dateKey: string) => {
    const r = referenceDays.find((d) => d.dateKey === dateKey);
    return r ? r.dow === 0 || r.dow === 6 : false;
  };
  const trainingWeatherStatsPast =
    !useLowDataSyntheticContext && referenceDays.length > 0 && weatherByDateKeyPast.size > 0
      ? (buildTrainingWeatherStats({
          trainingDateKeys: referenceDays.map((d) => d.dateKey),
          trainingDayKwhByDate,
          weatherByDateKey: weatherByDateKeyPast as Map<string, DailyWeatherFeatures>,
          isWeekend: isWeekendRef,
        }) as unknown as PastDayTrainingWeatherStats)
      : null;
  const shapeByMonth96Ref: Record<string, number[]> = {};
  type ShapeAcc = { sum: number[]; count: number };
  type WeatherShapeAcc = Record<PastWeatherRegimeKey, ShapeAcc>;
  const makeShapeAcc = (): ShapeAcc => ({ sum: emptyShape96Array(), count: 0 });
  const makeWeatherShapeAcc = (): WeatherShapeAcc => ({
    heating: makeShapeAcc(),
    cooling: makeShapeAcc(),
    neutral: makeShapeAcc(),
  });
  const monthDayTypeAcc: Record<string, Record<PastDayTypeKey, ShapeAcc>> = {};
  const monthWeatherDayTypeAcc: Record<string, Record<PastDayTypeKey, WeatherShapeAcc>> = {};
  const weekdayWeekendAcc: Record<PastDayTypeKey, ShapeAcc> = {
    weekday: makeShapeAcc(),
    weekend: makeShapeAcc(),
  };
  const weekdayWeekendWeatherAcc: Record<PastDayTypeKey, WeatherShapeAcc> = {
    weekday: makeWeatherShapeAcc(),
    weekend: makeWeatherShapeAcc(),
  };
  const neighborDayTotals: PastNeighborDayTotals = { weekdayByMonth: {}, weekendByMonth: {} };
  const addShapeToAcc = (acc: ShapeAcc, shape: number[]) => {
    for (let i = 0; i < INTERVALS_PER_DAY; i++) acc.sum[i] += Number(shape[i]) || 0;
    acc.count += 1;
  };
  for (const d of referenceDays) {
    const dayType: PastDayTypeKey = d.dow === 0 || d.dow === 6 ? "weekend" : "weekday";
    const dom = Number(d.dateKey.slice(8, 10));
    if (Number.isFinite(dom) && dom >= 1 && dom <= 31) {
      const bucket = dayType === "weekend" ? neighborDayTotals.weekendByMonth : neighborDayTotals.weekdayByMonth;
      if (!bucket) continue;
      if (!bucket[d.monthKey]) bucket[d.monthKey] = [];
      bucket[d.monthKey]!.push({
        localDate: d.dateKey,
        dayOfMonth: dom,
        dayKwh: Number(d.total) || 0,
      });
    }
    const dayTotal = Number(d.total) || 0;
    if (dayTotal <= 0) continue;
    const dayShape = d.slotKwh.map((k) => Math.max(0, (Number(k) || 0) / dayTotal));
    const weatherRegime = weatherRegimeForShape(d.wx);
    if (!monthDayTypeAcc[d.monthKey]) {
      monthDayTypeAcc[d.monthKey] = { weekday: makeShapeAcc(), weekend: makeShapeAcc() };
    }
    if (!monthWeatherDayTypeAcc[d.monthKey]) {
      monthWeatherDayTypeAcc[d.monthKey] = { weekday: makeWeatherShapeAcc(), weekend: makeWeatherShapeAcc() };
    }
    addShapeToAcc(monthDayTypeAcc[d.monthKey]![dayType], dayShape);
    addShapeToAcc(monthWeatherDayTypeAcc[d.monthKey]![dayType][weatherRegime], dayShape);
    addShapeToAcc(weekdayWeekendAcc[dayType], dayShape);
    addShapeToAcc(weekdayWeekendWeatherAcc[dayType][weatherRegime], dayShape);
  }
  // Raw 15‑minute kWh vectors are only needed for shape aggregation above. Clearing them before
  // pastContext + the per-day simulation loop reduces peak heap on full-year windows (serverless OOM).
  for (const d of referenceDays) {
    d.slotKwh.length = 0;
  }
  const normalizedFromAcc = (acc: ShapeAcc): number[] | null =>
    acc.count > 0 ? normalizeShape96OrNull(acc.sum.map((v) => v / acc.count)) : null;
  const summarizeShapeToDayparts = (shape: number[] | null): Record<string, number> | null => {
    if (!Array.isArray(shape) || shape.length !== INTERVALS_PER_DAY) return null;
    const bucket = { overnight: 0, morning: 0, afternoon: 0, evening: 0 };
    for (let i = 0; i < shape.length; i++) {
      const hour = Math.floor(i / 4);
      const value = Number(shape[i]) || 0;
      if (hour < 6) bucket.overnight += value;
      else if (hour < 12) bucket.morning += value;
      else if (hour < 18) bucket.afternoon += value;
      else bucket.evening += value;
    }
    return bucket;
  };
  for (const ym of monthKeysRef) {
    const wd = monthDayTypeAcc[ym]?.weekday;
    const we = monthDayTypeAcc[ym]?.weekend;
    const monthSum = emptyShape96Array();
    const monthCount = (wd?.count ?? 0) + (we?.count ?? 0);
    if (wd?.count) for (let i = 0; i < INTERVALS_PER_DAY; i++) monthSum[i] += wd.sum[i];
    if (we?.count) for (let i = 0; i < INTERVALS_PER_DAY; i++) monthSum[i] += we.sum[i];
    const normalized =
      monthCount > 0 ? normalizeShape96OrNull(monthSum.map((v) => v / monthCount)) : null;
    if (normalized) shapeByMonth96Ref[ym] = normalized;
  }
  const shapeVariants: PastShapeVariants = {
    byMonth96: shapeByMonth96Ref,
    byMonthDayType96: {},
    byMonthWeatherDayType96: {},
    weekdayWeekend96: {},
    weekdayWeekendWeather96: {},
  };
  for (const ym of Object.keys(monthDayTypeAcc)) {
    const dayTypeBuckets: Record<PastDayTypeKey, number[] | null> = {
      weekday: normalizedFromAcc(monthDayTypeAcc[ym]!.weekday),
      weekend: normalizedFromAcc(monthDayTypeAcc[ym]!.weekend),
    };
    (shapeVariants.byMonthDayType96 as NonNullable<PastShapeVariants["byMonthDayType96"]>)[ym] = dayTypeBuckets;
    const weatherBuckets: any = { weekday: {}, weekend: {} };
    for (const dt of ["weekday", "weekend"] as const) {
      for (const regime of ["heating", "cooling", "neutral"] as const) {
        weatherBuckets[dt][regime] = normalizedFromAcc(monthWeatherDayTypeAcc[ym]![dt][regime]);
      }
    }
    (shapeVariants.byMonthWeatherDayType96 as NonNullable<PastShapeVariants["byMonthWeatherDayType96"]>)[ym] =
      weatherBuckets;
  }
  (shapeVariants.weekdayWeekend96 as any).weekday = normalizedFromAcc(weekdayWeekendAcc.weekday);
  (shapeVariants.weekdayWeekend96 as any).weekend = normalizedFromAcc(weekdayWeekendAcc.weekend);
  for (const dt of ["weekday", "weekend"] as const) {
    (shapeVariants.weekdayWeekendWeather96 as any)[dt] = {
      heating: normalizedFromAcc(weekdayWeekendWeatherAcc[dt].heating),
      cooling: normalizedFromAcc(weekdayWeekendWeatherAcc[dt].cooling),
      neutral: normalizedFromAcc(weekdayWeekendWeatherAcc[dt].neutral),
    };
  }
  const fingerprintMonthBucketsUsed = Object.keys(shapeVariants.byMonthDayType96 ?? {}).sort();
  const fingerprintWeekdayWeekendBucketsUsed = ["weekday", "weekend"].filter(
    (dt) =>
      normalizeShape96OrNull((shapeVariants.weekdayWeekend96 as Record<string, unknown> | null | undefined)?.[dt] as
        | number[]
        | undefined) != null
  );
  const fingerprintWeatherBucketsUsed = (["heating", "cooling", "neutral"] as const).filter((regime) =>
    ["weekday", "weekend"].some(
      (dt) =>
        normalizeShape96OrNull(
          ((shapeVariants.weekdayWeekendWeather96 as Record<string, any> | null | undefined)?.[dt] ?? {})[regime]
        ) != null
    )
  );
  const fingerprintShapeSummaryByMonthDayType = fingerprintMonthBucketsUsed.reduce<
    Record<string, Record<string, Record<string, number>>>
  >((acc, ym) => {
    const monthBucket = (shapeVariants.byMonthDayType96 as Record<string, any> | null | undefined)?.[ym] ?? {};
    const weekdaySummary = summarizeShapeToDayparts(normalizeShape96OrNull(monthBucket.weekday));
    const weekendSummary = summarizeShapeToDayparts(normalizeShape96OrNull(monthBucket.weekend));
    acc[ym] = {};
    if (weekdaySummary) acc[ym].weekday = weekdaySummary;
    if (weekendSummary) acc[ym].weekend = weekendSummary;
    return acc;
  }, {});
  const intervalUsageFingerprintIdentity =
    referenceDays.length > 0
      ? createHash("sha256")
          .update(
            JSON.stringify({
              version: "monthly_interval_usage_fingerprint_v1",
              referenceDays: referenceDays.map((day) => ({
                dateKey: day.dateKey,
                monthKey: day.monthKey,
                dow: day.dow,
                total: Number(day.total.toFixed(4)),
                wx: day.wx,
                hourlyWeights: day.hourlyWeights.map((value) => Number(value.toFixed(6))),
              })),
            }),
            "utf8"
          )
          .digest("base64url")
          .slice(0, 24)
      : null;
  const lowDataShapeMonthKeys =
    lowDataSyntheticContext?.canonicalMonthKeys && lowDataSyntheticContext.canonicalMonthKeys.length > 0
      ? lowDataSyntheticContext.canonicalMonthKeys
      : finalProfile.monthKeys.length > 0
        ? finalProfile.monthKeys
        : monthKeysFromCanonical;
  const shapeVariantsForContext = useLowDataSyntheticContext
    ? buildLowDataSyntheticShapeVariants({
        monthKeys: lowDataShapeMonthKeys,
        intradayShape96: lowDataSyntheticContext?.intradayShape96 ?? null,
        weekdayWeekendShape96: lowDataSyntheticContext?.weekdayWeekendShape96 ?? null,
      })
    : wholeHomeOnlyPrior
      ? syntheticWholeHomeShapeVariants(
          finalProfile.monthKeys.length > 0 ? finalProfile.monthKeys : monthKeysRef
        )
      : shapeVariants;
  const weatherDonorSamples: PastWeatherDonorSample[] = wholeHomeOnlyPrior || useLowDataSyntheticContext
    ? []
    : referenceDays
        .map((day) => {
          const wxRaw = args.actualWxByDateKey?.get(day.dateKey) ?? null;
          const weather = wxRaw ? engineWxToPastDayWeather(wxRaw) : null;
          if (!weather) return null;
          return {
            localDate: day.dateKey,
            monthKey: day.monthKey,
            dayType: day.dow === 0 || day.dow === 6 ? "weekend" : "weekday",
            weatherRegime: weatherRegimeForShape(day.wx),
            dayKwh: day.total,
            dailyAvgTempC: weather.dailyAvgTempC,
            dailyMinTempC: weather.dailyMinTempC,
            dailyMaxTempC: weather.dailyMaxTempC,
            tempSpreadC:
              weather.dailyMinTempC != null && weather.dailyMaxTempC != null
                ? weather.dailyMaxTempC - weather.dailyMinTempC
                : null,
            heatingDegreeSeverity: weather.heatingDegreeSeverity,
            coolingDegreeSeverity: weather.coolingDegreeSeverity,
          } satisfies PastWeatherDonorSample;
        })
        .filter((sample): sample is PastWeatherDonorSample => sample != null);
  const pastContext = buildPastDaySimulationContext({
    profile: finalProfile,
    trainingWeatherStats: wholeHomeOnlyPrior || useLowDataSyntheticContext ? null : trainingWeatherStatsPast,
    weatherByDateKey: weatherByDateKeyPast,
    neighborDayTotals: wholeHomeOnlyPrior || useLowDataSyntheticContext ? null : neighborDayTotals,
    weatherDonorSamples: wholeHomeOnlyPrior || useLowDataSyntheticContext ? null : weatherDonorSamples,
    modeledDaySelectionStrategy: args.modeledDaySelectionStrategy ?? "calendar_first",
    shapeVariants: shapeVariantsForContext,
    lowDataSyntheticDayKwhByMonthDayType,
    lowDataWeatherEvidence: lowDataSyntheticContext?.weatherEvidenceSummary ?? null,
  });
  emitStage("buildPastSimulatedBaselineV1_stage_shape_context_ready", {
    elapsedMs: Date.now() - baselineStartedAt,
    shapeMonthCount: lowDataShapeMonthKeys.length,
    weatherDonorSampleCount: weatherDonorSamples.length,
  });

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
  const collectSimulatedDayResults = args.collectSimulatedDayResults !== false;
  const compactSimulatedDayResults = args.compactSimulatedDayResults === true;
  const collectSimulatedDayResultsLimitRaw = Number(args.collectSimulatedDayResultsLimit);
  const collectSimulatedDayResultsLimit =
    Number.isFinite(collectSimulatedDayResultsLimitRaw) && collectSimulatedDayResultsLimitRaw >= 0
      ? Math.floor(collectSimulatedDayResultsLimitRaw)
      : Number.POSITIVE_INFINITY;
  const collectSimulatedDayResultsDateKeys = args.collectSimulatedDayResultsDateKeys;
  const dayResults: SimulatedDayResult[] = [];
  let totalDays = 0;
  let excludedDays = 0;
  let leadingMissingDays = 0;
  let simulatedDays = 0;
  const collectDayDiagnostics = Boolean(args.debug?.collectDayDiagnostics);
  const maxDayDiagnostics = Math.max(0, Number(args.debug?.maxDayDiagnostics ?? 0) || 0);
  const dayDiagnostics: PastSimulatedDayDiagnostic[] = [];
  const legacyShapeByMonth96ForPastDay = wholeHomeOnlyPrior ? {} : shapeByMonth96Ref;
  const modeledKeepRefReasonCode = args.modeledKeepRefReasonCode ?? "TEST_MODELED_KEEP_REF";
  const defaultModeledReasonCode = args.defaultModeledReasonCode ?? "INCOMPLETE_METER_DAY";
  const selectedReferencePoolCountForVariant = (
    shapeVariantUsed: string,
    monthKey: string,
    dayType: PastDayTypeKey,
    weatherRegime: PastWeatherRegimeKey
  ): number | null => {
    if (useLowDataSyntheticContext) return null;
    if (shapeVariantUsed.startsWith("month_") && shapeVariantUsed.includes("_weather_")) {
      return monthWeatherDayTypeAcc[monthKey]?.[dayType]?.[weatherRegime]?.count ?? null;
    }
    if (shapeVariantUsed.startsWith("month_")) {
      return monthDayTypeAcc[monthKey]?.[dayType]?.count ?? null;
    }
    if (shapeVariantUsed === "month") {
      return (monthDayTypeAcc[monthKey]?.weekday?.count ?? 0) + (monthDayTypeAcc[monthKey]?.weekend?.count ?? 0);
    }
    if (shapeVariantUsed.startsWith("weekdayweekend_weather_")) {
      return weekdayWeekendWeatherAcc[dayType]?.[weatherRegime]?.count ?? null;
    }
    if (shapeVariantUsed.startsWith("weekdayweekend_")) {
      return weekdayWeekendAcc[dayType]?.count ?? null;
    }
    return referenceDays.length;
  };
  const perDayLoopStartedAt = Date.now();
  emitStage("buildPastSimulatedBaselineV1_stage_per_day_loop_start", {
    modeledDayCount: 0,
    intervalCount: out.length,
  });
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
      const simulatedReason:
        | "EXCLUDED"
        | "LEADING_MISSING"
        | "LOW_DATA_CONSTRAINED"
        | "INCOMPLETE"
        | "FORCED_SELECTED_DAY"
        | "GAPFILL_MODELED_KEEP_REF" =
        day.dayIsForceModeledKeepRef
          ? "GAPFILL_MODELED_KEEP_REF"
          : day.dayIsForcedSimulate
            ? "FORCED_SELECTED_DAY"
            : day.dayIsExcluded
              ? "EXCLUDED"
              : day.dayIsLeadingMissing
                ? "LEADING_MISSING"
                : day.dayIsLowDataSyntheticModeled
                  ? "LOW_DATA_CONSTRAINED"
                : "INCOMPLETE";
      const simulatedReasonCode:
        | "TRAVEL_VACANT"
        | "TEST_MODELED_KEEP_REF"
        | "MANUAL_CONSTRAINED_DAY"
        | "MONTHLY_CONSTRAINED_NON_TRAVEL_DAY"
        | "FORCED_SELECTED_DAY"
        | "INCOMPLETE_METER_DAY"
        | "LEADING_MISSING_DAY" =
        simulatedReason === "EXCLUDED"
          ? "TRAVEL_VACANT"
          : simulatedReason === "GAPFILL_MODELED_KEEP_REF"
            ? modeledKeepRefReasonCode
            : simulatedReason === "LOW_DATA_CONSTRAINED"
              ? modeledKeepRefReasonCode
            : simulatedReason === "FORCED_SELECTED_DAY"
              ? "FORCED_SELECTED_DAY"
              : simulatedReason === "LEADING_MISSING"
                ? "LEADING_MISSING_DAY"
                : defaultModeledReasonCode;
      const wx = args.actualWxByDateKey?.get(dateKey) ?? null;
      const weatherForDay = wx ? engineWxToPastDayWeather(wx) : null;
      // One shared core for all modeled-day reasons (travel, incomplete, forced, keep-ref modeled).
      const result = simulatePastDay(
        {
          localDate: dateKey,
          isWeekend: dow === 0 || dow === 6,
          gridTimestamps: gridTs,
          weatherForDay,
        },
        pastContext,
        args.homeProfile as import("@/modules/simulatedUsage/pastDaySimulatorTypes").PastDayHomeProfile | null,
        args.applianceProfile as import("@/modules/simulatedUsage/pastDaySimulatorTypes").PastDayApplianceProfile | null,
        legacyShapeByMonth96ForPastDay
      );
      const blendedResult =
        day.dayIsIncomplete
          ? (() => {
              const blendedIntervals = result.intervals.map((iv) => {
                if (actualByTs.has(iv.timestamp)) {
                  return { timestamp: iv.timestamp, kwh: Number(actualByTs.get(iv.timestamp) ?? 0) || 0 };
                }
                return iv;
              });
              const blendedIntervals15 = blendedIntervals.map((iv) => Number(iv.kwh) || 0);
              const blendedSum = blendedIntervals15.reduce((a, b) => a + b, 0);
              return {
                ...result,
                intervals: blendedIntervals,
                intervals15: blendedIntervals15,
                intervalSumKwh: blendedSum,
                displayDayKwh: Number(blendedSum.toFixed(2)),
                finalDayKwh: blendedSum,
              };
            })()
          : result;
      const retainDayResult =
        !collectSimulatedDayResultsDateKeys ||
        collectSimulatedDayResultsDateKeys.has(dateKey);
      const classifiedResult: SimulatedDayResult = {
        ...blendedResult,
        simulatedReasonCode,
        templateSelectionKind:
          simulatedReasonCode === "TRAVEL_VACANT"
            ? "travel_vacant_shared_day_template"
            : simulatedReasonCode === "MONTHLY_CONSTRAINED_NON_TRAVEL_DAY" || simulatedReasonCode === "MANUAL_CONSTRAINED_DAY"
              ? "monthly_manual_constrained_shared_day_template"
              : simulatedReasonCode === "TEST_MODELED_KEEP_REF"
                ? "validation_keep_ref_shared_day_template"
                : "shared_day_template",
        selectedFingerprintBucketMonth: blendedResult.selectedFingerprintBucketMonth ?? ym,
        selectedFingerprintBucketDayType: blendedResult.dayTypeUsed,
        selectedFingerprintWeatherBucket: blendedResult.weatherRegimeUsed,
        selectedFingerprintIdentity: intervalUsageFingerprintIdentity ?? undefined,
        selectedReferencePoolCount:
          blendedResult.dayTypeUsed && blendedResult.weatherRegimeUsed
            ? selectedReferencePoolCountForVariant(
                blendedResult.shapeVariantUsed ?? "uniform_fallback",
                blendedResult.selectedFingerprintBucketMonth ?? ym,
                blendedResult.dayTypeUsed,
                blendedResult.weatherRegimeUsed
              ) ?? undefined
            : undefined,
        weatherScalingCoefficientUsed: blendedResult.weatherSeverityMultiplier,
        dayTotalBeforeWeatherScale: blendedResult.targetDayKwhBeforeWeather,
        dayTotalAfterWeatherScale: blendedResult.weatherAdjustedDayKwh,
        intervalShapeScalingMethod: `shape_variant:${blendedResult.shapeVariantUsed ?? "uniform_fallback"}`,
      };
      if (collectSimulatedDayResults && retainDayResult && dayResults.length < collectSimulatedDayResultsLimit) {
        dayResults.push(
          compactSimulatedDayResults
            ? ({
                localDate: classifiedResult.localDate,
                source: classifiedResult.source,
                simulatedReasonCode: classifiedResult.simulatedReasonCode,
                intervalSumKwh: classifiedResult.intervalSumKwh,
                displayDayKwh: classifiedResult.displayDayKwh,
                rawDayKwh: classifiedResult.rawDayKwh,
                weatherAdjustedDayKwh: classifiedResult.weatherAdjustedDayKwh,
                profileSelectedDayKwh: classifiedResult.profileSelectedDayKwh,
                finalDayKwh: classifiedResult.finalDayKwh,
                weatherSeverityMultiplier: classifiedResult.weatherSeverityMultiplier,
                weatherModeUsed: classifiedResult.weatherModeUsed,
                auxHeatKwhAdder: classifiedResult.auxHeatKwhAdder,
                poolFreezeProtectKwhAdder: classifiedResult.poolFreezeProtectKwhAdder,
                dayClassification: classifiedResult.dayClassification,
                fallbackLevel: classifiedResult.fallbackLevel,
                clampApplied: classifiedResult.clampApplied,
                dayTypeUsed: classifiedResult.dayTypeUsed,
                shapeVariantUsed: classifiedResult.shapeVariantUsed,
                weatherRegimeUsed: classifiedResult.weatherRegimeUsed,
                targetDayKwhBeforeWeather: classifiedResult.targetDayKwhBeforeWeather,
                donorSelectionModeUsed: classifiedResult.donorSelectionModeUsed,
                donorCandidatePoolSize: classifiedResult.donorCandidatePoolSize,
                selectedDonorLocalDates: classifiedResult.selectedDonorLocalDates,
                selectedDonorWeights: classifiedResult.selectedDonorWeights,
                donorWeatherRegimeUsed: classifiedResult.donorWeatherRegimeUsed,
                donorMonthKeyUsed: classifiedResult.donorMonthKeyUsed,
                thermalDistanceScore: classifiedResult.thermalDistanceScore,
                broadFallbackUsed: classifiedResult.broadFallbackUsed,
                sameRegimeDonorPoolAvailable: classifiedResult.sameRegimeDonorPoolAvailable,
                donorPoolBlendStrategy: classifiedResult.donorPoolBlendStrategy,
                donorPoolKwhSpread: classifiedResult.donorPoolKwhSpread,
                donorPoolKwhVariance: classifiedResult.donorPoolKwhVariance,
                donorPoolMedianKwh: classifiedResult.donorPoolMedianKwh,
                donorVarianceGuardrailTriggered: classifiedResult.donorVarianceGuardrailTriggered,
                weatherAdjustmentModeUsed: classifiedResult.weatherAdjustmentModeUsed,
                postDonorAdjustmentCoefficient: classifiedResult.postDonorAdjustmentCoefficient,
                templateSelectionKind: classifiedResult.templateSelectionKind,
                selectedFingerprintBucketMonth: classifiedResult.selectedFingerprintBucketMonth,
                selectedFingerprintBucketDayType: classifiedResult.selectedFingerprintBucketDayType,
                selectedFingerprintWeatherBucket: classifiedResult.selectedFingerprintWeatherBucket,
                selectedFingerprintIdentity: classifiedResult.selectedFingerprintIdentity,
                selectedReferencePoolCount: classifiedResult.selectedReferencePoolCount,
                weatherScalingCoefficientUsed: classifiedResult.weatherScalingCoefficientUsed,
                dayTotalBeforeWeatherScale: classifiedResult.dayTotalBeforeWeatherScale,
                dayTotalAfterWeatherScale: classifiedResult.dayTotalAfterWeatherScale,
                intervalShapeScalingMethod: classifiedResult.intervalShapeScalingMethod,
              } as SimulatedDayResult)
            : classifiedResult
        );
      }
      for (const iv of classifiedResult.intervals) out.push(iv);
      const mappedFallback = pastDayFallbackToEngineLevel(classifiedResult.fallbackLevel);
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
          hourFallbackLevel: mappedFallback,
          totalFallbackLevel: mappedFallback,
          referenceCandidateCount: classifiedResult.donorCandidatePoolSize ?? 0,
          referencePickedCount: classifiedResult.selectedDonorLocalDates?.length ?? 0,
          weatherDistanceAvg: classifiedResult.thermalDistanceScore ?? null,
          poolApplied: classifiedResult.poolFreezeProtectKwhAdder > 0,
          poolKwh: classifiedResult.poolFreezeProtectKwhAdder > 0 ? classifiedResult.poolFreezeProtectKwhAdder : 0,
          baseNonHvacKwh: classifiedResult.profileSelectedDayKwh,
          hvacKwh: classifiedResult.auxHeatKwhAdder,
          targetTotalKwh: classifiedResult.finalDayKwh,
          sourceOfDaySimulationCore: SOURCE_OF_DAY_SIMULATION_CORE,
          rawDayKwh: classifiedResult.rawDayKwh,
          targetDayKwhBeforeWeather: classifiedResult.targetDayKwhBeforeWeather ?? classifiedResult.rawDayKwh,
          weatherAdjustedDayKwh: classifiedResult.weatherAdjustedDayKwh,
          dayTypeUsed: classifiedResult.dayTypeUsed ?? (dow === 0 || dow === 6 ? "weekend" : "weekday"),
          shapeVariantUsed: classifiedResult.shapeVariantUsed ?? null,
          finalDayKwh: classifiedResult.finalDayKwh,
          displayDayKwh: classifiedResult.displayDayKwh,
          intervalSumKwh: classifiedResult.intervalSumKwh,
          donorSelectionModeUsed: classifiedResult.donorSelectionModeUsed ?? null,
          donorCandidatePoolSize: classifiedResult.donorCandidatePoolSize ?? null,
          selectedDonorLocalDates: classifiedResult.selectedDonorLocalDates ?? null,
          selectedDonorWeights:
            classifiedResult.selectedDonorWeights?.map((entry) => ({
              localDate: entry.localDate,
              weight: entry.weight,
              distance: entry.distance,
              dayKwh: entry.dayKwh,
            })) ?? null,
          donorWeatherRegimeUsed: classifiedResult.donorWeatherRegimeUsed ?? null,
          donorMonthKeyUsed: classifiedResult.donorMonthKeyUsed ?? null,
          thermalDistanceScore: classifiedResult.thermalDistanceScore ?? null,
          broadFallbackUsed: classifiedResult.broadFallbackUsed ?? null,
          sameRegimeDonorPoolAvailable: classifiedResult.sameRegimeDonorPoolAvailable ?? null,
          donorPoolBlendStrategy: classifiedResult.donorPoolBlendStrategy ?? null,
          donorPoolKwhSpread: classifiedResult.donorPoolKwhSpread ?? null,
          donorPoolKwhVariance: classifiedResult.donorPoolKwhVariance ?? null,
          donorPoolMedianKwh: classifiedResult.donorPoolMedianKwh ?? null,
          donorVarianceGuardrailTriggered: classifiedResult.donorVarianceGuardrailTriggered ?? null,
          weatherAdjustmentModeUsed: classifiedResult.weatherAdjustmentModeUsed ?? null,
          postDonorAdjustmentCoefficient: classifiedResult.postDonorAdjustmentCoefficient ?? null,
        });
      }
    } else {
      if (emitAllIntervals) {
        for (let i = 0; i < INTERVALS_PER_DAY; i++) {
          const ts = gridTs[i];
          out.push({ timestamp: ts, kwh: Number(actualByTs.get(ts) ?? 0) || 0 });
        }
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
          poolApplied: false,
          poolKwh: null,
          baseNonHvacKwh: null,
          hvacKwh: null,
          targetTotalKwh: null,
          targetDayKwhBeforeWeather: null,
          dayTypeUsed: null,
          shapeVariantUsed: null,
        });
      }
    }
  }
  emitStage("buildPastSimulatedBaselineV1_stage_per_day_loop_success", {
    elapsedMs: Date.now() - perDayLoopStartedAt,
    modeledDayCount: simulatedDays,
    intervalCount: out.length,
  });

  if (args.debug?.out) {
    args.debug.out.totalDays = totalDays;
    args.debug.out.excludedDays = excludedDays;
    args.debug.out.leadingMissingDays = leadingMissingDays;
    args.debug.out.referenceDaysUsed = referenceDays.length;
    args.debug.out.simulatedDays = simulatedDays;
    args.debug.out.lowDataSyntheticContextUsed = useLowDataSyntheticContext;
    args.debug.out.lowDataSyntheticMode = lowDataSyntheticContext?.mode ?? null;
    args.debug.out.actualBackedReferencePoolUsed = !useLowDataSyntheticContext && !wholeHomeOnlyPrior;
    args.debug.out.actualIntervalPayloadAttached = actualIntervalPayloadAttached;
    args.debug.out.actualIntervalPayloadCount = actualIntervals.length;
    args.debug.out.suppressedActualIntervalPayloadCount = suppressedActualIntervalPayloadCount;
    args.debug.out.exactIntervalReferencePreparationSkipped = useLowDataSyntheticContext;
    args.debug.out.lowDataSummarizedSourceTruthUsed = useLowDataSyntheticContext;
    args.debug.out.intervalUsageFingerprintIdentity = intervalUsageFingerprintIdentity ?? undefined;
    args.debug.out.trustedIntervalFingerprintDayCount = referenceDays.length;
    args.debug.out.excludedTravelVacantFingerprintDayCount = excludedTravelVacantFingerprintDayCount;
    args.debug.out.excludedIncompleteMeterFingerprintDayCount = excludedIncompleteMeterFingerprintDayCount;
    args.debug.out.excludedLeadingMissingFingerprintDayCount = excludedLeadingMissingFingerprintDayCount;
    args.debug.out.excludedOtherUntrustedFingerprintDayCount = excludedOtherUntrustedFingerprintDayCount;
    args.debug.out.fingerprintMonthBucketsUsed = fingerprintMonthBucketsUsed;
    args.debug.out.fingerprintWeekdayWeekendBucketsUsed = fingerprintWeekdayWeekendBucketsUsed;
    args.debug.out.fingerprintWeatherBucketsUsed = fingerprintWeatherBucketsUsed;
    args.debug.out.fingerprintShapeSummaryByMonthDayType = fingerprintShapeSummaryByMonthDayType;
    args.debug.out.dayDiagnostics = dayDiagnostics;
    (args.debug.out as Record<string, unknown>).sourceOfDaySimulationCore = SOURCE_OF_DAY_SIMULATION_CORE;
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
        lowDataSyntheticContextUsed: useLowDataSyntheticContext,
        lowDataSyntheticMode: lowDataSyntheticContext?.mode ?? null,
      })
    );
  }

  actualByTs.clear();
  // `canonicalDayStartsMs` and each per-day grid are emitted in chronological order,
  // so re-sorting the full stitched interval list only burns CPU on large annual runs.
  emitStage("buildPastSimulatedBaselineV1_stage_success", {
    intervalCount: out.length,
    modeledDayCount: simulatedDays,
    totalDayCount: totalDays,
  });
  return { intervals: out, dayResults };
}

// Future stubs (do not implement yet)
export type UsagePatch = { start: string; end: string; reason: string };
export function applyScenarioDeltasStub() {
  throw new Error("not_implemented");
}