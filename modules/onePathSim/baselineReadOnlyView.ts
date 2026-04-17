import { buildGapfillCompareMonthlyTotals } from "@/modules/onePathSim/usageSimulator/monthlyCompareRows";
import type { OnePathBaselineParityAudit } from "@/modules/onePathSim/baselineParityAudit";
import type { WeatherSensitivityScore } from "@/modules/onePathSim/weatherSensitivityShared";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function pickNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function round2(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function deriveTotalsFromRows(rows: Array<{ kwh: number }>) {
  let importKwh = 0;
  let exportKwh = 0;
  for (const row of rows) {
    const kwh = Number(row.kwh) || 0;
    if (kwh >= 0) importKwh += kwh;
    else exportKwh += Math.abs(kwh);
  }
  return {
    importKwh: round2(importKwh),
    exportKwh: round2(exportKwh),
    netKwh: round2(importKwh - exportKwh),
  };
}

export type OnePathBaselineReadOnlyView = {
  summary: {
    source: string | null;
    coverageStart: string | null;
    coverageEnd: string | null;
    intervalsCount: number | null;
    totals: { importKwh: number; exportKwh: number; netKwh: number };
    baseload: number | null;
    peakDay: { date: string; kwh: number } | null;
    peakHour: { hour: number; kw: number } | null;
    weekdayKwh: number;
    weekendKwh: number;
    timeOfDayBuckets: Array<{ key: string; label: string; kwh: number }>;
  };
  monthlyRows: Array<{ month: string; kwh: number }>;
  dailyRows: Array<{ date: string; kwh: number; source?: string; sourceDetail?: string }>;
  fifteenMinuteAverages: Array<{ hhmm: string; avgKw: number }>;
  weatherScore: WeatherSensitivityScore | null;
  parityAudit: OnePathBaselineParityAudit | null;
};

export function buildOnePathBaselineReadOnlyView(args: {
  readModel?: unknown;
  weatherScore?: WeatherSensitivityScore | null;
  parityAudit?: OnePathBaselineParityAudit | null;
}): OnePathBaselineReadOnlyView | null {
  const readModel = asRecord(args.readModel);
  const dataset = asRecord(readModel.dataset);
  const summary = asRecord(dataset.summary);
  if (!Object.keys(summary).length) return null;

  const displayedMonthlyTotals = buildGapfillCompareMonthlyTotals(dataset as never);
  const monthlyRows = Array.from(displayedMonthlyTotals.entries())
    .map(([month, kwh]) => ({ month, kwh }))
    .sort((left, right) => (left.month < right.month ? -1 : left.month > right.month ? 1 : 0));
  const dailyRows = asArray<Record<string, unknown>>(dataset.daily).map((row) => ({
    date: String(row.date ?? "").slice(0, 10),
    kwh: Number(row.kwh ?? 0) || 0,
    source: typeof row.source === "string" ? row.source : undefined,
    sourceDetail: typeof row.sourceDetail === "string" ? row.sourceDetail : undefined,
  }));
  const intervals = asArray<Record<string, unknown>>(asRecord(dataset.series).intervals15).map((row) => ({
    kwh: Number(row.kwh ?? 0) || 0,
  }));
  const totalsRecord = asRecord(dataset.totals);
  const monthlyTotals = monthlyRows.length ? deriveTotalsFromRows(monthlyRows) : null;
  const intervalTotals = intervals.length ? deriveTotalsFromRows(intervals) : null;
  const totals =
    pickNumber(totalsRecord.netKwh) != null
      ? {
          importKwh: pickNumber(totalsRecord.importKwh) ?? 0,
          exportKwh: pickNumber(totalsRecord.exportKwh) ?? 0,
          netKwh: pickNumber(totalsRecord.netKwh) ?? 0,
        }
      : monthlyTotals ?? intervalTotals ?? { importKwh: 0, exportKwh: 0, netKwh: 0 };
  const insights = asRecord(dataset.insights);

  return {
    summary: {
      source: typeof summary.source === "string" ? summary.source : null,
      coverageStart: typeof summary.start === "string" ? summary.start : null,
      coverageEnd: typeof summary.end === "string" ? summary.end : null,
      intervalsCount: pickNumber(summary.intervalsCount),
      totals,
      baseload: pickNumber(insights.baseload),
      peakDay: asRecord(insights.peakDay).date
        ? {
            date: String(asRecord(insights.peakDay).date),
            kwh: Number(asRecord(insights.peakDay).kwh ?? 0) || 0,
          }
        : null,
      peakHour: pickNumber(asRecord(insights.peakHour).hour) != null
        ? {
            hour: Number(asRecord(insights.peakHour).hour),
            kw: Number(asRecord(insights.peakHour).kw ?? 0) || 0,
          }
        : null,
      weekdayKwh: Number(asRecord(insights.weekdayVsWeekend).weekday ?? 0) || 0,
      weekendKwh: Number(asRecord(insights.weekdayVsWeekend).weekend ?? 0) || 0,
      timeOfDayBuckets: asArray<Record<string, unknown>>(insights.timeOfDayBuckets).map((row) => ({
        key: String(row.key ?? ""),
        label: String(row.label ?? row.key ?? ""),
        kwh: Number(row.kwh ?? 0) || 0,
      })),
    },
    monthlyRows,
    dailyRows,
    fifteenMinuteAverages: asArray<Record<string, unknown>>(insights.fifteenMinuteAverages)
      .map((row) => ({
        hhmm: String(row.hhmm ?? ""),
        avgKw: Number(row.avgKw ?? 0) || 0,
      }))
      .sort((left, right) => left.hhmm.localeCompare(right.hhmm)),
    weatherScore: args.weatherScore ?? null,
    parityAudit: args.parityAudit ?? null,
  };
}
