export const MODEL_INTELLIGENCE_RUN_MODES = [
  "SMT_INTERVAL_TRUTH",
  "GREEN_BUTTON_TRUTH",
  "MONTHLY_MASKED",
  "ANNUAL_MASKED",
  "NEW_BUILD",
] as const;

export type ModelIntelligenceRunMode = (typeof MODEL_INTELLIGENCE_RUN_MODES)[number];

export type ModelIntelligenceRunStepKind =
  | "resolve_context"
  | "build_masked_input"
  | "dispatch_one_path_sim"
  | "compare_diagnostics"
  | "aggregate_results_matrix"
  | "cohort_snapshot"
  | "tuning_queue_update"
  | "export_ai_bundle";

export type ModelIntelligenceStepStatus = "planned" | "unavailable" | "skipped" | "not_started";

export type ModelIntelligenceWeatherPreference = "NONE" | "LAST_YEAR_WEATHER" | "LONG_TERM_AVERAGE";

export type ModelIntelligenceValidationSelectionMode = "policy_default" | "fixed_count" | "explicit_dates";

export type ModelIntelligenceManualGapfillMode =
  | "MONTHLY_FROM_SOURCE_INTERVALS"
  | "ANNUAL_FROM_SOURCE_INTERVALS";

export type ModelIntelligenceOnePathOptions = {
  weatherPreference: ModelIntelligenceWeatherPreference;
  validationSelectionMode: ModelIntelligenceValidationSelectionMode;
  validationDayCount: number;
  validationOnlyDateKeysLocal: string[];
  persistRequested: boolean;
  runReason: string;
  includeDebugDiagnostics: boolean;
  includeSimRunAudit: boolean;
  includePosthocTopMissIntervalCurves: boolean;
  actualContextHouseIdOverride: string | null;
};

export type ModelIntelligenceManualGapfillOptions = {
  includeDiagnostics: boolean;
  includeDailyRows: boolean;
  anchorEndDate: string;
  persistSeedToggle: boolean;
  manualGapfillMode: ModelIntelligenceManualGapfillMode;
  includeIntervalCurveDiagnostics: boolean;
  includeTopMissCurves: boolean;
};

export type ModelIntelligenceOrchestrationFlags = {
  runCompareDiagnostics: boolean;
  buildCohortSnapshot: boolean;
  updateTuningQueue: boolean;
  includeAiExportBundle: boolean;
};

export type ModelIntelligenceSelectedRuns = Record<ModelIntelligenceRunMode, boolean>;

export type ModelIntelligenceLabContext = {
  email: string;
  userId: string;
  sourceHouseId: string;
  esiid: string | null;
  addressLabel: string | null;
  committedUsageSource: string | null;
  actualSourceKind: "SMT" | "GREEN_BUTTON" | "manual" | "none" | "ambiguous";
  actualContextHouseId: string;
  sourceTruthAvailable: boolean;
  profileOnlyHouse: boolean;
  coverageStart: string | null;
  coverageEnd: string | null;
  dailyCount: number;
  intervalCount: number;
  annualTotalKwh: number | null;
  intervalFingerprint: string | null;
  greenButtonAvailable: boolean;
  smtIntervalTruthAvailable: boolean;
  labTestHome: {
    testHomeHouseId: string | null;
    linkedSourceHouseId: string | null;
    isPinnedToSource: boolean;
    status: string;
    statusMessage: string | null;
    needsReplace: boolean;
  };
  warnings: string[];
};

export type ModelIntelligenceModeAvailability = {
  mode: ModelIntelligenceRunMode;
  selectable: boolean;
  available: boolean;
  unavailableReason: string | null;
  usesLabTestHome: boolean;
  writesToLabHomeOnly: boolean;
};

export type ModelIntelligenceSequenceStep = {
  stepId: string;
  order: number;
  kind: ModelIntelligenceRunStepKind;
  label: string;
  runMode: ModelIntelligenceRunMode | null;
  status: ModelIntelligenceStepStatus;
  unavailableReason: string | null;
  clientRunnable: boolean;
  notes: string[];
};

