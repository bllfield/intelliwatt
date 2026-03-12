/**
 * Derives a UsageShapeProfile from actual 15-min intervals (canonical 12-month window).
 * All time-of-day indexing is in local time (timezone).
 * Baseload: bottom 10% of intervals by kwh (documented in configHash).
 */

import { dateTimePartsInTimezone } from "@/lib/time/chicago";

const SLOTS_PER_DAY = 96;
const HOURS_OVERNIGHT = [0, 1, 2, 3, 4, 5];   // 12am–6am
const HOURS_MORNING = [6, 7, 8, 9, 10, 11];   // 6am–12pm
const HOURS_AFTERNOON = [12, 13, 14, 15, 16, 17]; // 12pm–6pm
const HOURS_EVENING = [18, 19, 20, 21, 22, 23];   // 6pm–12am
const BASELOAD_PERCENTILE = 0.1;
const P95_PERCENTILE = 0.95;
const PROFILE_VERSION = "v1";
const CONFIG_BASELOAD = "baseload_bottom10pct";

export type IntervalInput = { tsUtc: string; kwh: number };

export type TimeOfDayShares = {
  overnight: number;
  morning: number;
  afternoon: number;
  evening: number;
};

export type DerivedUsageShapeProfile = {
  windowStartUtc: string;
  windowEndUtc: string;
  baseloadKwhPer15m: number | null;
  baseloadKwhPerDay: number | null;
  shapeAll96: number[];
  shapeWeekday96: number[];
  shapeWeekend96: number[];
  shapeByMonth96: Record<string, number[]>; // YYYY-MM -> 96
  avgKwhPerDayWeekdayByMonth: number[];     // 12, Jan=0
  avgKwhPerDayWeekendByMonth: number[];
  peakHourByMonth: number[];                // 12, 0-23
  p95KwByMonth: number[];
  timeOfDayShares: TimeOfDayShares;
  configHash: string;
};

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function percentile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo] ?? null;
  const w = idx - lo;
  return (sorted[lo] ?? 0) * (1 - w) + (sorted[hi] ?? 0) * w;
}

