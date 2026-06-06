import {
  buildGreenButtonLoadCurveInsightsFromSeriesRows,
  isGreenButtonBackedDatasetMeta,
  resolveGreenButtonPastDisplayMeta,
} from "@/lib/time/greenButtonPersistedIntervalConvert";
import {
  buildLoadCurveInsightsFromIntervalRows,
  hourInHomeTimezone,
  localDateKeyInHomeTimezone,
  normalizeHomeTimezoneForLoadCurve,
} from "@/lib/usage/fifteenMinuteLoadCurve";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function round2(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function isPastSimulatedDisplayDataset(dataset: Record<string, unknown>): boolean {
  const meta = asRecord(dataset.meta);
  return meta.datasetKind === "SIMULATED" && meta.baselinePassthrough !== true;
}

function sumIntervalKwh(
  rows: Array<{ kwh?: unknown; consumption_kwh?: unknown }>
): number {
  return round2(rows.reduce((sum, row) => sum + (Number(row.kwh ?? row.consumption_kwh) || 0), 0));
}

function sumDailyKwh(daily: Array<{ kwh?: unknown }>): number | null {
  if (!daily.length) return null;
  return round2(daily.reduce((sum, row) => sum + (Number(row.kwh) || 0), 0));
}

function buildMonthlyFromDailyRows(
  daily: Array<{ date?: unknown; kwh?: unknown }>
): Array<{ month: string; kwh: number }> {
  const monthlyTotals = new Map<string, number>();
  for (const row of daily) {
    const dk = String(row?.date ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dk)) continue;
    const month = dk.slice(0, 7);
    monthlyTotals.set(month, (monthlyTotals.get(month) ?? 0) + (Number(row.kwh) || 0));
  }
  return Array.from(monthlyTotals.entries())
    .sort((left, right) => (left[0] < right[0] ? -1 : 1))
    .map(([month, kwh]) => ({ month, kwh: round2(kwh) }));
}

export type PastSimTimeOfDayAuditFields = {
  timeOfDayTotalKwh: number | null;
  canonicalTotalKwh: number | null;
  timeOfDayVsCanonicalDeltaKwh: number | null;
  timeOfDayDroppedIntervalCount: number;
  timeOfDayUnbucketedKwh: number;
  timeOfDaySourceOwner: string;
};

const GENERIC_TOD_OWNER = "lib/usage/fifteenMinuteLoadCurve.buildLoadCurveInsightsFromIntervalRows";
const GREEN_BUTTON_TOD_OWNER =
  "lib/time/greenButtonPersistedIntervalConvert.buildGreenButtonLoadCurveInsightsFromSeriesRows";

function buildLoadCurveInsightsForPastDataset(
  dataset: Record<string, unknown>,
  intervalRows: Array<{ timestamp?: string; kwh?: number; consumption_kwh?: number }>,
  timezone: string
): { insights: ReturnType<typeof buildLoadCurveInsightsFromIntervalRows>; sourceOwner: string } {
  const meta = asRecord(dataset.meta);
  const daily = Array.isArray(dataset.daily)
    ? (dataset.daily as Array<{ date?: string; source?: string; sourceDetail?: string }>)
    : [];
  if (isGreenButtonBackedDatasetMeta(meta)) {
    return {
      insights: buildGreenButtonLoadCurveInsightsFromSeriesRows(intervalRows, {
        homeTimezone: timezone,
        meta: resolveGreenButtonPastDisplayMeta(meta),
        displayDaily: daily,
        filterToActualDailyDates: false,
      }),
      sourceOwner: GREEN_BUTTON_TOD_OWNER,
    };
  }
  return {
    insights: buildLoadCurveInsightsFromIntervalRows(intervalRows, timezone),
    sourceOwner: GENERIC_TOD_OWNER,
  };
}

function auditIntervalBucketing(
  rows: Array<{ timestamp?: string; kwh?: number; consumption_kwh?: number }>,
  timezone: string
): Pick<PastSimTimeOfDayAuditFields, "timeOfDayDroppedIntervalCount" | "timeOfDayUnbucketedKwh"> {
  let dropped = 0;
  let unbucketedKwh = 0;
  for (const row of rows) {
    const timestamp = String(row?.timestamp ?? "");
    if (!timestamp) {
      dropped += 1;
      continue;
    }
    const kwh = Number(row?.kwh ?? row?.consumption_kwh ?? 0) || 0;
    const dateKey = localDateKeyInHomeTimezone(timestamp, timezone);
    const hour = hourInHomeTimezone(timestamp, timezone);
    if (dateKey == null || hour == null) {
      dropped += 1;
      unbucketedKwh += kwh;
    }
  }
  return {
    timeOfDayDroppedIntervalCount: dropped,
    timeOfDayUnbucketedKwh: round2(unbucketedKwh),
  };
}

/**
 * Sync persisted Past insights from the final stitched `series.intervals15` read model.
 * User and admin surfaces must render `insights.timeOfDayBuckets` — not re-derive separately.
 */
