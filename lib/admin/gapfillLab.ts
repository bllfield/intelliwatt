/**
 * Gap-Fill Lab: compute comparison metrics between actual and simulated intervals on Test Dates only.
 * Vacant/Travel (DB) are separate; scoring uses only admin-entered Test Dates.
 */

export type IntervalPoint = { timestamp: string; kwh: number };

/** Local calendar date key YYYY-MM-DD (timezone-dependent when derived from timestamp). */
export type LocalDateKey = string;

/** Canonical timestamp key for joining actual and simulated intervals (UTC ISO string). */
export function canonicalIntervalKey(tsIso: string): string {
  try {
    const d = new Date(String(tsIso).trim());
    return Number.isFinite(d.getTime()) ? d.toISOString() : String(tsIso).trim();
  } catch {
    return String(tsIso).trim();
  }
}

export type GapFillDiagnostics = {
  dailyTotalsMasked: Array<{ date: string; actualKwh: number; simKwh: number; deltaKwh: number }>;
  top10Under: Array<{ date: string; actualKwh: number; simKwh: number; deltaKwh: number }>;
  top10Over: Array<{ date: string; actualKwh: number; simKwh: number; deltaKwh: number }>;
  hourlyProfileMasked: Array<{ hour: number; actualMeanKwh: number; simMeanKwh: number; deltaMeanKwh: number }>;
  seasonalSplit: {
    summer: { wape: number; mae: number; count: number };
    winter: { wape: number; mae: number; count: number };
    shoulder: { wape: number; mae: number; count: number };
  };
};

