import { buildDisplayedMonthlyRows } from "@/modules/usageSimulator/monthlyCompareRows";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
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

function approxEqual(left: number | null, right: number | null, tolerance = 0.05): boolean {
  if (left == null && right == null) return true;
  if (left == null || right == null) return false;
  return Math.abs(left - right) <= tolerance;
}

function pickFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function sumKwhRows(rows: Array<Record<string, unknown>>): number | null {
  if (!rows.length) return null;
  return round2(rows.reduce((sum, row) => sum + (Number(row.kwh) || 0), 0));
}

export type UsageDisplayTotalsAudit = {
  rawIntervalTotalKwh: number | null;
  summaryTotalKwh: number | null;
  datasetTotalsImportKwh: number | null;
  datasetTotalsNetKwh: number | null;
  monthlyDisplayedTotalKwh: number | null;
  weekdayWeekendBreakdownTotalKwh: number | null;
  timeOfDayBucketTotalKwh: number | null;
  dashboardHeadlineTotalKwh: number | null;
  dashboardHeadlineTotalOwner: string;
  breakdownTotalOwner: string;
  firstDivergenceOwner: string | null;
  mismatchClassification:
    | "aligned"
    | "expected_stitched_latest_month_display_behavior"
    | "expected_bucket_rounding_or_persisted_breakdown_behavior"
    | "unexpected_display_owner_mismatch";
  stitchedMonth: Record<string, unknown> | null;
  note: string;
};

