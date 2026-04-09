import type { ManualUsagePayload } from "@/modules/simulatedUsage/types";
import { buildManualMonthlyReconciliation } from "@/modules/manualUsage/reconciliation";
import { buildManualUsageReadModel, type ManualUsageReadModel } from "@/modules/manualUsage/readModel";
import { getManualUsageInputForUserHouse } from "@/modules/manualUsage/store";
import { buildValidationCompareProjectionSidecar } from "@/modules/usageSimulator/compareProjection";
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
      dataset: any;
      compareProjection: {
        rows?: unknown;
        metrics?: unknown;
      };
      manualReadModel: ManualUsageReadModel | null;
      manualMonthlyReconciliation: ReturnType<typeof buildManualMonthlyReconciliation>;
      sharedDiagnostics: ReturnType<typeof buildSharedPastSimDiagnostics>;
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
}) : Promise<ManualUsagePastSimReadResult> {
  const startedAt = Date.now();
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

  emit("manual_readback_dataset_ready", {
    intervalCount: Array.isArray((out.dataset as any)?.series?.intervals15) ? (out.dataset as any).series.intervals15.length : 0,
    dayCount: Array.isArray((out.dataset as any)?.daily) ? (out.dataset as any).daily.length : 0,
    monthCount: Array.isArray((out.dataset as any)?.monthly) ? (out.dataset as any).monthly.length : 0,
  });
  const { compareProjection, manualReadModel, manualMonthlyReconciliation, sharedDiagnostics } =
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
      manualUsagePayload: args.manualUsagePayload,
      actualDataset: args.actualDataset,
    });
  emit("manual_readback_success", {
    compareRowCount: Array.isArray(compareProjection?.rows) ? compareProjection.rows.length : 0,
    reconciliationRowCount: Array.isArray((manualMonthlyReconciliation as any)?.rows)
      ? (manualMonthlyReconciliation as any).rows.length
      : 0,
  });
  return {
    ok: true,
    houseId: args.houseId,
    scenarioId: args.scenarioId,
    dataset: out.dataset,
    compareProjection,
    manualReadModel,
    manualMonthlyReconciliation,
    sharedDiagnostics,
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
}) {
  const manualUsageRecord =
    args.manualUsagePayload !== undefined
      ? { payload: args.manualUsagePayload }
      : await getManualUsageInputForUserHouse({ userId: args.userId, houseId: args.houseId });
  const compareProjection = buildValidationCompareProjectionSidecar(args.dataset);
  const manualReadModel = buildManualUsageReadModel({
    payload: manualUsageRecord.payload,
    dataset: args.dataset,
    actualDataset: args.actualDataset,
  });
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
    usageInputMode: args.usageInputMode ?? null,
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
  };
}
