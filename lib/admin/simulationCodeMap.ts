import type { ExportDeploymentMetadata } from "@/lib/admin/aiTuningBundleHelpers";

export const SIMULATION_CODE_MAP_VERSION = "simulation_code_map_v1";

type SimulationCodeMapModule = {
  moduleId: string;
  path: string;
  role: string;
  exportedFunctions: string[];
  routeEntrypoints?: string[];
  snippet: string;
};

const SHARED_MODULES: SimulationCodeMapModule[] = [
  {
    moduleId: "past_sim_orchestrator",
    path: "modules/onePathSim/usageSimulator/service.ts",
    role: "Past sim orchestrator / artifact read-write owner (One Path tree).",
    exportedFunctions: [
      "getSimulatedUsageForHouseScenario",
      "recalcSimulatorBuild",
      "resolvePastArtifactIdentity",
    ],
    routeEntrypoints: [
      "app/api/admin/tools/one-path-sim/route.ts → buildPastSimRunReadbackResponse",
      "modules/onePathSim/serviceBridge.ts → readOnePathSimulatedUsageScenario",
    ],
    snippet:
      "Past admin readback uses artifact_only first, then optional allow_rebuild. Simulated datasets are persisted to PastSimulatedDatasetCache with canonical input hashes.",
  },
  {
    moduleId: "manual_allocation",
    path: "modules/onePathSim/simulatedUsage/simulatePastUsageDataset.ts",
    role: "Manual monthly/annual allocation and MANUAL_TOTALS constrained sim producer.",
    exportedFunctions: ["simulatePastUsageDataset", "ensureUsageShapeProfileForSharedSimulation"],
    snippet:
      "MANUAL_TOTALS runs allocate daily/monthly totals from manual payload targets, then reconstruct intraday intervals under shared shape constraints.",
  },
  {
    moduleId: "daily_weather_shaping",
    path: "modules/onePathSim/simulatedUsage/simulatePastUsageDataset.ts",
    role: "Daily weather-sensitive allocation and weather-efficiency shaping inside Past sim.",
    exportedFunctions: ["simulatePastUsageDataset"],
    snippet:
      "Weather buckets and sensitivity inputs influence daily allocation before interval reconstruction; holdout validation days remain policy-selected.",
  },
  {
    moduleId: "intraday_interval_reconstruction",
    path: "modules/usageShapeProfile/derive.ts",
    role: "Usage-shape profile derivation and intraday interval reconstruction support.",
    exportedFunctions: ["deriveUsageShapeProfile"],
    routeEntrypoints: ["modules/usageShapeProfile/autoBuild.ts → ensureUsageShapeProfileForUserHouse"],
    snippet:
      "Shape-by-month 96-slot profiles drive intraday reconstruction when actual intervals are unavailable or constrained modes require estimated curves.",
  },
  {
    moduleId: "weather_scorer",
    path: "modules/weatherNormalization/normalizer.ts",
    role: "Weather scorer / derived weather input logic for display and diagnostics.",
    exportedFunctions: ["normalizeWeatherForHouse", "buildWeatherSensitivityScore"],
    snippet:
      "Weather scoring produces derived sensitivity inputs used by dashboard display and diagnostic compare; export excludes raw env secrets.",
  },
  {
    moduleId: "validation_day_selector",
    path: "lib/usage/validationDayPolicy.ts",
    role: "Global validation-day selector / policy hash owner.",
    exportedFunctions: [
      "resolveActiveValidationDayPolicyLive",
      "computeValidationDayPolicyHash",
      "selectValidationDayKeys",
    ],
    routeEntrypoints: ["app/api/admin/tools/validation-day-policy/route.ts"],
    snippet:
      "Validation-day holdout keys are selected from global admin policy and hashed into Past artifact identity; diagnostics never mutate the policy.",
  },
  {
    moduleId: "travel_vacant_filter",
    path: "lib/usage/pastSimTravelRanges.ts",
    role: "Travel/vacant range storage, coverage-window classification, and operational clipping.",
    exportedFunctions: [
      "summarizeTravelRangesForCoverageWindow",
      "filterTravelRangesToCoverageWindow",
      "replacePastCorrectedScenarioTravelRanges",
    ],
    snippet:
      "Stored travel ranges are classified into active current-window, archived historical, and future outside-window buckets before recalc exclusion.",
  },
  {
    moduleId: "one_path_interval_compare_diagnostics",
    path: "modules/onePathSim/onePathIntervalCompareDiagnosticsV1.ts",
    role: "One Path interval compare diagnostics (read-only admin export).",
    exportedFunctions: [
      "buildOnePathIntervalCompareDiagnosticsV1",
      "buildOnePathIntervalDiagnosticsEnvelope",
      "extractValidationDayKeysFromCompareProjection",
    ],
    snippet:
      "Diagnostics compare actual vs simulated daily totals and optional validation/posthoc interval curves without changing sim output or scoring labels.",
  },
  {
    moduleId: "manual_gapfill_compare_diagnostics",
    path: "modules/manualUsage/manualGapfillCompareDiagnosticsV1.ts",
    role: "Manual GapFill compare diagnostics (MG-5 read-only export).",
    exportedFunctions: ["buildManualGapfillCompareDiagnosticsV1"],
    routeEntrypoints: ["app/api/admin/tools/manual-gapfill/compare/route.ts"],
    snippet:
      "MG-5 diagnostics summarize weather miss, travel, bill-period allocation, validation interval curves, and worst-day buckets for lab-only compare.",
  },
  {
    moduleId: "artifact_projection",
    path: "lib/usage/persistManualPastArtifactCanonicalWindow.ts",
    role: "Manual Past artifact canonical-window projection helper (read/write guard owner).",
    exportedFunctions: ["projectManualPastDatasetToCanonicalWindow", "isCanonicalManualPastArtifact"],
    snippet:
      "Display/read models may remap manual artifacts to canonical 365-day windows; export captures identity hashes and coverage metadata only.",
  },
];

