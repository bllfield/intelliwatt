import type { ManualUsagePayload } from "@/modules/simulatedUsage/types";
import { buildManualMonthlyReconciliation } from "@/modules/manualUsage/reconciliation";
import { buildManualUsageReadModel, type ManualUsageReadModel } from "@/modules/manualUsage/readModel";
import { getManualUsageInputForUserHouse } from "@/modules/manualUsage/store";
import {
  buildValidationCompareProjectionFromDatasets,
  buildValidationCompareProjectionSidecar,
} from "@/modules/usageSimulator/compareProjection";
import { buildDailyCurveComparePayload } from "@/modules/usageSimulator/dailyCurveCompareSummary";
import {
  buildSharedPastSimDiagnostics,
  type SharedDiagnosticsCallerType,
} from "@/modules/usageSimulator/sharedDiagnostics";
import { getMemoryRssMb, logSimPipelineEvent } from "@/modules/usageSimulator/simObservability";
import { getSimulatedUsageForHouseScenario } from "@/modules/usageSimulator/service";

export type ManualUsagePastSimReadResult =
  | {
      ok: true;
      houseId: string;
      scenarioId: string;
      payload: ManualUsagePayload | null;
      dataset: any;
      displayDataset: any;
      compareProjection: {
        rows?: unknown;
        metrics?: unknown;
      };
      curveCompareActualIntervals15: Array<{ timestamp: string; kwh: number }>;
      curveCompareSimulatedIntervals15: Array<{ timestamp: string; kwh: number }>;
      curveCompareSimulatedDailyRows: Array<{
        date: string;
        kwh: number;
        source: string | null;
        sourceDetail: string | null;
      }>;
      manualReadModel: ManualUsageReadModel | null;
      manualMonthlyReconciliation: ReturnType<typeof buildManualMonthlyReconciliation>;
      sharedDiagnostics: ReturnType<typeof buildSharedPastSimDiagnostics>;
      manualParitySummary: ReturnType<typeof buildManualParitySummary> | null;
    }
  | {
      ok: false;
      error: string | null | undefined;
      message: string | null | undefined;
      failureCode: string | null | undefined;
      failureMessage: string | null | undefined;
    };

