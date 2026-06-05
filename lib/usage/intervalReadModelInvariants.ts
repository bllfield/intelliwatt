import { buildDisplayedMonthlyRows } from "@/modules/usageSimulator/monthlyCompareRows";
import { buildUserUsageDashboardViewModel } from "@/lib/usage/userUsageDashboardViewModel";
import { buildOnePathRunReadOnlyView } from "@/modules/onePathSim/runReadOnlyView";
import type { UserUsageHouseContract } from "@/lib/usage/userUsageHouseContract";

export const INTERVAL_READ_MODEL_TOLERANCE_KWH = 0.1;

function round2(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function withinTolerance(left: number, right: number, tolerance = INTERVAL_READ_MODEL_TOLERANCE_KWH): boolean {
  return Math.abs(left - right) <= tolerance;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function sumDailyKwh(rows: Array<{ kwh?: unknown }>): number {
  return round2(rows.reduce((sum, row) => sum + (Number(row.kwh) || 0), 0));
}

function sumMonthlyKwh(rows: Array<{ kwh?: unknown }>): number {
  return round2(rows.reduce((sum, row) => sum + (Number(row.kwh) || 0), 0));
}

export type IntervalReadModelInvariantResult = {
  ok: boolean;
  netUsageKwh: number | null;
  dailySumKwh: number | null;
  monthlySumKwh: number | null;
  weekdayWeekendTotalKwh: number | null;
  timeOfDayBucketTotalKwh: number | null;
  loadCurveMeanKw: number | null;
  averageDailyKwh: number | null;
  loadCurveMeanDailyKwh: number | null;
  displayedCurveSlots: number;
  violations: string[];
};

export function auditIntervalReadModelInvariants(args: {
  dataset: unknown;
  dailyRows?: Array<{ kwh?: unknown }>;
  monthlyRows?: Array<{ kwh?: unknown }>;
  fifteenMinuteAverages?: Array<{ hhmm?: string; avgKw?: number }>;
  weekdayKwh?: number | null;
  weekendKwh?: number | null;
  timeOfDayBuckets?: Array<{ kwh?: unknown }>;
  netUsageKwh?: number | null;
  avgDailyKwh?: number | null;
  dailyRowCount?: number | null;
}): IntervalReadModelInvariantResult {
  const dataset = asRecord(args.dataset);
  const summary = asRecord(dataset.summary);
  const totals = asRecord(dataset.totals);
  const insights = asRecord(dataset.insights);
  const dailyRows =
    args.dailyRows ??
    asArray<Record<string, unknown>>(dataset.daily).map((row) => ({ kwh: row.kwh }));
  const monthlyRows =
    args.monthlyRows ??
    (asArray(dataset.monthly).length > 0
      ? asArray<Record<string, unknown>>(dataset.monthly)
      : buildDisplayedMonthlyRows(dataset as never));
  const fifteenMinuteAverages =
    args.fifteenMinuteAverages ??
    asArray<Record<string, unknown>>(insights.fifteenMinuteAverages).map((row) => ({
      hhmm: String(row.hhmm ?? ""),
      avgKw: Number(row.avgKw) || 0,
    }));
  const weekdayWeekend = asRecord(insights.weekdayVsWeekend);
  const weekdayKwh =
    args.weekdayKwh ??
    (typeof weekdayWeekend.weekday === "number" && Number.isFinite(weekdayWeekend.weekday)
      ? weekdayWeekend.weekday
      : null);
  const weekendKwh =
    args.weekendKwh ??
    (typeof weekdayWeekend.weekend === "number" && Number.isFinite(weekdayWeekend.weekend)
      ? weekdayWeekend.weekend
      : null);
  const timeOfDayBuckets =
    args.timeOfDayBuckets ??
    asArray<Record<string, unknown>>(insights.timeOfDayBuckets).map((row) => ({ kwh: row.kwh }));

  const netUsageKwh =
    args.netUsageKwh ??
    (totals.netKwh != null
      ? round2(Number(totals.netKwh))
      : summary.totalKwh != null
        ? round2(Number(summary.totalKwh))
        : null);
  const dailySumKwh = dailyRows.length > 0 ? sumDailyKwh(dailyRows) : null;
  const monthlySumKwh = monthlyRows.length > 0 ? sumMonthlyKwh(monthlyRows) : null;
  const weekdayWeekendTotalKwh =
    weekdayKwh != null && weekendKwh != null ? round2(weekdayKwh + weekendKwh) : null;
  const timeOfDayBucketTotalKwh =
    timeOfDayBuckets.length > 0
      ? round2(timeOfDayBuckets.reduce((sum, row) => sum + (Number(row.kwh) || 0), 0))
      : null;
  const loadCurveMeanKw =
    fifteenMinuteAverages.length > 0
      ? round2(
          fifteenMinuteAverages.reduce((sum, row) => sum + (Number(row.avgKw) || 0), 0) /
            fifteenMinuteAverages.length
        )
      : null;
  const dailyRowCount = args.dailyRowCount ?? dailyRows.length;
  const averageDailyKwh =
    args.avgDailyKwh ??
    (netUsageKwh != null && dailyRowCount > 0 ? round2(netUsageKwh / dailyRowCount) : null);
  const loadCurveMeanDailyKwh =
    loadCurveMeanKw != null ? round2(loadCurveMeanKw * 24) : null;

  const violations: string[] = [];
  if (netUsageKwh != null && dailySumKwh != null && !withinTolerance(netUsageKwh, dailySumKwh)) {
    violations.push(`daily sum ${dailySumKwh} != net usage ${netUsageKwh}`);
  }
  if (netUsageKwh != null && monthlySumKwh != null && !withinTolerance(netUsageKwh, monthlySumKwh)) {
    violations.push(`monthly sum ${monthlySumKwh} != net usage ${netUsageKwh}`);
  }
  if (
    netUsageKwh != null &&
    weekdayWeekendTotalKwh != null &&
    !withinTolerance(netUsageKwh, weekdayWeekendTotalKwh)
  ) {
    violations.push(`weekday+weekend ${weekdayWeekendTotalKwh} != net usage ${netUsageKwh}`);
  }
  if (
    netUsageKwh != null &&
    timeOfDayBucketTotalKwh != null &&
    !withinTolerance(netUsageKwh, timeOfDayBucketTotalKwh)
  ) {
    violations.push(`time-of-day buckets ${timeOfDayBucketTotalKwh} != net usage ${netUsageKwh}`);
  }
  if (
    fifteenMinuteAverages.length >= 96 &&
    averageDailyKwh != null &&
    loadCurveMeanDailyKwh != null &&
    !withinTolerance(averageDailyKwh, loadCurveMeanDailyKwh)
  ) {
    violations.push(
      `load curve mean daily ${loadCurveMeanDailyKwh} != average daily kWh ${averageDailyKwh}`
    );
  }

  return {
    ok: violations.length === 0,
    netUsageKwh,
    dailySumKwh,
    monthlySumKwh,
    weekdayWeekendTotalKwh,
    timeOfDayBucketTotalKwh,
    loadCurveMeanKw,
    averageDailyKwh,
    loadCurveMeanDailyKwh,
    displayedCurveSlots: fifteenMinuteAverages.length,
    violations,
  };
}

export function auditUserAdminPastReadModelParity(args: { dataset: unknown }): {
  ok: boolean;
  violations: string[];
} {
  const datasetRecord = asRecord(args.dataset);
  const viewModel = buildUserUsageDashboardViewModel({ dataset: args.dataset });
  const adminView = buildOnePathRunReadOnlyView({
    dataset: Object.keys(datasetRecord).length > 0 ? datasetRecord : null,
  });
  const violations: string[] = [];
  if (!viewModel || !adminView) {
    return { ok: false, violations: ["missing user or admin read model"] };
  }

  const compareNumeric = (label: string, left: number | null, right: number | null) => {
    if (left == null || right == null) return;
    if (!withinTolerance(left, right)) {
      violations.push(`${label}: user ${left} != admin ${right}`);
    }
  };

  compareNumeric("netKwh", viewModel.derived.totals.netKwh, adminView.summary.totals.netKwh);
  compareNumeric("weekdayKwh", viewModel.derived.weekdayKwh, adminView.summary.weekdayKwh);
  compareNumeric("weekendKwh", viewModel.derived.weekendKwh, adminView.summary.weekendKwh);
  compareNumeric("avgDailyKwh", viewModel.derived.avgDailyKwh, adminView.summary.avgDailyKwh);

  const userBucketTotal = round2(
    viewModel.derived.timeOfDayBuckets.reduce(
      (sum: number, row: { kwh?: unknown }) => sum + (Number(row.kwh) || 0),
      0
    )
  );
  const adminBucketTotal = round2(
    adminView.summary.timeOfDayBuckets.reduce(
      (sum: number, row: { kwh?: unknown }) => sum + (Number(row.kwh) || 0),
      0
    )
  );
  compareNumeric("timeOfDayBucketsTotal", userBucketTotal, adminBucketTotal);

  if (JSON.stringify(viewModel.derived.fifteenCurve) !== JSON.stringify(adminView.fifteenMinuteAverages)) {
    violations.push("fifteenMinuteAverages mismatch");
  }

  return { ok: violations.length === 0, violations };
}

export function auditUserUsageHouseContractParity(args: {
  left: UserUsageHouseContract | null;
  right: UserUsageHouseContract | null;
}): { ok: boolean; violations: string[] } {
  const leftVm = buildUserUsageDashboardViewModel(args.left);
  const rightVm = buildUserUsageDashboardViewModel(args.right);
  const violations: string[] = [];
  if (!leftVm || !rightVm) {
    return { ok: false, violations: ["missing dashboard view model"] };
  }

  const compare = (label: string, left: unknown, right: unknown) => {
    if (JSON.stringify(left) !== JSON.stringify(right)) {
      violations.push(`${label} mismatch`);
    }
  };

  compare("coverage", leftVm.coverage, rightVm.coverage);
  compare("totals", leftVm.derived.totals, rightVm.derived.totals);
  compare("monthly", leftVm.derived.monthly, rightVm.derived.monthly);
  compare("daily", leftVm.derived.daily, rightVm.derived.daily);
  compare("fifteenCurve", leftVm.derived.fifteenCurve, rightVm.derived.fifteenCurve);
  compare("weekdayKwh", leftVm.derived.weekdayKwh, rightVm.derived.weekdayKwh);
  compare("weekendKwh", leftVm.derived.weekendKwh, rightVm.derived.weekendKwh);
  compare("peakHour", leftVm.derived.peakHour, rightVm.derived.peakHour);
  compare("timeOfDayBuckets", leftVm.derived.timeOfDayBuckets, rightVm.derived.timeOfDayBuckets);

  return { ok: violations.length === 0, violations };
}
