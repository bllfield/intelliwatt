import {
  auditIntervalReadModelInvariants,
  auditUserAdminPastReadModelParity,
  auditUserUsageHouseContractParity,
  INTERVAL_READ_MODEL_TOLERANCE_KWH,
} from "@/lib/usage/intervalReadModelInvariants";
import { buildUserUsageDashboardViewModel } from "@/lib/usage/userUsageDashboardViewModel";
import { buildUsageDisplayTotalsAudit } from "@/modules/onePathSim/usageDisplayTotalsAudit";
import type { UserUsageHouseContract } from "@/lib/usage/userUsageHouseContract";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function pickNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeCoverageSnapshot(coverage: unknown) {
  const record = asRecord(coverage);
  return {
    source: record.source ?? null,
    start: record.start ?? null,
    end: record.end ?? null,
    intervalsCount: pickNumber(record.intervalsCount) ?? null,
  };
}

export type UsageParitySnapshot = {
  coverage: unknown;
  intervalsCount: number | null;
  netKwh: number | null;
  avgDailyKwh: number | null;
  weatherEfficiencyScore0to100: number | null;
  coolingSensitivity: number | null;
  heatingSensitivity: number | null;
  confidence: number | null;
  baseload15MinKwh: number | null;
  baseloadDailyKwh: number | null;
  baseloadMonthlyKwh: number | null;
  weekdayKwh: number | null;
  weekendKwh: number | null;
  timeOfDayBuckets: unknown;
  monthlyRows: unknown;
  dailyRowCount: number | null;
};

function weatherFieldsFromScore(score: unknown): {
  weatherEfficiencyScore0to100: number | null;
  coolingSensitivity: number | null;
  heatingSensitivity: number | null;
  confidence: number | null;
} {
  const record = asRecord(score);
  const derived = asRecord(record.derivedInput ?? record.weatherEfficiencyDerivedInput);
  return {
    weatherEfficiencyScore0to100: pickNumber(record.weatherEfficiencyScore0to100),
    coolingSensitivity:
      pickNumber(derived.coolingSensitivityScore0to100) ??
      pickNumber(derived.coolingSensitivity) ??
      pickNumber(record.coolingSensitivityScore0to100),
    heatingSensitivity:
      pickNumber(derived.heatingSensitivityScore0to100) ??
      pickNumber(derived.heatingSensitivity) ??
      pickNumber(record.heatingSensitivityScore0to100),
    confidence:
      pickNumber(derived.confidenceScore0to100) ??
      pickNumber(derived.confidence) ??
      pickNumber(record.confidenceScore0to100),
  };
}

export function buildUsageParitySnapshotFromHouseContract(
  contract: UserUsageHouseContract | null | undefined
): UsageParitySnapshot | null {
  const viewModel = buildUserUsageDashboardViewModel(contract ?? null);
  if (!viewModel) return null;
  const weather = weatherFieldsFromScore(contract?.weatherSensitivityScore);
  return {
    coverage: normalizeCoverageSnapshot(viewModel.coverage),
    intervalsCount: viewModel.coverage.intervalsCount ?? null,
    netKwh: viewModel.derived.totals.netKwh ?? null,
    avgDailyKwh: viewModel.derived.avgDailyKwh ?? null,
    ...weather,
    baseload15MinKwh: pickNumber(viewModel.derived.baseload),
    baseloadDailyKwh: pickNumber(viewModel.derived.baseloadDaily),
    baseloadMonthlyKwh: pickNumber(viewModel.derived.baseloadMonthly),
    weekdayKwh: viewModel.derived.weekdayKwh ?? null,
    weekendKwh: viewModel.derived.weekendKwh ?? null,
    timeOfDayBuckets: viewModel.derived.timeOfDayBuckets,
    monthlyRows: viewModel.derived.monthly,
    dailyRowCount: viewModel.derived.daily.length,
  };
}

