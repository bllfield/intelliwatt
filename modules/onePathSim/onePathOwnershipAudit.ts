export type OnePathSurfaceAuditRow = {
  section: string;
  surfaceType: "control" | "json_panel" | "truth_panel" | "modal" | "copy_action";
  visibleOnPage: boolean;
  editableOnPage: boolean;
  copiedInAiPayload: boolean;
  runRequired: boolean;
  pageOnly: boolean;
  backedBySharedOwner: boolean;
  ownerFiles: string[];
  ownerSymbols: string[];
  notes: string;
};

export type OnePathCopyPayloadInventoryRow = {
  section: string;
  includedInCopyPayload: boolean;
  requiresRun: boolean;
  sourcedFromSharedShaper: boolean;
  ownerFiles: string[];
  ownerSymbols: string[];
  notes: string;
};

export type SharedWiringFlowStep = {
  step: number;
  label: string;
  from: string;
  to: string;
  ownerFile: string;
  ownerSymbol: string;
  sharedOwner: boolean;
  notes: string;
};

export type ExternalSurfaceClassificationRow = {
  surface: string;
  classification:
    | "shared_reader"
    | "shared_run_orchestrator"
    | "local_summarizer"
    | "duplicate_owner_risk"
    | "adjacent_shared_scorer";
  ownerFiles: string[];
  ownerSymbols: string[];
  notes: string;
};

export type DriftRiskWatchItem = {
  risk: string;
  currentState: "tightened_in_this_pass" | "watch" | "branch_risk";
  ownerFiles: string[];
  ownerSymbols: string[];
  notes: string;
};

export type OnePathOwnershipAudit = {
  overview: string;
  pageSurfaceAuditMatrix: OnePathSurfaceAuditRow[];
  aiCopyPayloadInventory: OnePathCopyPayloadInventoryRow[];
  sharedWiringFlow: SharedWiringFlowStep[];
  externalSurfaceClassification: ExternalSurfaceClassificationRow[];
  driftRiskWatchlist: DriftRiskWatchItem[];
};

