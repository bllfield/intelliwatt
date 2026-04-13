import { dateKeyInTimezone } from "@/lib/admin/gapfillLab";
import { DateTime } from "luxon";

/** Weekday vs weekend in `zone` for a local `YYYY-MM-DD` key (matches usage daily semantics, not UTC calendar). */
function isWeekendLocalDateKeyInZone(dateKeyLocal: string, zone: string): boolean {
  const dt = DateTime.fromISO(dateKeyLocal, { zone });
  if (!dt.isValid) return false;
  const wd = dt.weekday;
  return wd === 6 || wd === 7;
}

/** Thrown when validation compare rows cannot be built without substituting missing simulated-day truth. */
export class CompareTruthIncompleteError extends Error {
  readonly code = "COMPARE_TRUTH_INCOMPLETE" as const;
  constructor(
    public readonly missingDateKeysLocal: string[],
    message?: string
  ) {
    super(
      message ??
        "Compare projection requires finite canonical simulated-day totals for every validation day; missing or non-finite for: " +
          missingDateKeysLocal.join(", ")
    );
    this.name = "CompareTruthIncompleteError";
  }
}

/** Day-level weather aligned to `dataset.dailyWeather` for the same local date (display context only). */
export type ValidationCompareRowWeather = {
  tAvgF: number | null;
  tMinF: number | null;
  tMaxF: number | null;
  hdd65: number | null;
  cdd65: number | null;
  source: string | null;
  /** True when there is no `dailyWeather` entry for this date (do not substitute). */
  weatherMissing: boolean;
};

export type ValidationCompareProjectionSidecar = {
  rows: Array<{
    localDate: string;
    dayType: "weekday" | "weekend";
    actualDayKwh: number;
    simulatedDayKwh: number;
    errorKwh: number;
    percentError: number | null;
    weather?: ValidationCompareRowWeather;
  }>;
  metrics: Record<string, unknown>;
};

function round2(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function rebuildValidationCompareMetrics(
  rows: ValidationCompareProjectionSidecar["rows"]
): Record<string, unknown> {
  const absErrors = rows.map((r) => Math.abs(Number(r.errorKwh ?? 0) || 0));
  const actualTotal = rows.reduce((sum, row) => sum + (Number(row.actualDayKwh ?? 0) || 0), 0);
  const simTotal = rows.reduce((sum, row) => sum + (Number(row.simulatedDayKwh ?? 0) || 0), 0);
  const mae = rows.length > 0 ? absErrors.reduce((a, b) => a + b, 0) / rows.length : 0;
  const rmse =
    rows.length > 0
      ? Math.sqrt(rows.reduce((sum, row) => sum + Math.pow(Number(row.errorKwh ?? 0) || 0, 2), 0) / rows.length)
      : 0;
  const maxAbs = absErrors.length > 0 ? Math.max(...absErrors) : 0;
  const wape =
    Math.abs(actualTotal) > 1e-6 ? (absErrors.reduce((a, b) => a + b, 0) / Math.abs(actualTotal)) * 100 : 0;
  return {
    mae: round2(mae),
    rmse: round2(rmse),
    mape: round2(wape),
    wape: round2(wape),
    maxAbs: round2(maxAbs),
    totalActualKwhMasked: round2(actualTotal),
    totalSimKwhMasked: round2(simTotal),
    deltaKwhMasked: round2(simTotal - actualTotal),
    mapeFiltered: rows.length > 0 ? round2(wape) : null,
    mapeFilteredCount: rows.length,
  };
}

export function overrideValidationCompareProjectionSimTotals(args: {
  compareProjection: ValidationCompareProjectionSidecar | null | undefined;
  simulatedDailyRows: Array<{ date?: string; kwh?: number }> | null | undefined;
}): ValidationCompareProjectionSidecar {
  const rows = Array.isArray(args.compareProjection?.rows) ? args.compareProjection.rows : [];
  if (rows.length === 0) {
    return {
      rows: [],
      metrics:
        args.compareProjection?.metrics && typeof args.compareProjection.metrics === "object"
          ? (args.compareProjection.metrics as Record<string, unknown>)
          : {},
    };
  }
  const simulatedByDate = new Map<string, number>();
  for (const row of args.simulatedDailyRows ?? []) {
    const dateKey = String(row?.date ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) continue;
    simulatedByDate.set(dateKey, Number(row?.kwh ?? 0) || 0);
  }
  if (simulatedByDate.size === 0) {
    return {
      rows,
      metrics:
        args.compareProjection?.metrics && typeof args.compareProjection.metrics === "object"
          ? (args.compareProjection.metrics as Record<string, unknown>)
          : {},
    };
  }
  const nextRows = rows.map((row) => {
    const dateKey = String(row.localDate ?? "").slice(0, 10);
    if (!simulatedByDate.has(dateKey)) return row;
    const actualDayKwh = Number(row.actualDayKwh ?? 0) || 0;
    const simulatedDayKwh = simulatedByDate.get(dateKey) ?? 0;
    const errorKwh = simulatedDayKwh - actualDayKwh;
    const percentError =
      Math.abs(actualDayKwh) > 1e-6 ? (Math.abs(errorKwh) / Math.abs(actualDayKwh)) * 100 : null;
    return {
      ...row,
      simulatedDayKwh: round2(simulatedDayKwh),
      errorKwh: round2(errorKwh),
      percentError: percentError == null ? null : round2(percentError),
    };
  });
  return {
    rows: nextRows,
    metrics: rebuildValidationCompareMetrics(nextRows),
  };
}

function buildDailyKwhByDate(rows: unknown): Map<string, number> {
  const byDate = new Map<string, number>();
  for (const row of Array.isArray(rows) ? rows : []) {
    const dateKey = String((row as any)?.date ?? "").slice(0, 10);
    const kwh = Number((row as any)?.kwh);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || !Number.isFinite(kwh)) continue;
    byDate.set(dateKey, kwh);
  }
  return byDate;
}

