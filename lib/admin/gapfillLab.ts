/**
 * Gap-Fill Lab: compute comparison metrics between actual and simulated intervals on Test Dates only.
 * Vacant/Travel (DB) are separate; scoring uses only admin-entered Test Dates.
 */

import { canonicalIntervalKey } from "@/lib/sim/contract/time";

export type IntervalPoint = { timestamp: string; kwh: number };

/** Local calendar date key YYYY-MM-DD (timezone-dependent when derived from timestamp). */
export type LocalDateKey = string;

/** Canonical timestamp key for joining actual and simulated intervals (UTC ISO string). Re-exported from sim contract. */
export { canonicalIntervalKey };

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
  /** When set, byHour / byDayType / byMonth / byDate use local time in this tz. Omit for UTC bucketing. */
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

/** Fallback level used when selecting day total for sparse buckets. */
export type DayTotalFallbackLevel =
  | "month_daytype"
  | "adjacent_month_daytype"
  | "month_overall"
  | "season_overall"
  | "global_daytype"
  | "global_overall";

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

/** Filter candidate date keys to a season by month. Winter=Dec,Jan,Feb; Summer=Jun,Jul,Aug; Shoulder=Mar,Apr,May,Sep,Oct,Nov. */
export function filterCandidateDateKeysBySeason(
  candidateDateKeys: string[],
  season: "winter" | "summer" | "shoulder"
): string[] {
  const winterMonths = new Set(["12", "01", "02"]);
  const summerMonths = new Set(["06", "07", "08"]);
  const shoulderMonths = new Set(["03", "04", "05", "09", "10", "11"]);
  const set = season === "winter" ? winterMonths : season === "summer" ? summerMonths : shoulderMonths;
  return candidateDateKeys.filter((dk) => set.has(dk.slice(5, 7)));
}

/**
 * Pick test days for extreme_weather mode: prefer days with dailyMinTempC <= -2 or dailyMaxTempC >= 35;
 * if fewer than testDays exist, fall back to top testDays by (heatingDegreeSeverity + coolingDegreeSeverity).
 * Returns { picked, candidateDaysAfterModeFilterCount }.
 */
export function pickExtremeWeatherTestDateKeys(args: {
  candidateDateKeys: string[];
  travelDateKeysSet: Set<string>;
  weatherByDateKey: Map<string, DailyWeatherFeatures>;
  testDays: number;
  seed: string;
  stratifyByMonth: boolean;
  stratifyByWeekend: boolean;
  isWeekendLocalKey: (dk: string) => boolean;
  monthKeyFromLocalKey: (dk: string) => string;
}): { picked: string[]; candidateDaysAfterModeFilterCount: number } {
  const {
    candidateDateKeys,
    travelDateKeysSet,
    weatherByDateKey,
    testDays,
    seed,
    stratifyByMonth,
    stratifyByWeekend,
    isWeekendLocalKey,
    monthKeyFromLocalKey,
  } = args;

  const EXTREME_COLD_MAX_C = -2;
  const EXTREME_HEAT_MIN_C = 35;

  const withWeather = candidateDateKeys.filter((dk) => weatherByDateKey.has(dk));
  const notTravel = withWeather.filter((dk) => !travelDateKeysSet.has(dk));
  const extreme = notTravel.filter((dk) => {
    const wx = weatherByDateKey.get(dk)!;
    return (wx.dailyMinTempC != null && wx.dailyMinTempC <= EXTREME_COLD_MAX_C) ||
      (wx.dailyMaxTempC != null && wx.dailyMaxTempC >= EXTREME_HEAT_MIN_C);
  });

  const candidateDaysAfterModeFilterCount = extreme.length >= testDays ? extreme.length : notTravel.length;

  if (extreme.length >= testDays) {
    return {
      picked: pickRandomTestDateKeys({
        candidateDateKeys: extreme,
        travelDateKeysSet,
        testDays,
        seed,
        stratifyByMonth,
        stratifyByWeekend,
        isWeekendLocalKey,
        monthKeyFromLocalKey,
      }),
      candidateDaysAfterModeFilterCount,
    };
  }

  const bySeverity = [...notTravel].sort((a, b) => {
    const wa = weatherByDateKey.get(a)!;
    const wb = weatherByDateKey.get(b)!;
    const sa = (wa.heatingDegreeSeverity ?? 0) + (wa.coolingDegreeSeverity ?? 0);
    const sb = (wb.heatingDegreeSeverity ?? 0) + (wb.coolingDegreeSeverity ?? 0);
    return sb - sa;
  });
  return {
    picked: bySeverity.slice(0, testDays).sort(),
    candidateDaysAfterModeFilterCount,
  };
}