export function buildOnePathOwnershipAudit(): OnePathOwnershipAudit {
  return {
    overview:
      "Read-only architecture audit for the One Path admin harness. This inventory tracks what is visible on the page, what is copied for AI, how the shared simulation chain is wired, and which external surfaces still orbit the same shared simulation owners.",
    pageSurfaceAuditMatrix: [
      {
        section: "Pre-cutover harness status",
        surfaceType: "truth_panel",
        visibleOnPage: true,
        editableOnPage: false,
        copiedInAiPayload: true,
        runRequired: false,
        pageOnly: false,
        backedBySharedOwner: true,
        ownerFiles: ["components/admin/OnePathSimAdmin.tsx", "modules/onePathSim/onePathTruthSummary.ts"],
        ownerSymbols: ["OnePathSimAdmin", "buildOnePathTruthSummary"],
        notes:
          "Explicitly states this is the pre-cutover canonical harness only and that older surfaces are not rerouted in this pass.",
      },
      {
        section: "Lookup and run controls",
        surfaceType: "control",
        visibleOnPage: true,
        editableOnPage: true,
        copiedInAiPayload: true,
        runRequired: false,
        pageOnly: false,
        backedBySharedOwner: true,
        ownerFiles: ["components/admin/OnePathSimAdmin.tsx", "app/api/admin/tools/one-path-sim/route.ts"],
        ownerSymbols: ["OnePathSimAdmin", "POST"],
        notes:
          "Email, house, mode, scenario, weather preference, actual context house, validation mode/day count, manual validation keys, and persist flag all flow into the shared one-path route.",
      },
      {
        section: "Run reason",
        surfaceType: "control",
        visibleOnPage: true,
        editableOnPage: true,
        copiedInAiPayload: true,
        runRequired: false,
        pageOnly: true,
        backedBySharedOwner: false,
        ownerFiles: ["components/admin/OnePathSimAdmin.tsx"],
        ownerSymbols: ["OnePathSimAdmin"],
        notes: "Captured for admin context and AI copy only. It is not part of the current canonical run contract.",
      },
      {
        section: "Loaded source context",
        surfaceType: "json_panel",
        visibleOnPage: true,
        editableOnPage: false,
        copiedInAiPayload: true,
        runRequired: false,
        pageOnly: false,
        backedBySharedOwner: true,
        ownerFiles: ["app/api/admin/tools/one-path-sim/route.ts"],
        ownerSymbols: ["POST"],
        notes:
          "Shows lookup-time context including actual dataset summary/meta, saved manual payload, travel ranges, profiles, shared weather preview, and the copied named `loadedSourceContext` AI section.",
      },
      {
        section: "Household energy insights and baseline parity audit",
        surfaceType: "truth_panel",
        visibleOnPage: true,
        editableOnPage: false,
        copiedInAiPayload: true,
        runRequired: false,
        pageOnly: false,
        backedBySharedOwner: true,
        ownerFiles: [
          "components/admin/OnePathSimAdmin.tsx",
          "components/admin/OnePathBaselineReadOnlyView.tsx",
          "lib/usage/userUsageDashboardViewModel.ts",
          "modules/onePathSim/baselineReadOnlyView.ts",
        ],
        ownerSymbols: [
          "OnePathSimAdmin",
          "OnePathBaselineReadOnlyView",
          "buildUserUsageDashboardViewModel",
          "buildOnePathBaselineReadOnlyView",
        ],
        notes:
          "The copied AI payload now carries explicit `userUsageDashboardViewModel`, `baselineParityReport`, `baselineParityAudit`, and `displayTotalsAudit` sections matching the read-only baseline view.",
      },
      {
        section: "Interval Past blocker trace and Runtime / env parity trace",
        surfaceType: "json_panel",
        visibleOnPage: true,
        editableOnPage: false,
        copiedInAiPayload: true,
        runRequired: false,
        pageOnly: false,
        backedBySharedOwner: true,
        ownerFiles: [
          "components/admin/OnePathSimAdmin.tsx",
          "modules/onePathSim/intervalPastReadinessTrace.ts",
          "modules/onePathSim/runtimeEnvParityTrace.ts",
        ],
        ownerSymbols: ["OnePathSimAdmin", "buildIntervalPastReadinessTrace", "buildRuntimeEnvParityTrace"],
        notes:
          "Both page traces are copied as named top-level AI payload sections when present so AI can reason about env parity and Past readiness without scraping JSON panels.",
      },
      {
        section: "Shared variable defaults, overrides, and effective-by-mode JSON",
        surfaceType: "json_panel",
        visibleOnPage: true,
        editableOnPage: false,
        copiedInAiPayload: true,
        runRequired: false,
        pageOnly: false,
        backedBySharedOwner: true,
        ownerFiles: ["modules/onePathSim/simulationVariablePolicy.ts", "app/api/admin/tools/one-path-sim/variables/route.ts"],
        ownerSymbols: ["SIMULATION_VARIABLE_POLICY_FAMILY_META", "GET"],
        notes: "Read-only JSON mirrors the same shared policy store consumed by the simulation producer.",
      },
      {
        section: "Variable family popup cards",
        surfaceType: "modal",
        visibleOnPage: true,
        editableOnPage: true,
        copiedInAiPayload: true,
        runRequired: false,
        pageOnly: false,
        backedBySharedOwner: true,
        ownerFiles: ["modules/onePathSim/simulationVariablePresentation.ts", "components/admin/OnePathSimAdmin.tsx"],
        ownerSymbols: ["buildSimulationVariableFamilyAdminView", "openVariableFamily"],
        notes:
          "Human-readable variable descriptions, value sources, current overrides, edit inputs, raw JSON, and OVERRIDE-gated save/reset all sit on top of the shared variable policy owner.",
      },
      {
        section: "Canonical engine input, artifact, read model",
        surfaceType: "json_panel",
        visibleOnPage: true,
        editableOnPage: false,
        copiedInAiPayload: true,
        runRequired: true,
        pageOnly: false,
        backedBySharedOwner: true,
        ownerFiles: ["modules/onePathSim/onePathSim.ts"],
        ownerSymbols: ["runSharedSimulation", "buildSharedSimulationReadModel"],
        notes: "Post-run canonical outputs read back from the shared persisted artifact path.",
      },
      {
        section: "Effective Variables Used By Last Run",
        surfaceType: "truth_panel",
        visibleOnPage: true,
        editableOnPage: false,
        copiedInAiPayload: true,
        runRequired: true,
        pageOnly: false,
        backedBySharedOwner: true,
        ownerFiles: ["modules/onePathSim/simulationVariablePolicy.ts", "modules/onePathSim/onePathSim.ts"],
        ownerSymbols: ["resolveSimulationVariablePolicyForInputType", "buildSharedSimulationReadModel"],
        notes:
          "Run-linked resolved variable snapshot with per-field value sources from the shared artifact/read-model pipeline.",
      },
      {
        section: "Chart / Window / Display Logic and Manual Statement / Annual Logic",
        surfaceType: "truth_panel",
        visibleOnPage: true,
        editableOnPage: false,
        copiedInAiPayload: true,
        runRequired: true,
        pageOnly: false,
        backedBySharedOwner: true,
        ownerFiles: ["modules/onePathSim/onePathTruthSummary.ts"],
        ownerSymbols: ["buildOnePathTruthSummary"],
        notes:
          "Read-only audit panels for shared date/window ownership, manual statement ownership, and thin admin control ownership.",
      },
      {
        section: "Stage Boundary Map",
        surfaceType: "truth_panel",
        visibleOnPage: true,
        editableOnPage: false,
        copiedInAiPayload: true,
        runRequired: true,
        pageOnly: false,
        backedBySharedOwner: true,
        ownerFiles: ["modules/onePathSim/onePathTruthSummary.ts", "modules/onePathSim/onePathSim.ts"],
        ownerSymbols: ["buildOnePathTruthSummary", "buildSharedSimulationReadModel"],
        notes:
          "Shows raw input, adapter choice, canonical engine input, derived inputs, shared producer stages, formatter output, and persisted artifact identity from shared readback only.",
      },
      {
        section: "Upstream Usage Truth",
        surfaceType: "truth_panel",
        visibleOnPage: true,
        editableOnPage: false,
        copiedInAiPayload: true,
        runRequired: false,
        pageOnly: false,
        backedBySharedOwner: true,
        ownerFiles: [
          "modules/onePathSim/upstreamUsageTruth.ts",
          "modules/onePathSim/onePathTruthSummary.ts",
          "app/api/admin/tools/one-path-sim/route.ts",
        ],
        ownerSymbols: [
          "buildUpstreamUsageTruthSummary",
          "buildOnePathTruthSummary",
          "resolveUpstreamUsageTruthForSimulation",
        ],
        notes:
          "Shows whether persisted usage truth already existed, whether the isolated harness stayed read-only, and whether downstream simulation was allowed to proceed.",
      },
      {
        section: "Shared Derived Inputs Used By Run",
        surfaceType: "truth_panel",
        visibleOnPage: true,
        editableOnPage: false,
        copiedInAiPayload: true,
        runRequired: true,
        pageOnly: false,
        backedBySharedOwner: true,
        ownerFiles: ["modules/onePathSim/onePathTruthSummary.ts", "modules/onePathSim/weatherSensitivityShared.ts"],
        ownerSymbols: ["buildOnePathTruthSummary", "resolveSharedWeatherSensitivityEnvelope"],
        notes:
          "Surfaces weather-efficiency input, donor/fallback modes, rebalance mode, intraday controls, and compare thresholds from shared diagnostics and effective run snapshot.",
      },
      {
        section: "Final Shared Output Contract",
        surfaceType: "truth_panel",
        visibleOnPage: true,
        editableOnPage: false,
        copiedInAiPayload: true,
        runRequired: true,
        pageOnly: false,
        backedBySharedOwner: true,
        ownerFiles: ["modules/onePathSim/onePathTruthSummary.ts", "modules/onePathSim/onePathSim.ts"],
        ownerSymbols: ["buildOnePathTruthSummary", "CanonicalSimulationReadModel"],
        notes:
          "Breaks the final shared output into named contract sections instead of forcing admins to rely on one giant JSON blob.",
      },
      {
        section: "Home, appliance, manual usage, and travel popups",
        surfaceType: "modal",
        visibleOnPage: true,
        editableOnPage: true,
        copiedInAiPayload: false,
        runRequired: false,
        pageOnly: false,
        backedBySharedOwner: true,
        ownerFiles: [
          "components/admin/OnePathSimAdmin.tsx",
          "components/home/HomeDetailsClient.tsx",
          "components/appliances/AppliancesClient.tsx",
          "components/manual/ManualUsageEntry.tsx",
        ],
        ownerSymbols: ["HomeDetailsClient", "AppliancesClient", "ManualUsageEntry"],
        notes:
          "These reuse shared editors or local travel-range staging; travel ranges become shared input only when sent through the canonical run path.",
      },
      {
        section: "Copy all variables for AI / Copy this family for AI",
        surfaceType: "copy_action",
        visibleOnPage: true,
        editableOnPage: false,
        copiedInAiPayload: true,
        runRequired: false,
        pageOnly: false,
        backedBySharedOwner: true,
        ownerFiles: ["modules/onePathSim/simulationVariablePresentation.ts"],
        ownerSymbols: ["buildSimulationVariableCopyPayload"],
        notes: "Both copy actions use the same shared read-only payload shaper. The family button only filters the family list after shared shaping.",
      },
    ],
    aiCopyPayloadInventory: [
      {
        section: "currentControls",
        includedInCopyPayload: true,
        requiresRun: false,
        sourcedFromSharedShaper: true,
        ownerFiles: ["modules/onePathSim/simulationVariablePresentation.ts", "components/admin/OnePathSimAdmin.tsx"],
        ownerSymbols: ["buildSimulationVariableCopyPayload", "copyAllVariablesForAi"],
        notes: "Includes current admin selections plus page-only runReason context.",
      },
      {
        section: "aiPayloadMeta",
        includedInCopyPayload: true,
        requiresRun: false,
        sourcedFromSharedShaper: true,
        ownerFiles: ["modules/onePathSim/simulationVariablePresentation.ts"],
        ownerSymbols: ["buildSimulationVariableCopyPayload"],
        notes:
          "Top-level meta tells AI which mode/source/run type it is reading and whether dashboard, parity, and env/readiness sections are present.",
      },
      {
        section: "loadedSourceContext",
        includedInCopyPayload: true,
        requiresRun: false,
        sourcedFromSharedShaper: true,
        ownerFiles: ["app/api/admin/tools/one-path-sim/route.ts", "modules/onePathSim/simulationVariablePresentation.ts"],
        ownerSymbols: ["POST", "buildSimulationVariableCopyPayload"],
        notes:
          "Explicit lookup-time source context section carrying actual dataset summary/meta, usage truth status, manual payload state, travel ranges, profiles, weather preview, and the shared user-usage baseline contract.",
      },
      {
        section: "userUsageDashboardViewModel",
        includedInCopyPayload: true,
        requiresRun: false,
        sourcedFromSharedShaper: true,
        ownerFiles: ["lib/usage/userUsageDashboardViewModel.ts", "modules/onePathSim/simulationVariablePresentation.ts"],
        ownerSymbols: ["buildUserUsageDashboardViewModel", "buildSimulationVariableCopyPayload"],
        notes:
          "Explicit top-level baseline/dashboard view-model section with coverage, totals, breakdown note, monthly rows, daily rows/count, 15-minute curve summary, and weather display fields.",
      },
      {
        section: "baselineParityReport",
        includedInCopyPayload: true,
        requiresRun: false,
        sourcedFromSharedShaper: true,
        ownerFiles: ["modules/onePathSim/baselineParityReport.ts", "modules/onePathSim/simulationVariablePresentation.ts"],
        ownerSymbols: ["buildBaselineParityReport", "buildSimulationVariableCopyPayload"],
        notes: "Explicit field-by-field baseline parity report copied as its own top-level section.",
      },
      {
        section: "baselineParityAudit",
        includedInCopyPayload: true,
        requiresRun: false,
        sourcedFromSharedShaper: true,
        ownerFiles: ["modules/onePathSim/baselineParityAudit.ts", "modules/onePathSim/simulationVariablePresentation.ts"],
        ownerSymbols: ["buildOnePathBaselineParityAudit", "buildSimulationVariableCopyPayload"],
        notes: "Compact baseline parity audit copied as its own top-level section.",
      },
      {
        section: "displayTotalsAudit",
        includedInCopyPayload: true,
        requiresRun: false,
        sourcedFromSharedShaper: true,
        ownerFiles: ["modules/onePathSim/usageDisplayTotalsAudit.ts", "modules/onePathSim/simulationVariablePresentation.ts"],
        ownerSymbols: ["buildUsageDisplayTotalsAudit", "buildSimulationVariableCopyPayload"],
        notes:
          "Captures headline-vs-breakdown display owner splits so AI can see when daily or bucket totals differ from the headline total.",
      },
      {
        section: "runtimeEnvParityTrace",
        includedInCopyPayload: true,
        requiresRun: false,
        sourcedFromSharedShaper: true,
        ownerFiles: ["modules/onePathSim/runtimeEnvParityTrace.ts", "modules/onePathSim/simulationVariablePresentation.ts"],
        ownerSymbols: ["buildRuntimeEnvParityTrace", "buildSimulationVariableCopyPayload"],
        notes: "Copied when the page has runtime/env parity status available.",
      },
      {
        section: "intervalPastReadinessTrace",
        includedInCopyPayload: true,
        requiresRun: false,
        sourcedFromSharedShaper: true,
        ownerFiles: ["modules/onePathSim/intervalPastReadinessTrace.ts", "modules/onePathSim/simulationVariablePresentation.ts"],
        ownerSymbols: ["buildIntervalPastReadinessTrace", "buildSimulationVariableCopyPayload"],
        notes: "Copied when the page has the read-only Interval Past blocker trace available.",
      },
      {
        section: "readOnlyAudit",
        includedInCopyPayload: true,
        requiresRun: false,
        sourcedFromSharedShaper: true,
        ownerFiles: ["app/api/admin/tools/one-path-sim/route.ts", "modules/onePathSim/simulationVariablePresentation.ts"],
        ownerSymbols: ["POST", "buildSimulationVariableCopyPayload"],
        notes:
          "Explicit top-level read-only prereq audit section carrying readiness flags, blocking reasons, baseline/compare runnable state, and validatorAudit details from lookup-time source context.",
      },
      {
        section: "runIdentity",
        includedInCopyPayload: true,
        requiresRun: true,
        sourcedFromSharedShaper: true,
        ownerFiles: ["modules/onePathSim/simulationVariablePresentation.ts"],
        ownerSymbols: ["buildSimulationVariableCopyPayload"],
        notes: "Taken from effectiveSimulationVariablesUsed.runIdentityLinkage when a canonical run snapshot exists.",
      },
      {
        section: "truthConsole",
        includedInCopyPayload: true,
        requiresRun: true,
        sourcedFromSharedShaper: true,
        ownerFiles: ["modules/onePathSim/simulationVariablePresentation.ts", "modules/onePathSim/onePathTruthSummary.ts"],
        ownerSymbols: ["buildSimulationVariableCopyPayload", "buildOnePathTruthSummary"],
        notes:
          "Structured pre-cutover truth-console sections for upstream usage truth, stage boundaries, derived inputs, identity, rebalance, donor/fallback, intraday logic, output contract, and mode-specific truth.",
      },
      {
        section: "upstreamUsageTruth",
        includedInCopyPayload: true,
        requiresRun: true,
        sourcedFromSharedShaper: true,
        ownerFiles: ["modules/onePathSim/simulationVariablePresentation.ts", "modules/onePathSim/upstreamUsageTruth.ts"],
        ownerSymbols: ["buildSimulationVariableCopyPayload", "buildUpstreamUsageTruthSummary"],
        notes:
          "Structured upstream usage-truth status that proves simulation stayed downstream of persisted usage output while quarantine keeps the live refresh/orchestration path external to One Path.",
      },
      {
        section: "engineInput",
        includedInCopyPayload: true,
        requiresRun: true,
        sourcedFromSharedShaper: true,
        ownerFiles: ["modules/onePathSim/simulationVariablePresentation.ts"],
        ownerSymbols: ["buildSimulationVariableCopyPayload"],
        notes: "Full canonical engine input for the selected run.",
      },
      {
        section: "runResults",
        includedInCopyPayload: true,
        requiresRun: true,
        sourcedFromSharedShaper: true,
        ownerFiles: ["modules/onePathSim/simulationVariablePresentation.ts"],
        ownerSymbols: ["buildSimulationVariableCopyPayload"],
        notes:
          "Includes dataset summary, compare metrics, tuning summary, daily shape tuning, manual parity/reconciliation, shared diagnostics, truth summary, and artifact summary.",
      },
      {
        section: "curveShapingSummary",
        includedInCopyPayload: true,
        requiresRun: false,
        sourcedFromSharedShaper: true,
        ownerFiles: ["modules/onePathSim/simulationVariablePresentation.ts"],
        ownerSymbols: ["buildCurveShapingSummary"],
        notes: "Prioritized shape-sensitive variables for quick AI tuning review.",
      },
      {
        section: "variableFamilies",
        includedInCopyPayload: true,
        requiresRun: false,
        sourcedFromSharedShaper: true,
        ownerFiles: ["modules/onePathSim/simulationVariablePresentation.ts"],
        ownerSymbols: ["buildSimulationVariableFamilyAdminView"],
        notes: "Human-readable family and field inventory, including descriptions, hints, resolved values, and sources.",
      },
      {
        section: "rawEffectiveSimulationVariablesUsed and rawReadModel",
        includedInCopyPayload: true,
        requiresRun: true,
        sourcedFromSharedShaper: true,
        ownerFiles: ["modules/onePathSim/simulationVariablePresentation.ts"],
        ownerSymbols: ["buildSimulationVariableCopyPayload"],
        notes: "Raw shared run snapshot and raw read model for deeper inspection.",
      },
      {
        section: "ownershipAudit",
        includedInCopyPayload: true,
        requiresRun: false,
        sourcedFromSharedShaper: true,
        ownerFiles: ["modules/onePathSim/onePathOwnershipAudit.ts", "modules/onePathSim/simulationVariablePresentation.ts"],
        ownerSymbols: ["buildOnePathOwnershipAudit", "buildSimulationVariableCopyPayload"],
        notes: "Static architecture audit covering page surfaces, wiring flow, external surfaces, and drift watchpoints.",
      },
    ],
    sharedWiringFlow: [
      {
        step: 1,
        label: "Admin harness collects controls",
        from: "OnePathSimAdmin",
        to: "one-path-sim route POST body",
        ownerFile: "components/admin/OnePathSimAdmin.tsx",
        ownerSymbol: "runSimulation",
        sharedOwner: false,
        notes: "Thin UI layer only; no simulation math runs in the page.",
      },
      {
        step: 2,
        label: "Route normalizes raw one-path input",
        from: "one-path-sim route",
        to: "rawInputBase",
        ownerFile: "app/api/admin/tools/one-path-sim/route.ts",
        ownerSymbol: "POST",
        sharedOwner: false,
        notes: "Route orchestrates mode, validation, travel, and persist flags before calling shared adapters.",
      },
      {
        step: 3,
        label: "Shared adapters build canonical engine input",
        from: "rawInputBase",
        to: "CanonicalSimulationEngineInput",
        ownerFile: "modules/onePathSim/onePathSim.ts",
        ownerSymbol: "adaptIntervalRawInput / adaptManualMonthlyRawInput / adaptManualAnnualRawInput / adaptNewBuildRawInput",
        sharedOwner: true,
        notes: "All four modes adapt into one canonical engine-input contract.",
      },
      {
        step: 4,
        label: "Canonical engine input dispatches shared recalc",
        from: "CanonicalSimulationEngineInput",
        to: "recalcSimulatorBuild",
        ownerFile: "modules/onePathSim/onePathSim.ts",
        ownerSymbol: "runSharedSimulation",
        sharedOwner: true,
        notes: "One Path maps engineInput.runtime into RecalcSimulatorBuildArgs and stays on the shared producer family.",
      },
      {
        step: 5,
        label: "Shared recalc resolves profiles, policy, weather envelope, and statement targets",
        from: "RecalcSimulatorBuildArgs",
        to: "simulator build inputs",
        ownerFile: "modules/usageSimulator/service.ts",
        ownerSymbol: "recalcSimulatorBuild",
        sharedOwner: true,
        notes:
          "This is where policy, manual bill-period targets, weather sensitivity envelope, and effectiveSimulationVariablesUsed are resolved.",
      },
      {
        step: 6,
        label: "Shared past producer simulates canonical dataset",
        from: "simulator build inputs",
        to: "persisted past dataset artifact",
        ownerFile: "modules/simulatedUsage/simulatePastUsageDataset.ts",
        ownerSymbol: "simulatePastUsageDataset",
        sharedOwner: true,
        notes: "Owns day simulation, weather loading, stitched curves, and dataset packaging for past-sim scenarios.",
      },
      {
        step: 7,
        label: "Shared service persists build and artifact metadata",
        from: "simulated dataset",
        to: "usageSimulatorBuild + cached artifact",
        ownerFile: "modules/usageSimulator/service.ts",
        ownerSymbol: "upsertSimulatorBuild flow",
        sharedOwner: true,
        notes: "Applies canonical coverage metadata and stores effective variable snapshots in dataset meta.",
      },
      {
        step: 8,
        label: "One Path reads the persisted artifact back",
        from: "persisted artifact",
        to: "CanonicalSimulationArtifact",
        ownerFile: "modules/onePathSim/onePathSim.ts",
        ownerSymbol: "buildArtifactFromEngineInput",
        sharedOwner: true,
        notes: "Reads artifact-only data and attaches run identity to effectiveSimulationVariablesUsed.",
      },
      {
        step: 9,
        label: "Shared read model decorates artifact for admin review",
        from: "CanonicalSimulationArtifact",
        to: "CanonicalSimulationReadModel",
        ownerFile: "modules/onePathSim/onePathSim.ts",
        ownerSymbol: "buildSharedSimulationReadModel",
        sharedOwner: true,
        notes: "Adds compare sidecars, curve compare payloads, tuning summary, truth summary, and run-linked variable snapshot.",
      },
      {
        step: 10,
        label: "Shared read-only shapers feed page and AI copy",
        from: "CanonicalSimulationReadModel",
        to: "admin truth panels and AI payload",
        ownerFile: "modules/onePathSim/simulationVariablePresentation.ts",
        ownerSymbol: "buildSimulationVariableCopyPayload",
        sharedOwner: true,
        notes: "The page renders shared shaper output; the copy payload comes from the same shared shaper.",
      },
    ],
    externalSurfaceClassification: [
      {
        surface: "GapFill canonical compare route",
        classification: "shared_run_orchestrator",
        ownerFiles: ["app/api/admin/tools/gapfill-lab/route.ts", "modules/usageSimulator/service.ts"],
        ownerSymbols: ["POST", "getSimulatedUsageForHouseScenario", "recalcSimulatorBuild"],
        notes: "Runs and reads through the shared service family, but still owns heavy compare/report assembly downstream.",
      },
      {
        surface: "GapFill source-home past snapshot route",
        classification: "local_summarizer",
        ownerFiles: ["app/api/admin/tools/gapfill-lab/sourceHomePastSimSnapshot.ts"],
        ownerSymbols: ["buildSourceHomePastSimSnapshot"],
        notes: "Reads shared artifact data and adds snapshot/report metadata for GapFill source-home diagnostics.",
      },
      {
        surface: "GapFill source-home travel helper route wrapper",
        classification: "duplicate_owner_risk",
        ownerFiles: ["app/api/admin/tools/gapfill-lab/source-home-past-sim/route.ts", "app/api/admin/tools/gapfill-lab/gapfillLabRouteHelpers.ts"],
        ownerSymbols: ["POST", "getTravelRangesFromDb"],
        notes: "This pass removes the duplicate helper implementation and routes through the shared helper import.",
      },
      {
        surface: "Manual Monthly Lab",
        classification: "shared_run_orchestrator",
        ownerFiles: ["app/api/admin/tools/manual-monthly/route.ts", "modules/manualUsage/pastSimReadResult.ts"],
        ownerSymbols: ["POST", "buildManualUsagePastSimReadResult"],
        notes: "Uses shared recalc/readback and shared manual read-model decorations rather than page-local simulation.",
      },
      {
        surface: "User simulated-house route",
        classification: "shared_reader",
        ownerFiles: ["app/api/user/usage/simulated/house/route.ts", "modules/usageSimulator/service.ts"],
        ownerSymbols: ["GET", "getSimulatedUsageForHouseScenario", "buildManualUsageReadDecorations"],
        notes: "Reads shared artifact data for past/future scenarios and adds shared decorations for compare and manual parity.",
      },
      {
        surface: "User baseline usage route",
        classification: "adjacent_shared_scorer",
        ownerFiles: ["app/api/user/usage/route.ts", "modules/weatherSensitivity/shared.ts"],
        ownerSymbols: ["GET", "resolveSharedWeatherSensitivityEnvelope"],
        notes: "Reads actual usage directly and enriches with the shared weather envelope, but does not run past simulation.",
      },
      {
        surface: "Weather Sensitivity Lab",
        classification: "adjacent_shared_scorer",
        ownerFiles: ["app/api/admin/tools/weather-sensitivity-lab/route.ts", "modules/weatherSensitivity/shared.ts"],
        ownerSymbols: ["GET", "resolveSharedWeatherSensitivityEnvelope"],
        notes: "Scores houses through the shared weather owner only; it is not a past-sim execution surface.",
      },
      {
        surface: "One Path Sim Admin",
        classification: "shared_run_orchestrator",
        ownerFiles: ["app/api/admin/tools/one-path-sim/route.ts", "modules/onePathSim/onePathSim.ts"],
        ownerSymbols: ["POST", "runSharedSimulation", "buildSharedSimulationReadModel"],
        notes: "Admin audit/tuning harness for the same shared producer family used elsewhere.",
      },
    ],
    driftRiskWatchlist: [
      {
        risk: "GapFill source-home route duplicated travel-range helper ownership",
        currentState: "tightened_in_this_pass",
        ownerFiles: ["app/api/admin/tools/gapfill-lab/source-home-past-sim/route.ts", "app/api/admin/tools/gapfill-lab/gapfillLabRouteHelpers.ts"],
        ownerSymbols: ["POST", "getTravelRangesFromDb"],
        notes: "Now should import the shared helper instead of reimplementing the DB walk locally.",
      },
      {
        risk: "One Path lookup weather preview can drift from recalc policy resolution",
        currentState: "tightened_in_this_pass",
        ownerFiles: ["app/api/admin/tools/one-path-sim/route.ts", "modules/onePathSim/simulationVariablePolicy.ts"],
        ownerSymbols: ["POST", "getSimulationVariablePolicy"],
        notes: "Lookup preview should resolve the same mode-aware policy bucket used by the shared recalc path.",
      },
      {
        risk: "One Path actual-context preview can drift if lookup ignores actualContextHouseId",
        currentState: "tightened_in_this_pass",
        ownerFiles: ["app/api/admin/tools/one-path-sim/route.ts", "components/admin/OnePathSimAdmin.tsx"],
        ownerSymbols: ["POST", "loadLookup"],
        notes: "Lookup preview should respect the selected actual-context house when building source-context weather preview.",
      },
      {
        risk: "GapFill still owns heavy compare/report assembly after shared sim returns",
        currentState: "watch",
        ownerFiles: ["app/api/admin/tools/gapfill-lab/route.ts", "app/api/admin/tools/gapfill-lab/sourceHomePastSimSnapshot.ts"],
        ownerSymbols: ["POST", "buildSourceHomePastSimSnapshot"],
        notes: "Not a second simulator, but still a large downstream summarization surface outside One Path.",
      },
      {
        risk: "Multiple non-One-Path routes call shared weather scoring directly for display/enrichment",
        currentState: "watch",
        ownerFiles: [
          "app/api/admin/tools/weather-sensitivity-lab/route.ts",
          "app/api/user/usage/simulated/house/route.ts",
          "app/api/user/usage/route.ts",
        ],
        ownerSymbols: ["GET", "resolveSharedWeatherSensitivityEnvelope"],
        notes: "Math remains shared in one weather owner, but the orchestration entry points are still spread across several surfaces.",
      },
      {
        risk: "runReason looks like run truth but is currently page-only context",
        currentState: "branch_risk",
        ownerFiles: ["components/admin/OnePathSimAdmin.tsx", "modules/onePathSim/simulationVariablePresentation.ts"],
        ownerSymbols: ["OnePathSimAdmin", "buildSimulationVariableCopyPayload"],
        notes: "Keep it labeled as admin context only unless it is promoted into the canonical engine-input contract later.",
      },
    ],
  };
}