export function buildValidationCompareProjectionFromDatasets(args: {
  validationSourceDataset: any;
  actualDataset: any;
  simulatedDataset: any;
  weatherDataset?: any;
}): ValidationCompareProjectionSidecar {
  const rawKeys = Array.isArray((args.validationSourceDataset as any)?.meta?.validationOnlyDateKeysLocal)
    ? ((args.validationSourceDataset as any).meta.validationOnlyDateKeysLocal as unknown[])
    : [];
  const validationOnlyDateKeysLocal = rawKeys
    .map((v) => String(v ?? "").slice(0, 10))
    .filter((dk) => /^\d{4}-\d{2}-\d{2}$/.test(dk));
  if (validationOnlyDateKeysLocal.length === 0) {
    return { rows: [], metrics: {} };
  }

  const actualByDate = buildDailyKwhByDate(args.actualDataset?.daily);
  const simulatedByDate = buildDailyKwhByDate(args.simulatedDataset?.daily);
  const missingActual = validationOnlyDateKeysLocal.filter((dk) => !actualByDate.has(dk));
  if (missingActual.length > 0) {
    throw new CompareTruthIncompleteError(
      missingActual,
      "Compare projection requires interval-backed actual day totals for every validation day; missing actual truth for: " +
        missingActual.join(", ")
    );
  }
  const missingSim = validationOnlyDateKeysLocal.filter((dk) => !simulatedByDate.has(dk));
  if (missingSim.length > 0) {
    throw new CompareTruthIncompleteError(
      missingSim,
      "Compare projection requires simulated day totals for every validation day; missing simulated truth for: " +
        missingSim.join(", ")
    );
  }

  const weatherDataset =
    args.weatherDataset ?? args.actualDataset ?? args.simulatedDataset ?? args.validationSourceDataset;
  const dailyWeather = weatherDataset?.dailyWeather;
  const tz = String(
    (args.validationSourceDataset as any)?.meta?.timezone ??
      args.validationSourceDataset?.timezone ??
      weatherDataset?.meta?.timezone ??
      weatherDataset?.timezone ??
      "America/Chicago"
  );
  const rows = validationOnlyDateKeysLocal
    .map((dk) => {
      const actualDayKwh = Number(actualByDate.get(dk) ?? 0) || 0;
      const simulatedDayKwh = Number(simulatedByDate.get(dk) ?? 0) || 0;
      const errorKwh = simulatedDayKwh - actualDayKwh;
      const percentError =
        Math.abs(actualDayKwh) > 1e-6 ? (Math.abs(errorKwh) / Math.abs(actualDayKwh)) * 100 : null;
      return {
        localDate: dk,
        dayType: isWeekendLocalDateKeyInZone(dk, tz) ? ("weekend" as const) : ("weekday" as const),
        actualDayKwh: round2(actualDayKwh),
        simulatedDayKwh: round2(simulatedDayKwh),
        errorKwh: round2(errorKwh),
        percentError: percentError == null ? null : round2(percentError),
        weather: compareWeatherFromDailyWeather(dailyWeather, dk),
      };
    })
    .sort((a, b) => a.localDate.localeCompare(b.localDate));
  return {
    rows,
    metrics: rebuildValidationCompareMetrics(rows),
  };
}