export async function buildManualUsagePastSimReadResult(args: {
  userId: string;
  houseId: string;
  scenarioId: string | null;
  readMode: "artifact_only" | "allow_rebuild";
  callerType: SharedDiagnosticsCallerType;
  correlationId?: string | null;
  exactArtifactInputHash?: string | null;
  requireExactArtifactMatch?: boolean;
  usageInputMode?: string | null;
  validationPolicyOwner?: string | null;
  weatherLogicMode?: string | null;
  artifactId?: string | null;
  artifactInputHash?: string | null;
  artifactEngineVersion?: string | null;
  artifactPersistenceOutcome?: string | null;
  manualUsagePayload?: ManualUsagePayload | null;
  actualDataset?: any;
  actualReference?:
    | {
        userId: string;
        houseId: string;
        scenarioId: string | null;
      }
    | null;
}) : Promise<ManualUsagePastSimReadResult> {
  const startedAt = Date.now();
  const stepStartedAt = Date.now();
  const emit = (event: string, extra: Record<string, unknown> = {}) => {
    logSimPipelineEvent(event, {
      correlationId: args.correlationId ?? null,
      houseId: args.houseId,
      scenarioId: args.scenarioId ?? null,
      readMode: args.readMode,
      callerType: args.callerType,
      artifactInputHash: args.exactArtifactInputHash ?? args.artifactInputHash ?? null,
      durationMs: Date.now() - startedAt,
      memoryRssMb: getMemoryRssMb(),
      source: "buildManualUsagePastSimReadResult",
      ...extra,
    });
  };
  if (!args.scenarioId) {
    emit("manual_readback_failure", {
      failureCode: "past_scenario_missing",
      failureMessage: "Past (Corrected) scenario is missing for this house.",
    });
    return {
      ok: false,
      error: "past_scenario_missing",
      message: "Past (Corrected) scenario is missing for this house.",
      failureCode: "past_scenario_missing",
      failureMessage: "Past (Corrected) scenario is missing for this house.",
    };
  }

  emit("manual_readback_start", {
    requireExactArtifactMatch: args.requireExactArtifactMatch === true,
  });
  const manualUsageRecord =
    args.manualUsagePayload !== undefined
      ? { payload: args.manualUsagePayload }
      : await getManualUsageInputForUserHouse({ userId: args.userId, houseId: args.houseId });
  const effectiveUsageInputMode =
    args.usageInputMode ??
    (manualUsageRecord.payload?.mode === "ANNUAL"
      ? "MANUAL_ANNUAL"
      : manualUsageRecord.payload?.mode === "MONTHLY"
        ? "MANUAL_MONTHLY"
        : null);
  const out = await getSimulatedUsageForHouseScenario({
    userId: args.userId,
    houseId: args.houseId,
    scenarioId: args.scenarioId,
    readMode: args.readMode,
    exactArtifactInputHash: args.exactArtifactInputHash ?? undefined,
    requireExactArtifactMatch: args.requireExactArtifactMatch === true,
    projectionMode: "baseline",
    correlationId: args.correlationId ?? undefined,
    readContext: {
      artifactReadMode: args.readMode,
      projectionMode: "baseline",
      compareSidecarRequest: true,
    },
  });
  if (!out.ok) {
    emit("manual_readback_failure", {
      failureCode: out.code,
      failureMessage: out.message,
    });
    return {
      ok: false,
      error: out.code,
      message: out.message,
      failureCode: out.code,
      failureMessage: out.message,
    };
  }

  const displayDataset = shouldUseRawDisplayDataset(effectiveUsageInputMode)
    ? await loadManualUsageRawDisplayDataset({
        userId: args.userId,
        houseId: args.houseId,
        scenarioId: args.scenarioId,
        readMode: args.readMode,
        exactArtifactInputHash: args.exactArtifactInputHash ?? null,
        requireExactArtifactMatch: args.requireExactArtifactMatch === true,
        correlationId: args.correlationId ?? null,
        fallbackDataset: out.dataset,
      })
    : out.dataset;

  emit("manual_readback_dataset_ready", {
    intervalCount: Array.isArray((out.dataset as any)?.series?.intervals15) ? (out.dataset as any).series.intervals15.length : 0,
    dayCount: Array.isArray((out.dataset as any)?.daily) ? (out.dataset as any).daily.length : 0,
    monthCount: Array.isArray((out.dataset as any)?.monthly) ? (out.dataset as any).monthly.length : 0,
  });
  const resolvedActualDataset = await resolveManualCompareActualDataset({
    actualDataset: args.actualDataset,
    actualReference: args.actualReference ?? null,
    correlationId: args.correlationId ?? null,
  });
  emit("manual_readback_actual_dataset_ready", {
    stepDurationMs: Date.now() - stepStartedAt,
    actualIntervalCount: Array.isArray((resolvedActualDataset as any)?.series?.intervals15)
      ? (resolvedActualDataset as any).series.intervals15.length
      : 0,
    actualDayCount: Array.isArray((resolvedActualDataset as any)?.daily) ? (resolvedActualDataset as any).daily.length : 0,
  });
  const { compareProjection, manualReadModel, manualMonthlyReconciliation, sharedDiagnostics, manualUsagePayload } =
    await buildManualUsageReadDecorations({
      userId: args.userId,
      houseId: args.houseId,
      scenarioId: args.scenarioId,
      dataset: out.dataset,
      callerType: args.callerType,
      readMode: args.readMode,
      correlationId: args.correlationId ?? null,
      usageInputMode: args.usageInputMode ?? null,
      validationPolicyOwner: args.validationPolicyOwner ?? null,
      weatherLogicMode: args.weatherLogicMode ?? null,
      artifactId: args.artifactId ?? null,
      artifactInputHash: args.artifactInputHash ?? null,
      artifactEngineVersion: args.artifactEngineVersion ?? null,
      artifactPersistenceOutcome: args.artifactPersistenceOutcome ?? null,
      manualUsagePayload: manualUsageRecord.payload,
      actualDataset: resolvedActualDataset,
      displayDataset,
    });
  emit("manual_readback_decorations_ready", {
    stepDurationMs: Date.now() - stepStartedAt,
    compareRowCount: Array.isArray(compareProjection?.rows) ? compareProjection.rows.length : 0,
    reconciliationRowCount: Array.isArray((manualMonthlyReconciliation as any)?.rows)
      ? (manualMonthlyReconciliation as any).rows.length
      : 0,
    readModelBillPeriodCount: Array.isArray(manualReadModel?.billPeriodTargets) ? manualReadModel.billPeriodTargets.length : 0,
  });
  const manualParitySummary = buildManualParitySummary({
    scenarioId: args.scenarioId,
    payload: manualUsagePayload,
    dataset: out.dataset,
    compareProjection,
    manualReadModel,
    sharedDiagnostics,
  });
  const curveComparePayload = buildDailyCurveComparePayload({
    actualDataset: resolvedActualDataset,
    simulatedDataset: displayDataset,
    compareRows: compareProjection?.rows ?? [],
    timezone: displayDataset?.meta?.timezone ?? out.dataset?.meta?.timezone ?? "America/Chicago",
  });
  emit("manual_readback_curve_payload_ready", {
    stepDurationMs: Date.now() - stepStartedAt,
    curveCompareActualIntervalCount: curveComparePayload?.actualIntervals15.length ?? 0,
    curveCompareSimIntervalCount: curveComparePayload?.simulatedIntervals15.length ?? 0,
    curveCompareDailyRowCount: curveComparePayload?.simulatedDailyRows.length ?? 0,
  });
  emit("manual_readback_success", {
    compareRowCount: Array.isArray(compareProjection?.rows) ? compareProjection.rows.length : 0,
    reconciliationRowCount: Array.isArray((manualMonthlyReconciliation as any)?.rows)
      ? (manualMonthlyReconciliation as any).rows.length
      : 0,
    displayDatasetAvailable: displayDataset != null,
    displayDatasetSummaryTotalKwh:
      typeof displayDataset?.summary?.totalKwh === "number" ? displayDataset.summary.totalKwh : null,
    curveCompareActualIntervalCount: curveComparePayload?.actualIntervals15.length ?? 0,
    curveCompareSimIntervalCount: curveComparePayload?.simulatedIntervals15.length ?? 0,
  });
  return {
    ok: true,
    houseId: args.houseId,
    scenarioId: args.scenarioId,
    payload: manualUsagePayload,
    dataset: out.dataset,
    displayDataset,
    compareProjection,
    curveCompareActualIntervals15: curveComparePayload?.actualIntervals15 ?? [],
    curveCompareSimulatedIntervals15: curveComparePayload?.simulatedIntervals15 ?? [],
    curveCompareSimulatedDailyRows: curveComparePayload?.simulatedDailyRows ?? [],
    manualReadModel,
    manualMonthlyReconciliation,
    sharedDiagnostics,
    manualParitySummary,
  };
}

