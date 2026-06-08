import { createHash } from "crypto";

import { buildDisplayedMonthlyRows } from "@/modules/usageSimulator/monthlyCompareRows";
import { buildUserUsageDashboardViewModel } from "@/lib/usage/userUsageDashboardViewModel";
import { auditPastWeatherInputParity } from "@/lib/usage/pastWeatherInputParity";
import { resolveUserPastVisibleWeatherSensitivityScore } from "@/lib/usage/userPastVisibleWeather";
import {
  buildWeatherScoringAudit,
  detectPastVisibleWeatherOwnerViolation,
  PAST_DISPLAY_WEATHER_META_FIELD,
  scoreCardValues,
} from "@/lib/usage/weatherScoringOwnership";
import { WORKSPACE_PAST_SCENARIO_NAME } from "@/lib/usage/onePathPastUserSiteParityTypes";
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

function hashMonthlyRows(rows: Array<{ month?: unknown; kwh?: unknown }>): string {
  return createHash("sha256")
    .update(
      JSON.stringify(
        rows.map((row) => ({
          month: String(row.month ?? "").slice(0, 7),
          kwh: round2(Number(row.kwh) || 0),
        }))
      ),
      "utf8"
    )
    .digest("base64url")
    .slice(0, 22);
}

function readSourceDerivedMonthlyTotalsKwhByMonth(
  dataset: Record<string, unknown>
): Record<string, number> | null {
  const meta = asRecord(dataset.meta);
  const lockboxInput = asRecord(meta.lockboxInput);
  const sourceContext = asRecord(lockboxInput.sourceContext);
  const fromSourceContext = asRecord(sourceContext.sourceDerivedMonthlyTotalsKwhByMonth);
  if (Object.keys(fromSourceContext).length > 0) {
    return Object.fromEntries(
      Object.entries(fromSourceContext).map(([month, kwh]) => [month, round2(Number(kwh) || 0)])
    );
  }
  const fromMeta = asRecord(meta.sourceDerivedMonthlyTotalsKwhByMonth);
  if (Object.keys(fromMeta).length > 0) {
    return Object.fromEntries(
      Object.entries(fromMeta).map(([month, kwh]) => [month, round2(Number(kwh) || 0)])
    );
  }
  return null;
}

