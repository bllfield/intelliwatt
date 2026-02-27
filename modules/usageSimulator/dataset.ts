import { generateSimulatedCurve } from "@/modules/simulatedUsage/engine";
import type { SimulatedCurve } from "@/modules/simulatedUsage/types";

type UsageSeriesPoint = { timestamp: string; kwh: number };

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function low10Average(values: number[]): number | null {
  const finite = (values ?? []).filter((v) => Number.isFinite(v));
  if (!finite.length) return null;
  const positive = finite.filter((v) => v > 1e-6).sort((a, b) => a - b);
  const count10 = Math.max(1, Math.floor((positive.length || finite.length) * 0.1));
  const slice =
    positive.length >= count10
      ? positive.slice(0, count10)
      : finite.sort((a, b) => a - b).slice(0, Math.max(1, Math.floor(finite.length * 0.1)));
  if (!slice.length) return null;
  const avg = slice.reduce((a, b) => a + b, 0) / slice.length;
  return Number.isFinite(avg) ? round2(avg) : null;
}

type BaseloadOptions = {
  excludedDateKeys?: Set<string>;
  minDayKwhFloor?: number;
  baseloadDayMultiplier?: number;
  percentile?: number;
};

function dateKeyUtcFromIso(tsIso: string): string {
  return tsIso.slice(0, 10);
}

function percentileCont(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo]!;
  const w = idx - lo;
  return sorted[lo]! * (1 - w) + sorted[hi]! * w;
}

function computeNormalLifeBaseloadKw(
  intervals: Array<{ tsIso: string; kwh: number }>,
  options: BaseloadOptions = {}
): { baseloadKw: number | null; fallbackUsed: boolean; debugNote: string | null } {
  const minDayKwhFloor = Number.isFinite(options.minDayKwhFloor) ? Number(options.minDayKwhFloor) : 4;
  const baseloadDayMultiplier = Number.isFinite(options.baseloadDayMultiplier)
    ? Number(options.baseloadDayMultiplier)
    : 1.3;
  const percentile = Number.isFinite(options.percentile) ? Number(options.percentile) : 0.1;
  const excluded = options.excludedDateKeys;

  const kept: Array<{ tsIso: string; kwh: number; dayKey: string }> = [];
  for (const row of intervals ?? []) {
    const tsIso = String(row?.tsIso ?? "");
    const kwh = Number(row?.kwh);
    if (!tsIso || !Number.isFinite(kwh)) continue;
    const dayKey = dateKeyUtcFromIso(tsIso);
    if (excluded?.has(dayKey)) continue;
    kept.push({ tsIso, kwh, dayKey });
  }

  const dayTotals = new Map<string, number>();
  for (const row of kept) dayTotals.set(row.dayKey, (dayTotals.get(row.dayKey) ?? 0) + row.kwh);
  const positiveDayTotals = Array.from(dayTotals.values())
    .filter((v) => Number.isFinite(v) && v > 1e-6)
    .sort((a, b) => a - b);
  const lowCount = Math.max(1, Math.floor(positiveDayTotals.length * 0.2));
  const lowSlice = positiveDayTotals.slice(0, lowCount);
  const avgLowDayKwh =
    lowSlice.length > 0 ? lowSlice.reduce((a, b) => a + b, 0) / lowSlice.length : null;
  const baseloadKwhPerDayCandidate = avgLowDayKwh ?? 0;
  const minDayKwh = Math.max(minDayKwhFloor, baseloadKwhPerDayCandidate * baseloadDayMultiplier);

  const qualityDays = new Set<string>();
  dayTotals.forEach((total, dayKey) => {
    if ((Number(total) || 0) >= minDayKwh) qualityDays.add(dayKey);
  });
  const qualityRows = kept.filter((row) => qualityDays.has(row.dayKey));
  const filteredKwSamples = qualityRows
    .map((row) => (Number(row.kwh) || 0) * 4)
    .filter((kw) => Number.isFinite(kw) && kw > 1e-6)
    .sort((a, b) => a - b);

  if (filteredKwSamples.length < 500) {
    const fallbackKw = kept
      .map((row) => (Number(row.kwh) || 0) * 4)
      .filter((kw) => Number.isFinite(kw) && kw > 1e-6)
      .sort((a, b) => a - b);
    const p10Fallback = percentileCont(fallbackKw, percentile);
    const fallbackSlice = p10Fallback == null ? [] : fallbackKw.filter((kw) => kw <= p10Fallback);
    const fallbackAvg =
      fallbackSlice.length > 0
        ? fallbackSlice.reduce((a, b) => a + b, 0) / fallbackSlice.length
        : null;
    return {
      baseloadKw: fallbackAvg == null ? null : round2(fallbackAvg),
      fallbackUsed: true,
      debugNote: "Baseload fallback used: fewer than 500 filtered interval samples.",
    };
  }

  const p10 = percentileCont(filteredKwSamples, percentile);
  const pool = p10 == null ? [] : filteredKwSamples.filter((kw) => kw <= p10);
  const avg = pool.length > 0 ? pool.reduce((a, b) => a + b, 0) / pool.length : null;
  return { baseloadKw: avg == null ? null : round2(avg), fallbackUsed: false, debugNote: null };
}

