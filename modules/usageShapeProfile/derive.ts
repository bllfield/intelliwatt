/**
 * Derives a UsageShapeProfile from actual 15-min intervals (canonical 12-month window).
 * All time-of-day indexing is in local time (timezone).
 * Baseload: bottom 10% of intervals by kwh (documented in configHash).
 */

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

function getLocalSlot(tsIso: string, timezone: string): number {
  const d = new Date(tsIso);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(d);
  const hour = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
  const minute = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);
  return Math.min(95, hour * 4 + Math.floor(minute / 15));
}

function getLocalMonth(tsIso: string, timezone: string): string {
  const d = new Date(tsIso);
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit" })
    .format(d)
    .replace(/\//g, "-");
}

function getLocalDateKey(tsIso: string, timezone: string): string {
  const d = new Date(tsIso);
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" })
    .format(d)
    .replace(/\//g, "-");
}

function getLocalHour(tsIso: string, timezone: string): number {
  const d = new Date(tsIso);
  const hour = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, hour: "numeric", hour12: false }).format(d);
  return parseInt(hour, 10) || 0;
}

/** 0 = Sunday, 6 = Saturday. Weekday = 1-5. */
function getLocalDayOfWeek(tsIso: string, timezone: string): number {
  const d = new Date(tsIso);
  const dow = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, weekday: "short" }).format(d);
  const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return map[dow] ?? 0;
}

function isWeekday(tsIso: string, timezone: string): boolean {
  const dow = getLocalDayOfWeek(tsIso, timezone);
  return dow >= 1 && dow <= 5;
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
  const kwhByMonthWeekday: Record<string, number[]> = {};
  const kwhByMonthWeekend: Record<string, number[]> = {};
  const kwByMonth: Record<string, number[]> = {};
  const hourKwByMonth: Record<string, Record<number, number[]>> = {};

  let totalKwh = 0;
  const overnight: number[] = [];
  const morning: number[] = [];
  const afternoon: number[] = [];
  const evening: number[] = [];

  for (const r of rows) {
    const slot = getLocalSlot(r.tsUtc, tz);
    const month = getLocalMonth(r.tsUtc, tz);
    const hour = getLocalHour(r.tsUtc, tz);
    const kw = r.kwh * 4;

    slotSumsAll[slot] += r.kwh;
    slotCountsAll[slot]++;
    totalKwh += r.kwh;
    if (isWeekday(r.tsUtc, tz)) {
      slotSumsWeekday[slot] += r.kwh;
      slotCountsWeekday[slot]++;
      if (!kwhByMonthWeekday[month]) kwhByMonthWeekday[month] = [];
      kwhByMonthWeekday[month].push(r.kwh);
    } else {
      slotSumsWeekend[slot] += r.kwh;
      slotCountsWeekend[slot]++;
      if (!kwhByMonthWeekend[month]) kwhByMonthWeekend[month] = [];
      kwhByMonthWeekend[month].push(r.kwh);
    }
    if (!byMonth[month]) byMonth[month] = { sums: new Array(SLOTS_PER_DAY).fill(0), counts: new Array(SLOTS_PER_DAY).fill(0) };
    byMonth[month].sums[slot] += r.kwh;
    byMonth[month].counts[slot]++;
    if (!kwByMonth[month]) kwByMonth[month] = [];
    kwByMonth[month].push(kw);
    if (!hourKwByMonth[month]) hourKwByMonth[month] = {};
    if (!hourKwByMonth[month][hour]) hourKwByMonth[month][hour] = [];
    hourKwByMonth[month][hour].push(kw);
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
    const ym = monthsOrder[i] ?? "";
    const wd = kwhByMonthWeekday[ym];
    const we = kwhByMonthWeekend[ym];
    const sumWd = wd?.reduce((a, b) => a + b, 0) ?? 0;
    const sumWe = we?.reduce((a, b) => a + b, 0) ?? 0;
    avgKwhPerDayWeekdayByMonth.push(wd?.length ? round4((sumWd * SLOTS_PER_DAY) / wd.length) : 0);
    avgKwhPerDayWeekendByMonth.push(we?.length ? round4((sumWe * SLOTS_PER_DAY) / we.length) : 0);
    const kws = kwByMonth[ym];
    p95KwByMonth.push(kws?.length ? (percentile([...kws].sort((a, b) => a - b), P95_PERCENTILE) ?? 0) : 0);
    const hourMeans = hourKwByMonth[ym];
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