export function computeGapFillMetrics(args: {
  actual: IntervalPoint[];
  simulated: IntervalPoint[];
  /** Map timestamp (ISO) -> simulated kwh for lookup */
  simulatedByTs: Map<string, number>;
  /** When set, byHour / byDayType / byMonth / byDate use local time in this tz (aligns with simulateIntervalsForTestDaysFromUsageShapeProfile). Omit for UTC bucketing. */
  timezone?: string;
}): {
  mae: number;
  rmse: number;
  mape: number;
  wape: number;
  maxAbs: number;
  totalActualKwhMasked: number;
  totalSimKwhMasked: number;
  deltaKwhMasked: number;
  mapeFiltered: number | null;
  mapeFilteredCount: number;
  byMonth: Array<{ month: string; mae: number; mape: number; count: number; totalActual: number; totalSim: number; wape: number }>;
  byHour: Array<{ hour: number; mae: number; mape: number; count: number; sumAbs: number }>;
  byDayType: Array<{ dayType: "weekday" | "weekend"; mae: number; mape: number; count: number }>;
  worstDays: Array<{ date: string; absErrorKwh: number }>;
  worst10Abs: Array<{ date: string; actualKwh: number; simKwh: number; deltaKwh: number }>;
  diagnostics: GapFillDiagnostics;
  pasteSummary: string;
} {
  const { actual, simulatedByTs, timezone } = args;
  const useLocal = Boolean(timezone && timezone.trim());
  const errors: number[] = [];
  const absErrors: number[] = [];
  const byMonth = new Map<string, { sumAbs: number; sumAbsPct: number; sumActual: number; sumSim: number; count: number }>();
  const byHour = new Map<number, { sumAbs: number; sumAbsPct: number; sumActual: number; sumSim: number; count: number }>();
  const byDayType = new Map<"weekday" | "weekend", { sumAbs: number; sumAbsPct: number; sumActual: number; count: number }>();
  const byDate = new Map<string, number>();
  const byDateActualSim = new Map<string, { actualKwh: number; simKwh: number }>();
  const bySeason = new Map<"summer" | "winter" | "shoulder", { sumAbs: number; sumActual: number; count: number }>();

  for (const p of actual) {
    const ts = String(p?.timestamp ?? "").trim();
    const key = canonicalIntervalKey(ts);
    const actualKwh = Number(p?.kwh) || 0;
    const simKwh = simulatedByTs.get(key) ?? 0;
    const err = simKwh - actualKwh;
    const absErr = Math.abs(err);
    errors.push(err);
    absErrors.push(absErr);

    const date = useLocal ? dateKeyInTimezone(ts, timezone!) : ts.slice(0, 10);
    const month = date.slice(0, 7);
    const hour = useLocal ? localHourInTimezone(ts, timezone!) : new Date(ts).getUTCHours();
    const dow = useLocal ? localDayOfWeekInTimezone(ts, timezone!) : new Date(ts).getUTCDay();
    const dayType: "weekday" | "weekend" = dow === 0 || dow === 6 ? "weekend" : "weekday";

    const prevDay = byDateActualSim.get(date) ?? { actualKwh: 0, simKwh: 0 };
    byDateActualSim.set(date, {
      actualKwh: prevDay.actualKwh + actualKwh,
      simKwh: prevDay.simKwh + simKwh,
    });

    byDate.set(date, (byDate.get(date) ?? 0) + absErr);
    byMonth.set(month, {
      sumAbs: (byMonth.get(month)?.sumAbs ?? 0) + absErr,
      sumAbsPct: (byMonth.get(month)?.sumAbsPct ?? 0) + (actualKwh > 1e-6 ? absErr / actualKwh : 0),
      sumActual: (byMonth.get(month)?.sumActual ?? 0) + actualKwh,
      sumSim: (byMonth.get(month)?.sumSim ?? 0) + simKwh,
      count: (byMonth.get(month)?.count ?? 0) + 1,
    });
    const prevH = byHour.get(hour);
    byHour.set(hour, {
      sumAbs: (prevH?.sumAbs ?? 0) + absErr,
      sumAbsPct: (prevH?.sumAbsPct ?? 0) + (actualKwh > 1e-6 ? absErr / actualKwh : 0),
      sumActual: (prevH?.sumActual ?? 0) + actualKwh,
      sumSim: (prevH?.sumSim ?? 0) + simKwh,
      count: (prevH?.count ?? 0) + 1,
    });
    byDayType.set(dayType, {
      sumAbs: (byDayType.get(dayType)?.sumAbs ?? 0) + absErr,
      sumAbsPct: (byDayType.get(dayType)?.sumAbsPct ?? 0) + (actualKwh > 1e-6 ? absErr / actualKwh : 0),
      sumActual: (byDayType.get(dayType)?.sumActual ?? 0) + actualKwh,
      count: (byDayType.get(dayType)?.count ?? 0) + 1,
    });
  }

  const n = errors.length;
  const mae = n > 0 ? absErrors.reduce((a, b) => a + b, 0) / n : 0;
  const rmse = n > 0 ? Math.sqrt(errors.reduce((a, e) => a + e * e, 0) / n) : 0;
  const sumActual = actual.reduce((s, p) => s + (Number(p.kwh) || 0), 0);
  const sumSim = Array.from(byDateActualSim.values()).reduce((s, { simKwh }) => s + simKwh, 0);
  const mape = sumActual > 1e-6 ? (absErrors.reduce((a, b) => a + b, 0) / sumActual) * 100 : 0;
  const wape = sumActual > 1e-6 ? (absErrors.reduce((a, b) => a + b, 0) / sumActual) * 100 : 0;
  const maxAbs = absErrors.length > 0 ? Math.max(...absErrors) : 0;
  const MAPE_THRESHOLD_KWH = 0.05;
  let sumAbsFiltered = 0;
  let sumActualFiltered = 0;
  let mapeFilteredCount = 0;
  for (let i = 0; i < actual.length; i++) {
    const a = Number(actual[i]?.kwh) || 0;
    if (a < MAPE_THRESHOLD_KWH) continue;
    mapeFilteredCount++;
    sumActualFiltered += a;
    sumAbsFiltered += absErrors[i] ?? 0;
  }
  const mapeFiltered = sumActualFiltered > 1e-6 ? Math.round((sumAbsFiltered / sumActualFiltered) * 10000) / 100 : null;

  const round2 = (x: number) => Math.round(x * 100) / 100;

  const worstDays = Array.from(byDate.entries())
    .map(([date, absErrorKwh]) => ({ date, absErrorKwh }))
    .sort((a, b) => b.absErrorKwh - a.absErrorKwh)
    .slice(0, 10);

  const byMonthArr = Array.from(byMonth.entries())
    .map(([month, v]) => ({
      month,
      mae: round2(v.sumAbs / (v.count || 1)),
      mape: round2((v.count && v.sumActual > 1e-6 ? (v.sumAbsPct / v.count) * 100 : 0)),
      count: v.count,
      totalActual: round2(v.sumActual),
      totalSim: round2(v.sumSim),
      wape: v.sumActual > 1e-6 ? round2((v.sumAbs / v.sumActual) * 100) : 0,
    }))
    .sort((a, b) => (a.month < b.month ? -1 : 1));

  const byHourArr = Array.from({ length: 24 }, (_, hour) => {
    const v = byHour.get(hour);
    return {
      hour,
      mae: v ? round2(v.sumAbs / (v.count || 1)) : 0,
      mape: v && v.count && v.sumActual > 1e-6 ? round2((v.sumAbsPct / v.count) * 100) : 0,
      count: v?.count ?? 0,
      sumAbs: v?.sumAbs ?? 0,
    };
  });

  const byDayTypeArr: Array<{ dayType: "weekday" | "weekend"; mae: number; mape: number; count: number }> = [
    "weekday",
    "weekend",
  ].map((dayType) => {
    const v = byDayType.get(dayType as "weekday" | "weekend");
    return {
      dayType: dayType as "weekday" | "weekend",
      mae: v ? round2(v.sumAbs / (v.count || 1)) : 0,
      mape: v && v.count && v.sumActual > 1e-6 ? round2((v.sumAbsPct / v.count) * 100) : 0,
      count: v?.count ?? 0,
    };
  });

  const dailyTotalsMasked = Array.from(byDateActualSim.entries())
    .map(([date, { actualKwh, simKwh }]) => ({
      date,
      actualKwh: round2(actualKwh),
      simKwh: round2(simKwh),
      deltaKwh: round2(simKwh - actualKwh),
    }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  const top10Under = dailyTotalsMasked.filter((r) => r.deltaKwh < 0).sort((a, b) => a.deltaKwh - b.deltaKwh).slice(0, 10);
  const top10Over = dailyTotalsMasked.filter((r) => r.deltaKwh > 0).sort((a, b) => b.deltaKwh - a.deltaKwh).slice(0, 10);
  const worst10Abs = [...dailyTotalsMasked]
    .sort((a, b) => Math.abs(b.deltaKwh) - Math.abs(a.deltaKwh))
    .slice(0, 10);

  const hourlyProfileMasked = Array.from({ length: 24 }, (_, hour) => {
    const v = byHour.get(hour);
    const count = v?.count ?? 0;
    const actualMeanKwh = count > 0 ? (v!.sumActual / count) : 0;
    const simMeanKwh = count > 0 ? v!.sumSim / count : 0;
    return {
      hour,
      actualMeanKwh: round2(actualMeanKwh),
      simMeanKwh: round2(simMeanKwh),
      deltaMeanKwh: round2(simMeanKwh - actualMeanKwh),
    };
  });

  const seasonStats = (key: "summer" | "winter" | "shoulder") => {
    const v = bySeason.get(key);
    const count = v?.count ?? 0;
    const mae = count > 0 ? (v!.sumAbs / count) : 0;
    const wape = v && v.sumActual > 1e-6 ? (v.sumAbs / v.sumActual) * 100 : 0;
    return { wape: round2(wape), mae: round2(mae), count };
  };
  const seasonalSplit = {
    summer: seasonStats("summer"),
    winter: seasonStats("winter"),
    shoulder: seasonStats("shoulder"),
  };

  const diagnostics: GapFillDiagnostics = {
    dailyTotalsMasked,
    top10Under,
    top10Over,
    hourlyProfileMasked,
    seasonalSplit,
  };

  const pasteSummary = [
    `Gap-Fill Lab | masked intervals: ${n}`,
    `WAPE: ${round2(wape)}% | MAE: ${round2(mae)} kWh | RMSE: ${round2(rmse)} | MAPE: ${round2(mape)}% | MaxAbs: ${round2(maxAbs)} kWh`,
    `Worst days: ${worstDays.map((d) => `${d.date}: ${round2(d.absErrorKwh)}`).join(" | ")}`,
  ].join("\n");

  return {
    mae: round2(mae),
    rmse: round2(rmse),
    mape: round2(mape),
    wape: round2(wape),
    maxAbs: round2(maxAbs),
    totalActualKwhMasked: round2(sumActual),
    totalSimKwhMasked: round2(sumSim),
    deltaKwhMasked: round2(sumSim - sumActual),
    mapeFiltered,
    mapeFilteredCount,
    byMonth: byMonthArr,
    byHour: byHourArr,
    byDayType: byDayTypeArr,
    worstDays: worstDays.map((d) => ({ ...d, absErrorKwh: round2(d.absErrorKwh) })),
    worst10Abs,
    diagnostics,
    pasteSummary,
  };
}

/** Return the next calendar date (YYYY-MM-DD) after the given one. */
function nextCalendarDay(ymd: string): string {
  const d = new Date(ymd + "T12:00:00.000Z");
  d.setUTCDate(d.getUTCDate() + 1);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Return the calendar date (YYYY-MM-DD) N days before the given one. */
export function prevCalendarDay(ymd: string, daysBack: number): string {
  const d = new Date(ymd + "T12:00:00.000Z");
  d.setUTCDate(d.getUTCDate() - daysBack);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Lite profile shape compatible with UsageShapeProfileRowForSim (no DB write). */
export type UsageShapeProfileLite = {
  shapeByMonth96: Record<string, number[]>;
  avgKwhPerDayWeekdayByMonth: number[];
  avgKwhPerDayWeekendByMonth: number[];
};

/**
 * Build a minimal usage shape profile from interval data (training window).
 * Exclude no dates here; caller must pass already-filtered training intervals.
 */
export function buildUsageShapeProfileLiteFromIntervals(args: {
  timezone: string;
  intervals: IntervalPoint[];
}): UsageShapeProfileLite {
  const { timezone, intervals } = args;
  const byDate = new Map<string, { slots: number[]; totalKwh: number; dow: number }>();

  for (const p of intervals) {
    const ts = String(p?.timestamp ?? "").trim();
    const kwh = Number(p?.kwh) || 0;
    const dateKey = dateKeyInTimezone(ts, timezone);
    const slot96 = localSlot96InTimezone(ts, timezone);
    const dow = localDayOfWeekInTimezone(ts, timezone);

    if (!byDate.has(dateKey)) {
      byDate.set(dateKey, { slots: Array(96).fill(0), totalKwh: 0, dow });
    }
    const row = byDate.get(dateKey)!;
    row.slots[slot96] += kwh;
    row.totalKwh += kwh;
  }

  const byMonth = new Map<
    string,
    { weekdayTotals: number[]; weekendTotals: number[]; weekdayShapes: number[][]; weekendShapes: number[][] }
  >();

  for (const [dateKey, row] of Array.from(byDate)) {
    const monthKey = dateKey.slice(0, 7);
    if (!byMonth.has(monthKey)) {
      byMonth.set(monthKey, {
        weekdayTotals: [],
        weekendTotals: [],
        weekdayShapes: [],
        weekendShapes: [],
      });
    }
    const m = byMonth.get(monthKey)!;
    const isWeekend = row.dow === 0 || row.dow === 6;
    if (row.totalKwh > 1e-9) {
      const norm = row.slots.map((s) => s / row.totalKwh);
      if (isWeekend) {
        m.weekendTotals.push(row.totalKwh);
        m.weekendShapes.push(norm);
      } else {
        m.weekdayTotals.push(row.totalKwh);
        m.weekdayShapes.push(norm);
      }
    }
  }

  const shapeByMonth96: Record<string, number[]> = {};
  const weekdayAvgByMonth: Record<string, number> = {};
  const weekendAvgByMonth: Record<string, number> = {};

  for (const [monthKey, m] of Array.from(byMonth)) {
    const mean = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
    weekdayAvgByMonth[monthKey] = mean(m.weekdayTotals);
    weekendAvgByMonth[monthKey] = mean(m.weekendTotals);

    const allShapes: number[][] = [...m.weekdayShapes, ...m.weekendShapes];
    if (allShapes.length > 0) {
      const sumSlots = Array(96).fill(0);
      for (const s of allShapes) {
        for (let i = 0; i < 96; i++) sumSlots[i] += s[i] ?? 0;
      }
      const total = sumSlots.reduce((a, b) => a + b, 0);
      shapeByMonth96[monthKey] =
        total > 1e-9 ? sumSlots.map((v) => v / total) : Array(96).fill(1 / 96);
    } else {
      shapeByMonth96[monthKey] = Array(96).fill(1 / 96);
    }
  }

  const monthKeys = Object.keys(shapeByMonth96).sort();
  const avgKwhPerDayWeekdayByMonth = monthKeys.map((k) => weekdayAvgByMonth[k] ?? 0);
  const avgKwhPerDayWeekendByMonth = monthKeys.map((k) => weekendAvgByMonth[k] ?? 0);

  return {
    shapeByMonth96,
    avgKwhPerDayWeekdayByMonth,
    avgKwhPerDayWeekendByMonth,
  };
}

/** Enumerate local date keys (YYYY-MM-DD) for a range. start/end are treated as calendar dates
 * (YYYY-MM-DD). If they are full ISO strings, they are converted to local date keys in tz first.
 * Returns the list of calendar date strings from start to end inclusive, so they match
 * dateKeyInTimezone(ts, tz) when filtering masked intervals. */
export function localDateKeysInRange(startDate: string, endDate: string, tz: string): string[] {
  const rawStart = String(startDate).trim();
  const rawEnd = String(endDate).trim();
  const startKey = /^\d{4}-\d{2}-\d{2}$/.test(rawStart.slice(0, 10))
    ? rawStart.slice(0, 10)
    : dateKeyInTimezone(rawStart, tz);
  const endKey = /^\d{4}-\d{2}-\d{2}$/.test(rawEnd.slice(0, 10))
    ? rawEnd.slice(0, 10)
    : dateKeyInTimezone(rawEnd, tz);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startKey) || !/^\d{4}-\d{2}-\d{2}$/.test(endKey)) return [];
  const first = startKey <= endKey ? startKey : endKey;
  const last = startKey <= endKey ? endKey : startKey;
  const out: string[] = [];
  let cur = first;
  while (cur <= last) {
    out.push(cur);
    if (cur === last) break;
    cur = nextCalendarDay(cur);
  }
  return out;
}

/** Compress sorted date keys (YYYY-MM-DD) into minimal start/end ranges. */
export function mergeDateKeysToRanges(keysSorted: string[]): Array<{ startDate: string; endDate: string }> {
  if (keysSorted.length === 0) return [];
  const ranges: Array<{ startDate: string; endDate: string }> = [];
  let start = keysSorted[0]!;
  let prev = keysSorted[0]!;
  for (let i = 1; i < keysSorted.length; i++) {
    const cur = keysSorted[i]!;
    const prevNext = nextCalendarDay(prev);
    if (cur === prevNext) {
      prev = cur;
    } else {
      ranges.push({ startDate: start, endDate: prev });
      start = cur;
      prev = cur;
    }
  }
  ranges.push({ startDate: start, endDate: prev });
  return ranges;
}

/** Simple seeded RNG returning [0, 1). Deterministic for same seed. */
export function seededRng(seed: string): () => number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0;
  let state = Math.abs(h) || 1;
  return () => {
    state = (Math.imul(1103515245, state) + 12345) | 0;
    return ((state >>> 0) / 0x1_0000_0000) % 1;
  };
}

/**
 * Pick a deterministic random subset of candidate date keys for test days.
 * Excludes travel dates. Optionally stratifies by month and weekend/weekday.
 */
export function pickRandomTestDateKeys(args: {
  candidateDateKeys: string[];
  travelDateKeysSet: Set<string>;
  testDays: number;
  seed: string;
  stratifyByMonth: boolean;
  stratifyByWeekend: boolean;
  isWeekendLocalKey: (dk: string) => boolean;
  monthKeyFromLocalKey: (dk: string) => string;
}): string[] {
  const {
    candidateDateKeys,
    travelDateKeysSet,
    testDays,
    seed,
    stratifyByMonth,
    stratifyByWeekend,
    isWeekendLocalKey,
    monthKeyFromLocalKey,
  } = args;
  const filtered = candidateDateKeys.filter((dk) => !travelDateKeysSet.has(dk));
  if (filtered.length <= testDays) return [...filtered].sort();

  const rng = seededRng(seed);
  const shuffle = <T>(arr: T[]): T[] => {
    const out = [...arr];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [out[i], out[j]] = [out[j]!, out[i]!];
    }
    return out;
  };

  if (!stratifyByMonth && !stratifyByWeekend) {
    return shuffle(filtered).slice(0, testDays).sort();
  }

  const key = (dk: string) =>
    stratifyByMonth && stratifyByWeekend
      ? `${monthKeyFromLocalKey(dk)}:${isWeekendLocalKey(dk) ? "we" : "wd"}`
      : stratifyByMonth
        ? monthKeyFromLocalKey(dk)
        : isWeekendLocalKey(dk)
          ? "we"
          : "wd";
  const groups = new Map<string, string[]>();
  for (const dk of filtered) {
    const k = key(dk);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(dk);
  }
  const groupKeys = Array.from(groups.keys()).sort();
  const shuffledGroups = new Map<string, string[]>();
  for (const gk of groupKeys) {
    shuffledGroups.set(gk, shuffle(groups.get(gk)!));
  }
  const picked: string[] = [];
  let index = 0;
  while (picked.length < testDays) {
    let added = 0;
    for (const gk of groupKeys) {
      const arr = shuffledGroups.get(gk)!;
      const dk = arr[index];
      if (dk && !picked.includes(dk)) {
        picked.push(dk);
        added++;
        if (picked.length >= testDays) break;
      }
    }
    if (added === 0) break;
    index++;
  }
  if (picked.length < testDays) {
    const remaining = filtered.filter((dk) => !picked.includes(dk));
    const extra = shuffle(remaining).slice(0, testDays - picked.length);
    picked.push(...extra);
  }
  return picked.slice(0, testDays).sort();
}

