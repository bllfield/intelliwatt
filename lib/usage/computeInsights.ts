import { DateTime } from 'luxon';
import { NormalizedUsageRow } from './normalize';

export interface UsageInsights {
  intervals: NormalizedUsageRow[];
  monthlyTotals: { month: string; kwh: number }[];
  dailyTotals: { date: string; kwh: number }[];
  fifteenMinuteAverages: { hhmm: string; avgKw: number }[];
  peakDay: { date: string; kwh: number } | null;
  peakHour: { hour: number; kw: number } | null;
  baseload: number | null;
  weekdayVsWeekend: { weekday: number; weekend: number };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

// Use America/Chicago so daily buckets align with Texas local time and SMT UI.
const US_CENTRAL_TZ = 'America/Chicago';

function dateKey(date: Date): string {
  const dt = DateTime.fromJSDate(date, { zone: US_CENTRAL_TZ });
  return dt.toISODate() ?? date.toISOString().slice(0, 10);
}

function startOfDayMs(date: Date): number {
  const dt = DateTime.fromJSDate(date, { zone: US_CENTRAL_TZ }).startOf('day').toUTC();
  return dt.toJSDate().getTime();
}

export function computeInsights(intervals: NormalizedUsageRow[]): UsageInsights {
  if (!intervals || intervals.length === 0) {
    return {
      intervals: [],
      monthlyTotals: [],
      dailyTotals: [],
      fifteenMinuteAverages: [],
      peakDay: null,
      peakHour: null,
      baseload: null,
      weekdayVsWeekend: { weekday: 0, weekend: 0 },
    };
  }

  const sorted = [...intervals].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  // ----- DAILY GROUPING WITH ZERO FILL -----
  const dailyMap = new Map<string, number>();
  for (const row of sorted) {
    const key = dateKey(row.timestamp);
    dailyMap.set(key, (dailyMap.get(key) ?? 0) + row.kwh);
  }

  const firstDayMs = startOfDayMs(sorted[0].timestamp);
  const lastDayMs = startOfDayMs(sorted[sorted.length - 1].timestamp);
  const DAY_MS = 24 * 60 * 60 * 1000;
  const dailyTotals: { date: string; kwh: number }[] = [];

  if (Number.isFinite(firstDayMs) && Number.isFinite(lastDayMs) && firstDayMs <= lastDayMs) {
    for (let ms = firstDayMs; ms <= lastDayMs; ms += DAY_MS) {
      const key = dateKey(new Date(ms));
      const kwh = dailyMap.get(key) ?? 0;
      dailyTotals.push({ date: key, kwh: round2(kwh) });
    }
  }

  // ----- MONTHLY GROUPING -----
  const monthlyMap = new Map<string, number>();
  for (const row of sorted) {
    const ts = row.timestamp;
    const month = `${ts.getFullYear()}-${String(ts.getMonth() + 1).padStart(2, '0')}`;
    monthlyMap.set(month, (monthlyMap.get(month) ?? 0) + row.kwh);
  }
  const monthlyTotals = Array.from(monthlyMap.entries()).map(([month, kwh]) => ({ month, kwh: round2(kwh) }));

  // ----- 15-MINUTE AVERAGE LOAD CURVE -----
  const slotMap = new Map<string, { sum: number; count: number }>();
  for (const row of sorted) {
    const hh = row.timestamp.getHours().toString().padStart(2, '0');
    const mm = row.timestamp.getMinutes().toString().padStart(2, '0');
    const key = `${hh}:${mm}`;
    if (!slotMap.has(key)) slotMap.set(key, { sum: 0, count: 0 });
    const slot = slotMap.get(key)!;
    slot.sum += row.kwh * 4; // Convert 15m kWh into kW
    slot.count += 1;
  }
  const fifteenMinuteAverages = Array.from(slotMap.entries()).map(([hhmm, value]) => ({
    hhmm,
    avgKw: round2(value.sum / value.count),
  }));

  // ----- PEAK DAY -----
  const peakDay = dailyTotals.length > 0
    ? dailyTotals.reduce((a, b) => (b.kwh > a.kwh ? b : a))
    : null;

  // ----- PEAK HOUR -----
  const hourMap = new Map<number, { sumKw: number; count: number }>();
  for (const row of sorted) {
    const hr = row.timestamp.getHours();
    const cur = hourMap.get(hr) ?? { sumKw: 0, count: 0 };
    cur.sumKw += row.kwh * 4;
    cur.count += 1;
    hourMap.set(hr, cur);
  }
  const peakHour = hourMap.size > 0
    ? (() => {
        const top = Array.from(hourMap.entries())
          .map(([hour, v]) => ({ hour, avgKw: v.count > 0 ? v.sumKw / v.count : 0 }))
          .reduce((a, b) => (b.avgKw > a.avgKw ? b : a));
        return { hour: top.hour, kw: round2(top.avgKw) };
      })()
    : null;

  // ----- BASELOAD = lowest 10% kWh samples -----
  const kwhSamples = sorted.map((row) => row.kwh).sort((a, b) => a - b);
  const count10 = Math.max(1, Math.floor(kwhSamples.length * 0.1));
  const baseSlice = kwhSamples.slice(0, count10);
  const baseload = baseSlice.length > 0 ? round2(baseSlice.reduce((a, b) => a + b, 0) / baseSlice.length) : null;

  // ----- WEEKDAY vs WEEKEND -----
  let weekday = 0;
  let weekend = 0;
  for (const row of sorted) {
    const day = row.timestamp.getDay();
    if (day === 0 || day === 6) weekend += row.kwh;
    else weekday += row.kwh;
  }

  return {
    intervals: sorted,
    monthlyTotals,
    dailyTotals,
    fifteenMinuteAverages,
    peakDay,
    peakHour,
    baseload,
    weekdayVsWeekend: {
      weekday: round2(weekday),
      weekend: round2(weekend),
    },
  };
}