function toDateKey(tsIso: string): string {
  return tsIso.slice(0, 10);
}

function dayOfWeekUtc(dateKey: string): number {
  const d = new Date(`${dateKey}T00:00:00.000Z`);
  const t = d.getTime();
  if (!Number.isFinite(t)) return 0;
  return d.getUTCDay();
}

function daysInMonth(year: number, month1: number): number {
  if (!Number.isFinite(year) || !Number.isFinite(month1) || month1 < 1 || month1 > 12) return 31;
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

function chicagoParts(ts: Date): { year: number; month: number; day: number; yearMonth: string } | null {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Chicago",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const parts = fmt.formatToParts(ts);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
    const year = Number(get("year"));
    const month = Number(get("month"));
    const day = Number(get("day"));
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return { year, month, day, yearMonth: `${String(year)}-${String(month).padStart(2, "0")}` };
  } catch {
    return null;
  }
}

function lastNYearMonthsFrom(year: number, month1: number, n: number): string[] {
  const out: string[] = [];
  const count = Math.max(1, Math.floor(n));
  for (let i = count - 1; i >= 0; i--) {
    const idx = month1 - i;
    const y = idx >= 1 ? year : year - Math.ceil((1 - idx) / 12);
    const m = ((idx - 1) % 12 + 12) % 12 + 1;
    out.push(`${String(y)}-${String(m).padStart(2, "0")}`);
  }
  return out;
}

function buildDisplayMonthlyFromIntervals(args: {
  intervals: Array<{ timestamp: string; consumption_kwh: number }>;
  endDate: string;
}): {
  monthly: Array<{ month: string; kwh: number }>;
  stitchedMonth:
    | {
        mode: "PRIOR_YEAR_TAIL";
        yearMonth: string;
        haveDaysThrough: number;
        missingDaysFrom: number;
        missingDaysTo: number;
        borrowedFromYearMonth: string;
        completenessRule: string;
      }
    | null;
} {
  const monthTotals = new Map<string, number>();
  const dayTotals = new Map<string, number>(); // `${YYYY-MM}-${DD}`
  for (const iv of args.intervals ?? []) {
    const ts = new Date(String(iv?.timestamp ?? ""));
    if (!Number.isFinite(ts.getTime())) continue;
    const p = chicagoParts(ts);
    if (!p) continue;
    const kwh = Number(iv?.consumption_kwh) || 0;
    monthTotals.set(p.yearMonth, (monthTotals.get(p.yearMonth) ?? 0) + kwh);
    const dayKey = `${p.yearMonth}-${String(p.day).padStart(2, "0")}`;
    dayTotals.set(dayKey, (dayTotals.get(dayKey) ?? 0) + kwh);
  }

  const endAnchor = new Date(`${String(args.endDate).slice(0, 10)}T23:59:59.999Z`);
  const endParts = chicagoParts(endAnchor);
  if (!endParts) {
    const fallback = Array.from(monthTotals.entries())
      .map(([month, kwh]) => ({ month, kwh: round2(kwh) }))
      .sort((a, b) => (a.month < b.month ? -1 : 1));
    return { monthly: fallback, stitchedMonth: null };
  }

  const yearMonths = lastNYearMonthsFrom(endParts.year, endParts.month, 12);
  const displayTotals = new Map<string, number>();
  for (const ym of yearMonths) displayTotals.set(ym, monthTotals.get(ym) ?? 0);

  const dim = daysInMonth(endParts.year, endParts.month);
  const haveDaysThrough = Math.max(0, Math.min(dim, endParts.day));
  let stitchedMonth: {
    mode: "PRIOR_YEAR_TAIL";
    yearMonth: string;
    haveDaysThrough: number;
    missingDaysFrom: number;
    missingDaysTo: number;
    borrowedFromYearMonth: string;
    completenessRule: string;
  } | null = null;

  if (haveDaysThrough < dim) {
    const borrowedFromYearMonth = `${String(endParts.year - 1)}-${String(endParts.month).padStart(2, "0")}`;
    let stitchedKwh = 0;
    for (let d = 1; d <= haveDaysThrough; d++) {
      const k = `${endParts.yearMonth}-${String(d).padStart(2, "0")}`;
      stitchedKwh += dayTotals.get(k) ?? 0;
    }
    for (let d = haveDaysThrough + 1; d <= dim; d++) {
      const k = `${borrowedFromYearMonth}-${String(d).padStart(2, "0")}`;
      stitchedKwh += dayTotals.get(k) ?? 0;
    }
    displayTotals.set(endParts.yearMonth, stitchedKwh);
    stitchedMonth = {
      mode: "PRIOR_YEAR_TAIL",
      yearMonth: endParts.yearMonth,
      haveDaysThrough,
      missingDaysFrom: haveDaysThrough + 1,
      missingDaysTo: dim,
      borrowedFromYearMonth,
      completenessRule: "SIMULATED_INTERVALS",
    };
  }

  const monthly = yearMonths.map((month) => ({ month, kwh: round2(displayTotals.get(month) ?? 0) }));
  return { monthly, stitchedMonth };
}

