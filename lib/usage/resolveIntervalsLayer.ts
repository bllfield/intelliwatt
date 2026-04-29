import { getActualUsageDatasetForHouse } from "@/lib/usage/actualDatasetForHouse";
import type { ActualHouseDataset, ActualHouseInsights, UsageSummary } from "@/lib/usage/actualDatasetForHouse";
import { getIntervalSeries15m } from "@/lib/usage/intervalSeriesRepo";
import { IntervalSeriesKind } from "@/modules/usageSimulator/kinds";
import type { ActualUsageSource } from "@/modules/realUsageAdapter/actual";

type SimulatedUsageSummary = Omit<ActualHouseDataset["summary"], "source"> & {
  source: "SIMULATED";
};

type PersistedPastDataset = Omit<ActualHouseDataset, "summary"> & {
  summary: SimulatedUsageSummary;
};

type ResolveIntervalsLayerResult = {
  dataset: ActualHouseDataset | PersistedPastDataset | null;
  alternatives: { smt: UsageSummary | null; greenButton: UsageSummary | null };
  skippedFullYearIntervalFetch?: boolean;
};

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function buildPersistedDatasetFromIntervals(args: {
  points: Array<{ tsUtc: Date; kwh: string }>;
  kind: IntervalSeriesKind;
}): PersistedPastDataset | null {
  const intervals15 = (args.points ?? []).map((p) => ({
    timestamp: new Date(p.tsUtc).toISOString(),
    kwh: Number(p.kwh) || 0,
  }));
  if (!intervals15.length) return null;
  const start = intervals15[0]!.timestamp;
  const end = intervals15[intervals15.length - 1]!.timestamp;
  const totalKwh = round2(intervals15.reduce((s, r) => s + (Number(r.kwh) || 0), 0));

  const dailyMap = new Map<string, number>();
  const monthlyMap = new Map<string, number>();
  for (const row of intervals15) {
    const ts = String(row.timestamp);
    const day = ts.slice(0, 10);
    const month = ts.slice(0, 7);
    dailyMap.set(day, (dailyMap.get(day) ?? 0) + (Number(row.kwh) || 0));
    monthlyMap.set(month, (monthlyMap.get(month) ?? 0) + (Number(row.kwh) || 0));
  }
  const daily = Array.from(dailyMap.entries())
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([date, kwh]) => ({ date, kwh: round2(kwh) }));
  const monthly = Array.from(monthlyMap.entries())
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([month, kwh]) => ({ month, kwh: round2(kwh) }));
  const insights: ActualHouseInsights = {
    fifteenMinuteAverages: [],
    timeOfDayBuckets: [],
    peakDay: null,
    peakHour: null,
    baseload: null,
    baseloadDaily: null,
    baseloadMonthly: null,
    weekdayVsWeekend: { weekday: 0, weekend: 0 },
    artifactKind: args.kind,
    artifactReadMode: "persisted_only",
    artifactRecomputed: false,
  };

  return {
    summary: {
      source: "SIMULATED" as const,
      intervalsCount: intervals15.length,
      totalKwh,
      start,
      end,
      latest: end,
    },
    series: {
      intervals15,
      hourly: [] as Array<{ timestamp: string; kwh: number }>,
      daily: daily.map((d) => ({ timestamp: `${d.date}T00:00:00.000Z`, kwh: d.kwh })),
      monthly: monthly.map((m) => ({ timestamp: `${m.month}-01T00:00:00.000Z`, kwh: m.kwh })),
      annual: [{ timestamp: `${start.slice(0, 4)}-01-01T00:00:00.000Z`, kwh: totalKwh }],
    },
    daily,
    monthly,
    insights,
    totals: { importKwh: totalKwh, exportKwh: 0, netKwh: totalKwh },
  };
}

export async function resolveIntervalsLayer(args: {
  userId: string;
  houseId: string;
  layerKind: IntervalSeriesKind;
  scenarioId?: string | null;
  esiid?: string | null;
  preferredActualSource?: ActualUsageSource | null;
  lightweightActualUsage?: boolean;
}): Promise<ResolveIntervalsLayerResult | null> {
  if (
    args.layerKind === IntervalSeriesKind.ACTUAL_USAGE_INTERVALS ||
    args.layerKind === IntervalSeriesKind.BASELINE_INTERVALS
  ) {
    return getActualUsageDatasetForHouse(args.houseId, args.esiid ?? null, {
      preferredSource: args.preferredActualSource ?? null,
      skipFullYearIntervalFetch: args.lightweightActualUsage === true,
    });
  }

  if (args.layerKind === IntervalSeriesKind.PAST_SIM_BASELINE) {
    const series = await getIntervalSeries15m({
      userId: args.userId,
      houseId: args.houseId,
      kind: IntervalSeriesKind.PAST_SIM_BASELINE,
      scenarioId: args.scenarioId ?? null,
    });
    if (!series) {
      // Explicitly artifact-only: resolver never recomputes upstream baseline.
      return { dataset: null, alternatives: { smt: null, greenButton: null } };
    }
    const dataset = buildPersistedDatasetFromIntervals({
      points: series.points,
      kind: IntervalSeriesKind.PAST_SIM_BASELINE,
    });
    return { dataset, alternatives: { smt: null, greenButton: null } };
  }

  return null;
}