export function deriveUsageShapeProfile(
  intervals: IntervalInput[],
  timezone: string,
  windowStartUtc: string,
  windowEndUtc: string
): DerivedUsageShapeProfile {
  const tz = timezone || "America/Chicago";
  const rows = intervals
    .map((r) => ({ ...r, kwh: Number(r.kwh) || 0 }))
    .filter((r) => Number.isFinite(r.kwh) && r.tsUtc);

  const slotSumsAll = new Array(SLOTS_PER_DAY).fill(0);
  const slotCountsAll = new Array(SLOTS_PER_DAY).fill(0);
  const slotSumsWeekday = new Array(SLOTS_PER_DAY).fill(0);
  const slotCountsWeekday = new Array(SLOTS_PER_DAY).fill(0);
  const slotSumsWeekend = new Array(SLOTS_PER_DAY).fill(0);
  const slotCountsWeekend = new Array(SLOTS_PER_DAY).fill(0);

  const byMonth: Record<string, { sums: number[]; counts: number[] }> = {};
  const kwhByCalendarMonthWeekday: number[][] = Array.from({ length: 12 }, () => []);
  const kwhByCalendarMonthWeekend: number[][] = Array.from({ length: 12 }, () => []);
  const kwByCalendarMonth: number[][] = Array.from({ length: 12 }, () => []);
  const hourKwByCalendarMonth: Array<Record<number, number[]>> = Array.from({ length: 12 }, () => ({}));

  let totalKwh = 0;
  const overnight: number[] = [];
  const morning: number[] = [];
  const afternoon: number[] = [];
  const evening: number[] = [];

  for (const r of rows) {
    const local = dateTimePartsInTimezone(r.tsUtc, tz);
    if (!local) continue;
    const slot = Math.min(95, local.hour * 4 + Math.floor(local.minute / 15));
    const month = local.yearMonth;
    const hour = local.hour;
    const calendarMonthIndex = Math.max(0, Math.min(11, local.month - 1));
    const kw = r.kwh * 4;

    slotSumsAll[slot] += r.kwh;
    slotCountsAll[slot]++;
    totalKwh += r.kwh;
    if (local.weekdayIndex >= 1 && local.weekdayIndex <= 5) {
      slotSumsWeekday[slot] += r.kwh;
      slotCountsWeekday[slot]++;
      kwhByCalendarMonthWeekday[calendarMonthIndex].push(r.kwh);
    } else {
      slotSumsWeekend[slot] += r.kwh;
      slotCountsWeekend[slot]++;
      kwhByCalendarMonthWeekend[calendarMonthIndex].push(r.kwh);
    }
    if (!byMonth[month]) byMonth[month] = { sums: new Array(SLOTS_PER_DAY).fill(0), counts: new Array(SLOTS_PER_DAY).fill(0) };
    byMonth[month].sums[slot] += r.kwh;
    byMonth[month].counts[slot]++;
    kwByCalendarMonth[calendarMonthIndex].push(kw);
    if (!hourKwByCalendarMonth[calendarMonthIndex][hour]) hourKwByCalendarMonth[calendarMonthIndex][hour] = [];
    hourKwByCalendarMonth[calendarMonthIndex][hour].push(kw);
    if (HOURS_OVERNIGHT.includes(hour)) overnight.push(r.kwh);
    else if (HOURS_MORNING.includes(hour)) morning.push(r.kwh);
    else if (HOURS_AFTERNOON.includes(hour)) afternoon.push(r.kwh);
    else if (HOURS_EVENING.includes(hour)) evening.push(r.kwh);
  }

  const shapeAll96 = slotSumsAll.map((s, i) => (slotCountsAll[i] ? round4(s / slotCountsAll[i]) : 0));
  const shapeWeekday96 = slotSumsWeekday.map((s, i) => (slotCountsWeekday[i] ? round4(s / slotCountsWeekday[i]) : 0));
  const shapeWeekend96 = slotSumsWeekend.map((s, i) => (slotCountsWeekend[i] ? round4(s / slotCountsWeekend[i]) : 0));

  const sortedKwh = rows.map((r) => r.kwh).filter((k) => k > 0).sort((a, b) => a - b);
  const baseloadKwhPer15m = percentile(sortedKwh, BASELOAD_PERCENTILE);
  const baseloadKwhPerDay = baseloadKwhPer15m != null ? round4(baseloadKwhPer15m * 96) : null;

  const monthsOrder = Object.keys(byMonth).sort();
  const shapeByMonth96: Record<string, number[]> = {};
  for (const m of monthsOrder) {
    shapeByMonth96[m] = byMonth[m].sums.map((s, i) => (byMonth[m].counts[i] ? round4(s / byMonth[m].counts[i]) : 0));
  }

  const avgKwhPerDayWeekdayByMonth: number[] = [];
  const avgKwhPerDayWeekendByMonth: number[] = [];
  const peakHourByMonth: number[] = [];
  const p95KwByMonth: number[] = [];
  for (let i = 0; i < 12; i++) {
    const wd = kwhByCalendarMonthWeekday[i];
    const we = kwhByCalendarMonthWeekend[i];
    const sumWd = wd?.reduce((a, b) => a + b, 0) ?? 0;
    const sumWe = we?.reduce((a, b) => a + b, 0) ?? 0;
    avgKwhPerDayWeekdayByMonth.push(wd?.length ? round4((sumWd * SLOTS_PER_DAY) / wd.length) : 0);
    avgKwhPerDayWeekendByMonth.push(we?.length ? round4((sumWe * SLOTS_PER_DAY) / we.length) : 0);
    const kws = kwByCalendarMonth[i];
    p95KwByMonth.push(kws?.length ? (percentile([...kws].sort((a, b) => a - b), P95_PERCENTILE) ?? 0) : 0);
    const hourMeans = hourKwByCalendarMonth[i];
    let peakH = 0;
    let maxMean = 0;
    if (hourMeans) {
      for (let h = 0; h < 24; h++) {
        const arr = hourMeans[h];
        if (arr?.length) {
          const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
          if (mean > maxMean) {
            maxMean = mean;
            peakH = h;
          }
        }
      }
    }
    peakHourByMonth.push(peakH);
  }

  const sumO = overnight.reduce((a, b) => a + b, 0);
  const sumM = morning.reduce((a, b) => a + b, 0);
  const sumA = afternoon.reduce((a, b) => a + b, 0);
  const sumE = evening.reduce((a, b) => a + b, 0);
  const totalShare = sumO + sumM + sumA + sumE || 1;
  const timeOfDayShares: TimeOfDayShares = {
    overnight: round4(sumO / totalShare),
    morning: round4(sumM / totalShare),
    afternoon: round4(sumA / totalShare),
    evening: round4(sumE / totalShare),
  };

  const configHash = `${PROFILE_VERSION}_${CONFIG_BASELOAD}_tz_${tz.replace(/\//g, "_")}`;

  return {
    windowStartUtc,
    windowEndUtc,
    baseloadKwhPer15m: baseloadKwhPer15m ?? null,
    baseloadKwhPerDay,
    shapeAll96,
    shapeWeekday96,
    shapeWeekend96,
    shapeByMonth96,
    avgKwhPerDayWeekdayByMonth,
    avgKwhPerDayWeekendByMonth,
    peakHourByMonth,
    p95KwByMonth,
    timeOfDayShares,
    configHash,
  };
}