function shouldUseRawDisplayDataset(usageInputMode: string | null | undefined): boolean {
  return (
    usageInputMode === "MANUAL_MONTHLY" ||
    usageInputMode === "MONTHLY_FROM_SOURCE_INTERVALS" ||
    usageInputMode === "MANUAL_ANNUAL" ||
    usageInputMode === "ANNUAL_FROM_SOURCE_INTERVALS"
  );
}

async function loadManualUsageRawDisplayDataset(args: {
  userId: string;
  houseId: string;
  scenarioId: string;
  readMode: "artifact_only" | "allow_rebuild";
  exactArtifactInputHash?: string | null;
  requireExactArtifactMatch?: boolean;
  correlationId?: string | null;
  fallbackDataset: any;
}) {
  const raw = await getSimulatedUsageForHouseScenario({
    userId: args.userId,
    houseId: args.houseId,
    scenarioId: args.scenarioId,
    readMode: args.readMode,
    exactArtifactInputHash: args.exactArtifactInputHash ?? undefined,
    requireExactArtifactMatch: args.requireExactArtifactMatch === true,
    projectionMode: "raw",
    correlationId: args.correlationId ?? undefined,
    readContext: {
      artifactReadMode: args.readMode,
      projectionMode: "raw",
      compareSidecarRequest: false,
    },
  });
  return raw.ok ? raw.dataset : args.fallbackDataset;
}