export function compareWeatherFromDailyWeather(dailyWeather: unknown, dateKey: string): ValidationCompareRowWeather {
  if (!dailyWeather || typeof dailyWeather !== "object" || Array.isArray(dailyWeather)) {
    return {
      tAvgF: null,
      tMinF: null,
      tMaxF: null,
      hdd65: null,
      cdd65: null,
      source: null,
      weatherMissing: true,
    };
  }
  const rec = (dailyWeather as Record<string, unknown>)[dateKey];
  if (!rec || typeof rec !== "object" || Array.isArray(rec)) {
    return {
      tAvgF: null,
      tMinF: null,
      tMaxF: null,
      hdd65: null,
      cdd65: null,
      source: null,
      weatherMissing: true,
    };
  }
  const w = rec as Record<string, unknown>;
  const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;
  const src = w.source;
  return {
    tAvgF: num(w.tAvgF),
    tMinF: num(w.tMinF),
    tMaxF: num(w.tMaxF),
    hdd65: num(w.hdd65),
    cdd65: num(w.cdd65),
    source: typeof src === "string" && src.trim() ? src.trim() : null,
    weatherMissing: false,
  };
}

function cloneDatasetForProjection(dataset: any): any {
  if (!dataset || typeof dataset !== "object") return dataset;
  return {
    ...dataset,
    summary:
      dataset.summary && typeof dataset.summary === "object"
        ? { ...dataset.summary }
        : dataset.summary,
    meta:
      dataset.meta && typeof dataset.meta === "object"
        ? { ...dataset.meta }
        : dataset.meta,
    daily: Array.isArray(dataset.daily) ? [...dataset.daily] : dataset.daily,
    monthly: Array.isArray(dataset.monthly) ? [...dataset.monthly] : dataset.monthly,
    series:
      dataset.series && typeof dataset.series === "object"
        ? {
            ...dataset.series,
            daily: Array.isArray(dataset.series.daily) ? [...dataset.series.daily] : dataset.series.daily,
            intervals15: Array.isArray(dataset.series.intervals15)
              ? [...dataset.series.intervals15]
              : dataset.series.intervals15,
          }
        : dataset.series,
  };
}

