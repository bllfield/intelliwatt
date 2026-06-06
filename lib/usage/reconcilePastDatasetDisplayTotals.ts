import { localDateKeyInHomeTimezone } from "@/lib/usage/fifteenMinuteLoadCurve";

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
  // Stitched Past headline totals follow the canonical interval curve when present.
  const truthTotal =
    intervalTotal != null && intervals15.length > 0
      ? intervalTotal
      : dailyTotal ?? intervalTotal ?? args?.fallbackTotalKwh ?? null;
  if (truthTotal == null) return;

  if (
    daily.length > 0 &&
    dailyTotal != null &&
    intervalTotal != null &&
    intervals15.length > 0 &&
    Math.abs(dailyTotal - intervalTotal) > 0.01
  ) {
    const scale = intervalTotal / dailyTotal;
    const scaledDaily = (dataset.daily as Array<Record<string, unknown>>).map((row) => ({
      ...row,
      kwh: round2((Number(row.kwh) || 0) * scale),
    }));
    const scaledSum = sumDailyKwh(scaledDaily as Array<{ kwh?: unknown }>);
    if (scaledSum != null) {
      const delta = round2(intervalTotal - scaledSum);
      if (Math.abs(delta) > 0 && scaledDaily.length > 0) {
        const lastIdx = scaledDaily.length - 1;
        const last = scaledDaily[lastIdx]!;
        scaledDaily[lastIdx] = {
          ...last,
          kwh: round2((Number(last.kwh) || 0) + delta),
        };
      }
    }
    dataset.daily = scaledDaily;
  }

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

  const timezone = String(meta.timezone ?? "America/Chicago");
  const monthlyTotals = new Map<string, number>();
  if (intervals15.length > 0) {
    for (const row of intervals15) {
      const timestamp = String(row.timestamp ?? "");
      const dk = localDateKeyInHomeTimezone(timestamp, timezone);
      if (!dk || !/^\d{4}-\d{2}-\d{2}$/.test(dk)) continue;
      const month = dk.slice(0, 7);
      monthlyTotals.set(
        month,
        (monthlyTotals.get(month) ?? 0) + (Number(row.kwh ?? row.consumption_kwh) || 0)
      );
    }
  } else if (daily.length > 0) {
    for (const row of daily) {
      const dk = String((row as { date?: unknown }).date ?? "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dk)) continue;
      const month = dk.slice(0, 7);
      monthlyTotals.set(month, (monthlyTotals.get(month) ?? 0) + (Number((row as { kwh?: unknown }).kwh) || 0));
    }
  }
  if (monthlyTotals.size > 0) {
    const monthlyRows = Array.from(monthlyTotals.entries())
      .sort((left, right) => (left[0] < right[0] ? -1 : 1))
      .map(([month, kwh]) => ({ month, kwh: round2(kwh) }));
    const monthlySum = sumDailyKwh(monthlyRows);
    if (monthlySum != null && Math.abs(monthlySum - truthTotal) > 0.01 && monthlyRows.length > 0) {
      const lastIdx = monthlyRows.length - 1;
      const last = monthlyRows[lastIdx]!;
      monthlyRows[lastIdx] = {
        ...last,
        kwh: round2((Number(last.kwh) || 0) + round2(truthTotal - monthlySum)),
      };
    }
    dataset.monthly = monthlyRows;
  }
}