export function buildPastMonthlyRowsParityDebug(args: {
  userDataset?: unknown;
  adminDataset?: unknown;
  userMonthlyRows: Array<{ month: string; kwh: number }>;
  adminMonthlyRows: Array<{ month: string; kwh: number }>;
}): {
  userMonthlyRows: Array<{ month: string; kwh: number }>;
  adminMonthlyRows: Array<{ month: string; kwh: number }>;
  userMonthlyRowsHash: string;
  adminMonthlyRowsHash: string;
  monthlyRowsMatch: boolean;
  monthlyRowsDiffByMonth: Array<{ month: string; userKwh: number; adminKwh: number; deltaKwh: number }>;
  totalKwhUser: number;
  totalKwhAdmin: number;
  roundingPolicy: string;
  comparisonTolerance: number;
  userSourceDerivedMonthlyTotalsKwhByMonth: Record<string, number> | null;
  adminSourceDerivedMonthlyTotalsKwhByMonth: Record<string, number> | null;
  sourceDerivedMonthlyTotalsKwhByMonthNote: string;
} {
  const userMonthlyRows = args.userMonthlyRows.map((row) => ({
    month: String(row.month ?? "").slice(0, 7),
    kwh: round2(Number(row.kwh) || 0),
  }));
  const adminMonthlyRows = args.adminMonthlyRows.map((row) => ({
    month: String(row.month ?? "").slice(0, 7),
    kwh: round2(Number(row.kwh) || 0),
  }));
  const userMonthlyRowsHash = hashMonthlyRows(userMonthlyRows);
  const adminMonthlyRowsHash = hashMonthlyRows(adminMonthlyRows);
  const monthlyRowsMatch = userMonthlyRowsHash === adminMonthlyRowsHash;
  const months = Array.from(
    new Set([...userMonthlyRows.map((row) => row.month), ...adminMonthlyRows.map((row) => row.month)])
  ).sort();
  const userByMonth = new Map(userMonthlyRows.map((row) => [row.month, row.kwh]));
  const adminByMonth = new Map(adminMonthlyRows.map((row) => [row.month, row.kwh]));
  const monthlyRowsDiffByMonth = months
    .map((month) => {
      const userKwh = userByMonth.get(month) ?? 0;
      const adminKwh = adminByMonth.get(month) ?? 0;
      const deltaKwh = round2(userKwh - adminKwh);
      return { month, userKwh, adminKwh, deltaKwh };
    })
    .filter((row) => Math.abs(row.deltaKwh) > INTERVAL_READ_MODEL_TOLERANCE_KWH);
  return {
    userMonthlyRows,
    adminMonthlyRows,
    userMonthlyRowsHash,
    adminMonthlyRowsHash,
    monthlyRowsMatch,
    monthlyRowsDiffByMonth,
    totalKwhUser: sumMonthlyKwh(userMonthlyRows),
    totalKwhAdmin: sumMonthlyKwh(adminMonthlyRows),
    roundingPolicy: "round2 per row before hash/compare",
    comparisonTolerance: INTERVAL_READ_MODEL_TOLERANCE_KWH,
    userSourceDerivedMonthlyTotalsKwhByMonth: args.userDataset
      ? readSourceDerivedMonthlyTotalsKwhByMonth(asRecord(args.userDataset))
      : null,
    adminSourceDerivedMonthlyTotalsKwhByMonth: args.adminDataset
      ? readSourceDerivedMonthlyTotalsKwhByMonth(asRecord(args.adminDataset))
      : null,
    sourceDerivedMonthlyTotalsKwhByMonthNote:
      "source-only upstream anchors — not the Past display monthlyRows parity target",
  };
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
  const intervalsCount = Number(summary.intervalsCount);
  if (
    Number.isFinite(intervalsCount) &&
    intervalsCount > 0 &&
    netUsageKwh != null &&
    netUsageKwh > 0 &&
    timeOfDayBucketTotalKwh != null &&
    timeOfDayBucketTotalKwh <= INTERVAL_READ_MODEL_TOLERANCE_KWH
  ) {
    violations.push("time-of-day buckets are zero despite interval-backed net usage");
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

function weatherCardValuesFromScore(score: unknown): {
  weatherEfficiency: number | null;
  cooling: number | null;
  heating: number | null;
  confidence: number | null;
} {
  const record = asRecord(score);
  const derived = asRecord(record.derivedInput ?? record.weatherEfficiencyDerivedInput);
  const pick = (value: unknown): number | null =>
    typeof value === "number" && Number.isFinite(value) ? value : null;
  return {
    weatherEfficiency: pick(record.weatherEfficiencyScore0to100),
    cooling:
      pick(derived.coolingSensitivityScore0to100) ??
      pick(derived.coolingSensitivity) ??
      pick(record.coolingSensitivityScore0to100),
    heating:
      pick(derived.heatingSensitivityScore0to100) ??
      pick(derived.heatingSensitivity) ??
      pick(record.heatingSensitivityScore0to100),
    confidence:
      pick(derived.confidenceScore0to100) ??
      pick(derived.confidence) ??
      pick(record.confidenceScore0to100),
  };
}

export function auditUserAdminPastReadModelParity(args: {
  /** @deprecated Same-dataset audit is a false green for cross-surface parity. Pass userDataset + adminDataset. */
  dataset?: unknown;
  userDataset?: unknown;
  adminDataset?: unknown;
  scenarioName?: string | null;
  actualBaselineWeatherScore?: unknown;
  userProfileFingerprints?: { homeProfile?: string | null; applianceProfile?: string | null };
  adminProfileFingerprints?: { homeProfile?: string | null; applianceProfile?: string | null };
  /** Cross-surface weather parity: score both legs against the same profile/weather house. */
  userWeatherHouseId?: string | null;
  adminWeatherHouseId?: string | null;
  /** When true, same in-memory dataset audit is allowed (read-model structural checks only). */
  allowSameDatasetStructuralAudit?: boolean;
  crossSurfaceWeatherInputsOnly?: boolean;
}): {
  ok: boolean;
  violations: string[];
  inputParity: ReturnType<typeof auditPastWeatherInputParity> | null;
  weatherCards: {
    pass: boolean;
    user: ReturnType<typeof weatherCardValuesFromScore>;
    admin: ReturnType<typeof weatherCardValuesFromScore>;
    sourceOwner: string;
    userVisibleSourceOwner: string;
    adminVisibleSourceOwner: string;
    outputField: string;
    ownerViolation: string | null;
  };
  weatherScoringAudit: ReturnType<typeof buildWeatherScoringAudit> | null;
  monthlyRowsParity: ReturnType<typeof buildPastMonthlyRowsParityDebug> | null;
} {
  const userDatasetRecord = asRecord(args.userDataset ?? args.dataset);
  const adminDatasetRecord = asRecord(args.adminDataset ?? args.dataset);
  const sameDatasetAudit =
    args.userDataset == null &&
    args.adminDataset == null &&
    args.allowSameDatasetStructuralAudit !== true;
  const userPastVisibleWeather = resolveUserPastVisibleWeatherSensitivityScore({
    dataset: userDatasetRecord,
    scenarioName: args.scenarioName ?? WORKSPACE_PAST_SCENARIO_NAME,
  });
  const adminPastVisibleWeather = resolveUserPastVisibleWeatherSensitivityScore({
    dataset: adminDatasetRecord,
    scenarioName: args.scenarioName ?? WORKSPACE_PAST_SCENARIO_NAME,
  });
  const viewModel = buildUserUsageDashboardViewModel({
    dataset: userDatasetRecord,
    weatherSensitivityScore: userPastVisibleWeather.score as never,
  });
  const adminView = buildOnePathRunReadOnlyView({
    dataset: Object.keys(adminDatasetRecord).length > 0 ? adminDatasetRecord : null,
  });
  const violations: string[] = [];
  if (sameDatasetAudit) {
    violations.push(
      "auditUserAdminPastReadModelParity used same in-memory dataset for user and admin — not cross-surface proof"
    );
  }
  const inputParity =
    args.userDataset != null &&
    args.adminDataset != null &&
    args.userDataset !== args.adminDataset
      ? auditPastWeatherInputParity({
          userDataset: userDatasetRecord,
          adminDataset: adminDatasetRecord,
          userWeatherHouseId: args.userWeatherHouseId,
          adminWeatherHouseId: args.adminWeatherHouseId,
          userProfileFingerprints: args.userProfileFingerprints,
          adminProfileFingerprints: args.adminProfileFingerprints,
          crossSurfaceWeatherInputsOnly: args.crossSurfaceWeatherInputsOnly,
        })
      : null;
  if (inputParity && !inputParity.ok) {
    violations.push(...inputParity.violations);
  }
  if (!viewModel || !adminView) {
    return {
      ok: false,
      violations: [...violations, "missing user or admin read model"],
      inputParity,
      weatherCards: {
        pass: false,
        user: weatherCardValuesFromScore(null),
        admin: weatherCardValuesFromScore(null),
        sourceOwner: "user_past_visible_api_weather",
        userVisibleSourceOwner: userPastVisibleWeather.sourceOwner,
        adminVisibleSourceOwner: "missing_admin_read_model",
        outputField: PAST_DISPLAY_WEATHER_META_FIELD,
        ownerViolation: "missing user or admin read model",
      },
      weatherScoringAudit: null,
      monthlyRowsParity: null,
    };
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

  if (JSON.stringify(viewModel.derived.timeOfDayBuckets) !== JSON.stringify(adminView.summary.timeOfDayBuckets)) {
    violations.push("timeOfDayBuckets mismatch");
  }

  if (JSON.stringify(viewModel.derived.monthly) !== JSON.stringify(adminView.monthlyRows)) {
    violations.push("monthlyRows mismatch");
  }

  if (JSON.stringify(viewModel.derived.fifteenCurve) !== JSON.stringify(adminView.fifteenMinuteAverages)) {
    violations.push("fifteenMinuteAverages mismatch");
  }

  const userWeather = scoreCardValues(userPastVisibleWeather.score);
  const adminWeather = scoreCardValues(adminPastVisibleWeather.score ?? adminView.weatherScore);
  const ownerViolation = detectPastVisibleWeatherOwnerViolation({
    meta: asRecord(userDatasetRecord.meta),
    visibleScore: userPastVisibleWeather.score,
    visibleSourceOwner: userPastVisibleWeather.sourceOwner,
    actualBaselineScore: args.actualBaselineWeatherScore,
  });
  const adminOwnerViolation =
    (adminPastVisibleWeather.score ?? adminView.weatherScore) &&
    detectPastVisibleWeatherOwnerViolation({
      meta: asRecord(adminDatasetRecord.meta),
      visibleScore: adminPastVisibleWeather.score ?? adminView.weatherScore,
      visibleSourceOwner: adminPastVisibleWeather.sourceOwner,
      actualBaselineScore: args.actualBaselineWeatherScore,
    });
  const weatherPass =
    args.allowSameDatasetStructuralAudit === true
      ? true
      : userWeather.weatherEfficiency === adminWeather.weatherEfficiency &&
        userWeather.cooling === adminWeather.cooling &&
        userWeather.heating === adminWeather.heating &&
        userWeather.confidence === adminWeather.confidence &&
        userPastVisibleWeather.sourceOwner === "past_artifact_build" &&
        adminPastVisibleWeather.sourceOwner === "past_artifact_build" &&
        ownerViolation == null &&
        adminOwnerViolation == null;
  if (!weatherPass) {
    violations.push("weather cards mismatch");
  }
  if (ownerViolation) {
    violations.push(ownerViolation);
  }
  if (adminOwnerViolation) {
    violations.push(`admin past weather: ${adminOwnerViolation}`);
  }
  if (args.allowSameDatasetStructuralAudit !== true) {
    if (userPastVisibleWeather.sourceOwner !== "past_artifact_build") {
      violations.push(`user past weather sourceOwner=${userPastVisibleWeather.sourceOwner}`);
    }
    if (adminPastVisibleWeather.sourceOwner !== "past_artifact_build") {
      violations.push(`admin past weather sourceOwner=${adminPastVisibleWeather.sourceOwner}`);
    }
  }

  const persistedAudit = asRecord(asRecord(adminDatasetRecord.meta).pastDisplayWeatherScoringAudit);
  const weatherScoringAudit =
    Object.keys(persistedAudit).length > 0
      ? (persistedAudit as ReturnType<typeof buildWeatherScoringAudit>)
      : buildWeatherScoringAudit({
          scoringContext: "PAST_DISPLAY",
          scoringDataset: adminDatasetRecord,
          datasetKind: "SIMULATED",
          outputField: PAST_DISPLAY_WEATHER_META_FIELD,
          envelope: {
            score: (adminPastVisibleWeather.score ?? adminView.weatherScore) as never,
            derivedInput: null,
          },
        });

  const monthlyRowsParity =
    viewModel && adminView
      ? buildPastMonthlyRowsParityDebug({
          userDataset: userDatasetRecord,
          adminDataset: adminDatasetRecord,
          userMonthlyRows: viewModel.derived.monthly,
          adminMonthlyRows: adminView.monthlyRows,
        })
      : null;

  return {
    ok: violations.length === 0,
    violations,
    inputParity,
    weatherCards: {
      pass: weatherPass,
      user: userWeather,
      admin: adminWeather,
      sourceOwner: PAST_DISPLAY_WEATHER_META_FIELD,
      userVisibleSourceOwner: userPastVisibleWeather.sourceOwner,
      adminVisibleSourceOwner: adminPastVisibleWeather.sourceOwner,
      outputField: PAST_DISPLAY_WEATHER_META_FIELD,
      ownerViolation,
    },
    weatherScoringAudit,
    monthlyRowsParity,
  };
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