async function resolveManualCompareActualDataset(args: {
  actualDataset?: any;
  actualReference?:
    | {
        userId: string;
        houseId: string;
        scenarioId: string | null;
      }
    | null;
  correlationId?: string | null;
}) {
  if (args.actualDataset !== undefined) return args.actualDataset ?? null;
  return null;
}

function compactTravelRanges(value: unknown): Array<{ startDate: string; endDate: string }> {
  if (!Array.isArray(value)) return [];
  return value
    .map((range) => ({
      startDate: String((range as any)?.startDate ?? "").slice(0, 10),
      endDate: String((range as any)?.endDate ?? "").slice(0, 10),
    }))
    .filter((range) => /^\d{4}-\d{2}-\d{2}$/.test(range.startDate) && /^\d{4}-\d{2}-\d{2}$/.test(range.endDate));
}

function buildModeledDayCounts(dataset: any): Record<string, number> {
  const counts: Record<string, number> = {};
  const dailyRows = Array.isArray(dataset?.daily) ? dataset.daily : [];
  for (const row of dailyRows) {
    const source = String((row as any)?.sourceDetail ?? (row as any)?.source ?? "UNKNOWN").trim() || "UNKNOWN";
    counts[source] = (counts[source] ?? 0) + 1;
  }
  return counts;
}

function buildMonthlyTotalsByMonth(dataset: any): Record<string, number> {
  const out: Record<string, number> = {};
  const monthlyRows = Array.isArray(dataset?.monthly) ? dataset.monthly : [];
  for (const row of monthlyRows) {
    const month = String((row as any)?.month ?? "").trim();
    const kwh = Number((row as any)?.kwh ?? Number.NaN);
    if (!/^\d{4}-\d{2}$/.test(month) || !Number.isFinite(kwh)) continue;
    out[month] = kwh;
  }
  return out;
}