const ONE_PATH_ROUTES = [
  {
    surface: "one_path_admin",
    route: "POST /api/admin/tools/one-path-sim",
    actions: ["lookup", "run", "read_past_interval_diagnostics"],
    primaryOwners: [
      "buildPastSimRunReadbackResponse",
      "buildSimulationVariableCopyPayload",
      "buildOnePathIntervalDiagnosticsForPastResponse",
    ],
  },
];

const MANUAL_GAPFILL_ROUTES = [
  { step: "MG-1", route: "POST /api/admin/tools/manual-gapfill/source-context" },
  { step: "MG-2", route: "POST /api/admin/tools/validation-day-policy" },
  { step: "MG-3", route: "POST /api/admin/tools/manual-gapfill/prepare-seed" },
  { step: "MG-4", route: "POST /api/admin/tools/manual-gapfill/run-readback" },
  { step: "MG-5", route: "POST /api/admin/tools/manual-gapfill/compare" },
];

export function buildSimulationCodeMap(args: {
  surface: "one_path_admin" | "manual_gapfill_lab";
  deployment?: ExportDeploymentMetadata | null;
}): Record<string, unknown> {
  const deployment = args.deployment ?? null;
  return {
    version: SIMULATION_CODE_MAP_VERSION,
    readOnly: true,
    surface: args.surface,
    deployment: deployment
      ? {
          gitCommitSha: deployment.gitCommitSha,
          gitCommitRef: deployment.gitCommitRef,
          deployedAt: deployment.deployedAt,
          workingTreeDirty: deployment.workingTreeDirty,
          metadataSource: deployment.metadataSource,
        }
      : {
          gitCommitSha: null,
          gitCommitRef: null,
          deployedAt: null,
          workingTreeDirty: null,
          metadataSource: "unknown",
          note: "Fetch GET /api/admin/tools/export-metadata before copy to populate deployment metadata.",
        },
    routeEntrypoints: args.surface === "one_path_admin" ? ONE_PATH_ROUTES : MANUAL_GAPFILL_ROUTES,
    modules: SHARED_MODULES.map((module) => ({
      ...module,
      codeVersionHash: deployment?.gitCommitSha ? `${module.moduleId}@${deployment.gitCommitSha.slice(0, 12)}` : module.moduleId,
    })),
    guardrails: {
      exportOnly: true,
      simulatorBehaviorMutated: false,
      validationPolicyMutated: false,
      customerFacingResultsMutated: false,
      secretsIncluded: false,
      envValuesIncluded: false,
    },
  };
}
