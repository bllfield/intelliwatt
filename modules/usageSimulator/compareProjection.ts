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
            intervals15: Array.isArray(dataset.series.intervals15)
              ? [...dataset.series.intervals15]
              : dataset.series.intervals15,
          }
        : dataset.series,
  };
}

export function projectBaselineFromCanonicalDataset(
  dataset: any,
  timezoneHint: string | null | undefined
): any {
  const rawKeys = Array.isArray((dataset as any)?.meta?.validationOnlyDateKeysLocal)
    ? ((dataset as any).meta.validationOnlyDateKeysLocal as unknown[])
    : [];
  const validationOnlyDateKeysLocal = rawKeys
    .map((v) => String(v ?? "").slice(0, 10))
    .filter((dk) => /^\d{4}-\d{2}-\d{2}$/.test(dk));
  const projected = cloneDatasetForProjection(dataset);
  projected.meta = {
    ...(projected.meta ?? {}),
    validationOnlyDateKeysLocal,
    validationProjectionApplied: false,
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
