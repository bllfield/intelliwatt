import { generateSimulatedCurve } from "@/modules/simulatedUsage/engine";
import type { SimulatedCurve } from "@/modules/simulatedUsage/types";

type UsageSeriesPoint = { timestamp: string; kwh: number };

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
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

export function buildSimulatedUsageDatasetFromBuildInputs(buildInputs: SimulatorBuildInputsV1): SimulatedUsageDataset {
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

  const monthly = curve.monthlyTotals
    .map((m) => ({ month: m.month, kwh: round2(m.kwh) }))
    .sort((a, b) => (a.month < b.month ? -1 : 1));

  const seriesDaily: UsageSeriesPoint[] = daily.map((d) => ({ timestamp: `${d.date}T00:00:00.000Z`, kwh: d.kwh }));
  const seriesMonthly: UsageSeriesPoint[] = monthly.map((m) => ({ timestamp: `${m.month}-01T00:00:00.000Z`, kwh: m.kwh }));
  const seriesAnnual: UsageSeriesPoint[] = [{ timestamp: curve.end.slice(0, 4) + "-01-01T00:00:00.000Z", kwh: round2(curve.annualTotalKwh) }];

  const fifteenMinuteAverages = computeFifteenMinuteAverages(curve.intervals);

  let weekdaySum = 0;
  let weekendSum = 0;
  for (let j = 0; j < daily.length; j++) {
    const dow = dayOfWeekUtc(daily[j].date);
    if (dow === 0 || dow === 6) weekendSum += daily[j].kwh;
    else weekdaySum += daily[j].kwh;
  }

  const peakDay = daily.length > 0 ? daily.reduce((a, b) => (b.kwh > a.kwh ? b : a)) : null;

  // Baseload from the built curve (lowest 10% of 15-min power samples), so Past/Future reflect overlay/upgrades/vacant fill.
  // Use only positive power samples so always-on load is not diluted by zeros (e.g. from shape or vacant fill).
  const powerSamples = curve.intervals
    .map((i) => (Number(i.consumption_kwh) || 0) * 4)
    .filter((kw) => Number.isFinite(kw) && kw > 0.001)
    .sort((a, b) => a - b);
  const count10 = Math.max(1, Math.floor(powerSamples.length * 0.1));
  const baseSlice = powerSamples.slice(0, count10);
  const baseload = baseSlice.length > 0 ? round2(baseSlice.reduce((a, b) => a + b, 0) / baseSlice.length) : null;

  const usageBucketsByMonth = usageBucketsByMonthFromSimulatedMonthly(monthly);

  return {
    summary: {
      source: "SIMULATED" as const,
      intervalsCount: curve.intervals.length,
      totalKwh: round2(curve.annualTotalKwh),
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
      timeOfDayBuckets: [],
      stitchedMonth: null,
      peakDay: peakDay ? { date: peakDay.date, kwh: peakDay.kwh } : null,
      peakHour: null,
      baseload,
      weekdayVsWeekend: { weekday: round2(weekdaySum), weekend: round2(weekendSum) },
    },
    totals: {
      importKwh: round2(curve.annualTotalKwh),
      exportKwh: 0,
      netKwh: round2(curve.annualTotalKwh),
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
  }
): SimulatedUsageDataset {
  const dailyMap = new Map<string, number>();
  for (let j = 0; j < curve.intervals.length; j++) {
    const dk = toDateKey(curve.intervals[j].timestamp);
    dailyMap.set(dk, (dailyMap.get(dk) ?? 0) + (Number(curve.intervals[j].consumption_kwh) || 0));
  }
  const daily = Array.from(dailyMap.entries())
    .map(([date, kwh]) => ({ date, kwh: round2(kwh) }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));

  const monthly = curve.monthlyTotals
    .map((m) => ({ month: m.month, kwh: round2(m.kwh) }))
    .sort((a, b) => (a.month < b.month ? -1 : 1));

  const seriesDaily: UsageSeriesPoint[] = daily.map((d) => ({ timestamp: `${d.date}T00:00:00.000Z`, kwh: d.kwh }));
  const seriesMonthly: UsageSeriesPoint[] = monthly.map((m) => ({ timestamp: `${m.month}-01T00:00:00.000Z`, kwh: m.kwh }));
  const seriesAnnual: UsageSeriesPoint[] = [{ timestamp: curve.end.slice(0, 4) + "-01-01T00:00:00.000Z", kwh: round2(curve.annualTotalKwh) }];
  const seriesIntervals15: UsageSeriesPoint[] = curve.intervals.map((i) => ({
    timestamp: i.timestamp,
    kwh: Number(i.consumption_kwh) || 0,
  }));

  const fifteenMinuteAverages = computeFifteenMinuteAverages(curve.intervals);

  let weekdaySum = 0;
  let weekendSum = 0;
  for (let j = 0; j < daily.length; j++) {
    const dow = dayOfWeekUtc(daily[j].date);
    if (dow === 0 || dow === 6) weekendSum += daily[j].kwh;
    else weekdaySum += daily[j].kwh;
  }

  const peakDay = daily.length > 0 ? daily.reduce((a, b) => (b.kwh > a.kwh ? b : a)) : null;

  // Baseload = lowest 10% of positive 15-min power samples (exclude zeros so always-on load is not diluted).
  const powerSamples = curve.intervals
    .map((i) => (Number(i.consumption_kwh) || 0) * 4)
    .filter((kw) => Number.isFinite(kw) && kw > 0.001)
    .sort((a, b) => a - b);
  const count10 = Math.max(1, Math.floor(powerSamples.length * 0.1));
  const baseSlice = powerSamples.slice(0, count10);
  const baseload = baseSlice.length > 0 ? round2(baseSlice.reduce((a, b) => a + b, 0) / baseSlice.length) : null;

  const usageBucketsByMonth = usageBucketsByMonthFromSimulatedMonthly(monthly);

  const startDateOnly = curve.start.slice(0, 10);
  const endDateOnly = curve.end.slice(0, 10);
  const summaryStart = /^\d{4}-\d{2}-\d{2}$/.test(startDateOnly) ? startDateOnly : curve.start;
  const summaryEnd = /^\d{4}-\d{2}-\d{2}$/.test(endDateOnly) ? endDateOnly : curve.end;

  return {
    summary: {
      source: "SIMULATED" as const,
      intervalsCount: curve.intervals.length,
      totalKwh: round2(curve.annualTotalKwh),
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
      timeOfDayBuckets: [],
      stitchedMonth: null,
      peakDay: peakDay ? { date: peakDay.date, kwh: peakDay.kwh } : null,
      peakHour: null,
      baseload,
      weekdayVsWeekend: { weekday: round2(weekdaySum), weekend: round2(weekendSum) },
    },
    totals: {
      importKwh: round2(curve.annualTotalKwh),
      exportKwh: 0,
      netKwh: round2(curve.annualTotalKwh),
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