function buildManualParitySummary(args: {
  scenarioId: string | null;
  payload: ManualUsagePayload | null;
  dataset: any;
  compareProjection: { rows?: unknown; metrics?: unknown } | null | undefined;
  manualReadModel: ManualUsageReadModel | null;
  sharedDiagnostics: ReturnType<typeof buildSharedPastSimDiagnostics> | null;
}) {
  const sourceTruthContext =
    args.sharedDiagnostics?.sourceTruthContext && typeof args.sharedDiagnostics.sourceTruthContext === "object"
      ? (args.sharedDiagnostics.sourceTruthContext as Record<string, any>)
      : {};
  const identityContext =
    args.sharedDiagnostics?.identityContext && typeof args.sharedDiagnostics.identityContext === "object"
      ? (args.sharedDiagnostics.identityContext as Record<string, any>)
      : {};
  const lockboxExecutionSummary =
    args.sharedDiagnostics?.lockboxExecutionSummary && typeof args.sharedDiagnostics.lockboxExecutionSummary === "object"
      ? (args.sharedDiagnostics.lockboxExecutionSummary as Record<string, any>)
      : {};
  const lockboxTravelRanges = compactTravelRanges(sourceTruthContext.travelRangesUsed);
  const payloadTravelRanges = compactTravelRanges(args.payload?.travelRanges);
  const readModelTargets = args.manualReadModel?.billPeriodTargets ?? [];
  const artifactBillPeriods = Array.isArray(sourceTruthContext.manualBillPeriods)
    ? sourceTruthContext.manualBillPeriods
    : readModelTargets;
  const artifactTotals =
    sourceTruthContext.manualBillPeriodTotalsKwhById && typeof sourceTruthContext.manualBillPeriodTotalsKwhById === "object"
      ? (sourceTruthContext.manualBillPeriodTotalsKwhById as Record<string, number>)
      : (args.manualReadModel?.billPeriodTotalsKwhById ?? {});
  const stageOneTargets =
    args.manualReadModel?.monthlyCompareRows?.reduce<Record<string, number>>((acc, row) => {
      acc[row.month] = row.stageOneTargetKwh;
      return acc;
    }, {}) ?? {};
  const compareRowCount = Array.isArray(args.compareProjection?.rows) ? args.compareProjection?.rows.length : 0;
  const validationKeyCount = Array.isArray(args.dataset?.meta?.validationOnlyDateKeysLocal)
    ? args.dataset.meta.validationOnlyDateKeysLocal.length
    : 0;
  const stage1Parity = artifactBillPeriods.length === readModelTargets.length;
  const travelRangeParity = JSON.stringify(lockboxTravelRanges) === JSON.stringify(payloadTravelRanges);
  const normalizedTargetParity =
    Object.keys(stageOneTargets).length === 0 ||
    Object.entries(stageOneTargets).every(([month, kwh]) => Number(artifactTotals[month] ?? kwh) === Number(kwh));
  const stage2PathParity = Boolean(lockboxExecutionSummary.sharedProducerPathUsed);
  const compareAttachmentParity = validationKeyCount === 0 || compareRowCount > 0;
  return {
    identity: {
      sourceHouseId: sourceTruthContext.sourceHouseId ?? null,
      profileHouseId: sourceTruthContext.profileHouseId ?? null,
      scenarioId: args.scenarioId,
      simulatorMode: identityContext.simulatorMode ?? args.dataset?.meta?.mode ?? null,
      usageInputMode: identityContext.usageInputMode ?? null,
      weatherLogicMode: identityContext.weatherLogicMode ?? null,
      artifactId: identityContext.artifactId ?? null,
      artifactInputHash: identityContext.artifactInputHash ?? null,
      fullChainHash: identityContext.fullChainHash ?? null,
    },
    stage1_contract: {
      anchorEndDate: args.payload?.anchorEndDate ?? args.manualReadModel?.anchorEndDate ?? null,
      billEndDay:
        typeof (args.payload as any)?.anchorEndDate === "string"
          ? String((args.payload as any).anchorEndDate).slice(8, 10)
          : null,
      manualBillPeriods: artifactBillPeriods,
      manualBillPeriodTotalsKwhById: artifactTotals,
      normalizedMonthTargetsByMonth: stageOneTargets,
      eligibleRangeCount: args.manualReadModel?.billPeriodCompare?.eligibleRangeCount ?? null,
      ineligibleRangeCount: args.manualReadModel?.billPeriodCompare?.ineligibleRangeCount ?? null,
    },
    exclusion_alignment: {
      effectiveTravelRangesUsed: lockboxTravelRanges,
      manualPayloadTravelRanges: payloadTravelRanges,
      excludedDateKeysCount: sourceTruthContext.exclusionDrivingCanonicalInputsSummary?.excludedDateKeysCount ?? null,
      validationKeyCount,
    },
    stage2_summary: {
      modeledDayReasonCounts: buildModeledDayCounts(args.dataset),
      monthlyTotalsByMonth: buildMonthlyTotalsByMonth(args.dataset),
      manualMonthlyWeatherEvidenceSummary:
        sourceTruthContext.manualMonthlyWeatherEvidenceSummary && typeof sourceTruthContext.manualMonthlyWeatherEvidenceSummary === "object"
          ? {
              dailyWeatherResponsiveness: sourceTruthContext.manualMonthlyWeatherEvidenceSummary.dailyWeatherResponsiveness ?? null,
              baseloadShare: sourceTruthContext.manualMonthlyWeatherEvidenceSummary.baseloadShare ?? null,
              hvacShare: sourceTruthContext.manualMonthlyWeatherEvidenceSummary.hvacShare ?? null,
              eligibleBillPeriodCount: Array.isArray(sourceTruthContext.manualMonthlyWeatherEvidenceSummary.eligibleBillPeriodsUsed)
                ? sourceTruthContext.manualMonthlyWeatherEvidenceSummary.eligibleBillPeriodsUsed.length
                : 0,
              excludedTravelBillPeriodCount: Array.isArray(sourceTruthContext.manualMonthlyWeatherEvidenceSummary.excludedTravelTouchedBillPeriods)
                ? sourceTruthContext.manualMonthlyWeatherEvidenceSummary.excludedTravelTouchedBillPeriods.length
                : 0,
            }
          : null,
      compareRowsCount: compareRowCount,
      compareMetrics: args.compareProjection?.metrics ?? null,
      sharedProducerPathUsed: stage2PathParity,
    },
    parity_verdicts: {
      stage1Parity,
      stage1ParityReason: stage1Parity ? null : "Artifact bill-period contract does not match the shared manual read model.",
      travelRangeParity,
      travelRangeParityReason: travelRangeParity ? null : "Artifact travel ranges differ from the shared manual payload travel contract.",
      normalizedTargetParity,
      normalizedTargetParityReason: normalizedTargetParity ? null : "Artifact bill-period totals drift from the shared Stage 1 targets.",
      stage2PathParity,
      stage2PathParityReason: stage2PathParity ? null : "Shared producer path was not recorded on this artifact readback.",
      compareAttachmentParity,
      compareAttachmentParityReason:
        compareAttachmentParity ? null : "Validation keys were present, but compare rows were not attached to the artifact-backed read.",
      overallParityReady:
        stage1Parity &&
        travelRangeParity &&
        normalizedTargetParity &&
        stage2PathParity &&
        compareAttachmentParity,
    },
  };
}