/** Day of week (0=Sun .. 6=Sat) for a local date key YYYY-MM-DD in the given timezone. */
export function getLocalDayOfWeekFromDateKey(dateKey: string, tz: string): number {
  try {
    const d = new Date(dateKey + "T12:00:00.000Z");
    if (!Number.isFinite(d.getTime())) return 0;
    const short = new Intl.DateTimeFormat("en-CA", { timeZone: tz, weekday: "short" }).format(d);
    const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    return map[short] ?? 0;
  } catch {
    return 0;
  }
}

/** Daily coverage: for each date key, count intervals and pct vs expected 96. */
export function summarizeDailyCoverageFromIntervals(
  intervals: IntervalPoint[],
  tz: string
): Map<string, { count: number; expected: number; pct: number }> {
  const byDay = new Map<string, number>();
  for (const p of intervals) {
    const dk = dateKeyInTimezone(String(p?.timestamp ?? "").trim(), tz);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dk)) continue;
    byDay.set(dk, (byDay.get(dk) ?? 0) + 1);
  }
  const out = new Map<string, { count: number; expected: number; pct: number }>();
  const expected = 96;
  for (const [dk, count] of Array.from(byDay)) {
    out.set(dk, { count, expected, pct: count / expected });
  }
  return out;
}

/**
 * Default pool window: centered on midday, spread across runHoursPerDay.
 * Returns inclusive [startHour, endHour] in 0-23 local time.
 */
