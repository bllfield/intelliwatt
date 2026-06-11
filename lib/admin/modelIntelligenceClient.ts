import type {
  ModelIntelligenceLabContext,
  ModelIntelligenceManualGapfillOptions,
  ModelIntelligenceModeAvailability,
  ModelIntelligenceOnePathOptions,
  ModelIntelligenceOrchestrationFlags,
  ModelIntelligenceRunMode,
  ModelIntelligenceSequencePreview,
  ModelIntelligenceSelectedRuns,
} from "@/modules/modelIntelligence/types";
import type { AdminHouseLookupRow } from "@/lib/admin/adminHouseLookup";

type ApiResult<T> = { ok: true; data: T } | { ok: false; error: string; status: number };

async function postJson<T>(body: Record<string, unknown>): Promise<ApiResult<T>> {
  const res = await fetch("/api/admin/tools/model-intelligence-lab", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || json.ok !== true) {
    const message =
      (typeof json.message === "string" && json.message) ||
      (typeof json.error === "string" && json.error) ||
      `Request failed (${res.status})`;
    return { ok: false, error: message, status: res.status };
  }
  return { ok: true, data: json as T };
}

export function defaultModelIntelligenceSelectedRuns(): ModelIntelligenceSelectedRuns {
  return {
    SMT_INTERVAL_TRUTH: true,
    GREEN_BUTTON_TRUTH: false,
    MONTHLY_MASKED: false,
    ANNUAL_MASKED: false,
    NEW_BUILD: false,
  };
}

export function defaultModelIntelligenceOnePathOptions(): ModelIntelligenceOnePathOptions {
  return {
    weatherPreference: "LAST_YEAR_WEATHER",
    validationSelectionMode: "policy_default",
    validationDayCount: 14,
    validationOnlyDateKeysLocal: [],
    persistRequested: false,
    runReason: "model_intelligence_lab_preview",
    includeDebugDiagnostics: false,
    includeSimRunAudit: false,
    includePosthocTopMissIntervalCurves: false,
    actualContextHouseIdOverride: null,
  };
}

export function defaultModelIntelligenceManualGapfillOptions(): ModelIntelligenceManualGapfillOptions {
  return {
    includeDiagnostics: true,
    includeDailyRows: true,
    anchorEndDate: "",
    persistSeedToggle: false,
    manualGapfillMode: "MONTHLY_FROM_SOURCE_INTERVALS",
    includeIntervalCurveDiagnostics: true,
    includeTopMissCurves: false,
  };
}

export function defaultModelIntelligenceOrchestrationFlags(): ModelIntelligenceOrchestrationFlags {
  return {
    runCompareDiagnostics: true,
    buildCohortSnapshot: false,
    updateTuningQueue: false,
    includeAiExportBundle: false,
  };
}

export async function fetchModelIntelligenceHouses(email: string) {
  return postJson<{ email: string; userId: string; houses: AdminHouseLookupRow[] }>({
    action: "load_houses",
    email,
  });
}

export async function fetchModelIntelligenceContext(args: { email: string; houseId: string; esiid?: string | null }) {
  return postJson<{
    context: ModelIntelligenceLabContext;
    houses: AdminHouseLookupRow[];
    modeAvailability: ModelIntelligenceModeAvailability[];
  }>({
    action: "load_context",
    email: args.email,
    houseId: args.houseId,
    ...(args.esiid ? { esiid: args.esiid } : {}),
  });
}

export async function fetchModelIntelligenceSequencePreview(args: {
  email: string;
  houseId: string;
  esiid?: string | null;
  selectedRuns: ModelIntelligenceSelectedRuns;
  onePathOptions: ModelIntelligenceOnePathOptions;
  manualGapfillOptions: ModelIntelligenceManualGapfillOptions;
  flags: ModelIntelligenceOrchestrationFlags;
}) {
  return postJson<{
    context: ModelIntelligenceLabContext;
    preview: ModelIntelligenceSequencePreview;
  }>({
    action: "preview_sequence",
    email: args.email,
    houseId: args.houseId,
    ...(args.esiid ? { esiid: args.esiid } : {}),
    selectedRuns: args.selectedRuns,
    onePathOptions: args.onePathOptions,
    manualGapfillOptions: args.manualGapfillOptions,
    flags: args.flags,
  });
}

export const MODEL_INTELLIGENCE_RUN_MODE_LABELS: Record<ModelIntelligenceRunMode, string> = {
  SMT_INTERVAL_TRUTH: "SMT / interval truth",
  GREEN_BUTTON_TRUTH: "Green Button truth",
  MONTHLY_MASKED: "Monthly masked",
  ANNUAL_MASKED: "Annual masked",
  NEW_BUILD: "New Build / no usage",
};