export async function buildManualUsageReadDecorations(args: {
  userId: string;
  houseId: string;
  scenarioId: string | null;
  dataset: any;
  callerType: SharedDiagnosticsCallerType;
  readMode: "artifact_only" | "allow_rebuild";
  correlationId?: string | null;
  usageInputMode?: string | null;
  validationPolicyOwner?: string | null;
  weatherLogicMode?: string | null;
  artifactId?: string | null;
  artifactInputHash?: string | null;
  artifactEngineVersion?: string | null;
  artifactPersistenceOutcome?: string | null;
  manualUsagePayload?: ManualUsagePayload | null;
  actualDataset?: any;
  displayDataset?: any;
}) {
  const manualUsageRecord =
    args.manualUsagePayload !== undefined
      ? { payload: args.manualUsagePayload }
      : await getManualUsageInputForUserHouse({ userId: args.userId, houseId: args.houseId });
  const compareProjection =
    args.actualDataset && args.displayDataset
      ? buildValidationCompareProjectionFromDatasets({
          validationSourceDataset: args.dataset,
          actualDataset: args.actualDataset,
          simulatedDataset: args.displayDataset,
        })
      : buildValidationCompareProjectionSidecar(args.dataset);
  const manualReadModel = buildManualUsageReadModel({
    payload: manualUsageRecord.payload,
    dataset: args.dataset,
    actualDataset: args.actualDataset,
  });
  const usageInputMode =
    args.usageInputMode ??
    (manualUsageRecord.payload?.mode === "ANNUAL"
      ? "MANUAL_ANNUAL"
      : manualUsageRecord.payload?.mode === "MONTHLY"
        ? "MANUAL_MONTHLY"
        : null);
  const manualMonthlyReconciliation =
    manualReadModel?.billPeriodCompare ??
    buildManualMonthlyReconciliation({
      payload: manualUsageRecord.payload,
      dataset: args.dataset,
    });
  const sharedDiagnostics = buildSharedPastSimDiagnostics({
    callerType: args.callerType,
    dataset: args.dataset,
    scenarioId: args.scenarioId,
    correlationId: args.correlationId ?? null,
    usageInputMode,
    validationPolicyOwner: args.validationPolicyOwner ?? null,
    weatherLogicMode: args.weatherLogicMode ?? null,
    compareProjection,
    manualMonthlyReconciliation,
    readMode: args.readMode,
    projectionMode: "baseline",
    artifactId: args.artifactId ?? null,
    artifactInputHash: args.artifactInputHash ?? null,
    artifactEngineVersion: args.artifactEngineVersion ?? null,
    artifactPersistenceOutcome: args.artifactPersistenceOutcome ?? null,
  });
  return {
    compareProjection,
    manualReadModel,
    manualMonthlyReconciliation,
    sharedDiagnostics,
    manualUsagePayload: manualUsageRecord.payload,
  };
}
