function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function round2(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function sumDailyKwh(daily: Array<{ kwh?: unknown }>): number | null {
  if (!daily.length) return null;
  return round2(daily.reduce((sum, row) => sum + (Number(row.kwh) || 0), 0));
}

function sumIntervalKwh(intervals15: Array<Record<string, unknown>>): number | null {
  if (!intervals15.length) return null;
  return round2(
    intervals15.reduce(
      (sum, row) => sum + (Number(row.kwh ?? row.consumption_kwh) || 0),
      0
    )
  );
}

/**
 * Align persisted Past headline totals with daily / interval truth.
 * Stale artifacts may keep monthly-derived totals that diverge from stitched daily rows.
 */
export function reconcilePastDatasetDisplayTotals(
  dataset: Record<string, unknown> | null | undefined,
  args?: { fallbackTotalKwh?: number | null }
): void {
  if (!dataset || typeof dataset !== "object") return;

  const meta = asRecord(dataset.meta);
  if (meta.datasetKind !== "SIMULATED" || meta.baselinePassthrough === true) return;

  const daily = Array.isArray(dataset.daily) ? (dataset.daily as Array<{ kwh?: unknown }>) : [];
  const series = asRecord(dataset.series);
  const intervals15 = Array.isArray(series.intervals15)
    ? (series.intervals15 as Array<Record<string, unknown>>)
    : [];

  const dailyTotal = sumDailyKwh(daily);
  const intervalTotal = sumIntervalKwh(intervals15);
  const truthTotal =
    dailyTotal != null && intervalTotal != null
      ? Math.abs(dailyTotal - intervalTotal) <= 0.1
        ? intervalTotal
        : dailyTotal
      : dailyTotal ?? intervalTotal ?? args?.fallbackTotalKwh ?? null;
  if (truthTotal == null) return;

  const summary = asRecord(dataset.summary);
  dataset.summary = { ...summary, totalKwh: truthTotal };

  const totals = asRecord(dataset.totals);
  dataset.totals = {
    ...totals,
    importKwh: truthTotal,
    netKwh: truthTotal,
    exportKwh: typeof totals.exportKwh === "number" && Number.isFinite(totals.exportKwh) ? totals.exportKwh : 0,
  };

  if (Array.isArray(series.annual) && series.annual.length > 0) {
    const annual0 = asRecord(series.annual[0]);
    series.annual = [{ ...annual0, kwh: truthTotal }];
    dataset.series = series;
  }
}