export {
  selectValidationDayKeys,
  type ValidationDaySelectionMode,
  type ValidationDaySelectionDiagnostics,
} from "@/modules/usageSimulator/validationSelection";

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

const CANDIDATE_DAY_COVERAGE_CACHE_TTL_MS = 10 * 60 * 1000;
const candidateDayCoverageCache = new Map<
  string,
  {
    createdAtMs: number;
    candidateDateKeys: string[];
    coverageByDay: Record<string, { count: number; expected: number; pct: number }>;
    intervalsForWindow: IntervalPoint[];
  }
>();

function buildCandidateDayCoverageCacheKey(args: {
  houseId: string;
  scenarioIdentity?: string | null;
  windowStart: string;
  windowEnd: string;
  timezone: string;
  minDayCoveragePct: number;
  stratifyByMonth: boolean;
  stratifyByWeekend: boolean;
}): string {
  const pct = Math.round((Number(args.minDayCoveragePct) || 0) * 10000) / 10000;
  return [
    `house:${String(args.houseId ?? "").trim()}`,
    `scenario:${String(args.scenarioIdentity ?? "").trim() || "none"}`,
    `window:${String(args.windowStart ?? "").trim()}..${String(args.windowEnd ?? "").trim()}`,
    `tz:${String(args.timezone ?? "").trim()}`,
    `minCoverage:${pct.toFixed(4)}`,
    `stratMonth:${args.stratifyByMonth ? "1" : "0"}`,
    `stratWeekend:${args.stratifyByWeekend ? "1" : "0"}`,
  ].join("|");
}

