import { getManualUsageInputForUserHouse } from "@/modules/onePathSim/manualStore";
import {
  buildManualUsageReadModel,
  type ManualUsageReadModel,
} from "@/modules/onePathSim/manualReadModel";
import type { ManualUsagePayload } from "@/modules/simulatedUsage/types";
import {
  buildValidationCompareProjectionFromDatasets,
  buildValidationCompareProjectionSidecar,
} from "@/modules/usageSimulator/compareProjection";
import {
  buildSharedPastSimDiagnostics,
  type SharedDiagnosticsCallerType,
} from "@/modules/usageSimulator/sharedDiagnostics";

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

export async function buildOnePathManualArtifactDecorations(args: {
  userId: string;
  houseId: string;
  scenarioId: string | null;
  dataset: any;
  callerType: SharedDiagnosticsCallerType;
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
  const manualMonthlyReconciliation = manualReadModel?.billPeriodCompare ?? null;
  const sharedDiagnostics = buildSharedPastSimDiagnostics({
    callerType: args.callerType,
    dataset: args.dataset,
    scenarioId: args.scenarioId,
    usageInputMode,
    validationPolicyOwner: args.validationPolicyOwner ?? null,
    weatherLogicMode: args.weatherLogicMode ?? null,
    compareProjection,
    manualMonthlyReconciliation,
    readMode: "artifact_only",
    projectionMode: "baseline",
    artifactId: args.artifactId ?? null,
    artifactInputHash: args.artifactInputHash ?? null,
    artifactEngineVersion: args.artifactEngineVersion ?? null,
    artifactPersistenceOutcome: args.artifactPersistenceOutcome ?? null,
  });
  const manualParitySummary = buildManualParitySummary({
    scenarioId: args.scenarioId,
    payload: manualUsageRecord.payload,
    dataset: args.dataset,
    compareProjection,
    manualReadModel,
    sharedDiagnostics,
  });
  return {
    compareProjection,
    manualReadModel,
    manualMonthlyReconciliation,
    sharedDiagnostics,
    manualUsagePayload: manualUsageRecord.payload,
    manualParitySummary,
  };
}