export function getPoolHourRange(runHoursPerDay: number): { startHour: number; endHour: number } {
  const half = runHoursPerDay / 2;
  const startHour = Math.max(0, Math.floor(12 - half));
  const endHour = Math.min(23, Math.ceil(12 + half) - 1);
  return { startHour, endHour };
}

/** Get local hour (0-23) for a timestamp in the given timezone. */
export function localHourInTimezone(tsIso: string, tz: string): number {
  try {
    const d = new Date(tsIso);
    const fmt = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "numeric", hour12: false });
    return parseInt(fmt.format(d), 10) || 0;
  } catch {
    return new Date(tsIso).getUTCHours();
  }
}

/** Get local date key (YYYY-MM-DD) for a timestamp in the given timezone. */
export function dateKeyInTimezone(tsIso: string, tz: string): string {
  try {
    const d = new Date(tsIso);
    if (!Number.isFinite(d.getTime())) return tsIso.slice(0, 10);
    const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
    const parts = fmt.formatToParts(d);
    const y = parts.find((p) => p.type === "year")?.value ?? "";
    const m = parts.find((p) => p.type === "month")?.value ?? "";
    const day = parts.find((p) => p.type === "day")?.value ?? "";
    return `${y}-${m}-${day}`;
  } catch {
    return tsIso.slice(0, 10);
  }
}