export async function getCandidateDateCoverageForSelection(args: {
  houseId: string;
  scenarioIdentity?: string | null;
  windowStart: string;
  windowEnd: string;
  timezone: string;
  minDayCoveragePct: number;
  stratifyByMonth: boolean;
  stratifyByWeekend: boolean;
  loadIntervalsForWindow: () => Promise<IntervalPoint[]>;
}): Promise<{
  candidateDateKeys: string[];
  cacheHit: boolean;
  coverageByDay: Record<string, { count: number; expected: number; pct: number }>;
  intervalsForWindow: IntervalPoint[];
}> {
  const key = buildCandidateDayCoverageCacheKey({
    houseId: args.houseId,
    scenarioIdentity: args.scenarioIdentity,
    windowStart: args.windowStart,
    windowEnd: args.windowEnd,
    timezone: args.timezone,
    minDayCoveragePct: args.minDayCoveragePct,
    stratifyByMonth: args.stratifyByMonth,
    stratifyByWeekend: args.stratifyByWeekend,
  });
  const now = Date.now();
  const cached = candidateDayCoverageCache.get(key);
  if (cached && now - cached.createdAtMs <= CANDIDATE_DAY_COVERAGE_CACHE_TTL_MS) {
    return {
      candidateDateKeys: [...cached.candidateDateKeys],
      cacheHit: true,
      coverageByDay: { ...cached.coverageByDay },
      intervalsForWindow: [...cached.intervalsForWindow],
    };
  }

  const intervals = await args.loadIntervalsForWindow();
  const coverage = summarizeDailyCoverageFromIntervals(intervals ?? [], args.timezone);
  const candidateDateKeys = Array.from(coverage.keys())
    .filter((dk) => (coverage.get(dk)?.pct ?? 0) >= args.minDayCoveragePct)
    .sort();
  const coverageByDay = Object.fromEntries(Array.from(coverage.entries()));
  candidateDayCoverageCache.set(key, {
    createdAtMs: now,
    candidateDateKeys: [...candidateDateKeys],
    coverageByDay,
    intervalsForWindow: [...(intervals ?? [])],
  });
  return {
    candidateDateKeys,
    cacheHit: false,
    coverageByDay,
    intervalsForWindow: [...(intervals ?? [])],
  };
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

/** Usage shape profile row as returned from getLatestUsageShapeProfile (subset used for test-day sim). When from auto_built_lite, may include training strength for fallback. */
export type UsageShapeProfileRowForSim = {
  shapeByMonth96?: Record<string, number[]> | null;
  avgKwhPerDayWeekdayByMonth?: number[] | null;
  avgKwhPerDayWeekendByMonth?: number[] | null;
  monthKeys?: string[];
  weekdayCountByMonth?: Record<string, number>;
  weekendCountByMonth?: Record<string, number>;
  monthOverallAvgByMonth?: Record<string, number>;
  monthOverallCountByMonth?: Record<string, number>;
} | null;

/** Diagnostics from day-total fallback (lite profile path). */
export type DayTotalDiagnostics = {
  profileDayTotalFallbackSummary: Record<DayTotalFallbackLevel, number>;
  profileTrainingStrengthSample: Array<{ month: string; weekdayCount: number; weekendCount: number; overallCount: number }>;
  testedDayFallbackSample: Array<{
    localDate: string;
    monthKey: string;
    dayType: "weekday" | "weekend";
    fallbackLevelUsed: DayTotalFallbackLevel;
    rawSelectedDayKwh: number;
    finalSelectedDayKwh: number;
    clampApplied: boolean;
  }>;
  dayTotalGuardrailAppliedCount: number;
  /** Present when weather adjustment was applied. */
  weatherAdjustmentSummary?: {
    daysWithWeatherMultiplier: number;
    daysWithAuxHeatAdder: number;
    daysWithPoolFreezeProtectAdder: number;
    avgWeatherSeverityMultiplier: number;
    minWeatherSeverityMultiplier: number;
    maxWeatherSeverityMultiplier: number;
    totalAuxHeatKwhAdded: number;
    totalPoolFreezeProtectKwhAdded: number;
    daysClassified_normal: number;
    daysClassified_weather_scaled: number;
    daysClassified_extreme_cold_event: number;
    daysClassified_freeze_protect: number;
  };
  /** Tightening pass: counts and blend weights when weather scaling is selective. */
  weatherTighteningSummary?: {
    daysWithMultiplierOne: number;
    daysWithScaledMultiplier: number;
    daysBlendedBackTowardProfile: number;
    avgBlendWeightWeather: number;
    avgBlendWeightProfile: number;
  };
  /** First 10 test days with weather diagnostics when weather was used. */
  testedDayWeatherSample?: Array<{
    localDate: string;
    dayType: "weekday" | "weekend";
    weatherModeUsed: "heating" | "cooling" | "neutral";
    profileSelectedDayKwh: number;
    weatherSeverityMultiplier: number;
    auxHeatKwhAdder: number;
    poolFreezeProtectKwhAdder: number;
    finalSelectedDayKwh: number;
    dayClassification: WeatherDayClassification;
    /** Pre-blend adjusted total (profile × mult + aux + pool). */
    preBlendAdjustedDayKwh?: number;
    /** Final day total after optional blend (same as finalSelectedDayKwh). */
    postBlendFinalDayKwh?: number;
    dailyAvgTempC: number | null;
    dailyMinTempC: number | null;
    heatingDegreeSeverity: number;
    coolingDegreeSeverity: number;
    freezeHoursCount: number;
    /** Aux heat gate: dailyMinTempC <= 0 C. */
    auxHeatGate_minTempPassed?: boolean;
    /** Aux heat gate: freezeHoursCount >= 2. */
    auxHeatGate_freezeHoursPassed?: boolean;
    /** Aux heat gate: heatingDegreeSeverity >= 1.35 × referenceHeatingSeverity. */
    auxHeatGate_severityPassed?: boolean;
    /** Reference heating severity (ref HDD) used for aux gate. */
    referenceHeatingSeverity?: number;
    /** True when 80/20 blend-back toward profile was applied (weather_scaled_day). */
    blendedBackTowardProfile?: boolean;
  }>;
  /** When set, day simulation used the shared past-day simulator core. */
  sourceOfDaySimulationCore?: string;
};

/** Hourly weather row shape used by gapfill-lab (matches HistoricalWeatherRow). */
export type WeatherHourlyRowForGapfill = {
  timestampUtc: Date | string;
  temperatureC: number | null;
  cloudcoverPct?: number | null;
  solarRadiation?: number | null;
};

/** Daily weather features derived from hourly rows (UTC date key). */
export type DailyWeatherFeatures = {
  dailyAvgTempC: number | null;
  dailyMinTempC: number | null;
  dailyMaxTempC: number | null;
  heatingDegreeSeverity: number;
  coolingDegreeSeverity: number;
  freezeHoursCount: number;
  solarRadiationDailyTotal: number;
  cloudcoverAvg: number | null;
  extremeCold: boolean;
  freezeDay: boolean;
};

/** Training aggregates for weather-based day-total adjustment (by bucket: month+daytype, season+daytype, global). */
export type TrainingWeatherStats = {
  byMonthDaytype: Map<string, { avgDayKwh: number; avgHdd: number; avgCdd: number; count: number }>;
  bySeasonDaytype: Map<string, { avgDayKwh: number; avgHdd: number; avgCdd: number; count: number }>;
  global: { avgDayKwhWd: number; avgDayKwhWe: number; avgHddWd: number; avgHddWe: number; avgCddWd: number; avgCddWe: number; countWd: number; countWe: number };
};

/** Result of weather-based day total adjustment. */
export type WeatherAdjustmentResult = {
  finalSelectedDayKwh: number;
  weatherSeverityMultiplier: number;
  weatherModeUsed: "heating" | "cooling" | "neutral";
  auxHeatKwhAdder: number;
  poolFreezeProtectKwhAdder: number;
  dayClassification: WeatherDayClassification;
};

/** Day classification for weather diagnostics. */
export type WeatherDayClassification =
  | "normal_day"
  | "weather_scaled_day"
  | "extreme_cold_event_day"
  | "freeze_protect_day";

const HEATING_BASE_C = 18;
const COOLING_BASE_C = 22;
const WEATHER_SEVERITY_THRESHOLD = 2;
/** Heating: scale only when relative deviation > 30%. Align with shared past-day simulator. */
const HEATING_DEADBAND_PCT = 0.3;
/** Cooling: scale only when relative deviation > 25%. Align with shared past-day simulator. */
const COOLING_DEADBAND_PCT = 0.25;
const HEATING_MULT_MIN = 0.9;
const HEATING_MULT_MAX = 1.35;
const COOLING_MULT_MIN = 0.9;
const COOLING_MULT_MAX = 1.25;
const AUX_HEAT_SLOPE = 0.15;
/** Phase 1 safety cap: aux heat adder per day (kWh). Align with shared past-day simulator. */
const AUX_HEAT_KWH_CAP = 12;
/** Aux heat only when daily min temp <= 0 C. */
const AUX_MIN_TEMP_C = 0;
const AUX_HDD_RATIO = 1.35;
/** Aux heat only when at least this many hours at or below 0 C. */
const AUX_FREEZE_HOURS_MIN = 2;
const FREEZE_HOURS_THRESHOLD = 2;
const POOL_FREEZE_HOURS_MIN = 4;
const POOL_FREEZE_MIN_TEMP_C = 0;
const POOL_FREEZE_KWH_CAP = 8;
const POOL_FREEZE_HP_FACTOR = 0.75;

/**
 * Build daily weather features from hourly rows. Groups by date key.
 * If timezone is provided, keys are local date keys (YYYY-MM-DD in that tz); otherwise UTC.
 */
export function buildDailyWeatherFeaturesFromHourly(
  rows: WeatherHourlyRowForGapfill[],
  heatingBaseC: number = HEATING_BASE_C,
  coolingBaseC: number = COOLING_BASE_C,
  timezone?: string
): Map<string, DailyWeatherFeatures> {
  const byDate = new Map<string, { tempsC: number[]; cloud: number[]; solar: number[] }>();
  for (const r of rows ?? []) {
    const t = r.timestampUtc instanceof Date ? r.timestampUtc : new Date(r.timestampUtc);
    if (!Number.isFinite(t.getTime())) continue;
    const dateKey = timezone ? dateKeyInTimezone(t.toISOString(), timezone) : t.toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) continue;
    const tempC = r.temperatureC != null && Number.isFinite(r.temperatureC) ? r.temperatureC : null;
    let entry = byDate.get(dateKey);
    if (!entry) {
      entry = { tempsC: [], cloud: [], solar: [] };
      byDate.set(dateKey, entry);
    }
    if (tempC != null) entry.tempsC.push(tempC);
    if (r.cloudcoverPct != null && Number.isFinite(r.cloudcoverPct)) entry.cloud.push(r.cloudcoverPct);
    if (r.solarRadiation != null && Number.isFinite(r.solarRadiation)) entry.solar.push(r.solarRadiation);
  }

  const out = new Map<string, DailyWeatherFeatures>();
  Array.from(byDate.entries()).forEach(([dateKey, entry]) => {
    const temps = entry.tempsC;
    const n = temps.length;
    const dailyAvgTempC = n > 0 ? temps.reduce((a, b) => a + b, 0) / n : null;
    const dailyMinTempC = n > 0 ? Math.min(...temps) : null;
    const dailyMaxTempC = n > 0 ? Math.max(...temps) : null;
    const heatingDegreeSeverity = temps.reduce((s, t) => s + Math.max(0, heatingBaseC - t), 0);
    const coolingDegreeSeverity = temps.reduce((s, t) => s + Math.max(0, t - coolingBaseC), 0);
    const freezeHoursCount = temps.filter((t) => t <= 0).length;
    const solarRadiationDailyTotal = entry.solar.length > 0 ? entry.solar.reduce((a, b) => a + b, 0) : 0;
    const cloudcoverAvg = entry.cloud.length > 0 ? entry.cloud.reduce((a, b) => a + b, 0) / entry.cloud.length : null;
    const extremeCold = dailyMinTempC != null && dailyMinTempC <= 0;
    const freezeDay = freezeHoursCount >= FREEZE_HOURS_THRESHOLD;
    out.set(dateKey, {
      dailyAvgTempC,
      dailyMinTempC,
      dailyMaxTempC,
      heatingDegreeSeverity,
      coolingDegreeSeverity,
      freezeHoursCount,
      solarRadiationDailyTotal,
      cloudcoverAvg,
      extremeCold,
      freezeDay,
    });
  });
  return out;
}

