import { createSimCorrelationId, getMemoryRssMb, logSimPipelineEvent } from "@/modules/onePathSim/usageSimulator/simObservability";

export type OnePathAdminRunStage =
  | "request_received"
  | "resolved_user_house"
  | "prepared_manual_payload_start"
  | "prepared_manual_payload_success"
  | "scenario_resolved"
  | "recalc_start"
  | "recalc_success"
  | "persist_start"
  | "persist_success"
  | "artifact_readback_start"
  | "artifact_readback_success"
  | "response_build_start"
  | "response_ready"
  | "error_caught";

export function resolveModelIntelligenceMaskedRunMode(args: {
  runReason?: string | null;
  orchestration?: Record<string, unknown> | null;
  forceActualDerivedManualPayload?: boolean;
}): string | null {
  const runReason = String(args.runReason ?? "").trim().toLowerCase();
  const orchestration = args.orchestration ?? {};
  const runMode = typeof orchestration.runMode === "string" ? orchestration.runMode.trim() : "";
  if (runMode === "MONTHLY_MASKED" || runMode === "ANNUAL_MASKED") return runMode;
  if (runReason.includes("model_intelligence_monthly_masked")) return "MONTHLY_MASKED";
  if (runReason.includes("model_intelligence_annual_masked")) return "ANNUAL_MASKED";
  if (args.forceActualDerivedManualPayload && runReason.includes("model_intelligence")) {
    return runReason.includes("annual") ? "ANNUAL_MASKED" : "MONTHLY_MASKED";
  }
  return null;
}

export function isModelIntelligenceMaskedAdminRun(args: {
  mode?: string | null;
  runReason?: string | null;
  orchestration?: Record<string, unknown> | null;
  forceActualDerivedManualPayload?: boolean;
}): boolean {
  const mode = String(args.mode ?? "").trim().toUpperCase();
  if (mode !== "MANUAL_MONTHLY" && mode !== "MANUAL_ANNUAL") return false;
  return resolveModelIntelligenceMaskedRunMode(args) != null;
}

export function logOnePathAdminRunStageMarker(args: {
  stage: OnePathAdminRunStage;
  correlationId: string;
  routeStartedAt: number;
  mode?: string | null;
  runMode?: string | null;
  scenarioId?: string | null;
  dispatchHouseId?: string | null;
  actualContextHouseId?: string | null;
  persistRequested?: boolean;
  forceActualDerivedManualPayload?: boolean;
  extra?: Record<string, string | number | boolean | null | undefined>;
}): void {
  logSimPipelineEvent("one_path_admin_run_stage", {
    stage: args.stage,
    correlationId: args.correlationId,
    elapsedMs: Date.now() - args.routeStartedAt,
    mode: args.mode ?? null,
    runMode: args.runMode ?? null,
    scenarioId: args.scenarioId ?? null,
    dispatchHouseId: args.dispatchHouseId ?? null,
    actualContextHouseId: args.actualContextHouseId ?? null,
    persistRequested: args.persistRequested ?? null,
    forceActualDerivedManualPayload: args.forceActualDerivedManualPayload ?? null,
    memoryRssMb: getMemoryRssMb(),
    ...(args.extra ?? {}),
  });
}

export function buildOnePathAdminRunTrace(args: {
  correlationId: string;
  lastStageReached: OnePathAdminRunStage;
  routeStartedAt: number;
  mode?: string | null;
  runMode?: string | null;
  scenarioId?: string | null;
  dispatchHouseId?: string | null;
  actualContextHouseId?: string | null;
  persistRequested?: boolean;
  forceActualDerivedManualPayload?: boolean;
  responseApproxSizeKb?: number | null;
  extra?: Record<string, string | number | boolean | null | undefined>;
}) {
  return {
    correlationId: args.correlationId,
    corrId: args.correlationId,
    lastStageReached: args.lastStageReached,
    elapsedMs: Date.now() - args.routeStartedAt,
    mode: args.mode ?? null,
    runMode: args.runMode ?? null,
    scenarioId: args.scenarioId ?? null,
    dispatchHouseId: args.dispatchHouseId ?? null,
    actualContextHouseId: args.actualContextHouseId ?? null,
    persistRequested: args.persistRequested ?? null,
    forceActualDerivedManualPayload: args.forceActualDerivedManualPayload ?? null,
    responseApproxSizeKb: args.responseApproxSizeKb ?? null,
    memoryRssMb: getMemoryRssMb(),
    ...(args.extra ?? {}),
  };
}

export function createOnePathAdminRunCorrelationId(): string {
  return createSimCorrelationId();
}