export type ModelIntelligenceSequencePreview = {
  previewVersion: "model_intelligence_sequence_preview_v1";
  generatedAt: string;
  phase: "phase_1_preview_only" | "phase_2_client_orchestration";
  executionEnabled: boolean;
  selectedRuns: ModelIntelligenceSelectedRuns;
  flags: ModelIntelligenceOrchestrationFlags;
  modeAvailability: ModelIntelligenceModeAvailability[];
  steps: ModelIntelligenceSequenceStep[];
  summary: {
    plannedStepCount: number;
    unavailableStepCount: number;
    selectedModeCount: number;
    runnableDispatchStepCount: number;
    compareDiagnosticsPlanned: boolean;
    simulationWillRun: boolean;
  };
  guardrails: {
    onePathOnlySimulation: true;
    manualGapfillCompareOnlyDiagnostics: true;
    noParallelSimulator: true;
    noParallelDiagnosticsEngine: true;
    maskedRunsWriteToLabHomeOnly: true;
  };
};

export type ModelIntelligenceOnePathRunReadback = {
  scenarioId: string | null;
  artifactId: string | null;
  artifactInputHash: string | null;
  buildInputsHash: string | null;
  engineVersion: string | null;
  runType: string | null;
  coverageStart: string | null;
  coverageEnd: string | null;
  totalKwh: number | null;
  onePathMode: string | null;
  dispatchHouseId: string | null;
  sourceHouseId: string | null;
  actualContextHouseId: string | null;
  manualPayloadHash: string | null;
  manualPayloadSource: string | null;
  payloadFreshlyDerived: boolean | null;
  derivedMonthlyTotalKwh: number | null;
  derivedAnnualTotalKwh: number | null;
  savedLabPayloadIgnored: boolean | null;
  unavailableReason: string | null;
};

export type ModelIntelligenceOrchestrationStepResult = {
  stepId: string;
  runMode: ModelIntelligenceRunMode;
  kind: "dispatch_one_path_sim";
  status: "completed" | "failed" | "skipped" | "unavailable" | "cancelled";
  unavailableReason: string | null;
  error: string | null;
  message: string | null;
  onePathRunRequest: Record<string, unknown> | null;
  readback: ModelIntelligenceOnePathRunReadback | null;
  startedAt: string;
  finishedAt: string | null;
};

export type ModelIntelligenceOrchestrationRun = {
  runVersion: "model_intelligence_orchestration_v1";
  phase: "phase_2_client_orchestration";
  startedAt: string;
  finishedAt: string | null;
  status: "running" | "completed" | "failed" | "cancelled";
  stepResults: ModelIntelligenceOrchestrationStepResult[];
  guardrails: {
    onePathOnlySimulation: true;
    clientDrivenSequentialSteps: true;
    noParallelSimulation: true;
    maskedRunsLabHomeOnly: true;
  };
};

export const PHASE_2_COMPARE_UNAVAILABLE_REASON = "Phase 2 — compare adapter not enabled.";
export const PHASE_2_COHORT_UNAVAILABLE_REASON = "Phase 2 — cohort intelligence not enabled.";
export const PHASE_2_TUNING_QUEUE_UNAVAILABLE_REASON = "Phase 2 — tuning queue not enabled.";
export const PHASE_2_EXPORT_UNAVAILABLE_REASON = "Phase 2 — export bundle not enabled.";
export const PHASE_2_RESULTS_MATRIX_UNAVAILABLE_REASON = "Phase 3 — results matrix not enabled.";

export const NEW_BUILD_ORCHESTRATION_UNAVAILABLE_REASON =
  "One Path NEW_BUILD/no-usage dispatch path not implemented yet";

export const GREEN_BUTTON_UNAVAILABLE_DEFAULT_REASON =
  "Green Button source not available for this house";