function computeFifteenMinuteAverages(intervals: Array<{ timestamp: string; consumption_kwh: number }>) {
  const buckets = new Map<string, { sumKw: number; count: number }>();
  for (let i = 0; i < intervals.length; i++) {
    const ts = intervals[i].timestamp;
    const hhmm = ts.slice(11, 16);
    const kwh = Number(intervals[i].consumption_kwh) || 0;
    const kw = kwh * 4;
    const cur = buckets.get(hhmm) ?? { sumKw: 0, count: 0 };
    cur.sumKw += kw;
    cur.count += 1;
    buckets.set(hhmm, cur);
  }
  return Array.from(buckets.entries())
    .map(([hhmm, v]) => ({ hhmm, avgKw: v.count > 0 ? round2(v.sumKw / v.count) : 0 }))
    .sort((a, b) => (a.hhmm < b.hhmm ? -1 : 1));
}

function chicagoHour(ts: Date): number | null {
  try {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Chicago",
      hour: "numeric",
      hour12: false,
    });
    const parts = fmt.formatToParts(ts);
    const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "");
    if (!Number.isFinite(hour) || hour < 0 || hour > 23) return null;
    return hour;
  } catch {
    return null;
  }
}

function computeTimeOfDayBuckets(intervals: Array<{ timestamp: string; consumption_kwh: number }>) {
  const sums = { overnight: 0, morning: 0, afternoon: 0, evening: 0 };
  for (const iv of intervals ?? []) {
    const ts = new Date(String(iv?.timestamp ?? ""));
    if (!Number.isFinite(ts.getTime())) continue;
    const hour = chicagoHour(ts);
    if (hour == null) continue;
    const kwh = Number(iv?.consumption_kwh) || 0;
    if (hour < 6) sums.overnight += kwh;
    else if (hour < 12) sums.morning += kwh;
    else if (hour < 18) sums.afternoon += kwh;
    else sums.evening += kwh;
  }
  return [
    { key: "overnight", label: "Overnight (12am–6am)", kwh: round2(sums.overnight) },
    { key: "morning", label: "Morning (6am–12pm)", kwh: round2(sums.morning) },
    { key: "afternoon", label: "Afternoon (12pm–6pm)", kwh: round2(sums.afternoon) },
    { key: "evening", label: "Evening (6pm–12am)", kwh: round2(sums.evening) },
  ];
}