/** Get local 15-min slot index (0–95) for a timestamp in the given timezone. */
export function localSlot96InTimezone(tsIso: string, tz: string): number {
  try {
    const d = new Date(tsIso);
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      hour: "numeric",
      minute: "numeric",
      hour12: false,
    }).formatToParts(d);
    const hour = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
    const minute = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);
    return Math.min(95, Math.max(0, hour * 4 + Math.floor(minute / 15)));
  } catch {
    return 0;
  }
}

/** Get local day of week (0 = Sunday, 6 = Saturday) for a timestamp in the given timezone. */
export function localDayOfWeekInTimezone(tsIso: string, tz: string): number {
  try {
    const d = new Date(tsIso);
    const short = new Intl.DateTimeFormat("en-CA", { timeZone: tz, weekday: "short" }).format(d);
    const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    return map[short] ?? 0;
  } catch {
    return 0;
  }
}

/** Usage shape profile row as returned from getLatestUsageShapeProfile (subset used for test-day sim). */
export type UsageShapeProfileRowForSim = {
  shapeByMonth96?: Record<string, number[]> | null;
  avgKwhPerDayWeekdayByMonth?: number[] | null;
  avgKwhPerDayWeekendByMonth?: number[] | null;
} | null;

/**
 * Simulate interval kWh for test-day timestamps using UsageShapeProfile (weekday/weekend avg + shape96).
 * Returns one entry per input interval with same timestamp; kwh is simulated.
 */
