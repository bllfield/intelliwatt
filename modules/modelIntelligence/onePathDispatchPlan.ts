import type {
  ModelIntelligenceLabContext,
  ModelIntelligenceManualGapfillOptions,
  ModelIntelligenceModeAvailability,
  ModelIntelligenceOnePathOptions,
  ModelIntelligenceOnePathRunReadback,
  ModelIntelligenceRunMode,
  ModelIntelligenceSequencePreview,
  ModelIntelligenceSequenceStep,
} from "@/modules/modelIntelligence/types";

export type OnePathAdminRunMode = "INTERVAL" | "GREEN_BUTTON" | "MANUAL_MONTHLY" | "MANUAL_ANNUAL";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function mapModelIntelligenceRunModeToOnePathMode(
  runMode: ModelIntelligenceRunMode
): OnePathAdminRunMode | null {
  switch (runMode) {
    case "SMT_INTERVAL_TRUTH":
      return "INTERVAL";
    case "GREEN_BUTTON_TRUTH":
      return "GREEN_BUTTON";
    case "MONTHLY_MASKED":
      return "MANUAL_MONTHLY";
    case "ANNUAL_MASKED":
      return "MANUAL_ANNUAL";
    default:
      return null;
  }
}

export function runReasonForModelIntelligenceMode(
  runMode: ModelIntelligenceRunMode,
  onePathOptions: ModelIntelligenceOnePathOptions
): string {
  switch (runMode) {
    case "SMT_INTERVAL_TRUTH":
      return "model_intelligence_smt_interval_truth";
    case "GREEN_BUTTON_TRUTH":
      return "model_intelligence_keeper-green-button-past";
    case "MONTHLY_MASKED":
      return "model_intelligence_monthly_masked";
    case "ANNUAL_MASKED":
      return "model_intelligence_annual_masked";
    default:
      return onePathOptions.runReason;
  }
}

export function resolveOrchestrationHouseTargets(args: {
  context: ModelIntelligenceLabContext;
  availability: ModelIntelligenceModeAvailability;
  ownerUserId: string | null;
}): { sourceHouseId: string; houseId: string; actualContextHouseId: string } {
  const pinned = args.context.labTestHome.isPinnedToSource && Boolean(args.context.labTestHome.testHomeHouseId);
  const sourceHouseId = args.context.sourceHouseId;
  const actualContextHouseId = args.context.actualContextHouseId;

  if (args.availability.writesToLabHomeOnly) {
    if (!pinned || !args.context.labTestHome.testHomeHouseId) {
      return {
        sourceHouseId,
        houseId: args.context.labTestHome.testHomeHouseId ?? sourceHouseId,
        actualContextHouseId,
      };
    }
    return {
      sourceHouseId,
      houseId: args.context.labTestHome.testHomeHouseId,
      actualContextHouseId,
    };
  }

  const houseId =
    pinned && args.context.labTestHome.testHomeHouseId ? args.context.labTestHome.testHomeHouseId : sourceHouseId;
  return {
    sourceHouseId,
    houseId,
    actualContextHouseId,
  };
}

export function buildModelIntelligenceOnePathRunRequest(args: {
  context: ModelIntelligenceLabContext;
  runMode: ModelIntelligenceRunMode;
  availability: ModelIntelligenceModeAvailability;
  onePathOptions: ModelIntelligenceOnePathOptions;
  manualGapfillOptions: ModelIntelligenceManualGapfillOptions;
  scenarioId: string | null;
  ownerUserId: string | null;
}): { ok: true; request: Record<string, unknown> } | { ok: false; error: string; message: string } {
  if (!args.availability.available) {
    return {
      ok: false,
      error: "mode_unavailable",
      message: args.availability.unavailableReason ?? "Selected run mode is unavailable.",
    };
  }

  const onePathMode = mapModelIntelligenceRunModeToOnePathMode(args.runMode);
  if (!onePathMode) {
    return {
      ok: false,
      error: "mode_unsupported",
      message: "Selected run mode is not dispatchable through One Path in Phase 2.",
    };
  }

  const targets = resolveOrchestrationHouseTargets({
    context: args.context,
    availability: args.availability,
    ownerUserId: args.ownerUserId,
  });
  if (args.availability.writesToLabHomeOnly && targets.houseId === targets.sourceHouseId) {
    return {
      ok: false,
      error: "lab_home_required",
      message: "Masked runs require a pinned One Path lab test home.",
    };
  }

  const preferredActualSource =
    onePathMode === "INTERVAL" ? "SMT" : onePathMode === "GREEN_BUTTON" ? "GREEN_BUTTON" : null;

  return {
    ok: true,
    request: {
      action: "run",
      email: args.context.email,
      sourceHouseId: targets.sourceHouseId,
      houseId: targets.houseId,
      scenarioId: args.scenarioId,
      mode: onePathMode,
      actualContextHouseId: args.onePathOptions.actualContextHouseIdOverride ?? targets.actualContextHouseId,
      preferredActualSource,
      weatherPreference: args.onePathOptions.weatherPreference,
      persistRequested: args.onePathOptions.persistRequested,
      runReason: runReasonForModelIntelligenceMode(args.runMode, args.onePathOptions),
      includeDebugDiagnostics: true,
      includePosthocTopMissIntervalCurves:
        onePathMode === "INTERVAL" || onePathMode === "GREEN_BUTTON"
          ? args.onePathOptions.includePosthocTopMissIntervalCurves
          : undefined,
      orchestration: {
        surface: "model_intelligence_lab",
        phase: "phase_2_client_orchestration",
        runMode: args.runMode,
        manualGapfillMode: args.manualGapfillOptions.manualGapfillMode,
        forceActualDerivedManualPayload: args.availability.writesToLabHomeOnly,
      },
    },
  };
}

