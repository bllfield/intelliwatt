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
  phase: "phase_1_preview_only";
  executionEnabled: false;
  selectedRuns: ModelIntelligenceSelectedRuns;
  flags: ModelIntelligenceOrchestrationFlags;
  modeAvailability: ModelIntelligenceModeAvailability[];
  steps: ModelIntelligenceSequenceStep[];
  summary: {
    plannedStepCount: number;
    unavailableStepCount: number;
    selectedModeCount: number;
    compareDiagnosticsPlanned: boolean;
    simulationWillRun: false;
  };
  guardrails: {
    onePathOnlySimulation: true;
    manualGapfillCompareOnlyDiagnostics: true;
    noParallelSimulator: true;
    noParallelDiagnosticsEngine: true;
    maskedRunsWriteToLabHomeOnly: true;
  };
};

export const NEW_BUILD_ORCHESTRATION_UNAVAILABLE_REASON =
  "One Path NEW_BUILD/no-usage dispatch path not implemented yet";

export const GREEN_BUTTON_UNAVAILABLE_DEFAULT_REASON =
  "Green Button source not available for this house";
