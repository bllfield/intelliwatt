export type ValidationCompareProjectionSidecar = {
  rows: Array<{
    localDate: string;
    dayType: "weekday" | "weekend";
    actualDayKwh: number;
    simulatedDayKwh: number;
    errorKwh: number;
    percentError: number | null;
  }>;
  metrics: Record<string, unknown>;
};

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

  if (Array.isArray(projected.daily) && validationSet.size > 0) {
    projected.daily = projected.daily.map((row: any) => {
      const dk = String(row?.date ?? "").slice(0, 10);
      if (!validationSet.has(dk)) return row;
      if (!actualDaily.has(dk)) return { ...row, source: "ACTUAL", sourceDetail: "ACTUAL_VALIDATION_TEST_DAY" };
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
      (projected as any).series.daily = (projected as any).series.daily.map((row: any) => {
        const dk = String(row?.timestamp ?? "").slice(0, 10);
        if (!validationSet.has(dk)) return row;
        if (!projectedDailyByDate.has(dk)) return row;
        return {
          ...row,
          kwh: round2(projectedDailyByDate.get(dk)!),
          source: "ACTUAL",
          sourceDetail: "ACTUAL_VALIDATION_TEST_DAY",
        };
      });
    }

    const monthlyMap = new Map<string, number>();
    for (const day of projected.daily as Array<{ date?: string; kwh?: number }>) {
      const dk = String(day?.date ?? "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dk)) continue;
      const month = dk.slice(0, 7);
      monthlyMap.set(month, (monthlyMap.get(month) ?? 0) + (Number(day?.kwh) || 0));
    }
    if (Array.isArray(projected.monthly)) {
      projected.monthly = projected.monthly.map((m: any) => {
        const month = String(m?.month ?? "").slice(0, 7);
        if (!monthlyMap.has(month)) return m;
        return { ...m, kwh: round2(monthlyMap.get(month) ?? 0) };
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
    actualByDate.set(dk, Number(row?.kwh ?? 0) || 0);
  }
  const simSrc =
    ((projected as any)?.meta?.canonicalArtifactSimulatedDayTotalsByDate as Record<string, number> | undefined) ??
    ((projected as any)?.canonicalArtifactSimulatedDayTotalsByDate as Record<string, number> | undefined) ??
    {};
  const rows = validationOnlyDateKeysLocal
    .map((dk) => {
      const actualDayKwh = Number(actualByDate.get(dk) ?? 0) || 0;
      const simulatedDayKwh = Number(simSrc[dk] ?? 0) || 0;
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
