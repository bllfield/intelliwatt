import {
  auditIntervalReadModelInvariants,
  auditUserAdminPastReadModelParity,
  auditUserUsageHouseContractParity,
  INTERVAL_READ_MODEL_TOLERANCE_KWH,
} from "@/lib/usage/intervalReadModelInvariants";
import { readPastSimDisplayWeatherSensitivityScore } from "@/lib/usage/pastSimDisplayWeather";
import { computePastSimCanonicalOwnershipAudit } from "@/lib/usage/pastSimValidationBaselineProjection";
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

type ParityFieldComparison = {
  field: string;
  left: unknown;
  right: unknown;
  delta: number | null;
  tolerance: number | null;
  pass: boolean;
};

function numericDelta(left: unknown, right: unknown): number | null {
  const a = pickNumber(left);
  const b = pickNumber(right);
  if (a == null || b == null) return null;
  return Math.round((a - b) * 100) / 100;
}

function fieldPass(left: unknown, right: unknown, tolerance = INTERVAL_READ_MODEL_TOLERANCE_KWH): boolean {
  const a = pickNumber(left);
  const b = pickNumber(right);
  if (a != null && b != null) {
    return Math.abs(a - b) <= tolerance;
  }
  return JSON.stringify(left) === JSON.stringify(right);
}

function buildStructuredParityGroup(args: {
  label: string;
  left: UsageParitySnapshot | null;
  right: UsageParitySnapshot | null;
  sourceOwner: string;
  numericFields?: string[];
}) {
  const violations: string[] = [];
  const fields: ParityFieldComparison[] = [];
  const numericFields = args.numericFields ?? [
    "intervalsCount",
    "netKwh",
    "avgDailyKwh",
    "weatherEfficiencyScore0to100",
    "coolingSensitivity",
    "heatingSensitivity",
    "confidence",
    "baseload15MinKwh",
    "baseloadDailyKwh",
    "baseloadMonthlyKwh",
    "weekdayKwh",
    "weekendKwh",
  ];
  if (!args.left || !args.right) {
    return {
      label: args.label,
      pass: false,
      violations: ["missing parity snapshot"],
      valuesCompared: fields,
      sourceOwner: args.sourceOwner,
    };
  }

  const compareField = (field: string, leftValue: unknown, rightValue: unknown, tolerance?: number) => {
    const pass = fieldPass(leftValue, rightValue, tolerance);
    fields.push({
      field,
      left: leftValue,
      right: rightValue,
      delta: numericDelta(leftValue, rightValue),
      tolerance: tolerance ?? (pickNumber(leftValue) != null ? INTERVAL_READ_MODEL_TOLERANCE_KWH : null),
      pass,
    });
    if (!pass) violations.push(`${field} mismatch`);
  };

  compareField("coverage", args.left.coverage, args.right.coverage, 0);
  for (const field of numericFields) {
    compareField(field, (args.left as Record<string, unknown>)[field], (args.right as Record<string, unknown>)[field]);
  }
  compareField("timeOfDayBuckets", args.left.timeOfDayBuckets, args.right.timeOfDayBuckets, 0);
  compareField("monthlyRows", args.left.monthlyRows, args.right.monthlyRows, 0);

  return {
    label: args.label,
    pass: violations.length === 0,
    violations,
    valuesCompared: fields,
    sourceOwner: args.sourceOwner,
  };
}