export function buildUsageDisplayTotalsAudit(args: { dataset: unknown }): UsageDisplayTotalsAudit {
  const dataset = asRecord(args.dataset);
  const summary = asRecord(dataset.summary);
  const totals = asRecord(dataset.totals);
  const insights = asRecord(dataset.insights);
  const series = asRecord(dataset.series);
  const stitchedMonth = asRecord(insights.stitchedMonth);
  const intervals15 = asArray<Record<string, unknown>>(series.intervals15);
  const dailyRows = asArray<Record<string, unknown>>(dataset.daily);
  const displayedMonthlyRows = buildDisplayedMonthlyRows(dataset as never);
  const weekdayWeekend = asRecord(insights.weekdayVsWeekend);
  const timeOfDayBuckets = asArray<Record<string, unknown>>(insights.timeOfDayBuckets);

  const previewIntervalTotalKwh = intervals15.length
    ? round2(intervals15.reduce((sum, row) => sum + (Number(row.kwh) || 0), 0))
    : null;
  const summaryTotalKwh = pickFiniteNumber(summary.totalKwh);
  const datasetTotalsImportKwh = pickFiniteNumber(totals.importKwh);
  const datasetTotalsNetKwh = pickFiniteNumber(totals.netKwh);
  const rawTotalFromDailyKwh = sumKwhRows(dailyRows);
  const monthlyDisplayedTotalKwh = displayedMonthlyRows.length
    ? round2(displayedMonthlyRows.reduce((sum, row) => sum + (Number(row.kwh) || 0), 0))
    : null;
  const weekdayWeekendBreakdownTotalKwh = round2(
    (Number(weekdayWeekend.weekday) || 0) + (Number(weekdayWeekend.weekend) || 0)
  );
  const timeOfDayBucketTotalKwh = timeOfDayBuckets.length
    ? round2(timeOfDayBuckets.reduce((sum, row) => sum + (Number(row.kwh) || 0), 0))
    : null;

  const totalsFromApi =
    datasetTotalsNetKwh != null || datasetTotalsImportKwh != null
      ? {
          importKwh: datasetTotalsImportKwh ?? 0,
          exportKwh: pickFiniteNumber(totals.exportKwh) ?? 0,
          netKwh: datasetTotalsNetKwh ?? 0,
        }
      : null;
  const totalsFromMonthly =
    monthlyDisplayedTotalKwh != null
      ? deriveTotalsFromRows(displayedMonthlyRows.map((row) => ({ kwh: Number(row.kwh) || 0 })))
      : null;
  const totalsFromSeries =
    previewIntervalTotalKwh != null
      ? {
          importKwh: previewIntervalTotalKwh,
          exportKwh: 0,
          netKwh: previewIntervalTotalKwh,
        }
      : null;

  const rawIntervalTotalKwh =
    rawTotalFromDailyKwh != null
      ? rawTotalFromDailyKwh
      : previewIntervalTotalKwh ?? datasetTotalsNetKwh ?? summaryTotalKwh;

  let dashboardHeadlineTotalKwh: number | null = null;
  let dashboardHeadlineTotalOwner = "UsageDashboard.tsx :: interval fallback";
  if (totalsFromApi != null) {
    if (
      totalsFromMonthly != null &&
      Math.abs((Number(totalsFromApi.netKwh) || 0) - (Number(totalsFromMonthly.netKwh) || 0)) > 0.05
    ) {
      dashboardHeadlineTotalKwh = totalsFromMonthly.netKwh;
      dashboardHeadlineTotalOwner = "UsageDashboard.tsx :: displayed monthly sum override";
    } else {
      dashboardHeadlineTotalKwh = totalsFromApi.netKwh;
      dashboardHeadlineTotalOwner = "UsageDashboard.tsx :: dataset.totals.netKwh";
    }
  } else if (totalsFromMonthly != null) {
    dashboardHeadlineTotalKwh = totalsFromMonthly.netKwh;
    dashboardHeadlineTotalOwner = "UsageDashboard.tsx :: displayed monthly sum fallback";
  } else if (totalsFromSeries != null) {
    dashboardHeadlineTotalKwh = totalsFromSeries.netKwh;
  }

  let firstDivergenceOwner: string | null = null;
  let mismatchClassification: UsageDisplayTotalsAudit["mismatchClassification"] = "aligned";
  let note = "Displayed totals are aligned across summary, dashboard, monthly, and breakdown owners.";

  if (
    !approxEqual(rawIntervalTotalKwh, summaryTotalKwh) ||
    !approxEqual(rawIntervalTotalKwh, datasetTotalsNetKwh) ||
    !approxEqual(rawIntervalTotalKwh, monthlyDisplayedTotalKwh)
  ) {
    firstDivergenceOwner = "lib/usage/actualDatasetForHouse.ts :: totalsForDataset / summary.totalKwh";
    if (
      Object.keys(stitchedMonth).length > 0 &&
      approxEqual(summaryTotalKwh, monthlyDisplayedTotalKwh) &&
      approxEqual(datasetTotalsNetKwh, monthlyDisplayedTotalKwh) &&
      approxEqual(rawIntervalTotalKwh, weekdayWeekendBreakdownTotalKwh)
    ) {
      mismatchClassification = "expected_stitched_latest_month_display_behavior";
      note =
        "The headline total follows stitched/displayed monthly totals from actualDatasetForHouse, while weekday/weekend and time-of-day buckets stay anchored to raw interval analytics.";
    } else {
      mismatchClassification = "unexpected_display_owner_mismatch";
      note =
        "Summary/totals diverged from the raw interval total before the dashboard formatting layer. Audit actualDatasetForHouse totalsForDataset and summary.totalKwh owners.";
    }
  } else if (
    !approxEqual(dashboardHeadlineTotalKwh, weekdayWeekendBreakdownTotalKwh) ||
    !approxEqual(dashboardHeadlineTotalKwh, timeOfDayBucketTotalKwh)
  ) {
    firstDivergenceOwner = "lib/usage/computeInsights.ts :: weekdayVsWeekend / timeOfDayBuckets";
    mismatchClassification = "expected_bucket_rounding_or_persisted_breakdown_behavior";
    note =
      "The dashboard headline stayed aligned with raw/summary totals, but persisted bucket analytics drifted by more than display tolerance.";
  }

  return {
    rawIntervalTotalKwh,
    summaryTotalKwh,
    datasetTotalsImportKwh,
    datasetTotalsNetKwh,
    monthlyDisplayedTotalKwh,
    weekdayWeekendBreakdownTotalKwh,
    timeOfDayBucketTotalKwh,
    dashboardHeadlineTotalKwh,
    dashboardHeadlineTotalOwner,
    breakdownTotalOwner: "UsageChartsPanel.tsx :: dataset.insights.weekdayVsWeekend",
    firstDivergenceOwner,
    mismatchClassification,
    stitchedMonth: Object.keys(stitchedMonth).length > 0 ? stitchedMonth : null,
    note,
  };
}