function excludedDateKeysFromTravelRanges(
  ranges: Array<{ startDate: string; endDate: string }> | undefined
): Set<string> {
  const out = new Set<string>();
  for (const r of ranges ?? []) {
    const start = String(r?.startDate ?? "").slice(0, 10);
    const end = String(r?.endDate ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) continue;
    const a = new Date(start + "T12:00:00.000Z");
    const b = new Date(end + "T12:00:00.000Z");
    if (!Number.isFinite(a.getTime()) || !Number.isFinite(b.getTime())) continue;
    let ms = Math.min(a.getTime(), b.getTime());
    const last = Math.max(a.getTime(), b.getTime());
    while (ms <= last) {
      out.add(new Date(ms).toISOString().slice(0, 10));
      ms += 24 * 60 * 60 * 1000;
    }
  }
  return out;
}

export type SimulatorBuildInputsV1 = {
  version: 1;
  mode: "MANUAL_TOTALS" | "NEW_BUILD_ESTIMATE" | "SMT_BASELINE";
  baseKind: "MANUAL" | "ESTIMATED" | "SMT_ACTUAL_BASELINE";
  canonicalEndMonth: string;
  canonicalMonths: string[];
  // For manual billing-period semantics (V1): optional explicit periods overriding calendar-month bucketing.
  canonicalPeriods?: Array<{ id: string; startDate: string; endDate: string }>;
  weatherPreference?: "NONE" | "LAST_YEAR_WEATHER" | "LONG_TERM_AVERAGE";
  weatherNormalizerVersion?: string;
  monthlyTotalsKwhByMonth: Record<string, number>;
  intradayShape96: number[];
  weekdayWeekendShape96?: { weekday: number[]; weekend: number[] };
  travelRanges?: Array<{ startDate: string; endDate: string }>;
  notes?: string[];
  filledMonths?: string[];
  // Snapshots (for auditing / future UI): not required for regen.
  snapshots?: {
    manualUsagePayload?: any;
    homeProfile?: any;
    applianceProfile?: any;
    baselineHomeProfile?: any;
    baselineApplianceProfile?: any;
    actualSource?: "SMT" | "GREEN_BUTTON" | null;
    actualMonthlyAnchorsByMonth?: Record<string, number>;
    actualIntradayShape96?: number[];
    smtMonthlyAnchorsByMonth?: Record<string, number>;
    smtIntradayShape96?: number[];
    // Scenario audit fields (not used for regen)
    scenario?: { id: string; name: string } | null;
    scenarioEvents?: any[];
    scenarioOverlay?: any;
    // Workspace chaining audit (Future based on Past)
    pastScenario?: { id: string; name: string } | null;
    pastScenarioEvents?: any[];
  };
};

export type SimulatedUsageDatasetMeta = {
  datasetKind: "SIMULATED";
  baseKind: SimulatorBuildInputsV1["baseKind"];
  mode: SimulatorBuildInputsV1["mode"];
  canonicalEndMonth: string;
  notes: string[];
  filledMonths: string[];
  excludedDays: number;
  renormalized: boolean;
  // Hybrid gap-fill support (V1): which months are actual vs simulated.
  monthProvenanceByMonth?: Record<string, "ACTUAL" | "SIMULATED">;
  actualSource?: "SMT" | "GREEN_BUTTON" | null;
  // Service-attached metadata (persisted build)
  buildInputsHash?: string;
  lastBuiltAt?: string | null;
  scenarioKey?: string;
  scenarioId?: string | null;
};