export function buildUsageParitySnapshotFromRunDisplayView(view: unknown): UsageParitySnapshot | null {
  const record = asRecord(view);
  const summary = asRecord(record.summary);
  const totals = asRecord(summary.totals);
  const weather = weatherFieldsFromScore(record.weatherScore);
  return {
    coverage: {
      source: summary.source ?? null,
      start: summary.coverageStart ?? null,
      end: summary.coverageEnd ?? null,
      intervalsCount: summary.intervalsCount ?? null,
    },
    intervalsCount: pickNumber(summary.intervalsCount),
    netKwh: pickNumber(totals.netKwh),
    avgDailyKwh: pickNumber(summary.avgDailyKwh),
    ...weather,
    baseload15MinKwh: pickNumber(summary.baseload),
    baseloadDailyKwh: pickNumber(summary.baseloadDaily),
    baseloadMonthlyKwh: pickNumber(summary.baseloadMonthly),
    weekdayKwh: pickNumber(summary.weekdayKwh),
    weekendKwh: pickNumber(summary.weekendKwh),
    timeOfDayBuckets: Array.isArray(summary.timeOfDayBuckets) ? summary.timeOfDayBuckets : [],
    monthlyRows: Array.isArray(record.monthlyRows) ? record.monthlyRows : [],
    dailyRowCount: Array.isArray(record.dailyRows) ? record.dailyRows.length : null,
  };
}

function compareParitySnapshots(left: UsageParitySnapshot | null, right: UsageParitySnapshot | null) {
  const violations: string[] = [];
  if (!left || !right) {
    return { ok: false, violations: ["missing parity snapshot"] };
  }
  const compare = (label: string, a: unknown, b: unknown) => {
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      violations.push(`${label} mismatch`);
    }
  };
  compare("coverage", left.coverage, right.coverage);
  compare("intervalsCount", left.intervalsCount, right.intervalsCount);
  compare("netKwh", left.netKwh, right.netKwh);
  compare("avgDailyKwh", left.avgDailyKwh, right.avgDailyKwh);
  compare("weatherEfficiencyScore0to100", left.weatherEfficiencyScore0to100, right.weatherEfficiencyScore0to100);
  compare("coolingSensitivity", left.coolingSensitivity, right.coolingSensitivity);
  compare("heatingSensitivity", left.heatingSensitivity, right.heatingSensitivity);
  compare("confidence", left.confidence, right.confidence);
  compare("baseload15MinKwh", left.baseload15MinKwh, right.baseload15MinKwh);
  compare("baseloadDailyKwh", left.baseloadDailyKwh, right.baseloadDailyKwh);
  compare("baseloadMonthlyKwh", left.baseloadMonthlyKwh, right.baseloadMonthlyKwh);
  compare("weekdayKwh", left.weekdayKwh, right.weekdayKwh);
  compare("weekendKwh", left.weekendKwh, right.weekendKwh);
  compare("timeOfDayBuckets", left.timeOfDayBuckets, right.timeOfDayBuckets);
  compare("monthlyRows", left.monthlyRows, right.monthlyRows);
  return { ok: violations.length === 0, violations };
}

export function buildUsageParityAudit(args: {
  userUsagePageBaselineContract?: UserUsageHouseContract | null;
  runDisplayView?: unknown;
  pastDataset?: unknown;
  displayTotalsDataset?: unknown;
}) {
  const actualSnapshot = buildUsageParitySnapshotFromHouseContract(args.userUsagePageBaselineContract);
  const simulatorUsageSnapshot = actualSnapshot;
  const adminBaselineSnapshot = args.runDisplayView
    ? buildUsageParitySnapshotFromRunDisplayView(args.runDisplayView)
    : actualSnapshot;

  const actualUserVsSimulatorUsage = compareParitySnapshots(actualSnapshot, simulatorUsageSnapshot);
  const actualUserVsAdminBaseline = compareParitySnapshots(actualSnapshot, adminBaselineSnapshot);

  const pastUserVsAdmin = args.pastDataset
    ? auditUserAdminPastReadModelParity({ dataset: args.pastDataset })
    : { ok: true, violations: [] as string[] };

  const totalsDataset = args.displayTotalsDataset ?? args.pastDataset ?? asRecord(args.userUsagePageBaselineContract).dataset;
  const intervalInvariants = totalsDataset
    ? auditIntervalReadModelInvariants({ dataset: totalsDataset })
    : { ok: true, violations: [] as string[], netUsageKwh: null, timeOfDayBucketTotalKwh: null };
  const displayTotalsAudit = totalsDataset ? buildUsageDisplayTotalsAudit({ dataset: totalsDataset }) : null;

  const invariants: string[] = [...intervalInvariants.violations];
  if (
    intervalInvariants.netUsageKwh != null &&
    intervalInvariants.netUsageKwh > 0 &&
    intervalInvariants.timeOfDayBucketTotalKwh != null &&
    intervalInvariants.timeOfDayBucketTotalKwh <= INTERVAL_READ_MODEL_TOLERANCE_KWH
  ) {
    invariants.push("time-of-day buckets are zero despite interval-backed net usage");
  }
  if (displayTotalsAudit?.canonicalTotalKwh != null && displayTotalsAudit.monthlyRawTotalKwh != null) {
    if (
      Math.abs(displayTotalsAudit.canonicalTotalKwh - displayTotalsAudit.monthlyRawTotalKwh) >
      INTERVAL_READ_MODEL_TOLERANCE_KWH
    ) {
      invariants.push("monthly raw total diverged from canonical total");
    }
  }
  if (args.userUsagePageBaselineContract) {
    const contractParity = auditUserUsageHouseContractParity({
      left: args.userUsagePageBaselineContract,
      right: args.userUsagePageBaselineContract,
    });
    if (!contractParity.ok) {
      invariants.push(...contractParity.violations);
    }
  }

  return {
    actualUserVsSimulatorUsage,
    actualUserVsAdminBaseline,
    pastUserVsAdmin,
    invariants: {
      ok: invariants.length === 0,
      violations: invariants,
      intervalReadModel: intervalInvariants,
      displayTotalsAudit,
    },
  };
}