export function syncPastSimDisplayInsightsFromCanonicalIntervals(
  dataset: Record<string, unknown> | null | undefined
): PastSimTimeOfDayAuditFields | null {
  if (!dataset || typeof dataset !== "object" || !isPastSimulatedDisplayDataset(dataset)) return null;

  const meta = asRecord(dataset.meta);
  const series = asRecord(dataset.series);
  const intervals15 = Array.isArray(series.intervals15)
    ? (series.intervals15 as Array<{ timestamp?: string; kwh?: number; consumption_kwh?: number }>)
    : [];
  if (!intervals15.length) return null;

  const timezone = normalizeHomeTimezoneForLoadCurve(
    typeof meta.timezone === "string" ? meta.timezone : "America/Chicago"
  );
  const intervalRows = intervals15.map((row) => ({
    timestamp: String(row.timestamp ?? ""),
    kwh: Number(row.kwh ?? row.consumption_kwh ?? 0) || 0,
    consumption_kwh: Number(row.kwh ?? row.consumption_kwh ?? 0) || 0,
  }));
  const daily = Array.isArray(dataset.daily) ? (dataset.daily as Array<{ date?: unknown; kwh?: unknown }>) : [];

  const { insights: loadCurveInsights, sourceOwner } = buildLoadCurveInsightsForPastDataset(
    dataset,
    intervalRows,
    timezone
  );
  const bucketingAudit = auditIntervalBucketing(intervalRows, timezone);
  const totals = asRecord(dataset.totals);
  const summary = asRecord(dataset.summary);
  const dailyTotal = sumDailyKwh(daily);
  const intervalTotal = sumIntervalKwh(intervalRows);
  const headlineTotal =
    typeof totals.netKwh === "number" && Number.isFinite(totals.netKwh)
      ? round2(totals.netKwh)
      : typeof summary.totalKwh === "number" && Number.isFinite(summary.totalKwh)
        ? round2(summary.totalKwh)
        : null;
  let timeOfDayBuckets = loadCurveInsights.timeOfDayBuckets;
  let timeOfDayTotalBeforeReconcile = round2(
    timeOfDayBuckets.reduce((sum, row) => sum + (Number(row.kwh) || 0), 0)
  );
  const canonicalTruthTotal =
    headlineTotal ??
    (dailyTotal != null && intervalTotal != null
      ? Math.abs(dailyTotal - intervalTotal) <= 0.1
        ? intervalTotal
        : dailyTotal
      : dailyTotal ?? intervalTotal);
  if (
    canonicalTruthTotal != null &&
    timeOfDayTotalBeforeReconcile > 0 &&
    Math.abs(timeOfDayTotalBeforeReconcile - canonicalTruthTotal) > 0.01
  ) {
    const scale = canonicalTruthTotal / timeOfDayTotalBeforeReconcile;
    timeOfDayBuckets = timeOfDayBuckets.map((row) => ({
      ...row,
      kwh: round2((Number(row.kwh) || 0) * scale),
    }));
    timeOfDayTotalBeforeReconcile = round2(
      timeOfDayBuckets.reduce((sum, row) => sum + (Number(row.kwh) || 0), 0)
    );
    const reconcileDelta = round2(canonicalTruthTotal - timeOfDayTotalBeforeReconcile);
    if (Math.abs(reconcileDelta) > 0 && timeOfDayBuckets.length > 0) {
      const last = timeOfDayBuckets[timeOfDayBuckets.length - 1]!;
      timeOfDayBuckets = [
        ...timeOfDayBuckets.slice(0, -1),
        { ...last, kwh: round2((Number(last.kwh) || 0) + reconcileDelta) },
      ];
    }
  }

  const insights = asRecord(dataset.insights);
  dataset.insights = {
    ...insights,
    timeOfDayBuckets,
    fifteenMinuteAverages: loadCurveInsights.fifteenMinuteAverages,
  };

  let weekdaySum = 0;
  let weekendSum = 0;
  for (const row of daily) {
    const dk = String(row.date ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dk)) continue;
    const dow = new Date(`${dk}T12:00:00.000Z`).getUTCDay();
    const kwh = Number(row.kwh) || 0;
    if (dow === 0 || dow === 6) weekendSum += kwh;
    else weekdaySum += kwh;
  }
  const weekdayWeekendTotal = round2(weekdaySum + weekendSum);
  const canonicalForWeekdayWeekend = canonicalTruthTotal ?? weekdayWeekendTotal;
  if (Math.abs(weekdayWeekendTotal - canonicalForWeekdayWeekend) > 0.01 && canonicalForWeekdayWeekend > 0) {
    const scale = canonicalForWeekdayWeekend / weekdayWeekendTotal;
    weekdaySum *= scale;
    weekendSum *= scale;
  }
  (dataset.insights as Record<string, unknown>).weekdayVsWeekend = {
    weekday: round2(weekdaySum),
    weekend: round2(weekendSum),
  };

  const monthlyFromDaily = buildMonthlyFromDailyRows(daily);
  if (monthlyFromDaily.length > 0) {
    dataset.monthly = monthlyFromDaily;
  }

  meta.pastDisplayInsightsSourceOwner = sourceOwner;
  meta.pastDisplayInsightsSyncedAt = new Date().toISOString();
  meta.pastDisplayTimeOfDayDroppedIntervalCount = bucketingAudit.timeOfDayDroppedIntervalCount;
  meta.pastDisplayTimeOfDayUnbucketedKwh = bucketingAudit.timeOfDayUnbucketedKwh;
  dataset.meta = meta;

  const timeOfDayTotalKwh = round2(
    timeOfDayBuckets.reduce((sum, row) => sum + (Number(row.kwh) || 0), 0)
  );
  const canonicalTotalKwh = canonicalTruthTotal;

  return {
    timeOfDayTotalKwh,
    canonicalTotalKwh,
    timeOfDayVsCanonicalDeltaKwh:
      canonicalTotalKwh != null ? round2(timeOfDayTotalKwh - canonicalTotalKwh) : null,
    ...bucketingAudit,
    timeOfDaySourceOwner: sourceOwner,
  };
}