export function projectBaselineFromCanonicalDataset(
  dataset: any,
  timezoneHint: string | null | undefined,
  actualDailyByDate?: Map<string, number> | null
): any {
  const rawKeys = Array.isArray((dataset as any)?.meta?.validationOnlyDateKeysLocal)
    ? ((dataset as any).meta.validationOnlyDateKeysLocal as unknown[])
    : [];
  const validationOnlyDateKeysLocal = rawKeys
    .map((v) => String(v ?? "").slice(0, 10))
    .filter((dk) => /^\d{4}-\d{2}-\d{2}$/.test(dk));
  const projected = cloneDatasetForProjection(dataset);
  const validationSet = new Set(validationOnlyDateKeysLocal);
  const actualDaily = actualDailyByDate ?? new Map<string, number>();
  const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
  const tz = String(timezoneHint ?? (dataset as any)?.meta?.timezone ?? "America/Chicago");

  if (Array.isArray(projected.daily) && validationSet.size > 0) {
    projected.daily = projected.daily.map((row: any) => {
      const dk = String(row?.date ?? "").slice(0, 10);
      if (!validationSet.has(dk)) return row;
      if (!actualDaily.has(dk)) return row;
      return {
        ...row,
        kwh: round2(actualDaily.get(dk)!),
        source: "ACTUAL",
        sourceDetail: "ACTUAL_VALIDATION_TEST_DAY",
      };
    });
    const projectedDailyByDate = new Map<string, number>(
      projected.daily.map((row: any) => [String(row?.date ?? "").slice(0, 10), Number(row?.kwh ?? 0) || 0])
    );
    if (Array.isArray((projected as any)?.series?.daily)) {
      const dailyArr = projected.daily as Array<{ date?: string; kwh?: number }>;
      (projected as any).series.daily = (projected as any).series.daily.map((row: any, idx: number) => {
        const dkFromDaily = dailyArr[idx] ? String(dailyArr[idx]?.date ?? "").slice(0, 10) : "";
        const dk =
          /^\d{4}-\d{2}-\d{2}$/.test(dkFromDaily)
            ? dkFromDaily
            : dateKeyInTimezone(String(row?.timestamp ?? ""), tz);
        if (!validationSet.has(dk)) return row;
        if (!actualDaily.has(dk)) return row;
        if (!projectedDailyByDate.has(dk)) return row;
        return {
          ...row,
          kwh: round2(projectedDailyByDate.get(dk)!),
          source: "ACTUAL",
          sourceDetail: "ACTUAL_VALIDATION_TEST_DAY",
        };
      });
    }

    /** Stitch/chart must show meter-backed usage on validation days; scale modeled 15m rows to actual day total. */
    if (Array.isArray((projected as any)?.series?.intervals15)) {
      const intervals = (projected as any).series.intervals15 as Array<{ timestamp: string; kwh: number }>;
      const byDate = new Map<string, number[]>();
      for (let i = 0; i < intervals.length; i++) {
        const dk = dateKeyInTimezone(String(intervals[i]?.timestamp ?? ""), tz);
        if (!validationSet.has(dk) || !actualDaily.has(dk)) continue;
        if (!byDate.has(dk)) byDate.set(dk, []);
        byDate.get(dk)!.push(i);
      }
      const next = intervals.map((r) => ({ ...r, kwh: Number(r.kwh) || 0 }));
      for (const dk of Array.from(validationSet)) {
        if (!actualDaily.has(dk)) continue;
        const idxs = byDate.get(dk);
        if (!idxs?.length) continue;
        const sumSim = idxs.reduce((s, i) => s + (Number(intervals[i]?.kwh) || 0), 0);
        const target = Number(actualDaily.get(dk)) || 0;
        if (sumSim <= 0 || !Number.isFinite(target)) continue;
        const factor = target / sumSim;
        for (const i of idxs) {
          next[i] = { ...next[i], kwh: round2(next[i].kwh * factor) };
        }
      }
      (projected as any).series.intervals15 = next;
    }

    const monthlyMap = new Map<string, number>();
    for (const day of projected.daily as Array<{ date?: string; kwh?: number }>) {
      const dk = String(day?.date ?? "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dk)) continue;
      const month = dk.slice(0, 7);
      monthlyMap.set(month, (monthlyMap.get(month) ?? 0) + (Number(day?.kwh) || 0));
    }
    const existingMonthlyRows = Array.isArray(projected.monthly) ? projected.monthly : [];
    const existingMonthlyByMonth = new Map<string, any>();
    for (const row of existingMonthlyRows) {
      const month = String((row as any)?.month ?? "").slice(0, 7);
      if (!/^\d{4}-\d{2}$/.test(month) || existingMonthlyByMonth.has(month)) continue;
      existingMonthlyByMonth.set(month, row);
    }
    if (existingMonthlyRows.length > 0 || monthlyMap.size > 0) {
      const orderedMonths = Array.from(
        new Set([...Array.from(existingMonthlyByMonth.keys()), ...Array.from(monthlyMap.keys())])
      ).sort();
      projected.monthly = orderedMonths.map((month) => {
        const existingRow = existingMonthlyByMonth.get(month);
        const monthlyKwh = monthlyMap.has(month)
          ? round2(monthlyMap.get(month) ?? 0)
          : Number((existingRow as any)?.kwh ?? 0) || 0;
        return existingRow && typeof existingRow === "object"
          ? { ...existingRow, month, kwh: monthlyKwh }
          : { month, kwh: monthlyKwh };
      });
    }
    const totalKwh = Array.from(monthlyMap.values()).reduce((s, v) => s + v, 0);
    if (projected.summary && typeof projected.summary === "object") {
      projected.summary = {
        ...projected.summary,
        totalKwh: round2(totalKwh),
      };
    }
    if (projected.totals && typeof projected.totals === "object") {
      const exportKwh = Number((projected.totals as any)?.exportKwh ?? 0) || 0;
      projected.totals = {
        ...projected.totals,
        importKwh: round2(totalKwh + exportKwh),
        netKwh: round2(totalKwh),
      };
    }

    if (projected.insights && typeof projected.insights === "object" && Array.isArray(projected.daily)) {
      let weekdaySum = 0;
      let weekendSum = 0;
      for (const day of projected.daily as Array<{ date?: string; kwh?: number }>) {
        const dk = String(day?.date ?? "").slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dk)) continue;
        const k = Number(day?.kwh) || 0;
        if (isWeekendLocalDateKeyInZone(dk, tz)) weekendSum += k;
        else weekdaySum += k;
      }
      (projected as any).insights = {
        ...(projected.insights as object),
        weekdayVsWeekend: { weekday: round2(weekdaySum), weekend: round2(weekendSum) },
      };
    }
  }

  projected.meta = {
    ...(projected.meta ?? {}),
    validationOnlyDateKeysLocal,
    validationProjectionApplied: validationSet.size > 0,
    validationProjectionType: "baseline_keeps_validation_days_actual",
    validationCompareAvailable: validationOnlyDateKeysLocal.length > 0,
    timezoneHintUsed: String(timezoneHint ?? (dataset as any)?.meta?.timezone ?? "America/Chicago"),
  };
  return projected;
}