export type SimulatedUsageDataset = {
  summary: {
    source: "SIMULATED";
    intervalsCount: number;
    totalKwh: number;
    start: string;
    end: string;
    latest: string;
  };
  series: {
    intervals15: Array<{ timestamp: string; kwh: number }>;
    hourly: Array<{ timestamp: string; kwh: number }>;
    daily: Array<{ timestamp: string; kwh: number }>;
    monthly: Array<{ timestamp: string; kwh: number }>;
    annual: Array<{ timestamp: string; kwh: number }>;
  };
  daily: Array<{ date: string; kwh: number }>;
  monthly: Array<{ month: string; kwh: number }>;
  insights: {
    fifteenMinuteAverages: Array<{ hhmm: string; avgKw: number }>;
    timeOfDayBuckets: any[];
    stitchedMonth: any;
    peakDay: { date: string; kwh: number } | null;
    peakHour: any;
    baseload: any;
    baseloadMethod?: "FILTERED_NORMAL_LIFE_V1" | "FALLBACK_V1" | "SQL_P10_V1";
    baseloadFallbackUsed?: boolean;
    baseloadDebugNote?: string | null;
    baseloadDaily?: any;
    baseloadMonthly?: any;
    weekdayVsWeekend: { weekday: number; weekend: number };
  };
  totals: {
    importKwh: number;
    exportKwh: number;
    netKwh: number;
  };
  meta: SimulatedUsageDatasetMeta;
  /** Monthly usage buckets (e.g. kwh.m.all.total per YYYY-MM) for plan costing; same shape as buildUsageBucketsForEstimate. */
  usageBucketsByMonth: Record<string, Record<string, number>>;
};