export function buildValidationTargetsSnapshot(metrics: unknown) {
  const record = asRecord(metrics);
  const wapeActual = pickNumber(record.wape);
  const maeActual = pickNumber(record.mae);
  const rmseActual = pickNumber(record.rmse);
  const wapeMax = 15;
  const maeMax = 10;
  const rmseMax = 15;
  return {
    wape: { actual: wapeActual, max: wapeMax, pass: wapeActual != null ? wapeActual <= wapeMax : null },
    mae: { actual: maeActual, max: maeMax, pass: maeActual != null ? maeActual <= maeMax : null },
    rmse: { actual: rmseActual, max: rmseMax, pass: rmseActual != null ? rmseActual <= rmseMax : null },
  };
}

export function buildPerformanceAuditSnapshot(args: {
  stageTimingsMs?: Record<string, number> | null;
  readModel?: Record<string, unknown> | null;
  routeTotalDurationMs?: number | null;
}) {
  const readModel = asRecord(args.readModel);
  const datasetMeta = asRecord(asRecord(readModel.dataset).meta);
  const sharedDiagnostics = asRecord(readModel.sharedDiagnostics);
  const lockboxSummary = asRecord(sharedDiagnostics.lockboxExecutionSummary);
  const lockboxTrace = asRecord(datasetMeta.lockboxPerRunTrace);
  const stageDurationsMs = {
    ...asRecord(lockboxSummary.stageTimings),
    ...asRecord(lockboxTrace.stageTimingsMs),
    ...asRecord(args.stageTimingsMs),
  };
  const stageValues = Object.values(stageDurationsMs).map((value) => Number(value) || 0);
  const summedStageMs = stageValues.reduce((sum, value) => sum + value, 0);
  const totalDurationMs =
    args.routeTotalDurationMs != null && args.routeTotalDurationMs > 0
      ? args.routeTotalDurationMs
      : summedStageMs > 0
        ? summedStageMs
        : null;

  const preloadReuse = pickNumber(lockboxTrace.preloadReuseCount);
  const preloadFetch = pickNumber(lockboxTrace.preloadFetchCount);
  const gbProducerFetch = pickNumber(lockboxTrace.greenButtonProducerFetchCount);
  const gbProducerReuse = pickNumber(lockboxTrace.greenButtonProducerReuseCount);

  return {
    totalDurationMs,
    cacheStatus:
      preloadReuse != null && preloadReuse > 0
        ? "hit"
        : preloadFetch != null && preloadFetch > 0
          ? "miss"
          : "unknown",
    getActualUsageDatasetForHouseCount:
      pickNumber(lockboxTrace.getActualUsageDatasetForHouseCount) ?? pickNumber(preloadFetch) ?? 0,
    loadGreenButtonPastProducerIntervalsCount: gbProducerFetch ?? gbProducerReuse ?? 0,
    intervalPreloadEnabled: preloadFetch != null || preloadReuse != null || gbProducerFetch != null,
    reusedForValidation: (preloadReuse ?? 0) > 0,
    reusedForSimulation: (gbProducerReuse ?? 0) > 0,
    stageDurationsMs,
  };
}