export function attachValidationCompareProjection(dataset: any): any {
  const projected = cloneDatasetForProjection(dataset);
  const rawKeys = Array.isArray((projected as any)?.meta?.validationOnlyDateKeysLocal)
    ? ((projected as any).meta.validationOnlyDateKeysLocal as unknown[])
    : [];
  const validationOnlyDateKeysLocal = rawKeys
    .map((v) => String(v ?? "").slice(0, 10))
    .filter((dk) => /^\d{4}-\d{2}-\d{2}$/.test(dk));
  if (validationOnlyDateKeysLocal.length === 0) return projected;
  const keySet = new Set(validationOnlyDateKeysLocal);
  const dailyRows = Array.isArray((projected as any)?.daily) ? (projected as any).daily : [];
  const actualByDate = new Map<string, number>();
  for (const row of dailyRows as Array<{ date?: string; kwh?: number }>) {
    const dk = String(row?.date ?? "").slice(0, 10);
    if (!keySet.has(dk)) continue;
    const source = String((row as any)?.source ?? "").toUpperCase();
    if (source !== "ACTUAL") continue;
    actualByDate.set(dk, Number(row?.kwh ?? 0) || 0);
  }
  const missingActualTotals = validationOnlyDateKeysLocal.filter((dk) => !actualByDate.has(dk));
  if (missingActualTotals.length > 0) {
    throw new CompareTruthIncompleteError(
      missingActualTotals,
      "Compare projection requires interval-backed actual day totals for every validation day; missing actual truth for: " +
        missingActualTotals.join(", ")
    );
  }
  const simSrc =
    ((projected as any)?.meta?.canonicalArtifactSimulatedDayTotalsByDate as Record<string, number> | undefined) ??
    ((projected as any)?.canonicalArtifactSimulatedDayTotalsByDate as Record<string, number> | undefined) ??
    {};
  const missingSimTotals = validationOnlyDateKeysLocal.filter((dk) => {
    const raw = simSrc[dk];
    return raw === undefined || raw === null || !Number.isFinite(Number(raw));
  });
  if (missingSimTotals.length > 0) {
    throw new CompareTruthIncompleteError(missingSimTotals);
  }
  const dailyWeather = (projected as any)?.dailyWeather;
  const rows = validationOnlyDateKeysLocal
    .map((dk) => {
      const actualDayKwh = Number(actualByDate.get(dk) ?? 0) || 0;
      const simulatedDayKwh = Number(simSrc[dk]) || 0;
      const errorKwh = simulatedDayKwh - actualDayKwh;
      const percentError = Math.abs(actualDayKwh) > 1e-6 ? (Math.abs(errorKwh) / Math.abs(actualDayKwh)) * 100 : null;
      const d = new Date(`${dk}T12:00:00.000Z`);
      const dow = Number.isFinite(d.getTime()) ? d.getUTCDay() : 0;
      return {
        localDate: dk,
        dayType: dow === 0 || dow === 6 ? ("weekend" as const) : ("weekday" as const),
        actualDayKwh: Math.round(actualDayKwh * 100) / 100,
        simulatedDayKwh: Math.round(simulatedDayKwh * 100) / 100,
        errorKwh: Math.round(errorKwh * 100) / 100,
        percentError: percentError == null ? null : Math.round(percentError * 100) / 100,
        weather: compareWeatherFromDailyWeather(dailyWeather, dk),
      };
    })
    .sort((a, b) => (a.localDate < b.localDate ? -1 : 1));
  const absErrors = rows.map((r) => Math.abs(r.errorKwh));
  const actualTotal = rows.reduce((s, r) => s + r.actualDayKwh, 0);
  const simTotal = rows.reduce((s, r) => s + r.simulatedDayKwh, 0);
  const mae = rows.length > 0 ? absErrors.reduce((a, b) => a + b, 0) / rows.length : 0;
  const rmse = rows.length > 0 ? Math.sqrt(rows.reduce((s, r) => s + r.errorKwh * r.errorKwh, 0) / rows.length) : 0;
  const maxAbs = absErrors.length > 0 ? Math.max(...absErrors) : 0;
  const wape = Math.abs(actualTotal) > 1e-6 ? (absErrors.reduce((a, b) => a + b, 0) / Math.abs(actualTotal)) * 100 : 0;
  projected.meta = {
    ...(projected.meta ?? {}),
    validationCompareRows: rows,
    validationCompareMetrics: {
      mae: Math.round(mae * 100) / 100,
      rmse: Math.round(rmse * 100) / 100,
      mape: Math.round(wape * 100) / 100,
      wape: Math.round(wape * 100) / 100,
      maxAbs: Math.round(maxAbs * 100) / 100,
      totalActualKwhMasked: Math.round(actualTotal * 100) / 100,
      totalSimKwhMasked: Math.round(simTotal * 100) / 100,
      deltaKwhMasked: Math.round((simTotal - actualTotal) * 100) / 100,
      mapeFiltered: rows.length > 0 ? Math.round(wape * 100) / 100 : null,
      mapeFilteredCount: rows.length,
    },
  };
  return projected;
}

export function buildValidationCompareProjectionSidecar(
  dataset: any
): ValidationCompareProjectionSidecar {
  return {
    rows: Array.isArray(dataset?.meta?.validationCompareRows)
      ? dataset.meta.validationCompareRows
      : [],
    metrics:
      dataset?.meta?.validationCompareMetrics &&
      typeof dataset.meta.validationCompareMetrics === "object"
        ? dataset.meta.validationCompareMetrics
        : {},
  };
}