export function extractModelIntelligenceOnePathRunReadback(
  response: Record<string, unknown>,
  request?: Record<string, unknown> | null
): ModelIntelligenceOnePathRunReadback {
  const artifact = asRecord(response.artifact);
  const readModel = asRecord(response.readModel);
  const compactArtifactSummary = asRecord(readModel.compactArtifactSummary);
  const engineInput = asRecord(response.engineInput);
  const runDisplayView = asRecord(response.runDisplayView);
  const summary = asRecord(runDisplayView.summary);
  const dataset = asRecord(readModel.dataset);
  const datasetSummary = asRecord(dataset.summary);
  const datasetMeta = asRecord(dataset.meta);
  const provenance = asRecord(response.adminManualPayloadProvenance);
  const requestRecord = asRecord(request);

  const pick = (key: string): string | null => {
    for (const source of [artifact[key], compactArtifactSummary[key], engineInput[key]]) {
      const text = String(source ?? "").trim();
      if (text) return text;
    }
    return null;
  };

  const totalKwhRaw =
    summary.totalKwh ?? datasetSummary.totalKwh ?? asRecord(summary.totals).netKwh ?? null;
  const totalKwh = typeof totalKwhRaw === "number" && Number.isFinite(totalKwhRaw) ? totalKwhRaw : null;
  const onePathMode = typeof requestRecord.mode === "string" ? requestRecord.mode : null;
  const manualPayloadSource =
    typeof provenance.monthlyPayloadSource === "string"
      ? provenance.monthlyPayloadSource
      : typeof provenance.annualPayloadSource === "string"
        ? provenance.annualPayloadSource
        : null;
  const manualPayloadHash =
    onePathMode === "MANUAL_ANNUAL"
      ? typeof provenance.manualPayloadHashAnnual === "string"
        ? provenance.manualPayloadHashAnnual
        : null
      : typeof provenance.manualPayloadHashMonthly === "string"
        ? provenance.manualPayloadHashMonthly
        : null;

  return {
    scenarioId: pick("scenarioId"),
    artifactId: pick("artifactId"),
    artifactInputHash: pick("artifactInputHash"),
    buildInputsHash: pick("buildInputsHash"),
    engineVersion: pick("engineVersion"),
    runType: typeof response.runType === "string" ? response.runType : null,
    coverageStart:
      (typeof summary.coverageStart === "string" && summary.coverageStart) ||
      (typeof summary.start === "string" && summary.start) ||
      (typeof datasetSummary.start === "string" && datasetSummary.start) ||
      (typeof datasetMeta.coverageStart === "string" && datasetMeta.coverageStart) ||
      null,
    coverageEnd:
      (typeof summary.coverageEnd === "string" && summary.coverageEnd) ||
      (typeof summary.end === "string" && summary.end) ||
      (typeof datasetSummary.end === "string" && datasetSummary.end) ||
      (typeof datasetMeta.coverageEnd === "string" && datasetMeta.coverageEnd) ||
      null,
    totalKwh,
    onePathMode,
    dispatchHouseId: typeof requestRecord.houseId === "string" ? requestRecord.houseId : null,
    sourceHouseId: typeof requestRecord.sourceHouseId === "string" ? requestRecord.sourceHouseId : null,
    actualContextHouseId:
      typeof requestRecord.actualContextHouseId === "string"
        ? requestRecord.actualContextHouseId
        : typeof provenance.actualContextHouseId === "string"
          ? provenance.actualContextHouseId
          : null,
    manualPayloadHash,
    manualPayloadSource,
    payloadFreshlyDerived:
      typeof provenance.payloadFreshlyDerived === "boolean" ? provenance.payloadFreshlyDerived : null,
    derivedMonthlyTotalKwh:
      typeof provenance.derivedMonthlyTotalKwh === "number" ? provenance.derivedMonthlyTotalKwh : null,
    derivedAnnualTotalKwh:
      typeof provenance.derivedAnnualTotalKwh === "number" ? provenance.derivedAnnualTotalKwh : null,
    savedLabPayloadIgnored:
      typeof provenance.savedLabPayloadIgnored === "boolean" ? provenance.savedLabPayloadIgnored : null,
    unavailableReason:
      typeof response.message === "string" && response.ok !== true
        ? response.message
        : typeof response.error === "string" && response.ok !== true
          ? response.error
          : null,
  };
}

export function listOrchestrationDispatchSteps(
  preview: ModelIntelligenceSequencePreview
): ModelIntelligenceSequenceStep[] {
  return preview.steps.filter(
    (step) => step.kind === "dispatch_one_path_sim" && step.clientRunnable && step.runMode != null
  );
}
