import { generateSimulatedCurve } from "@/modules/simulatedUsage/engine";

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
    smtMonthlyAnchorsByMonth?: Record<string, number>;
    smtIntradayShape96?: number[];
  };
};

export function buildSimulatedUsageDatasetFromBuildInputs(buildInputs: SimulatorBuildInputsV1) {
  const curve = generateSimulatedCurve({
    canonicalMonths: buildInputs.canonicalMonths,
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

  return {
    summary: {
      source: "SMT" as const,
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
      baseload: null,
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
  };
}

