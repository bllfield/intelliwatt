import type { ManualUsagePayload } from "@/modules/simulatedUsage/types";
import { buildManualMonthlyReconciliation } from "@/modules/manualUsage/reconciliation";
import { getManualUsageInputForUserHouse } from "@/modules/manualUsage/store";
import { buildValidationCompareProjectionSidecar } from "@/modules/usageSimulator/compareProjection";
import {
  buildSharedPastSimDiagnostics,
  type SharedDiagnosticsCallerType,
} from "@/modules/usageSimulator/sharedDiagnostics";
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
  usageInputMode?: string | null;
  validationPolicyOwner?: string | null;
  weatherLogicMode?: string | null;
  artifactId?: string | null;
  artifactInputHash?: string | null;
  artifactEngineVersion?: string | null;
  artifactPersistenceOutcome?: string | null;
  manualUsagePayload?: ManualUsagePayload | null;
}) : Promise<ManualUsagePastSimReadResult> {
  if (!args.scenarioId) {
    return {
      ok: false,
      error: "past_scenario_missing",
      message: "Past (Corrected) scenario is missing for this house.",
      failureCode: "past_scenario_missing",
      failureMessage: "Past (Corrected) scenario is missing for this house.",
    };
  }

  const out = await getSimulatedUsageForHouseScenario({
    userId: args.userId,
    houseId: args.houseId,
    scenarioId: args.scenarioId,
    readMode: args.readMode,
    projectionMode: "baseline",
    correlationId: args.correlationId ?? undefined,
    readContext: {
      artifactReadMode: args.readMode,
      projectionMode: "baseline",
      compareSidecarRequest: true,
    },
  });
  if (!out.ok) {
    return {
      ok: false,
      error: out.code,
      message: out.message,
      failureCode: out.code,
      failureMessage: out.message,
    };
  }

  const manualUsageRecord =
    args.manualUsagePayload !== undefined
      ? { payload: args.manualUsagePayload }
      : await getManualUsageInputForUserHouse({ userId: args.userId, houseId: args.houseId });
  const compareProjection = buildValidationCompareProjectionSidecar(out.dataset);
  const manualMonthlyReconciliation = buildManualMonthlyReconciliation({
    payload: manualUsageRecord.payload,
    dataset: out.dataset,
  });
  const sharedDiagnostics = buildSharedPastSimDiagnostics({
    callerType: args.callerType,
    dataset: out.dataset,
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
    ok: true,
    houseId: args.houseId,
    scenarioId: args.scenarioId,
    dataset: out.dataset,
    compareProjection,
    manualMonthlyReconciliation,
    sharedDiagnostics,
  };
}