export function buildSimulatedUsageDatasetFromBuildInputs(
  buildInputs: SimulatorBuildInputsV1,
  options?: { excludedDateKeys?: Set<string> }
): SimulatedUsageDataset {
  const curve = generateSimulatedCurve({
    canonicalMonths: buildInputs.canonicalMonths,
    periods: (buildInputs as any).canonicalPeriods ?? undefined,
    monthlyTotalsKwhByMonth: buildInputs.monthlyTotalsKwhByMonth,
    intradayShape96: buildInputs.intradayShape96,
    weekdayWeekendShape96: buildInputs.weekdayWeekendShape96,
    travelRanges: buildInputs.travelRanges,
  });

  const dailyMap = new Map<string, number>();
  for (let j = 0; j < curve.intervals.length; j++) {
    const dk = toDateKey(curve.intervals[j].timestamp);
    dailyMap.set(dk, (dailyMap.get(dk) ?? 0) + (Number(curve.intervals[j].consumption_kwh) || 0));
  }
  const daily = Array.from(dailyMap.entries())
    .map(([date, kwh]) => ({ date, kwh: round2(kwh) }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  const monthlyBuild = buildDisplayMonthlyFromIntervals({
    intervals: curve.intervals,
    endDate: curve.end,
  });
  const monthly = monthlyBuild.monthly;
  const totalFromMonthly = round2(monthly.reduce((s, m) => s + (Number(m.kwh) || 0), 0));

  const seriesDaily: UsageSeriesPoint[] = daily.map((d) => ({ timestamp: `${d.date}T00:00:00.000Z`, kwh: d.kwh }));
  const seriesMonthly: UsageSeriesPoint[] = monthly.map((m) => ({ timestamp: `${m.month}-01T00:00:00.000Z`, kwh: m.kwh }));
  const seriesAnnual: UsageSeriesPoint[] = [{ timestamp: curve.end.slice(0, 4) + "-01-01T00:00:00.000Z", kwh: totalFromMonthly }];

  const fifteenMinuteAverages = computeFifteenMinuteAverages(curve.intervals);
  const timeOfDayBuckets = computeTimeOfDayBuckets(curve.intervals);

  let weekdaySum = 0;
  let weekendSum = 0;
  for (let j = 0; j < daily.length; j++) {
    const dow = dayOfWeekUtc(daily[j].date);
    if (dow === 0 || dow === 6) weekendSum += daily[j].kwh;
    else weekdaySum += daily[j].kwh;
  }

  const peakDay = daily.length > 0 ? daily.reduce((a, b) => (b.kwh > a.kwh ? b : a)) : null;

  const excludedDateKeys = options?.excludedDateKeys ?? excludedDateKeysFromTravelRanges(buildInputs.travelRanges);
  const baseloadComputed = computeNormalLifeBaseloadKw(
    curve.intervals.map((i) => ({ tsIso: String(i.timestamp ?? ""), kwh: Number(i.consumption_kwh) || 0 })),
    { excludedDateKeys: excludedDateKeys.size > 0 ? excludedDateKeys : undefined }
  );
  const baseload = baseloadComputed.baseloadKw;
  const baseloadMethod: "FILTERED_NORMAL_LIFE_V1" | "FALLBACK_V1" | "SQL_P10_V1" = baseloadComputed
    .fallbackUsed
    ? "FALLBACK_V1"
    : "FILTERED_NORMAL_LIFE_V1";
  const baseloadDaily = low10Average(daily.map((d) => Number(d.kwh) || 0));
  const baseloadMonthly = low10Average(monthly.map((m) => Number(m.kwh) || 0));

  const usageBucketsByMonth = usageBucketsByMonthFromSimulatedMonthly(monthly);

  return {
    summary: {
      source: "SIMULATED" as const,
      intervalsCount: curve.intervals.length,
      totalKwh: totalFromMonthly,
      start: curve.start,
      end: curve.end,
      latest: curve.end,
    },
    series: {
      intervals15: [] as UsageSeriesPoint[],
      hourly: [] as UsageSeriesPoint[],
      daily: seriesDaily,
      monthly: seriesMonthly,
      annual: seriesAnnual,
    },
    daily,
    monthly,
    insights: {
      fifteenMinuteAverages,
      timeOfDayBuckets,
      stitchedMonth: monthlyBuild.stitchedMonth,
      peakDay: peakDay ? { date: peakDay.date, kwh: peakDay.kwh } : null,
      peakHour: null,
      baseload,
      baseloadMethod,
      baseloadFallbackUsed: baseloadComputed.fallbackUsed,
      baseloadDebugNote: baseloadComputed.debugNote,
      baseloadDaily,
      baseloadMonthly,
      weekdayVsWeekend: { weekday: round2(weekdaySum), weekend: round2(weekendSum) },
    },
    totals: {
      importKwh: totalFromMonthly,
      exportKwh: 0,
      netKwh: totalFromMonthly,
    },
    meta: {
      datasetKind: "SIMULATED",
      baseKind: buildInputs.baseKind,
      mode: buildInputs.mode,
      canonicalEndMonth: buildInputs.canonicalEndMonth,
      notes: buildInputs.notes ?? [],
      filledMonths: buildInputs.filledMonths ?? [],
      excludedDays: curve.meta.excludedDays,
      renormalized: curve.meta.renormalized,
    },
    usageBucketsByMonth,
  };
}

/** Build dataset from a precomputed curve (e.g. Past stitched actual + simulated). Use when the curve was built outside generateSimulatedCurve. */
export function buildSimulatedUsageDatasetFromCurve(
  curve: SimulatedCurve,
  meta: {
    baseKind: SimulatorBuildInputsV1["baseKind"];
    mode: SimulatorBuildInputsV1["mode"];
    canonicalEndMonth: string;
    notes?: string[];
    filledMonths?: string[];
  },
  options?: { excludedDateKeys?: Set<string> }
): SimulatedUsageDataset {
  const dailyMap = new Map<string, number>();
  for (let j = 0; j < curve.intervals.length; j++) {
    const dk = toDateKey(curve.intervals[j].timestamp);
    dailyMap.set(dk, (dailyMap.get(dk) ?? 0) + (Number(curve.intervals[j].consumption_kwh) || 0));
  }
  const daily = Array.from(dailyMap.entries())
    .map(([date, kwh]) => ({ date, kwh: round2(kwh) }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  const monthlyBuild = buildDisplayMonthlyFromIntervals({
    intervals: curve.intervals,
    endDate: curve.end,
  });
  const monthly = monthlyBuild.monthly;
  const totalFromMonthly = round2(monthly.reduce((s, m) => s + (Number(m.kwh) || 0), 0));

  const seriesDaily: UsageSeriesPoint[] = daily.map((d) => ({ timestamp: `${d.date}T00:00:00.000Z`, kwh: d.kwh }));
  const seriesMonthly: UsageSeriesPoint[] = monthly.map((m) => ({ timestamp: `${m.month}-01T00:00:00.000Z`, kwh: m.kwh }));
  const seriesAnnual: UsageSeriesPoint[] = [{ timestamp: curve.end.slice(0, 4) + "-01-01T00:00:00.000Z", kwh: totalFromMonthly }];
  const seriesIntervals15: UsageSeriesPoint[] = curve.intervals.map((i) => ({
    timestamp: i.timestamp,
    kwh: Number(i.consumption_kwh) || 0,
  }));

  const fifteenMinuteAverages = computeFifteenMinuteAverages(curve.intervals);
  const timeOfDayBuckets = computeTimeOfDayBuckets(curve.intervals);

  let weekdaySum = 0;
  let weekendSum = 0;
  for (let j = 0; j < daily.length; j++) {
    const dow = dayOfWeekUtc(daily[j].date);
    if (dow === 0 || dow === 6) weekendSum += daily[j].kwh;
    else weekdaySum += daily[j].kwh;
  }

  const peakDay = daily.length > 0 ? daily.reduce((a, b) => (b.kwh > a.kwh ? b : a)) : null;

  const baseloadComputed = computeNormalLifeBaseloadKw(
    curve.intervals.map((i) => ({ tsIso: String(i.timestamp ?? ""), kwh: Number(i.consumption_kwh) || 0 })),
    { excludedDateKeys: options?.excludedDateKeys }
  );
  const baseload = baseloadComputed.baseloadKw;
  const baseloadMethod: "FILTERED_NORMAL_LIFE_V1" | "FALLBACK_V1" | "SQL_P10_V1" = baseloadComputed
    .fallbackUsed
    ? "FALLBACK_V1"
    : "FILTERED_NORMAL_LIFE_V1";
  const baseloadDaily = low10Average(daily.map((d) => Number(d.kwh) || 0));
  const baseloadMonthly = low10Average(monthly.map((m) => Number(m.kwh) || 0));

  const usageBucketsByMonth = usageBucketsByMonthFromSimulatedMonthly(monthly);

  const startDateOnly = curve.start.slice(0, 10);
  const endDateOnly = curve.end.slice(0, 10);
  const summaryStart = /^\d{4}-\d{2}-\d{2}$/.test(startDateOnly) ? startDateOnly : curve.start;
  const summaryEnd = /^\d{4}-\d{2}-\d{2}$/.test(endDateOnly) ? endDateOnly : curve.end;

  return {
    summary: {
      source: "SIMULATED" as const,
      intervalsCount: curve.intervals.length,
      totalKwh: totalFromMonthly,
      start: summaryStart,
      end: summaryEnd,
      latest: summaryEnd,
    },
    series: {
      intervals15: seriesIntervals15,
      hourly: [] as UsageSeriesPoint[],
      daily: seriesDaily,
      monthly: seriesMonthly,
      annual: seriesAnnual,
    },
    daily,
    monthly,
    insights: {
      fifteenMinuteAverages,
      timeOfDayBuckets,
      stitchedMonth: monthlyBuild.stitchedMonth,
      peakDay: peakDay ? { date: peakDay.date, kwh: peakDay.kwh } : null,
      peakHour: null,
      baseload,
      baseloadMethod,
      baseloadFallbackUsed: baseloadComputed.fallbackUsed,
      baseloadDebugNote: baseloadComputed.debugNote,
      baseloadDaily,
      baseloadMonthly,
      weekdayVsWeekend: { weekday: round2(weekdaySum), weekend: round2(weekendSum) },
    },
    totals: {
      importKwh: totalFromMonthly,
      exportKwh: 0,
      netKwh: totalFromMonthly,
    },
    meta: {
      datasetKind: "SIMULATED",
      baseKind: meta.baseKind,
      mode: meta.mode,
      canonicalEndMonth: meta.canonicalEndMonth,
      notes: meta.notes ?? [],
      filledMonths: meta.filledMonths ?? [],
      excludedDays: curve.meta.excludedDays,
      renormalized: curve.meta.renormalized,
    },
    usageBucketsByMonth,
  };
}

/** Build usage buckets by month (same shape as buildUsageBucketsForEstimate) from simulated monthly totals. Used for Past/Future so plan costing can use simulated usage. */
export function usageBucketsByMonthFromSimulatedMonthly(
  monthly: Array<{ month: string; kwh: number }>
): Record<string, Record<string, number>> {
  const CORE_TOTAL_KEY = "kwh.m.all.total";
  const out: Record<string, Record<string, number>> = {};
  for (const m of monthly ?? []) {
    const ym = String(m?.month ?? "").trim();
    if (!/^\d{4}-\d{2}$/.test(ym)) continue;
    const kwh = typeof m?.kwh === "number" && Number.isFinite(m.kwh) ? m.kwh : 0;
    if (!out[ym]) out[ym] = {};
    out[ym][CORE_TOTAL_KEY] = Math.max(0, kwh);
  }
  return out;
}