export function simulateIntervalsForTestDaysFromUsageShapeProfile(args: {
  timezone: string;
  testIntervals: IntervalPoint[];
  usageShapeProfileRowOrNull: UsageShapeProfileRowForSim;
}): IntervalPoint[] {
  const { timezone, testIntervals, usageShapeProfileRowOrNull } = args;
  const profile = usageShapeProfileRowOrNull;
  const shapeByMonth = (profile?.shapeByMonth96 && typeof profile.shapeByMonth96 === "object") ? profile.shapeByMonth96 : {};
  const wdArr = Array.isArray(profile?.avgKwhPerDayWeekdayByMonth) ? profile.avgKwhPerDayWeekdayByMonth : [];
  const weArr = Array.isArray(profile?.avgKwhPerDayWeekendByMonth) ? profile.avgKwhPerDayWeekendByMonth : [];
  const profileMonthKeys = Object.keys(shapeByMonth).filter((k) => /^\d{4}-\d{2}$/.test(k)).sort();
  const globalAvgWd = wdArr.length ? wdArr.reduce((a, b) => a + b, 0) / wdArr.length : 0;
  const globalAvgWe = weArr.length ? weArr.reduce((a, b) => a + b, 0) / weArr.length : 0;

  return testIntervals.map((p) => {
    const ts = String(p?.timestamp ?? "").trim();
    const dateKey = dateKeyInTimezone(ts, timezone);
    const monthKey = dateKey.slice(0, 7);
    const slot96 = localSlot96InTimezone(ts, timezone);
    const dow = localDayOfWeekInTimezone(ts, timezone);
    const isWeekend = dow === 0 || dow === 6;

    let targetDayKwh: number;
    const monthIdx = profileMonthKeys.indexOf(monthKey);
    if (isWeekend) {
      targetDayKwh = monthIdx >= 0 && weArr[monthIdx] != null && Number.isFinite(weArr[monthIdx]) ? weArr[monthIdx] : globalAvgWe;
    } else {
      targetDayKwh = monthIdx >= 0 && wdArr[monthIdx] != null && Number.isFinite(wdArr[monthIdx]) ? wdArr[monthIdx] : globalAvgWd;
    }

    let shape96: number[];
    const monthShape = shapeByMonth[monthKey];
    if (Array.isArray(monthShape) && monthShape.length === 96) {
      const sum = monthShape.reduce((s, v) => s + v, 0);
      shape96 = sum > 1e-9 ? monthShape.map((v) => v / sum) : Array(96).fill(1 / 96);
    } else {
      shape96 = Array(96).fill(1 / 96);
    }

    const simKwh = (shape96[slot96] ?? 1 / 96) * (targetDayKwh ?? 0);
    return { timestamp: canonicalIntervalKey(ts), kwh: Math.max(0, simKwh) };
  });
}