/** Convert DB daily weather (HouseDailyWeather / getHouseWeatherDays) to DailyWeatherFeatures for gap-fill sim. */
export function dailyWeatherFromDbToFeatures(
  byDateKey: Map<string, { tAvgF: number; tMinF: number; tMaxF: number; hdd65: number; cdd65: number }>
): Map<string, DailyWeatherFeatures> {
  const out = new Map<string, DailyWeatherFeatures>();
  Array.from(byDateKey.entries()).forEach(([dateKey, w]) => {
    if (!w || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return;
    const tAvgC = ((Number(w.tAvgF) || 0) - 32) * (5 / 9);
    const tMinC = ((Number(w.tMinF) ?? w.tAvgF) - 32) * (5 / 9);
    const tMaxC = ((Number(w.tMaxF) ?? w.tAvgF) - 32) * (5 / 9);
    const heatingDegreeSeverity = Math.max(0, Number(w.hdd65) || 0);
    const coolingDegreeSeverity = Math.max(0, Number(w.cdd65) || 0);
    const freezeHoursCount = tMinC <= 0 ? 24 : 0;
    out.set(dateKey, {
      dailyAvgTempC: Number.isFinite(tAvgC) ? tAvgC : null,
      dailyMinTempC: Number.isFinite(tMinC) ? tMinC : null,
      dailyMaxTempC: Number.isFinite(tMaxC) ? tMaxC : null,
      heatingDegreeSeverity,
      coolingDegreeSeverity,
      freezeHoursCount,
      solarRadiationDailyTotal: 0,
      cloudcoverAvg: null,
      extremeCold: tMinC <= 0,
      freezeDay: freezeHoursCount >= FREEZE_HOURS_THRESHOLD,
    });
  });
  return out;
}

function getSeasonBucket(monthKey: string): "winter" | "spring" | "summer" | "fall" {
  const m = parseInt(monthKey.slice(5, 7), 10) || 1;
  if (m === 12 || m <= 2) return "winter";
  if (m >= 3 && m <= 5) return "spring";
  if (m >= 6 && m <= 8) return "summer";
  return "fall";
}

/**
 * Build training weather stats from training date keys, actual day kWh per date, and weather features.
 * Buckets: monthKey:wd|we, season:wd|we, global wd/we.
 */
export function buildTrainingWeatherStats(args: {
  trainingDateKeys: string[];
  trainingDayKwhByDate: Map<string, number>;
  weatherByDateKey: Map<string, DailyWeatherFeatures>;
  isWeekend: (dateKey: string) => boolean;
}): TrainingWeatherStats {
  const { trainingDateKeys, trainingDayKwhByDate, weatherByDateKey, isWeekend } = args;
  const byMonthDaytype = new Map<string, { sumKwh: number; sumHdd: number; sumCdd: number; count: number }>();
  const bySeasonDaytype = new Map<string, { sumKwh: number; sumHdd: number; sumCdd: number; count: number }>();
  let sumKwhWd = 0, sumKwhWe = 0, sumHddWd = 0, sumHddWe = 0, sumCddWd = 0, sumCddWe = 0, countWd = 0, countWe = 0;

  for (const dateKey of trainingDateKeys) {
    const kwh = trainingDayKwhByDate.get(dateKey);
    const wx = weatherByDateKey.get(dateKey);
    if (kwh == null || !Number.isFinite(kwh) || !wx) continue;
    const weekend = isWeekend(dateKey);
    const monthKey = dateKey.slice(0, 7);
    const season = getSeasonBucket(monthKey);
    const bucket = `${monthKey}:${weekend ? "we" : "wd"}`;
    const seasonBucket = `${season}:${weekend ? "we" : "wd"}`;

    const hdd = wx.heatingDegreeSeverity;
    const cdd = wx.coolingDegreeSeverity;

    const add = (map: Map<string, { sumKwh: number; sumHdd: number; sumCdd: number; count: number }>, key: string) => {
      let e = map.get(key);
      if (!e) {
        e = { sumKwh: 0, sumHdd: 0, sumCdd: 0, count: 0 };
        map.set(key, e);
      }
      e.sumKwh += kwh;
      e.sumHdd += hdd;
      e.sumCdd += cdd;
      e.count += 1;
    };
    add(byMonthDaytype, bucket);
    add(bySeasonDaytype, seasonBucket);

    if (weekend) {
      sumKwhWe += kwh;
      sumHddWe += hdd;
      sumCddWe += cdd;
      countWe++;
    } else {
      sumKwhWd += kwh;
      sumHddWd += hdd;
      sumCddWd += cdd;
      countWd++;
    }
  }

  const toAvg = (map: Map<string, { sumKwh: number; sumHdd: number; sumCdd: number; count: number }>) => {
    const out = new Map<string, { avgDayKwh: number; avgHdd: number; avgCdd: number; count: number }>();
    map.forEach((v, k) => {
      const n = v.count;
      out.set(k, n > 0 ? { avgDayKwh: v.sumKwh / n, avgHdd: v.sumHdd / n, avgCdd: v.sumCdd / n, count: n } : { avgDayKwh: 0, avgHdd: 0, avgCdd: 0, count: 0 });
    });
    return out;
  };

  return {
    byMonthDaytype: toAvg(byMonthDaytype),
    bySeasonDaytype: toAvg(bySeasonDaytype),
    global: {
      avgDayKwhWd: countWd > 0 ? sumKwhWd / countWd : 0,
      avgDayKwhWe: countWe > 0 ? sumKwhWe / countWe : 0,
      avgHddWd: countWd > 0 ? sumHddWd / countWd : 0,
      avgHddWe: countWe > 0 ? sumHddWe / countWe : 0,
      avgCddWd: countWd > 0 ? sumCddWd / countWd : 0,
      avgCddWe: countWe > 0 ? sumCddWe / countWe : 0,
      countWd,
      countWe,
    },
  };
}

/** Minimal home profile for weather adjustment (all-electric / electric heat / pool). */
export type GapfillHomeProfileForWeather = {
  fuelConfiguration?: string | null;
  heatingType?: string | null;
  hvacType?: string | null;
  pool?: { hasPool?: boolean; pumpType?: string | null; pumpHp?: number | null } | null;
};

/**
 * Compute weather-adjusted day total: final = profileSelectedDayKwh × weatherSeverityMultiplier + auxHeatKwhAdder + poolFreezeProtectKwhAdder.
 */
export function computeWeatherAdjustedDayTotal(args: {
  baseDayKwh: number;
  localDate: string;
  weatherByDateKey: Map<string, DailyWeatherFeatures>;
  trainingStats: TrainingWeatherStats;
  isWeekend: boolean;
  homeProfile?: GapfillHomeProfileForWeather | null;
  applianceProfile?: { appliances?: Array<{ type?: string; data?: Record<string, unknown> }> } | null;
}): WeatherAdjustmentResult {
  const { baseDayKwh, localDate, weatherByDateKey, trainingStats, isWeekend, homeProfile, applianceProfile } = args;
  const wx = weatherByDateKey.get(localDate);
  const monthKey = localDate.slice(0, 7);
  const season = getSeasonBucket(monthKey);
  const bucket = `${monthKey}:${isWeekend ? "we" : "wd"}`;
  const seasonBucket = `${season}:${isWeekend ? "we" : "wd"}`;

  let weatherSeverityMultiplier = 1;
  let weatherModeUsed: "heating" | "cooling" | "neutral" = "neutral";
  let auxHeatKwhAdder = 0;
  let poolFreezeProtectKwhAdder = 0;

  if (!wx) {
    return {
      finalSelectedDayKwh: baseDayKwh,
      weatherSeverityMultiplier: 1,
      weatherModeUsed: "neutral",
      auxHeatKwhAdder: 0,
      poolFreezeProtectKwhAdder: 0,
      dayClassification: "normal_day",
    };
  }

  const refMonth = trainingStats.byMonthDaytype.get(bucket);
  const refSeason = trainingStats.bySeasonDaytype.get(seasonBucket);
  const refGlobal = trainingStats.global;
  const refHdd = refMonth?.avgHdd ?? refSeason?.avgHdd ?? (isWeekend ? refGlobal.avgHddWe : refGlobal.avgHddWd);
  const refCdd = refMonth?.avgCdd ?? refSeason?.avgCdd ?? (isWeekend ? refGlobal.avgCddWe : refGlobal.avgCddWd);
  const { heatingDegreeSeverity: testHdd, coolingDegreeSeverity: testCdd } = wx;

  if (testHdd > testCdd && testHdd > WEATHER_SEVERITY_THRESHOLD) {
    weatherModeUsed = "heating";
    if (refHdd > 1e-6) {
      const ratio = testHdd / refHdd;
      if (ratio >= 1 - HEATING_DEADBAND_PCT && ratio <= 1 + HEATING_DEADBAND_PCT) {
        weatherSeverityMultiplier = 1;
      } else {
        weatherSeverityMultiplier = Math.max(HEATING_MULT_MIN, Math.min(HEATING_MULT_MAX, ratio));
      }
    }
  } else if (testCdd > testHdd && testCdd > WEATHER_SEVERITY_THRESHOLD) {
    weatherModeUsed = "cooling";
    if (refCdd > 1e-6) {
      const ratio = testCdd / refCdd;
      if (ratio >= 1 - COOLING_DEADBAND_PCT && ratio <= 1 + COOLING_DEADBAND_PCT) {
        weatherSeverityMultiplier = 1;
      } else {
        weatherSeverityMultiplier = Math.max(COOLING_MULT_MIN, Math.min(COOLING_MULT_MAX, ratio));
      }
    }
  }

  const isElectricHeat =
    homeProfile?.fuelConfiguration === "all_electric" || homeProfile?.heatingType === "electric";
  const dailyMinOkForAux = wx.dailyMinTempC != null && wx.dailyMinTempC <= AUX_MIN_TEMP_C;
  const freezeHoursOkForAux = wx.freezeHoursCount >= AUX_FREEZE_HOURS_MIN;
  const hddRatioOkForAux = (refHdd || 0) > 1e-6 && wx.heatingDegreeSeverity >= (refHdd || 0) * AUX_HDD_RATIO;
  if (isElectricHeat && dailyMinOkForAux && freezeHoursOkForAux && hddRatioOkForAux) {
    const ref = Math.max(refHdd || 0, 1);
    auxHeatKwhAdder = Math.max(0, Math.min(AUX_HEAT_KWH_CAP, (wx.heatingDegreeSeverity - ref) * AUX_HEAT_SLOPE));
  }

  const hasPool = Boolean(homeProfile?.pool?.hasPool) || (applianceProfile?.appliances ?? []).some((a) => a?.type === "pool");
  const pumpHp = homeProfile?.pool?.pumpHp ?? (applianceProfile?.appliances ?? []).find((a) => a?.type === "pool")?.data?.pump_hp;
  const freezeHoursOk = wx.freezeHoursCount >= POOL_FREEZE_HOURS_MIN;
  const dailyMinOkForPool = wx.dailyMinTempC != null && wx.dailyMinTempC <= POOL_FREEZE_MIN_TEMP_C;
  if (hasPool && freezeHoursOk && dailyMinOkForPool) {
    const hp = pumpHp != null && Number.isFinite(Number(pumpHp)) ? Number(pumpHp) : 1;
    poolFreezeProtectKwhAdder = Math.max(0, Math.min(POOL_FREEZE_KWH_CAP, hp * POOL_FREEZE_HP_FACTOR * Math.max(1, wx.freezeHoursCount / 4)));
  }

  const finalSelectedDayKwh = baseDayKwh * weatherSeverityMultiplier + auxHeatKwhAdder + poolFreezeProtectKwhAdder;

  let dayClassification: WeatherDayClassification;
  if (auxHeatKwhAdder > 0) {
    dayClassification = "extreme_cold_event_day";
  } else if (poolFreezeProtectKwhAdder > 0) {
    dayClassification = "freeze_protect_day";
  } else if (weatherSeverityMultiplier !== 1) {
    dayClassification = "weather_scaled_day";
  } else {
    dayClassification = "normal_day";
  }

  return {
    finalSelectedDayKwh: Math.max(0, finalSelectedDayKwh),
    weatherSeverityMultiplier,
    weatherModeUsed,
    auxHeatKwhAdder,
    poolFreezeProtectKwhAdder,
    dayClassification,
  };
}