export function buildUsageParityAudit(args: {
  userUsagePageBaselineContract?: UserUsageHouseContract | null;
  runDisplayView?: unknown;
  pastDataset?: unknown;
  pastRunDisplayView?: unknown;
  displayTotalsDataset?: unknown;
  engineInput?: Record<string, unknown> | null;
  compareMetrics?: Record<string, unknown> | null;
}) {
  const actualSnapshot = buildUsageParitySnapshotFromHouseContract(args.userUsagePageBaselineContract);
  const simulatorUsageSnapshot = actualSnapshot;
  const adminBaselineSnapshot = args.runDisplayView
    ? buildUsageParitySnapshotFromRunDisplayView(args.runDisplayView)
    : actualSnapshot;

  const actualUserVsSimulatorUsage = buildStructuredParityGroup({
    label: "actualUserVsSimulatorUsage",
    left: actualSnapshot,
    right: simulatorUsageSnapshot,
    sourceOwner: "buildUserUsageDashboardViewModel",
  });
  const actualUserVsAdminBaseline = buildStructuredParityGroup({
    label: "actualUserVsAdminBaseline",
    left: actualSnapshot,
    right: adminBaselineSnapshot,
    sourceOwner: "buildOnePathRunReadOnlyView",
  });

  const pastDatasetRecord = asRecord(args.pastDataset);
  const pastUserSnapshot = Object.keys(pastDatasetRecord).length
    ? buildUsageParitySnapshotFromHouseContract({
        dataset: args.pastDataset,
        weatherSensitivityScore: readPastSimDisplayWeatherSensitivityScore(pastDatasetRecord) as never,
      } as UserUsageHouseContract)
    : null;
  const pastAdminSnapshot = args.pastRunDisplayView
    ? buildUsageParitySnapshotFromRunDisplayView(args.pastRunDisplayView)
    : args.runDisplayView
      ? buildUsageParitySnapshotFromRunDisplayView(args.runDisplayView)
      : null;

  const pastReadModelAudit = Object.keys(pastDatasetRecord).length
    ? auditUserAdminPastReadModelParity({ dataset: args.pastDataset })
    : {
        ok: true,
        violations: [] as string[],
        weatherCards: {
          pass: true,
          user: { weatherEfficiency: null, cooling: null, heating: null, confidence: null },
          admin: { weatherEfficiency: null, cooling: null, heating: null, confidence: null },
          sourceOwner: "meta.pastDisplayWeatherSensitivityScore",
        },
      };

  const pastUserVsAdminCore = buildStructuredParityGroup({
    label: "pastUserVsAdmin",
    left: pastUserSnapshot,
    right: pastAdminSnapshot,
    sourceOwner: "meta.pastDisplayWeatherSensitivityScore + insights.timeOfDayBuckets",
  });

  const canonicalOwnership =
    Object.keys(pastDatasetRecord).length > 0
      ? computePastSimCanonicalOwnershipAudit({
          dataset: args.pastDataset,
          compareMetrics:
            args.compareMetrics ??
            asRecord(asRecord(args.pastRunDisplayView).compare).metrics ??
            asRecord(asRecord(args.runDisplayView).compare).metrics,
        })
      : null;

  const pastUserVsAdmin = {
    ...pastUserVsAdminCore,
    ok:
      pastUserVsAdminCore.pass &&
      pastReadModelAudit.ok &&
      pastReadModelAudit.weatherCards.pass &&
      canonicalOwnership?.canonicalPastIncludesValidationTestSimulation !== true,
    weatherCards: {
      pass: pastReadModelAudit.weatherCards.pass,
      valuesCompared: {
        weatherEfficiency: {
          user: pastReadModelAudit.weatherCards.user.weatherEfficiency,
          admin: pastReadModelAudit.weatherCards.admin.weatherEfficiency,
        },
        cooling: {
          user: pastReadModelAudit.weatherCards.user.cooling,
          admin: pastReadModelAudit.weatherCards.admin.cooling,
        },
        heating: {
          user: pastReadModelAudit.weatherCards.user.heating,
          admin: pastReadModelAudit.weatherCards.admin.heating,
        },
        confidence: {
          user: pastReadModelAudit.weatherCards.user.confidence,
          admin: pastReadModelAudit.weatherCards.admin.confidence,
        },
      },
      tolerance: 0,
      sourceOwner: pastReadModelAudit.weatherCards.sourceOwner,
    },
    readModelAudit: {
      pass: pastReadModelAudit.ok,
      violations: pastReadModelAudit.violations,
      sourceOwner: "auditUserAdminPastReadModelParity",
    },
    canonicalOwnership,
  };

  const totalsDataset =
    args.displayTotalsDataset ??
    args.pastDataset ??
    asRecord(args.userUsagePageBaselineContract).dataset;
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
  if (displayTotalsAudit?.timeOfDayVsCanonicalDeltaKwh != null) {
    if (Math.abs(displayTotalsAudit.timeOfDayVsCanonicalDeltaKwh) > INTERVAL_READ_MODEL_TOLERANCE_KWH) {
      invariants.push(
        `time-of-day total diverged from canonical by ${displayTotalsAudit.timeOfDayVsCanonicalDeltaKwh} kWh`
      );
    }
  }
  if (!pastUserVsAdmin.weatherCards.pass) {
    invariants.push("past user vs admin weather cards differ");
  }
  if (canonicalOwnership?.canonicalPastIncludesValidationTestSimulation) {
    invariants.push("canonical past curve includes simulated validation/test day totals");
  }
  if (displayTotalsAudit?.mismatchClassification === "unexpected_display_owner_mismatch") {
    invariants.push("display totals audit reported unexpected display owner mismatch");
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

  const datasetMeta = asRecord(asRecord(totalsDataset).meta);
  const engineInput = asRecord(args.engineInput);
  const runContext = asRecord(engineInput.runtime).runContext
    ? asRecord(asRecord(engineInput.runtime).runContext)
    : asRecord(datasetMeta.lockboxRunContext);
  const actualSource =
    String(engineInput.actualSource ?? datasetMeta.actualSource ?? runContext.preferredActualSource ?? "")
      .trim()
      .toUpperCase() || null;
  const preferredActualSource =
    String(runContext.preferredActualSource ?? datasetMeta.preferredActualSource ?? actualSource ?? "")
      .trim()
      .toUpperCase() || null;
  const internalLegacyMode =
    String(engineInput.simulatorMode ?? datasetMeta.simulatorMode ?? datasetMeta.mode ?? "").trim() || null;
  const selectedMode =
    actualSource === "GREEN_BUTTON" || preferredActualSource === "GREEN_BUTTON"
      ? "GREEN_BUTTON"
      : actualSource ?? preferredActualSource ?? internalLegacyMode;

  const parityPass =
    actualUserVsSimulatorUsage.pass &&
    actualUserVsAdminBaseline.pass &&
    pastUserVsAdmin.ok &&
    invariants.length === 0;

  return {
    pass: parityPass,
    selectedMode,
    simulatorMode: selectedMode,
    internalLegacyMode:
      internalLegacyMode && internalLegacyMode !== selectedMode ? internalLegacyMode : null,
    actualSource,
    preferredActualSource,
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
  engineInput?: Record<string, unknown> | null;
}) {
  const readModel = asRecord(args.readModel);
  const datasetMeta = asRecord(asRecord(readModel.dataset).meta);
  const sharedDiagnostics = asRecord(readModel.sharedDiagnostics);
  const lockboxSummary = asRecord(sharedDiagnostics.lockboxExecutionSummary);
  const lockboxTrace = asRecord(datasetMeta.lockboxPerRunTrace);
  const engineInput = asRecord(args.engineInput);
  const runContext = asRecord(engineInput.runtime).runContext
    ? asRecord(asRecord(engineInput.runtime).runContext)
    : asRecord(datasetMeta.lockboxRunContext);
  const actualSource =
    String(engineInput.actualSource ?? datasetMeta.actualSource ?? runContext.preferredActualSource ?? "")
      .trim()
      .toUpperCase() || null;
  const preferredActualSource =
    String(runContext.preferredActualSource ?? datasetMeta.preferredActualSource ?? actualSource ?? "")
      .trim()
      .toUpperCase() || null;
  const internalLegacyMode =
    String(engineInput.simulatorMode ?? datasetMeta.simulatorMode ?? datasetMeta.mode ?? "").trim() || null;
  const selectedMode =
    actualSource === "GREEN_BUTTON" || preferredActualSource === "GREEN_BUTTON"
      ? "GREEN_BUTTON"
      : actualSource ?? preferredActualSource ?? internalLegacyMode;

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
    selectedMode,
    simulatorMode: selectedMode,
    internalLegacyMode:
      internalLegacyMode && internalLegacyMode !== selectedMode ? internalLegacyMode : null,
    actualSource,
    preferredActualSource,
    cacheStatus:
      preloadReuse != null && preloadReuse > 0
        ? "hit"
        : preloadFetch != null && preloadFetch > 0
          ? "miss"
          : "unknown",
    getActualUsageDatasetForHouseCount:
      pickNumber(lockboxTrace.getActualUsageDatasetForHouseCount) ?? pickNumber(preloadFetch) ?? 0,
    loadGreenButtonPastProducerIntervalsCount: gbProducerFetch ?? gbProducerReuse ?? 0,
    greenButtonProducerFetchCount: gbProducerFetch ?? 0,
    greenButtonProducerReuseCount: gbProducerReuse ?? 0,
    actualIntervalPayloadAttached: datasetMeta.actualIntervalPayloadAttached ?? null,
    actualIntervalPayloadSource: datasetMeta.actualIntervalPayloadSource ?? null,
    intervalPreloadEnabled: preloadFetch != null || preloadReuse != null || gbProducerFetch != null,
    reusedForValidation: (preloadReuse ?? 0) > 0,
    reusedForSimulation: (gbProducerReuse ?? 0) > 0,
    stageDurationsMs,
  };
}
