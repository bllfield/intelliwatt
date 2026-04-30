"use client";

import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { AppliancesClient } from "@/components/appliances/AppliancesClient";
import { HomeDetailsClient } from "@/components/home/HomeDetailsClient";
import { ManualUsageEntry } from "@/components/manual/ManualUsageEntry";
import { OnePathBaselineReadOnlyView } from "@/components/admin/OnePathBaselineReadOnlyView";
import { OnePathManualStageView } from "@/components/admin/OnePathManualStageView";
import { OnePathRunReadOnlyView } from "@/components/admin/OnePathRunReadOnlyView";
import {
  buildSimulationVariableCopyPayload,
  buildSimulationVariableFamilyAdminView,
} from "@/modules/onePathSim/simulationVariablePresentation";
import { buildOnePathSandboxHarnessSummary } from "@/modules/onePathSim/adminHarnessSummary";
import { buildOnePathTuningCycleSummary } from "@/modules/onePathSim/tuningCycleSummary";
import {
  DEFAULT_BRIAN_KNOWN_SCENARIO_KEY,
  KNOWN_HOUSE_SCENARIOS,
  PRIMARY_BRIAN_SANDBOX_CONTEXT,
  getKnownHouseScenarioByKey,
  resolveKnownHouseScenarioSelection,
} from "@/modules/onePathSim/knownHouseScenarios";
import { buildKnownHouseScenarioPrereqStatus } from "@/modules/onePathSim/knownHouseScenarioPrereqs";
import { buildIntervalPastReadinessTrace } from "@/modules/onePathSim/intervalPastReadinessTrace";
import { buildOnePathOwnershipAudit } from "@/modules/onePathSim/onePathOwnershipAudit";
import { buildRuntimeEnvParityTrace } from "@/modules/onePathSim/runtimeEnvParityTrace";

type LookupResponse = {
  ok: true;
  email: string;
  userId: string;
  houses: Array<{ id: string; label: string; esiid: string | null }>;
  selectedHouse: { id: string; label: string; esiid: string | null };
  scenarios: Array<{ id: string; name: string }>;
  sourceContext: Record<string, unknown>;
};

type VariablePolicyResponse = {
  ok: true;
  confirmationKeyword: string;
  familyMeta: Record<string, { title: string; description: string }>;
  defaults: Record<string, unknown>;
  effectiveByMode: Record<string, Record<string, unknown>>;
  overrides: Record<string, unknown>;
};

const VALIDATION_SELECTION_OPTIONS = [
  { value: "manual", label: "manual" },
  { value: "random_simple", label: "random_simple" },
  { value: "customer_style_seasonal_mix", label: "customer_style_seasonal_mix" },
  { value: "stratified_weather_balanced", label: "stratified_weather_balanced" },
] as const;

const VALIDATION_SELECTION_MODE_DETAILS = [
  {
    value: "manual",
    title: "manual",
    howItWorks: "Uses only explicitly supplied validation date keys and excludes travel/vacant dates from that set.",
    adminAdjustments:
      "Best when you already know the exact days you want to score. This page lets admin set the shared mode, day count, and explicit manual validation date keys.",
  },
  {
    value: "random_simple",
    title: "random_simple",
    howItWorks: "Randomly samples clean candidate days from the shared pool without month or weekend stratification.",
    adminAdjustments:
      "Good for quick spot checks. Admin can mainly adjust the requested validation day count and compare it against other shared selector modes.",
  },
  {
    value: "customer_style_seasonal_mix",
    title: "customer_style_seasonal_mix",
    howItWorks: "Randomly samples clean days while stratifying by month and weekday/weekend mix.",
    adminAdjustments:
      "Useful when you want a broader customer-style seasonal spread without the stricter shared stratified bucket balancing.",
  },
  {
    value: "stratified_weather_balanced",
    title: "stratified_weather_balanced",
    howItWorks:
      "Uses the shared round-robin bucket selector across winter, summer, shoulder, weekday, and weekend buckets, with explicit fallback diagnostics when buckets run short.",
    adminAdjustments:
      "This is the admin-default shared selector. Adjust the validation day count to widen or tighten the balanced scored-day set for tuning runs.",
  },
] as const;

function Modal(props: { open: boolean; title: string; onClose: () => void; children: React.ReactNode }) {
  if (!props.open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-4xl rounded-3xl border border-brand-blue/15 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-brand-blue/10 px-6 py-4">
          <div className="text-sm font-semibold text-brand-navy">{props.title}</div>
          <button
            type="button"
            onClick={props.onClose}
            className="rounded-full border border-brand-blue/20 bg-white px-3 py-1 text-xs font-semibold text-brand-navy hover:bg-brand-blue/5"
          >
            Close
          </button>
        </div>
        <div className="max-h-[75vh] overflow-auto px-6 py-5">{props.children}</div>
      </div>
    </div>
  );
}

const SectionJson = memo(function SectionJson(props: { title: string; value: unknown }) {
  const formatted = useMemo(() => JSON.stringify(props.value, null, 2), [props.value]);
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-sm font-semibold text-brand-navy">{props.title}</div>
      <pre className="mt-3 overflow-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-100">{formatted}</pre>
    </div>
  );
});

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function parseManualValidationDateKeys(value: string): string[] {
  return value
    .split(/[\s,]+/)
    .map((entry) => entry.trim().slice(0, 10))
    .filter((entry, index, all) => /^\d{4}-\d{2}-\d{2}$/.test(entry) && all.indexOf(entry) === index);
}

function formatTruthValue(value: unknown): string {
  if (value == null) return "not set";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.length === 0 ? "none" : JSON.stringify(value);
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function hasUsableGreenButtonCoverage(upload: Record<string, unknown> | null | undefined): boolean {
  if (!upload) return false;
  if (upload.hasPersistedUsageIntervals === true) return true;
  const intervalCount = Number(upload.intervalCount ?? 0);
  return Number.isFinite(intervalCount) && intervalCount > 0;
}

function TruthSummaryPanel(props: {
  title: string;
  summary: string;
  currentRun: Record<string, unknown> | null | undefined;
  sharedOwners?: Array<{ label?: unknown; owner?: unknown; whyItMatters?: unknown }> | null;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-sm font-semibold text-brand-navy">{props.title}</div>
      <p className="mt-2 text-sm text-slate-600">{props.summary}</p>
      {props.sharedOwners?.length ? (
        <div className="mt-4 grid gap-3">
          {props.sharedOwners.map((owner, index) => (
            <div key={`${index}:${String(owner.owner ?? owner.label ?? "")}`} className="rounded-lg bg-slate-50 p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                {String(owner.label ?? "Shared owner")}
              </div>
              <div className="mt-1 text-sm font-semibold text-brand-navy">{String(owner.owner ?? "")}</div>
              <div className="mt-1 text-xs text-slate-600">{String(owner.whyItMatters ?? "")}</div>
            </div>
          ))}
        </div>
      ) : null}
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {Object.entries(props.currentRun ?? {}).map(([key, value]) => (
          <div key={key} className="rounded-lg border border-slate-200 p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{key}</div>
            <div className="mt-1 text-sm text-slate-800 break-words">{formatTruthValue(value)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function modeToOverrideBucketKey(mode: string): "intervalOverrides" | "manualMonthlyOverrides" | "manualAnnualOverrides" | "newBuildOverrides" {
  if (mode === "MANUAL_MONTHLY") return "manualMonthlyOverrides";
  if (mode === "MANUAL_ANNUAL") return "manualAnnualOverrides";
  if (mode === "NEW_BUILD") return "newBuildOverrides";
  return "intervalOverrides";
}

export function OnePathSimAdmin() {
  const [email, setEmail] = useState("");
  const [lookup, setLookup] = useState<LookupResponse | null>(null);
  const [debugDiagnosticsEnabled, setDebugDiagnosticsEnabled] = useState(true);
  const [selectedHouseId, setSelectedHouseId] = useState("");
  const [actualContextHouseId, setActualContextHouseId] = useState("");
  const [selectedScenarioId, setSelectedScenarioId] = useState("");
  const [selectedKnownScenarioKey, setSelectedKnownScenarioKey] = useState(DEFAULT_BRIAN_KNOWN_SCENARIO_KEY);
  const [lastRunKnownScenarioKey, setLastRunKnownScenarioKey] = useState("");
  const [mode, setMode] = useState<"INTERVAL" | "GREEN_BUTTON" | "MANUAL_MONTHLY" | "MANUAL_ANNUAL" | "NEW_BUILD">("INTERVAL");
  const [weatherPreference, setWeatherPreference] = useState<"NONE" | "LAST_YEAR_WEATHER" | "LONG_TERM_AVERAGE">(
    "LAST_YEAR_WEATHER"
  );
  const [validationSelectionMode, setValidationSelectionMode] = useState("stratified_weather_balanced");
  const [validationDayCount, setValidationDayCount] = useState("14");
  const [validationOnlyDateKeysText, setValidationOnlyDateKeysText] = useState("");
  const [persistRequested, setPersistRequested] = useState(true);
  const [runReason, setRunReason] = useState("one_path_admin_harness");
  const [travelRanges, setTravelRanges] = useState<Array<{ startDate: string; endDate: string }>>([]);
  const [travelOpen, setTravelOpen] = useState(false);
  const [homeOpen, setHomeOpen] = useState(false);
  const [applianceOpen, setApplianceOpen] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [runResult, setRunResult] = useState<any | null>(null);
  const [variablePolicy, setVariablePolicy] = useState<VariablePolicyResponse | null>(null);
  const [variableFamilyOpen, setVariableFamilyOpen] = useState<string | null>(null);
  const [variableDraft, setVariableDraft] = useState("{}");
  const [variableConfirmation, setVariableConfirmation] = useState("");
  const [variableBusy, setVariableBusy] = useState(false);
  const [variableError, setVariableError] = useState<string | null>(null);
  const [validationInfoOpen, setValidationInfoOpen] = useState(false);
  const [greenButtonSelectedFile, setGreenButtonSelectedFile] = useState<File | null>(null);
  const [greenButtonUploadInputKey, setGreenButtonUploadInputKey] = useState(0);
  const [greenButtonUtilityName, setGreenButtonUtilityName] = useState("");
  const [greenButtonAccountNumber, setGreenButtonAccountNumber] = useState("");
  const [greenButtonUploadBusy, setGreenButtonUploadBusy] = useState(false);
  const [greenButtonUploadStatus, setGreenButtonUploadStatus] = useState<string | null>(null);
  const [greenButtonUploadError, setGreenButtonUploadError] = useState<string | null>(null);

  const loadVariablePolicy = useCallback(async () => {
    const res = await fetch("/api/admin/tools/one-path-sim/variables");
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.ok) {
      setVariableError(json?.error ?? `Variables load failed (${res.status})`);
      return;
    }
    setVariablePolicy(json);
    setVariableError(null);
  }, []);

  useEffect(() => {
    void loadVariablePolicy();
  }, [loadVariablePolicy]);

  const openVariableFamily = useCallback(
    (familyKey: string) => {
      setVariableFamilyOpen(familyKey);
      setVariableDraft(JSON.stringify((variablePolicy?.overrides?.[familyKey] as Record<string, unknown> | undefined) ?? {}, null, 2));
      setVariableConfirmation("");
      setVariableError(null);
    },
    [variablePolicy]
  );

  const variableDraftParsed = useMemo(() => {
    try {
      return asRecord(JSON.parse(variableDraft || "{}"));
    } catch {
      return null;
    }
  }, [variableDraft]);

  const variableDraftModeOverrides = useMemo(
    () => asRecord(variableDraftParsed?.[modeToOverrideBucketKey(mode)]) ?? {},
    [mode, variableDraftParsed]
  );
  const effectiveHouseId = selectedHouseId || lookup?.selectedHouse?.id || "";
  const effectiveActualContextHouseId = actualContextHouseId || effectiveHouseId;
  useEffect(() => {
    setGreenButtonSelectedFile(null);
    setGreenButtonUploadInputKey((current) => current + 1);
    setGreenButtonUploadStatus(null);
    setGreenButtonUploadError(null);
  }, [lookup?.userId, effectiveActualContextHouseId]);
  const validationOnlyDateKeysLocal = useMemo(
    () => parseManualValidationDateKeys(validationOnlyDateKeysText),
    [validationOnlyDateKeysText]
  );
  const selectedKnownScenario = useMemo(
    () => getKnownHouseScenarioByKey(selectedKnownScenarioKey),
    [selectedKnownScenarioKey]
  );
  const selectedKnownScenarioIsGreenButton = selectedKnownScenario?.scenarioType === "GREEN_BUTTON_TRUTH";
  const lastRunKnownScenario = useMemo(
    () => getKnownHouseScenarioByKey(lastRunKnownScenarioKey),
    [lastRunKnownScenarioKey]
  );
  const orderedKnownScenarios = useMemo(() => {
    const brianEmail = PRIMARY_BRIAN_SANDBOX_CONTEXT.email;
    const registryOrder = new Map(KNOWN_HOUSE_SCENARIOS.map((scenario, index) => [scenario.scenarioKey, index]));
    return [...KNOWN_HOUSE_SCENARIOS].sort((left, right) => {
      if (left.scenarioKey === DEFAULT_BRIAN_KNOWN_SCENARIO_KEY) return -1;
      if (right.scenarioKey === DEFAULT_BRIAN_KNOWN_SCENARIO_KEY) return 1;
      if (left.sourceUserEmail === brianEmail && right.sourceUserEmail !== brianEmail) return -1;
      if (right.sourceUserEmail === brianEmail && left.sourceUserEmail !== brianEmail) return 1;
      if (left.active !== right.active) return left.active ? -1 : 1;
      return (registryOrder.get(left.scenarioKey) ?? 0) - (registryOrder.get(right.scenarioKey) ?? 0);
    });
  }, []);
  const ownershipAudit = useMemo(() => buildOnePathOwnershipAudit(), []);
  const upstreamUsageTruth = useMemo(
    () =>
      debugDiagnosticsEnabled
        ? asRecord(runResult?.readModel?.sourceOfTruthSummary?.upstreamUsageTruth) ??
          asRecord(runResult?.upstreamUsageTruth) ??
          asRecord(lookup?.sourceContext?.upstreamUsageTruth)
        : null,
    [
      debugDiagnosticsEnabled,
      lookup?.sourceContext?.upstreamUsageTruth,
      runResult?.readModel?.sourceOfTruthSummary?.upstreamUsageTruth,
      runResult?.upstreamUsageTruth,
    ]
  );
  const sandboxHarnessSummary = useMemo(
    () =>
      debugDiagnosticsEnabled
        ? buildOnePathSandboxHarnessSummary({
            lookupSourceContext: asRecord(lookup?.sourceContext),
            runResult: asRecord(runResult),
            knownScenario: lastRunKnownScenario ?? selectedKnownScenario,
          })
        : {
            runStatus: {
              runType:
                runResult?.runType ?? (selectedScenarioId ? "PAST_SIM" : runResult?.runDisplayView ? "PAST_SIM" : "BASELINE_OR_UNSET"),
            },
            monthlyTruthCompare: {},
            weatherAndShape: {},
            compareVisibility: {},
          },
    [debugDiagnosticsEnabled, lastRunKnownScenario, lookup?.sourceContext, runResult, selectedKnownScenario, selectedScenarioId]
  );
  const tuningCycleSummary = useMemo(
    () =>
      buildOnePathTuningCycleSummary({
        knownScenario: lastRunKnownScenario ?? selectedKnownScenario,
        sandboxSummary: sandboxHarnessSummary,
        selectedMode: mode,
        runError: error,
      }),
    [error, lastRunKnownScenario, mode, sandboxHarnessSummary, selectedKnownScenario]
  );
  const knownScenarioPrereqStatus = useMemo(
    () =>
      debugDiagnosticsEnabled
        ? buildKnownHouseScenarioPrereqStatus({
            scenario: selectedKnownScenario ?? lastRunKnownScenario,
            lookupSourceContext: asRecord(lookup?.sourceContext),
          })
        : null,
    [debugDiagnosticsEnabled, lastRunKnownScenario, lookup?.sourceContext, selectedKnownScenario]
  );
  const intervalPastReadinessTrace = useMemo(
    () =>
      debugDiagnosticsEnabled
        ? buildIntervalPastReadinessTrace({
            scenario: selectedKnownScenario ?? lastRunKnownScenario,
            lookupSourceContext: asRecord(lookup?.sourceContext),
            baselineParityReport: asRecord(lookup?.sourceContext?.baselineParityReport),
            environmentVisibility: asRecord(lookup?.sourceContext?.environmentVisibility),
          })
        : null,
    [debugDiagnosticsEnabled, lastRunKnownScenario, lookup?.sourceContext, selectedKnownScenario]
  );
  const runtimeEnvParityTrace = useMemo(
    () =>
      debugDiagnosticsEnabled
        ? buildRuntimeEnvParityTrace({
            environmentVisibility: asRecord(lookup?.sourceContext?.environmentVisibility),
          })
        : null,
    [debugDiagnosticsEnabled, lookup?.sourceContext?.environmentVisibility]
  );
  const lookupUserUsageBaselineContract = useMemo(() => {
    if (!debugDiagnosticsEnabled) return null;
    const contract = lookup?.sourceContext?.userUsageBaselineContract;
    return contract && typeof contract === "object" ? contract : null;
  }, [debugDiagnosticsEnabled, lookup?.sourceContext?.userUsageBaselineContract]);
  const lookupUserUsageBaselineView = useMemo(() => {
    if (!debugDiagnosticsEnabled) return null;
    const view = lookup?.sourceContext?.userUsageBaselineView;
    return view && typeof view === "object" ? view : null;
  }, [debugDiagnosticsEnabled, lookup?.sourceContext?.userUsageBaselineView]);
  const lookupBaselineParityAudit = useMemo(
    () => (debugDiagnosticsEnabled ? asRecord(lookup?.sourceContext?.baselineParityAudit) : null),
    [debugDiagnosticsEnabled, lookup?.sourceContext?.baselineParityAudit]
  );
  const lookupBaselineParityReport = useMemo(
    () => (debugDiagnosticsEnabled ? asRecord(lookup?.sourceContext?.baselineParityReport) : null),
    [debugDiagnosticsEnabled, lookup?.sourceContext?.baselineParityReport]
  );
  const runDisplayView = useMemo(() => asRecord(runResult?.runDisplayView), [runResult?.runDisplayView]);
  const activeDisplayMode = String(runResult?.engineInput?.inputType ?? mode);
  const isManualDisplayMode = activeDisplayMode === "MANUAL_MONTHLY" || activeDisplayMode === "MANUAL_ANNUAL";
  const displayRunType = String(runResult?.runType ?? sandboxHarnessSummary.runStatus.runType ?? "BASELINE_OR_UNSET");
  const manualStageOneView = useMemo(
    () =>
      (runResult?.manualStageOneView ??
        runResult?.readModel?.manualStageOneView ??
        lookup?.sourceContext?.manualStageOneView ??
        null) as any,
    [lookup?.sourceContext?.manualStageOneView, runResult?.manualStageOneView, runResult?.readModel?.manualStageOneView]
  );
  const shouldShowManualStageOneView = useMemo(() => {
    const activeInputType = String(runResult?.engineInput?.inputType ?? mode);
    return (activeInputType === "MANUAL_MONTHLY" || activeInputType === "MANUAL_ANNUAL") && manualStageOneView;
  }, [manualStageOneView, mode, runResult?.engineInput?.inputType]);
  const runReadOnlyDataset = useMemo(
    () => asRecord(runResult?.readModel?.dataset),
    [runResult?.readModel?.dataset]
  );
  const shouldRenderManualBaselinePhaseOneOnly =
    Boolean(shouldShowManualStageOneView) && isManualDisplayMode && displayRunType !== "PAST_SIM";
  const shouldRenderPastSimView =
    (displayRunType === "PAST_SIM" || displayRunType === "BASELINE_PASSTHROUGH") &&
    Boolean(runDisplayView || runReadOnlyDataset);
  const shouldRenderLookupBaselineView =
    !isManualDisplayMode && !shouldRenderPastSimView && Boolean(lookupUserUsageBaselineContract || lookupUserUsageBaselineView);
  const activePathLabel =
    mode === "INTERVAL"
      ? "interval calculations"
      : mode === "GREEN_BUTTON"
        ? "green-button path"
      : mode === "MANUAL_MONTHLY" || mode === "MANUAL_ANNUAL"
        ? "manual path"
        : "new-build path";
  const actualContextGreenButtonUpload = useMemo(
    () => asRecord(lookup?.sourceContext?.greenButtonUpload),
    [lookup?.sourceContext?.greenButtonUpload]
  );
  const actualContextHasGreenButtonUsage = useMemo(
    () => hasUsableGreenButtonCoverage(actualContextGreenButtonUpload),
    [actualContextGreenButtonUpload]
  );
  const actualContextHasGreenButtonUploadRecord = useMemo(() => {
    if (!actualContextGreenButtonUpload) return false;
    return Boolean(actualContextGreenButtonUpload.id || actualContextGreenButtonUpload.fileName || actualContextGreenButtonUpload.parseStatus);
  }, [actualContextGreenButtonUpload]);
  const runButtonLabel =
    mode === "INTERVAL"
      ? "Run One Path interval path"
      : mode === "GREEN_BUTTON"
        ? "Run One Path Green Button path"
      : mode === "NEW_BUILD"
        ? "Run One Path new-build path"
        : "Run One Path manual path";

  const activeVariableFamilyView = useMemo(
    () =>
      variableFamilyOpen && variablePolicy
        ? buildSimulationVariableFamilyAdminView({
            familyKey: variableFamilyOpen,
            mode,
            response: variablePolicy,
            runSnapshot: (runResult?.readModel?.effectiveSimulationVariablesUsed as any) ?? null,
          })
        : null,
    [mode, runResult?.readModel?.effectiveSimulationVariablesUsed, variableFamilyOpen, variablePolicy]
  );

  const updateVariableDraftField = useCallback(
    (fieldKey: string, rawValue: string) => {
      const bucketKey = modeToOverrideBucketKey(mode);
      const nextDraft = { ...(variableDraftParsed ?? {}) };
      const bucket = { ...(asRecord(nextDraft[bucketKey]) ?? {}) };
      const trimmed = rawValue.trim();
      if (!trimmed) {
        delete bucket[fieldKey];
      } else {
        const numericValue = Number(trimmed);
        if (!Number.isFinite(numericValue)) {
          setVariableError("Override values must be numeric.");
          return;
        }
        bucket[fieldKey] = numericValue;
      }
      nextDraft[bucketKey] = bucket;
      setVariableDraft(JSON.stringify(nextDraft, null, 2));
      setVariableError(null);
    },
    [mode, variableDraftParsed]
  );

  const copyAllVariablesForAi = useCallback(async () => {
    if (!variablePolicy) return;
    const payload = buildSimulationVariableCopyPayload({
      mode,
      response: variablePolicy,
      runSnapshot: (runResult?.readModel?.effectiveSimulationVariablesUsed as any) ?? null,
      engineInput: (runResult?.engineInput as Record<string, unknown> | undefined) ?? null,
      readModel: (runResult?.readModel as Record<string, unknown> | undefined) ?? null,
      artifact: (runResult?.artifact as Record<string, unknown> | undefined) ?? null,
      runDisplayView: (runResult?.runDisplayView as Record<string, unknown> | undefined) ?? null,
      loadedSourceContext: asRecord(lookup?.sourceContext),
      baselineParityReport: lookupBaselineParityReport,
      baselineParityAudit: lookupBaselineParityAudit,
      runtimeEnvParityTrace: runtimeEnvParityTrace,
      intervalPastReadinessTrace: intervalPastReadinessTrace,
      readOnlyAudit: asRecord(lookup?.sourceContext?.readOnlyAudit),
      currentControls: {
        mode,
        actualContextHouseId: effectiveActualContextHouseId || null,
        weatherPreference,
        validationSelectionMode,
        validationDayCount,
        validationOnlyDateKeysLocal,
        persistRequested,
        runReason,
      },
      knownScenario: lastRunKnownScenario ?? selectedKnownScenario,
      sandboxSummary: sandboxHarnessSummary,
    });
    await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
    setStatus("All simulation variables copied for AI.");
  }, [
    effectiveActualContextHouseId,
    lastRunKnownScenario,
    lookup?.sourceContext,
    lookupBaselineParityAudit,
    lookupBaselineParityReport,
    mode,
    persistRequested,
    runReason,
    runResult?.engineInput,
    runResult?.readModel?.effectiveSimulationVariablesUsed,
    runtimeEnvParityTrace,
    sandboxHarnessSummary,
    selectedKnownScenario,
    validationDayCount,
    validationOnlyDateKeysLocal,
    validationSelectionMode,
    variablePolicy,
    weatherPreference,
    intervalPastReadinessTrace,
  ]);

  const copyCurrentFamilyForAi = useCallback(async () => {
    if (!variablePolicy || !variableFamilyOpen) return;
    const payload = buildSimulationVariableCopyPayload({
      mode,
      response: variablePolicy,
      runSnapshot: (runResult?.readModel?.effectiveSimulationVariablesUsed as any) ?? null,
      engineInput: (runResult?.engineInput as Record<string, unknown> | undefined) ?? null,
      readModel: (runResult?.readModel as Record<string, unknown> | undefined) ?? null,
      artifact: (runResult?.artifact as Record<string, unknown> | undefined) ?? null,
      runDisplayView: (runResult?.runDisplayView as Record<string, unknown> | undefined) ?? null,
      loadedSourceContext: asRecord(lookup?.sourceContext),
      baselineParityReport: lookupBaselineParityReport,
      baselineParityAudit: lookupBaselineParityAudit,
      runtimeEnvParityTrace: runtimeEnvParityTrace,
      intervalPastReadinessTrace: intervalPastReadinessTrace,
      readOnlyAudit: asRecord(lookup?.sourceContext?.readOnlyAudit),
      currentControls: {
        mode,
        actualContextHouseId: effectiveActualContextHouseId || null,
        validationOnlyDateKeysLocal,
        selectedFamily: variableFamilyOpen,
      },
      knownScenario: lastRunKnownScenario ?? selectedKnownScenario,
      sandboxSummary: sandboxHarnessSummary,
    });
    const filteredPayload = {
      ...payload,
      variableFamilies: Array.isArray(payload.variableFamilies)
        ? payload.variableFamilies.filter((family: any) => family?.familyKey === variableFamilyOpen)
        : [],
    };
    await navigator.clipboard.writeText(JSON.stringify(filteredPayload, null, 2));
    setStatus(`Copied ${variableFamilyOpen} variables for AI.`);
  }, [
    effectiveActualContextHouseId,
    lastRunKnownScenario,
    lookup?.sourceContext,
    lookupBaselineParityAudit,
    lookupBaselineParityReport,
    mode,
    runResult?.engineInput,
    runResult?.readModel?.effectiveSimulationVariablesUsed,
    runtimeEnvParityTrace,
    sandboxHarnessSummary,
    selectedKnownScenario,
    validationOnlyDateKeysLocal,
    variableFamilyOpen,
    variablePolicy,
    intervalPastReadinessTrace,
  ]);

  const saveVariableFamily = useCallback(async () => {
    if (!variableFamilyOpen) return;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(variableDraft || "{}");
    } catch {
      setVariableError("Override JSON is invalid.");
      return;
    }
    setVariableBusy(true);
    setVariableError(null);
    const res = await fetch("/api/admin/tools/one-path-sim/variables", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        family: variableFamilyOpen,
        override: parsed,
        modeBucket: modeToOverrideBucketKey(mode),
        confirmation: variableConfirmation,
      }),
    });
    const json = await res.json().catch(() => null);
    setVariableBusy(false);
    if (!res.ok || !json?.ok) {
      setVariableError(json?.error ?? `Override save failed (${res.status})`);
      return;
    }
    setVariablePolicy(json);
    setStatus(`Shared override saved for ${variableFamilyOpen}.`);
  }, [mode, variableConfirmation, variableDraft, variableFamilyOpen]);

  const resetVariableFamily = useCallback(async () => {
    if (!variableFamilyOpen || !variablePolicy) return;
    if (variableConfirmation !== variablePolicy.confirmationKeyword) {
      setVariableError("Enter the OVERRIDE keyword to reset this family.");
      return;
    }
    setVariableDraft("{}");
    setVariableError(null);
    const nextOverrides = { ...(variablePolicy.overrides ?? {}), [variableFamilyOpen]: {} };
    setVariableBusy(true);
    const res = await fetch("/api/admin/tools/one-path-sim/variables", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        overrides: nextOverrides,
        confirmation: variableConfirmation,
      }),
    });
    const json = await res.json().catch(() => null);
    setVariableBusy(false);
    if (!res.ok || !json?.ok) {
      setVariableError(json?.error ?? `Override reset failed (${res.status})`);
      return;
    }
    setVariablePolicy(json);
    setStatus(`Shared override reset for ${variableFamilyOpen}.`);
  }, [variableConfirmation, variableFamilyOpen, variablePolicy]);

  const applyLookupResponse = useCallback(
    (
      json: LookupResponse,
      overrides?: {
        selectedHouseId?: string;
        actualContextHouseId?: string;
        selectedScenarioId?: string;
        travelRanges?: Array<{ startDate: string; endDate: string }>;
      }
    ) => {
      setLookup(json);
      setSelectedHouseId(overrides?.selectedHouseId ?? json.selectedHouse?.id ?? "");
      setActualContextHouseId(overrides?.actualContextHouseId ?? json.selectedHouse?.id ?? "");
      setSelectedScenarioId(overrides?.selectedScenarioId ?? "");
      const sourceTravelRanges = Array.isArray((json.sourceContext?.travelRangesFromDb as any[]))
        ? (json.sourceContext.travelRangesFromDb as Array<{ startDate: string; endDate: string }>)
        : [];
      setTravelRanges(overrides?.travelRanges ?? sourceTravelRanges);
    },
    []
  );

  const requestLookup = useCallback(
    async (args?: {
      email?: string;
      houseId?: string;
      mode?: "INTERVAL" | "GREEN_BUTTON" | "MANUAL_MONTHLY" | "MANUAL_ANNUAL" | "NEW_BUILD";
      actualContextHouseId?: string | null;
      freshSelection?: boolean;
      includeDebugDiagnostics?: boolean;
    }) => {
      const trimmedEmail = (args?.email ?? email).trim();
      if (!trimmedEmail) {
        setError("Enter a user email.");
        return null;
      }
      const freshSelection = args?.freshSelection === true;
      setBusy(true);
      setError(null);
      setStatus("Loading user, houses, and source context...");
      const res = await fetch("/api/admin/tools/one-path-sim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "lookup",
          email: trimmedEmail,
          houseId: args?.houseId ?? (freshSelection ? "" : effectiveHouseId ?? ""),
          mode: args?.mode ?? mode,
          actualContextHouseId: args?.actualContextHouseId ?? (freshSelection ? null : effectiveActualContextHouseId ?? null),
          includeDebugDiagnostics: args?.includeDebugDiagnostics ?? debugDiagnosticsEnabled,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        setBusy(false);
        setStatus(null);
        setError(json?.error ?? `Lookup failed (${res.status})`);
        return null;
      }
      setBusy(false);
      return json as LookupResponse;
    },
    [debugDiagnosticsEnabled, effectiveActualContextHouseId, effectiveHouseId, email, mode]
  );

  const loadLookup = useCallback(
    async (houseIdOverride?: string, options?: { freshSelection?: boolean }) => {
      const freshSelection = options?.freshSelection === true;
      if (freshSelection) {
        setRunResult(null);
        setLastRunKnownScenarioKey("");
        setSelectedKnownScenarioKey("");
        setSelectedHouseId("");
        setActualContextHouseId("");
        setSelectedScenarioId("");
        setTravelRanges([]);
      }
      const json = await requestLookup({ houseId: houseIdOverride, freshSelection });
      if (!json) return;
      applyLookupResponse(
        json,
        freshSelection
          ? undefined
          : {
              actualContextHouseId:
                actualContextHouseId && (json.houses ?? []).some((house: { id: string }) => house.id === actualContextHouseId)
                  ? actualContextHouseId
                  : json.selectedHouse?.id ?? "",
            }
      );
      setStatus("Lookup loaded.");
    },
    [actualContextHouseId, applyLookupResponse, requestLookup]
  );

  const uploadGreenButtonThroughUsage = useCallback(
    async (houseId: string) => {
      if (!greenButtonSelectedFile) {
        setGreenButtonUploadError("Select a Green Button XML or CSV file first.");
        return false;
      }
      const lower = greenButtonSelectedFile.name.toLowerCase();
      if (!lower.endsWith(".xml") && !lower.endsWith(".csv")) {
        setGreenButtonUploadError("Select a Green Button XML or CSV file.");
        return false;
      }

      setGreenButtonUploadBusy(true);
      setGreenButtonUploadError(null);
      setGreenButtonUploadStatus("Uploading replacement Green Button file through the usage pipeline...");
      try {
        const ticketRes = await fetch("/api/green-button/upload-ticket", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ homeId: houseId }),
        });
        const ticketJson = await ticketRes.json().catch(() => null);
        if (!ticketRes.ok || !ticketJson?.ok || !ticketJson?.uploadUrl || !ticketJson?.payload || !ticketJson?.signature) {
          setGreenButtonUploadStatus(null);
          setGreenButtonUploadError(ticketJson?.error ?? `Green Button upload ticket failed (${ticketRes.status})`);
          return false;
        }

        const formData = new FormData();
        formData.append("file", greenButtonSelectedFile);
        formData.append("payload", ticketJson.payload);
        formData.append("signature", ticketJson.signature);
        if (greenButtonUtilityName.trim()) formData.append("utilityName", greenButtonUtilityName.trim());
        if (greenButtonAccountNumber.trim()) formData.append("accountNumber", greenButtonAccountNumber.trim());

        const uploadRes = await fetch(String(ticketJson.uploadUrl), {
          method: "POST",
          body: formData,
          credentials: "omit",
        });
        const uploadJson = await uploadRes.json().catch(() => null);
        if (!uploadRes.ok || !uploadJson?.ok) {
          setGreenButtonUploadStatus(null);
          setGreenButtonUploadError(uploadJson?.error ?? `Green Button upload failed (${uploadRes.status})`);
          return false;
        }

        setGreenButtonSelectedFile(null);
        setGreenButtonUploadInputKey((current) => current + 1);
        setGreenButtonUploadStatus("Replacement Green Button file processed through usage. Loading preset...");
        return true;
      } catch (uploadError) {
        console.error("[OnePathSimAdmin] Green Button usage upload failed", uploadError);
        setGreenButtonUploadStatus(null);
        setGreenButtonUploadError("Green Button upload failed.");
        return false;
      } finally {
        setGreenButtonUploadBusy(false);
      }
    },
    [greenButtonAccountNumber, greenButtonSelectedFile, greenButtonUtilityName]
  );

  const loadKnownScenarioPreset = useCallback(async () => {
    if (!selectedKnownScenario) {
      setError("Choose a known-house scenario preset first.");
      return;
    }
    const resolvedEmail = email.trim() || lookup?.email?.trim() || selectedKnownScenario.sourceUserEmail;
    const normalizedResolvedEmail = resolvedEmail.trim().toLowerCase();
    const normalizedPresetEmail = selectedKnownScenario.sourceUserEmail.trim().toLowerCase();
    const reusingCurrentLookup = lookup?.email?.trim().toLowerCase() === normalizedResolvedEmail;
    const shouldUsePresetSourceContext = normalizedResolvedEmail === normalizedPresetEmail;
    const scenarioForSelection = shouldUsePresetSourceContext
      ? selectedKnownScenario
      : {
          ...selectedKnownScenario,
          sourceHouseId: null,
          actualContextHouseId: null,
          houseSelectionStrategy: "selected_house" as const,
        };
    const lookupArgs = {
      email: resolvedEmail,
      houseId:
        shouldUsePresetSourceContext
          ? selectedKnownScenario.sourceHouseId ?? undefined
          : reusingCurrentLookup
            ? selectedHouseId || undefined
            : undefined,
      mode: selectedKnownScenario.mode,
      actualContextHouseId:
        shouldUsePresetSourceContext
          ? selectedKnownScenario.actualContextHouseId
          : reusingCurrentLookup
            ? actualContextHouseId || selectedHouseId || null
            : null,
      freshSelection: !shouldUsePresetSourceContext && !reusingCurrentLookup,
    } as const;

    setRunResult(null);
    setEmail(resolvedEmail);
    setMode(selectedKnownScenario.mode);
    setWeatherPreference(selectedKnownScenario.weatherPreference);
    setValidationSelectionMode(selectedKnownScenario.validationSelectionMode ?? "stratified_weather_balanced");
    setValidationDayCount(String(selectedKnownScenario.validationDayCount ?? 14));
    setValidationOnlyDateKeysText(selectedKnownScenario.validationOnlyDateKeysLocal.join("\n"));
    setPersistRequested(selectedKnownScenario.persistRequested);
    setRunReason(`known_house:${selectedKnownScenario.scenarioKey}`);
    setGreenButtonUploadError(null);

    let json = await requestLookup({
      ...lookupArgs,
      includeDebugDiagnostics: false,
    });
    if (!json) return;

    let resolvedSelection = resolveKnownHouseScenarioSelection({
      scenario: scenarioForSelection,
      lookup: json,
    });

    if (selectedKnownScenario.scenarioType === "GREEN_BUTTON_TRUTH") {
      const targetActualContextHouseId = resolvedSelection.actualContextHouseId || resolvedSelection.selectedHouseId;
      const hasExistingGreenButtonUsage = hasUsableGreenButtonCoverage(asRecord(json.sourceContext?.greenButtonUpload));
      if (greenButtonSelectedFile) {
        const uploaded = await uploadGreenButtonThroughUsage(targetActualContextHouseId);
        if (!uploaded) return;
        json = await requestLookup({
          ...lookupArgs,
          houseId: resolvedSelection.selectedHouseId || lookupArgs.houseId,
          actualContextHouseId: targetActualContextHouseId,
          freshSelection: false,
          includeDebugDiagnostics: false,
        });
        if (!json) return;
        resolvedSelection = resolveKnownHouseScenarioSelection({
          scenario: scenarioForSelection,
          lookup: json,
        });
      } else if (!hasExistingGreenButtonUsage) {
        setGreenButtonUploadStatus(null);
        setGreenButtonUploadError(
          "This Green Button preset needs an existing Green Button file on the loaded house, or a replacement file selected before loading the preset."
        );
        return;
      }
    }

    applyLookupResponse(json, {
      selectedHouseId: resolvedSelection.selectedHouseId,
      actualContextHouseId: resolvedSelection.actualContextHouseId,
      selectedScenarioId: resolvedSelection.selectedScenarioId,
      travelRanges: selectedKnownScenario.travelRanges.length
        ? selectedKnownScenario.travelRanges
        : Array.isArray((json.sourceContext?.travelRangesFromDb as any[]))
          ? (json.sourceContext.travelRangesFromDb as Array<{ startDate: string; endDate: string }>)
          : [],
    });
    setStatus(`Known-house scenario preset loaded: ${selectedKnownScenario.label}.`);
  }, [
    actualContextHouseId,
    applyLookupResponse,
    email,
    greenButtonSelectedFile,
    lookup?.email,
    requestLookup,
    selectedHouseId,
    selectedKnownScenario,
    uploadGreenButtonThroughUsage,
  ]);

  const runSimulation = useCallback(async () => {
    if (!lookup || !effectiveHouseId) {
      setError("Load a user and select a house first.");
      return;
    }
    const blockedPastRunSummary =
      intervalPastReadinessTrace?.applicableToCurrentPreset !== false &&
      intervalPastReadinessTrace?.status === "blocked_for_interval_past"
        ? String(intervalPastReadinessTrace?.exactBlocker?.failureSummary ?? "").trim()
        : "";
    if (blockedPastRunSummary) {
      setStatus(null);
      setError(`Past Sim blocked: ${blockedPastRunSummary}`);
      return;
    }
    setRunResult(null);
    setBusy(true);
    setError(null);
    setStatus(`Running canonical ${mode} through the One Path-owned ${activePathLabel}...`);
    const res = await fetch("/api/admin/tools/one-path-sim", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "run",
        email: lookup.email,
        houseId: effectiveHouseId,
        scenarioId: selectedScenarioId || null,
        mode,
        actualContextHouseId: effectiveActualContextHouseId || null,
        preferredActualSource: mode === "GREEN_BUTTON" ? "GREEN_BUTTON" : null,
        weatherPreference,
        validationSelectionMode,
        validationDayCount: Number(validationDayCount) || null,
        validationOnlyDateKeysLocal,
        travelRanges,
        persistRequested,
        runReason,
        includeDebugDiagnostics: debugDiagnosticsEnabled,
      }),
    });
    const json = await res.json().catch(() => null);
    setBusy(false);
    if (!res.ok || !json?.ok) {
      if (json?.upstreamUsageTruth) {
        setLookup((current) =>
          current
            ? {
                ...current,
                sourceContext: {
                  ...(current.sourceContext ?? {}),
                  upstreamUsageTruth: json.upstreamUsageTruth,
                },
              }
            : current
        );
      }
      const missingItems = Array.isArray(json?.missingItems)
        ? json.missingItems.map((item: unknown) => String(item ?? "").trim()).filter(Boolean)
        : [];
      const surfacedMessage =
        typeof json?.message === "string" && json.message.trim()
          ? json.message.trim()
          : missingItems.length > 0
            ? missingItems.join("; ")
            : json?.error ?? `Run failed (${res.status})`;
      setStatus(null);
      setError(surfacedMessage);
      return;
    }
    setRunResult(json);
    setLastRunKnownScenarioKey(selectedKnownScenario?.scenarioKey ?? "");
    setStatus("One Path run completed and read back from the canonical artifact/read-model path.");
  }, [
    activePathLabel,
    debugDiagnosticsEnabled,
    effectiveActualContextHouseId,
    effectiveHouseId,
    lookup,
    mode,
    persistRequested,
    runReason,
    selectedKnownScenario,
    selectedScenarioId,
    selectedKnownScenarioIsGreenButton,
    intervalPastReadinessTrace,
    travelRanges,
    validationDayCount,
    validationSelectionMode,
    validationOnlyDateKeysLocal,
    weatherPreference,
  ]);

  const manualTransport = useMemo(
    () => ({
      load: async (houseId: string) => {
        const res = await fetch("/api/admin/tools/one-path-sim", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "load_manual",
            email: lookup?.email ?? email,
            houseId,
            actualContextHouseId: effectiveActualContextHouseId,
            mode,
          }),
        });
        return (await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }))) as any;
      },
      save: async (args: { houseId: string; payload: any }) => {
        const res = await fetch("/api/admin/tools/one-path-sim", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "save_manual",
            email: lookup?.email ?? email,
            houseId: args.houseId,
            payload: args.payload,
          }),
        });
        return (await res.json().catch(() => ({ ok: false, error: `HTTP ${res.status}` }))) as any;
      },
    }),
    [effectiveActualContextHouseId, email, lookup?.email, mode]
  );

  return (
    <div className="min-h-screen bg-slate-100 p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="rounded-2xl bg-brand-white p-6 shadow-lg">
          <div className="text-2xl font-semibold text-brand-navy">One Path Sim Admin</div>
          <p className="mt-2 max-w-4xl text-sm text-slate-600">
            Thin admin harness for the pre-cutover canonical simulation truth console. All four modes adapt into
            One Path-owned simulation paths, persist one artifact family, and render from the One Path read model only.
            Shared/live inputs stay read-only, and shared display reuse stays presentation-only. Older surfaces are not
            rerouted to this harness yet.
          </p>
          <div className="mt-2 text-xs text-slate-500">Older surfaces are not rerouted to this harness yet.</div>
        </div>

        <div className="rounded-2xl bg-white p-6 shadow-lg">
          <div className="mb-4 rounded-xl border border-brand-blue/10 bg-slate-50 p-4">
            <div className="text-sm font-semibold text-brand-navy">Editable Shared Config / Inputs</div>
            <p className="mt-1 text-xs text-slate-600">
              Pre-cutover harness controls only. These feed the One Path selector path and One Path policy store while
              leaving shared/live dependencies read-only. This pass does not cut older surfaces over.
            </p>
          </div>
          <div className="grid gap-4 lg:grid-cols-4">
            <label className="text-sm text-slate-700 lg:col-span-2">
              <div className="font-semibold text-brand-navy">User email lookup</div>
              <input
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="customer@example.com"
              />
            </label>
            <label className="text-sm text-slate-700">
              <div className="font-semibold text-brand-navy">House</div>
              <select
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                value={effectiveHouseId}
                onChange={(event) => setSelectedHouseId(event.target.value)}
              >
                <option value="">Select house</option>
                {(lookup?.houses ?? []).map((house) => (
                  <option key={house.id} value={house.id}>
                    {house.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex items-end">
              <button
                type="button"
                onClick={() => void loadLookup(undefined, { freshSelection: true })}
                disabled={busy}
                className="w-full rounded-lg bg-brand-blue px-4 py-2 text-sm font-semibold text-white hover:bg-brand-navy disabled:opacity-60"
              >
                Lookup and Load
              </button>
            </div>
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-4">
            <label className="text-sm text-slate-700 lg:col-span-2">
              <div className="font-semibold text-brand-navy">Known-house scenario preset</div>
              <div className="mt-1 text-xs text-slate-500">
                Presets apply to the currently entered email and loaded house. Brian stays the default reference context only
                when the active email is {PRIMARY_BRIAN_SANDBOX_CONTEXT.email}.
              </div>
              <select
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                value={selectedKnownScenarioKey}
                onChange={(event) => setSelectedKnownScenarioKey(event.target.value)}
              >
                <option value="">Select sandbox preset</option>
                {orderedKnownScenarios.map((scenario) => (
                  <option key={scenario.scenarioKey} value={scenario.scenarioKey}>
                    {scenario.label} {scenario.active ? "" : "(inactive)"}
                  </option>
                ))}
              </select>
            </label>
            {selectedKnownScenarioIsGreenButton ? (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-4 lg:col-span-4">
                <div className="text-sm font-semibold text-brand-navy">Green Button file for this preset</div>
                <p className="mt-1 text-xs text-slate-600">
                  Green Button presets read usage-backed Green Button intervals only. If this loaded house already has a
                  Green Button file, you can load the preset immediately. Adding a file here is optional and only replaces
                  the house&apos;s current Green Button usage for testing when you click <span className="font-semibold">Load known scenario preset</span>.
                </p>
                <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3 text-xs text-slate-700">
                  {actualContextHasGreenButtonUsage ? (
                    <div>
                      Existing Green Button usage is available for this actual context house.
                      {actualContextGreenButtonUpload?.dateRangeStart && actualContextGreenButtonUpload?.dateRangeEnd ? (
                        <span>
                          {" "}
                          Coverage: {String(actualContextGreenButtonUpload.dateRangeStart).slice(0, 10)} to{" "}
                          {String(actualContextGreenButtonUpload.dateRangeEnd).slice(0, 10)}.
                        </span>
                      ) : null}
                    </div>
                  ) : actualContextHasGreenButtonUploadRecord ? (
                    <div>
                      A Green Button upload record exists for this actual context house, but persisted usage-backed intervals are
                      not currently available. This preset will not run until the shared usage pipeline has produced Green Button
                      truth for this house, or you upload a replacement file here.
                    </div>
                  ) : (
                    <div>No Green Button usage is currently available for this actual context house. Add a file before loading this preset.</div>
                  )}
                </div>
                <div className="mt-4 grid gap-4 lg:grid-cols-4">
                  <label className="text-sm text-slate-700 lg:col-span-2">
                    <div className="font-semibold text-brand-navy">Replacement Green Button file</div>
                    <input
                      key={greenButtonUploadInputKey}
                      type="file"
                      accept=".xml,.csv,text/xml,text/csv,application/xml"
                      className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2"
                      onChange={(event) => setGreenButtonSelectedFile(event.target.files?.[0] ?? null)}
                    />
                    <div className="mt-1 text-xs text-slate-500">
                      Target house: {effectiveActualContextHouseId || "Select an actual context house first"}
                    </div>
                  </label>
                  <label className="text-sm text-slate-700">
                    <div className="font-semibold text-brand-navy">Utility name</div>
                    <input
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                      value={greenButtonUtilityName}
                      onChange={(event) => setGreenButtonUtilityName(event.target.value)}
                      placeholder="Optional"
                    />
                  </label>
                  <label className="text-sm text-slate-700">
                    <div className="font-semibold text-brand-navy">Account number</div>
                    <input
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                      value={greenButtonAccountNumber}
                      onChange={(event) => setGreenButtonAccountNumber(event.target.value)}
                      placeholder="Optional"
                    />
                  </label>
                </div>
                <div className="mt-2 text-xs text-slate-500">
                  {greenButtonSelectedFile
                    ? "The selected file will be uploaded through the usage Green Button pipeline when you load this preset."
                    : actualContextHasGreenButtonUsage
                      ? "No replacement file selected. This preset will use the Green Button usage already on the loaded house."
                      : "Select a replacement Green Button file, then load the preset."}
                </div>
                {greenButtonUploadStatus ? (
                  <div className="mt-3 rounded-lg bg-emerald-100 px-3 py-2 text-sm text-emerald-800">{greenButtonUploadStatus}</div>
                ) : null}
                {greenButtonUploadError ? (
                  <div className="mt-3 rounded-lg bg-rose-100 px-3 py-2 text-sm text-rose-700">{greenButtonUploadError}</div>
                ) : null}
              </div>
            ) : null}
            <div className="flex items-end">
              <button
                type="button"
                onClick={() => void loadKnownScenarioPreset()}
                disabled={busy || greenButtonUploadBusy || !selectedKnownScenarioKey}
                className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-brand-navy disabled:opacity-60"
              >
                {greenButtonUploadBusy ? "Uploading Green Button file..." : "Load known scenario preset"}
              </button>
            </div>
            <label className="text-sm text-slate-700">
              <div className="font-semibold text-brand-navy">Mode</div>
              <select className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2" value={mode} onChange={(event) => setMode(event.target.value as any)}>
                <option value="INTERVAL">INTERVAL</option>
                <option value="GREEN_BUTTON">GREEN_BUTTON</option>
                <option value="MANUAL_MONTHLY">MANUAL_MONTHLY</option>
                <option value="MANUAL_ANNUAL">MANUAL_ANNUAL</option>
                <option value="NEW_BUILD">NEW_BUILD</option>
              </select>
            </label>
            <label className="text-sm text-slate-700">
              <div className="font-semibold text-brand-navy">Scenario</div>
              <select
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                value={selectedScenarioId}
                onChange={(event) => setSelectedScenarioId(event.target.value)}
              >
                <option value="">Baseline</option>
                {(lookup?.scenarios ?? []).map((scenario) => (
                  <option key={scenario.id} value={scenario.id}>
                    {scenario.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm text-slate-700">
              <div className="font-semibold text-brand-navy">Weather preference</div>
              <select
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                value={weatherPreference}
                onChange={(event) => setWeatherPreference(event.target.value as any)}
              >
                <option value="LAST_YEAR_WEATHER">LAST_YEAR_WEATHER</option>
                <option value="LONG_TERM_AVERAGE">LONG_TERM_AVERAGE</option>
                <option value="NONE">NONE</option>
              </select>
            </label>
            <label className="text-sm text-slate-700">
              <div className="font-semibold text-brand-navy">Validation day count</div>
              <input
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                value={validationDayCount}
                onChange={(event) => setValidationDayCount(event.target.value)}
              />
            </label>
            <label className="text-sm text-slate-700">
              <div className="font-semibold text-brand-navy">Actual context house</div>
              <select
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                value={effectiveActualContextHouseId}
                onChange={(event) => setActualContextHouseId(event.target.value)}
              >
                <option value="">Use selected house</option>
                {(lookup?.houses ?? []).map((house) => (
                  <option key={house.id} value={house.id}>
                    {house.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <label className="flex items-center gap-3 rounded-lg border border-slate-200 px-4 py-3 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={debugDiagnosticsEnabled}
                onChange={(event) => setDebugDiagnosticsEnabled(event.target.checked)}
              />
              Debug diagnostics
            </label>
            <label className="text-sm text-slate-700">
              <div className="flex items-center justify-between gap-3">
                <div className="font-semibold text-brand-navy">Validation selection mode</div>
                <button
                  type="button"
                  onClick={() => setValidationInfoOpen(true)}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-brand-navy"
                >
                  Validation mode popup
                </button>
              </div>
              <select
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                value={validationSelectionMode}
                onChange={(event) => setValidationSelectionMode(event.target.value)}
              >
                {VALIDATION_SELECTION_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm text-slate-700">
              <div className="font-semibold text-brand-navy">Run reason</div>
              <input
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                value={runReason}
                onChange={(event) => setRunReason(event.target.value)}
              />
            </label>
            <label className="flex items-center gap-3 rounded-lg border border-slate-200 px-4 py-3 text-sm text-slate-700">
              <input type="checkbox" checked={persistRequested} onChange={(event) => setPersistRequested(event.target.checked)} />
              Persist requested
            </label>
          </div>

          <label className="mt-4 block text-sm text-slate-700">
            <div className="font-semibold text-brand-navy">Manual validation date keys</div>
            <textarea
              className="mt-1 min-h-[88px] w-full rounded-lg border border-slate-300 px-3 py-2"
              value={validationOnlyDateKeysText}
              onChange={(event) => setValidationOnlyDateKeysText(event.target.value)}
              placeholder="YYYY-MM-DD, one per line or comma-separated"
            />
            <div className="mt-2 text-xs text-slate-500">
              One Path manual validation keys sent through the canonical adapter path. Current parsed count: {validationOnlyDateKeysLocal.length}
            </div>
          </label>

          <div className="mt-6 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => setHomeOpen(true)}
              disabled={!effectiveHouseId}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-brand-navy disabled:opacity-50"
            >
              Home Details popup
            </button>
            <button
              type="button"
              onClick={() => setApplianceOpen(true)}
              disabled={!effectiveHouseId}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-brand-navy disabled:opacity-50"
            >
              Appliance Details popup
            </button>
            <button
              type="button"
              onClick={() => setTravelOpen(true)}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-brand-navy"
            >
              Travel/Vacant Dates popup
            </button>
            <button
              type="button"
              onClick={() => setManualOpen(true)}
              disabled={!effectiveHouseId}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-brand-navy disabled:opacity-50"
            >
              Manual Usage Entry popup
            </button>
            <button
              type="button"
              onClick={() => void runSimulation()}
              disabled={busy || !lookup || !effectiveHouseId}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
            >
              {runButtonLabel}
            </button>
          </div>

          <div className="mt-6 rounded-xl border border-brand-blue/10 bg-slate-50 p-4">
            <div className="text-sm font-semibold text-brand-navy">One Path calculation variable popups</div>
            <p className="mt-1 text-xs text-slate-600">
              These edit the One Path module variables directly. A change here affects the One Path-owned{" "}
              {activePathLabel} that read this policy.
            </p>
            <div className="mt-3 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => void copyAllVariablesForAi()}
                disabled={!variablePolicy || !debugDiagnosticsEnabled}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-brand-navy disabled:opacity-60"
              >
                Copy all variables for AI
              </button>
              {Object.entries(variablePolicy?.familyMeta ?? {}).map(([familyKey, meta]) => (
                <button
                  key={familyKey}
                  type="button"
                  onClick={() => openVariableFamily(familyKey)}
                  className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-brand-navy"
                >
                  {meta.title} variables
                </button>
              ))}
            </div>
          </div>

          {status ? <div className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{status}</div> : null}
          {error ? <div className="mt-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{error}</div> : null}
        </div>

        {shouldShowManualStageOneView ? <OnePathManualStageView view={shouldShowManualStageOneView} /> : null}

        {shouldRenderManualBaselinePhaseOneOnly ? (
          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="text-sm font-semibold text-brand-navy">Manual baseline / phase 1</div>
            <p className="mt-2 text-sm text-slate-600">
              Manual baseline stays on the Stage 1 billing-period contract only. Monthly bill totals, statement ranges,
              anchors, and travel ownership remain visible above; daily usage, interval counts, and 15-minute curves do
              not render for this phase.
            </p>
          </div>
        ) : null}

        {shouldRenderPastSimView ? (
          <div className="space-y-4">
            {shouldShowManualStageOneView ? (
              <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <div className="text-sm font-semibold text-brand-navy">Manual Stage 2 simulated result</div>
                <p className="mt-2 text-sm text-slate-600">
                  One Path-owned Past Sim output rendered through the same lean display-ready contract and read-only view
                  used by the finished One Path display surfaces where it remains truthful to manual mode.
                </p>
              </div>
            ) : null}
            <OnePathRunReadOnlyView
              view={(runDisplayView as any) ?? null}
              dataset={runReadOnlyDataset}
              engineInput={asRecord(runResult?.engineInput)}
              readModel={asRecord(runResult?.readModel)}
              runType={displayRunType}
            />
          </div>
        ) : shouldRenderLookupBaselineView ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 shadow-sm">
              <div className="text-sm font-semibold text-brand-navy">Household energy insights</div>
              <p className="mt-2 text-sm text-slate-600">
                Baseline parity audit, Monthly usage, Daily usage, and 15-minute load curve below render from the same
                user usage baseline contract the selected house already uses.
              </p>
            </div>
            <OnePathBaselineReadOnlyView
              houseContract={lookupUserUsageBaselineContract as any}
              view={lookupUserUsageBaselineView as any}
              parityAudit={lookupBaselineParityAudit as any}
              parityReport={lookupBaselineParityReport as any}
            />
          </div>
        ) : null}

        {debugDiagnosticsEnabled ? (
          <div className="grid gap-4 lg:grid-cols-2">
          {!runResult && upstreamUsageTruth ? (
            <div className="lg:col-span-2">
              <TruthSummaryPanel
                title={String(upstreamUsageTruth.title ?? "Upstream Usage Truth")}
                summary={String(upstreamUsageTruth.summary ?? "")}
                currentRun={asRecord(upstreamUsageTruth.currentRun)}
                sharedOwners={Array.isArray(upstreamUsageTruth.sharedOwners) ? (upstreamUsageTruth.sharedOwners as any[]) : []}
              />
            </div>
          ) : null}
          <SectionJson title="Loaded source context" value={lookup?.sourceContext ?? null} />
          <SectionJson
            title="Known scenario prerequisite status"
            value={{
              brianSandboxContext: PRIMARY_BRIAN_SANDBOX_CONTEXT,
              selectedKnownScenarioKey: selectedKnownScenarioKey || null,
              selectedKnownScenarioLabel: selectedKnownScenario?.label ?? null,
              ...knownScenarioPrereqStatus,
            }}
          />
          {intervalPastReadinessTrace?.applicableToCurrentPreset !== false ? (
            <SectionJson
              title="Interval Past blocker trace"
              value={intervalPastReadinessTrace}
            />
          ) : null}
          <SectionJson
            title="Runtime / env parity trace"
            value={runtimeEnvParityTrace}
          />
          <SectionJson
            title="Harness controls snapshot"
            value={{
              email: lookup?.email ?? email,
              selectedHouseId: effectiveHouseId || null,
              actualContextHouseId: effectiveActualContextHouseId || null,
              selectedScenarioId: selectedScenarioId || null,
              selectedKnownScenarioKey: selectedKnownScenarioKey || null,
              mode,
              weatherPreference,
              validationSelectionMode,
              validationDayCount,
              validationOnlyDateKeysLocal,
              persistRequested,
              runReason,
              travelRanges,
            }}
          />
          <SectionJson title="Shared simulation variable overrides" value={variablePolicy?.overrides ?? null} />
          <SectionJson title="Shared simulation variable defaults" value={variablePolicy?.defaults ?? null} />
          <SectionJson title={`Shared simulation variables for ${mode}`} value={variablePolicy?.effectiveByMode?.[mode] ?? null} />
          <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm lg:col-span-2">
            <div className="text-sm font-semibold text-brand-navy">One Path Hard Audit</div>
            <p className="mt-2 text-sm text-slate-600">{ownershipAudit.overview}</p>
          </div>
          <SectionJson title="One Path surface audit matrix" value={ownershipAudit.pageSurfaceAuditMatrix} />
          <SectionJson title="AI copy payload inventory" value={ownershipAudit.aiCopyPayloadInventory} />
          <SectionJson title="One Path wiring flow" value={ownershipAudit.sharedWiringFlow} />
          <SectionJson title="External surface classification" value={ownershipAudit.externalSurfaceClassification} />
          <SectionJson title="Drift-risk watchlist" value={ownershipAudit.driftRiskWatchlist} />
          </div>
        ) : null}

        {debugDiagnosticsEnabled && runResult ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <div className="text-sm font-semibold text-brand-navy">Read-Only One Path Run Truth</div>
              <p className="mt-2 text-sm text-slate-600">
                These panels come from shared readback owners only. They make the full producer chain, derived inputs,
                shared owners, and final output contract auditable without cutting older surfaces over yet.
              </p>
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <TruthSummaryPanel
                title="Pre-Cutover Harness Status"
                summary={String(runResult.readModel?.sourceOfTruthSummary?.preCutoverHarness?.summary ?? "")}
                currentRun={asRecord(runResult.readModel?.sourceOfTruthSummary?.preCutoverHarness?.currentRun)}
                sharedOwners={
                  Array.isArray(runResult.readModel?.sourceOfTruthSummary?.preCutoverHarness?.sharedOwners)
                    ? runResult.readModel.sourceOfTruthSummary.preCutoverHarness.sharedOwners
                    : []
                }
              />
              <TruthSummaryPanel
                title="Stage Boundary Map"
                summary={String(runResult.readModel?.sourceOfTruthSummary?.stageBoundaryMap?.summary ?? "")}
                currentRun={asRecord(runResult.readModel?.sourceOfTruthSummary?.stageBoundaryMap?.currentRun)}
                sharedOwners={
                  Array.isArray(runResult.readModel?.sourceOfTruthSummary?.stageBoundaryMap?.sharedOwners)
                    ? runResult.readModel.sourceOfTruthSummary.stageBoundaryMap.sharedOwners
                    : []
                }
              />
              <TruthSummaryPanel
                title={String(upstreamUsageTruth?.title ?? "Upstream Usage Truth")}
                summary={String(upstreamUsageTruth?.summary ?? "")}
                currentRun={asRecord(upstreamUsageTruth?.currentRun)}
                sharedOwners={Array.isArray(upstreamUsageTruth?.sharedOwners) ? (upstreamUsageTruth?.sharedOwners as any[]) : []}
              />
              <TruthSummaryPanel
                title="Read-Only Inputs and Resolved Controls Used By Run"
                summary={String(runResult.readModel?.sourceOfTruthSummary?.sharedDerivedInputs?.summary ?? "")}
                currentRun={asRecord(runResult.readModel?.sourceOfTruthSummary?.sharedDerivedInputs?.currentRun)}
                sharedOwners={
                  Array.isArray(runResult.readModel?.sourceOfTruthSummary?.sharedDerivedInputs?.sharedOwners)
                    ? runResult.readModel.sourceOfTruthSummary.sharedDerivedInputs.sharedOwners
                    : []
                }
              />
              <TruthSummaryPanel
                title="Source Truth / Compare Truth Identity"
                summary={String(runResult.readModel?.sourceOfTruthSummary?.sourceTruthIdentity?.summary ?? "")}
                currentRun={asRecord(runResult.readModel?.sourceOfTruthSummary?.sourceTruthIdentity?.currentRun)}
                sharedOwners={
                  Array.isArray(runResult.readModel?.sourceOfTruthSummary?.sourceTruthIdentity?.sharedOwners)
                    ? runResult.readModel.sourceOfTruthSummary.sourceTruthIdentity.sharedOwners
                    : []
                }
              />
              <TruthSummaryPanel
                title="Constraint / Rebalance Logic"
                summary={String(runResult.readModel?.sourceOfTruthSummary?.constraintRebalance?.summary ?? "")}
                currentRun={asRecord(runResult.readModel?.sourceOfTruthSummary?.constraintRebalance?.currentRun)}
                sharedOwners={
                  Array.isArray(runResult.readModel?.sourceOfTruthSummary?.constraintRebalance?.sharedOwners)
                    ? runResult.readModel.sourceOfTruthSummary.constraintRebalance.sharedOwners
                    : []
                }
              />
              <TruthSummaryPanel
                title="Donor / Fallback / Exclusion Logic"
                summary={String(runResult.readModel?.sourceOfTruthSummary?.donorFallbackExclusions?.summary ?? "")}
                currentRun={asRecord(runResult.readModel?.sourceOfTruthSummary?.donorFallbackExclusions?.currentRun)}
                sharedOwners={
                  Array.isArray(runResult.readModel?.sourceOfTruthSummary?.donorFallbackExclusions?.sharedOwners)
                    ? runResult.readModel.sourceOfTruthSummary.donorFallbackExclusions.sharedOwners
                    : []
                }
              />
              <TruthSummaryPanel
                title="Intraday Reconstruction Logic"
                summary={String(runResult.readModel?.sourceOfTruthSummary?.intradayReconstruction?.summary ?? "")}
                currentRun={asRecord(runResult.readModel?.sourceOfTruthSummary?.intradayReconstruction?.currentRun)}
                sharedOwners={
                  Array.isArray(runResult.readModel?.sourceOfTruthSummary?.intradayReconstruction?.sharedOwners)
                    ? runResult.readModel.sourceOfTruthSummary.intradayReconstruction.sharedOwners
                    : []
                }
              />
              <TruthSummaryPanel
                title="Chart / Window / Display Logic"
                summary={String(runResult.readModel?.sourceOfTruthSummary?.chartWindowDisplay?.summary ?? "")}
                currentRun={asRecord(runResult.readModel?.sourceOfTruthSummary?.chartWindowDisplay?.currentRun)}
                sharedOwners={
                  Array.isArray(runResult.readModel?.sourceOfTruthSummary?.chartWindowDisplay?.sharedOwners)
                    ? runResult.readModel.sourceOfTruthSummary.chartWindowDisplay.sharedOwners
                    : []
                }
              />
              <TruthSummaryPanel
                title="Manual Statement / Annual Logic"
                summary={String(runResult.readModel?.sourceOfTruthSummary?.manualStatementAnnual?.summary ?? "")}
                currentRun={asRecord(runResult.readModel?.sourceOfTruthSummary?.manualStatementAnnual?.currentRun)}
                sharedOwners={
                  Array.isArray(runResult.readModel?.sourceOfTruthSummary?.manualStatementAnnual?.sharedOwners)
                    ? runResult.readModel.sourceOfTruthSummary.manualStatementAnnual.sharedOwners
                    : []
                }
              />
              <TruthSummaryPanel
                title="Annual One Path Truth"
                summary={String(runResult.readModel?.sourceOfTruthSummary?.annualModeTruth?.summary ?? "")}
                currentRun={asRecord(runResult.readModel?.sourceOfTruthSummary?.annualModeTruth?.currentRun)}
                sharedOwners={
                  Array.isArray(runResult.readModel?.sourceOfTruthSummary?.annualModeTruth?.sharedOwners)
                    ? runResult.readModel.sourceOfTruthSummary.annualModeTruth.sharedOwners
                    : []
                }
              />
              <TruthSummaryPanel
                title="New Build One Path Truth"
                summary={String(runResult.readModel?.sourceOfTruthSummary?.newBuildModeTruth?.summary ?? "")}
                currentRun={asRecord(runResult.readModel?.sourceOfTruthSummary?.newBuildModeTruth?.currentRun)}
                sharedOwners={
                  Array.isArray(runResult.readModel?.sourceOfTruthSummary?.newBuildModeTruth?.sharedOwners)
                    ? runResult.readModel.sourceOfTruthSummary.newBuildModeTruth.sharedOwners
                    : []
                }
              />
              <TruthSummaryPanel
                title="Final One Path Output Contract"
                summary={String(runResult.readModel?.sourceOfTruthSummary?.finalSharedOutputContract?.summary ?? "")}
                currentRun={asRecord(runResult.readModel?.sourceOfTruthSummary?.finalSharedOutputContract?.currentRun)}
                sharedOwners={
                  Array.isArray(runResult.readModel?.sourceOfTruthSummary?.finalSharedOutputContract?.sharedOwners)
                    ? runResult.readModel.sourceOfTruthSummary.finalSharedOutputContract.sharedOwners
                    : []
                }
              />
              <TruthSummaryPanel
                title="One Path source-of-truth summary"
                summary={String(runResult.readModel?.sourceOfTruthSummary?.controlSurface?.summary ?? "")}
                currentRun={asRecord(runResult.readModel?.sourceOfTruthSummary?.controlSurface?.currentRun)}
              />
              <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <div className="text-sm font-semibold text-brand-navy">Effective Variables Used By Last Run</div>
                <p className="mt-2 text-xs text-slate-600">
                  Value sources are resolved in the One Path canonical read model only. Labels include default, mode
                  override, and explicit admin override.
                </p>
              </div>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <div className="text-sm font-semibold text-brand-navy">Deep inspection JSON</div>
              <p className="mt-2 text-xs text-slate-600">
                Raw JSON is still available for deep inspection, but the structured truth panels above are the primary
                read-only truth console surfaces.
              </p>
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <SectionJson
                title="Known scenario / expectations"
                value={
                  lastRunKnownScenario ?? selectedKnownScenario
                    ? {
                        ...(lastRunKnownScenario ?? selectedKnownScenario),
                        selectedScenarioId: selectedScenarioId || null,
                      }
                    : null
                }
              />
              <SectionJson title="Tuning cycle summary" value={tuningCycleSummary} />
              <SectionJson title="Sandbox run status" value={sandboxHarnessSummary.runStatus} />
              <SectionJson title="Monthly truth / compare snapshot" value={sandboxHarnessSummary.monthlyTruthCompare} />
              <SectionJson title="Weather / daily-shape snapshot" value={sandboxHarnessSummary.weatherAndShape} />
              <SectionJson title="Interval / compare visibility snapshot" value={sandboxHarnessSummary.compareVisibility} />
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <SectionJson title="Canonical engine input" value={runResult.engineInput} />
              <SectionJson title="Canonical artifact" value={runResult.artifact} />
              <SectionJson title="Canonical read model" value={runResult.readModel} />
              <SectionJson title="Read model dataset summary" value={runResult.readModel?.dataset?.summary ?? null} />
              <SectionJson title="Effective Variables Used By Last Run" value={runResult.readModel?.effectiveSimulationVariablesUsed ?? null} />
            </div>
          </div>
        ) : null}
      </div>

      <Modal open={homeOpen} title="Home Details popup/editor" onClose={() => setHomeOpen(false)}>
        {effectiveHouseId ? (
          <HomeDetailsClient
            houseId={effectiveHouseId}
            loadUrl="/api/admin/tools/one-path-sim/home-profile"
            saveUrl="/api/admin/tools/one-path-sim/home-profile"
            prefillUrl="/api/admin/tools/one-path-sim/home-profile/prefill"
            awardEntries={false}
            onSaved={async () => {
              await loadLookup(effectiveHouseId);
            }}
          />
        ) : null}
      </Modal>

      <Modal open={applianceOpen} title="Appliance Details popup/editor" onClose={() => setApplianceOpen(false)}>
        {effectiveHouseId ? (
          <AppliancesClient
            houseId={effectiveHouseId}
            loadUrl="/api/admin/tools/one-path-sim/appliances"
            saveUrl="/api/admin/tools/one-path-sim/appliances"
            awardEntries={false}
            onSaved={async () => {
              await loadLookup(effectiveHouseId);
            }}
          />
        ) : null}
      </Modal>

      <Modal open={manualOpen} title="Manual Usage Entry popup/editor" onClose={() => setManualOpen(false)}>
        {effectiveHouseId ? (
          <ManualUsageEntry
            houseId={effectiveHouseId}
            transport={manualTransport}
            showMonthlyDateSourceControls
            onSaved={async () => {
              await loadLookup(effectiveHouseId);
            }}
          />
        ) : null}
      </Modal>

      <Modal open={travelOpen} title="Travel/Vacant Dates popup/editor" onClose={() => setTravelOpen(false)}>
        <div className="space-y-3">
          {travelRanges.map((range, index) => (
            <div key={`${index}:${range.startDate}:${range.endDate}`} className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
              <input
                className="rounded-lg border border-slate-300 px-3 py-2"
                value={range.startDate}
                onChange={(event) =>
                  setTravelRanges((current) => current.map((row, rowIndex) => (rowIndex === index ? { ...row, startDate: event.target.value } : row)))
                }
                placeholder="YYYY-MM-DD"
              />
              <input
                className="rounded-lg border border-slate-300 px-3 py-2"
                value={range.endDate}
                onChange={(event) =>
                  setTravelRanges((current) => current.map((row, rowIndex) => (rowIndex === index ? { ...row, endDate: event.target.value } : row)))
                }
                placeholder="YYYY-MM-DD"
              />
              <button
                type="button"
                onClick={() => setTravelRanges((current) => current.filter((_, rowIndex) => rowIndex !== index))}
                className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-brand-navy"
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setTravelRanges((current) => [...current, { startDate: "", endDate: "" }])}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold text-brand-navy"
          >
            Add travel range
          </button>
        </div>
      </Modal>

      <Modal
        open={validationInfoOpen}
        title="Validation selection mode popup"
        onClose={() => setValidationInfoOpen(false)}
      >
        <div className="space-y-4">
          <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
            These are the shared validation selection modes used by the One Path selector path. This popup explains how each
            option works and gives the admin a thin control surface for mode and day-count adjustments only.
          </div>
          <SectionJson
            title="Current admin adjustments"
            value={{
              selectedMode: validationSelectionMode,
              validationDayCount,
              validationOnlyDateKeysLocal,
              adminDefaultValidationSelectionMode: "stratified_weather_balanced",
            }}
          />
          <label className="block text-sm text-slate-700">
            <div className="font-semibold text-brand-navy">Adjust validation day count</div>
            <input
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
              value={validationDayCount}
              onChange={(event) => setValidationDayCount(event.target.value)}
            />
          </label>
          <label className="block text-sm text-slate-700">
            <div className="font-semibold text-brand-navy">Manual validation date keys</div>
            <textarea
              className="mt-1 min-h-[88px] w-full rounded-lg border border-slate-300 px-3 py-2"
              value={validationOnlyDateKeysText}
              onChange={(event) => setValidationOnlyDateKeysText(event.target.value)}
              placeholder="YYYY-MM-DD, one per line or comma-separated"
            />
          </label>
          <div className="grid gap-3">
            {VALIDATION_SELECTION_MODE_DETAILS.map((detail) => (
              <div key={detail.value} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-brand-navy">{detail.title}</div>
                    <div className="mt-1 text-xs text-slate-600">{detail.howItWorks}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setValidationSelectionMode(detail.value);
                      setValidationInfoOpen(false);
                    }}
                    className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-brand-navy"
                  >
                    Use this mode
                  </button>
                </div>
                <div className="mt-3 rounded-lg bg-slate-50 p-3 text-xs text-slate-700">{detail.adminAdjustments}</div>
              </div>
            ))}
          </div>
        </div>
      </Modal>

      <Modal
        open={Boolean(variableFamilyOpen)}
        title={
          variableFamilyOpen
            ? `${variablePolicy?.familyMeta?.[variableFamilyOpen]?.title ?? variableFamilyOpen} variables`
            : "Shared variables"
        }
        onClose={() => {
          setVariableFamilyOpen(null);
          setVariableConfirmation("");
          setVariableError(null);
        }}
      >
        {variableFamilyOpen ? (
          <div className="space-y-4">
            <div className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
              {variablePolicy?.familyMeta?.[variableFamilyOpen]?.description ?? "Shared module variables."}
            </div>
            <div className="rounded-xl border border-brand-blue/10 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <div className="text-base font-semibold text-brand-navy">{activeVariableFamilyView?.title ?? variableFamilyOpen}</div>
                  <div className="mt-1 text-sm text-slate-600">{activeVariableFamilyView?.adminSummary}</div>
                  <div className="mt-3 grid gap-2 text-xs text-slate-700 md:grid-cols-2">
                    <div>
                      <span className="font-semibold text-brand-navy">Viewing mode:</span> {activeVariableFamilyView?.modeLabel ?? mode}
                    </div>
                    <div>
                      <span className="font-semibold text-brand-navy">Admin override bucket:</span>{" "}
                      {activeVariableFamilyView?.modeOverrideBucketLabel ?? modeToOverrideBucketKey(mode)}
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void copyCurrentFamilyForAi()}
                  disabled={!debugDiagnosticsEnabled}
                  className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-brand-navy"
                >
                  Copy this family for AI
                </button>
              </div>
            </div>
            <div className="grid gap-4">
              {activeVariableFamilyView?.fields.map((field) => (
                <div key={field.key} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="max-w-3xl">
                      <div className="text-sm font-semibold text-brand-navy">{field.label}</div>
                      <div className="mt-1 text-sm text-slate-700">{field.description}</div>
                      <div className="mt-2 text-xs text-slate-600">{field.tuningHint}</div>
                    </div>
                    <div className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700">{field.valueSource}</div>
                  </div>
                  <div className="mt-4 grid gap-3 md:grid-cols-3">
                    <div className="rounded-lg bg-slate-50 p-3">
                      <div className="text-xs font-semibold text-brand-navy">Resolved value used by sim</div>
                      <div className="mt-1 text-sm text-slate-800">{field.resolvedValue ?? "not set"}</div>
                    </div>
                    <div className="rounded-lg bg-slate-50 p-3">
                      <div className="text-xs font-semibold text-brand-navy">Current admin override</div>
                      <div className="mt-1 text-sm text-slate-800">
                        {field.currentModeOverrideValue == null ? "none for this mode" : field.currentModeOverrideValue}
                      </div>
                    </div>
                    <label className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
                      <div className="text-xs font-semibold text-brand-navy">Adjust this value</div>
                      <input
                        className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2"
                        value={
                          typeof variableDraftModeOverrides[field.key] === "number"
                            ? String(variableDraftModeOverrides[field.key])
                            : ""
                        }
                        onChange={(event) => updateVariableDraftField(field.key, event.target.value)}
                        placeholder="Leave blank for no explicit admin override"
                      />
                    </label>
                  </div>
                </div>
              ))}
            </div>
            <details className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <summary className="cursor-pointer text-sm font-semibold text-brand-navy">Raw code / JSON editor</summary>
              <div className="mt-4 space-y-4">
                <SectionJson title="Shared defaults" value={variablePolicy?.defaults?.[variableFamilyOpen] ?? null} />
                <SectionJson title={`Resolved values for ${mode}`} value={variablePolicy?.effectiveByMode?.[mode]?.[variableFamilyOpen] ?? null} />
                <SectionJson title="Current overrides" value={variablePolicy?.overrides?.[variableFamilyOpen] ?? {}} />
                <label className="block text-sm text-slate-700">
                  <div className="font-semibold text-brand-navy">Editable override JSON</div>
                  <textarea
                    className="mt-1 min-h-[220px] w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs"
                    value={variableDraft}
                    onChange={(event) => setVariableDraft(event.target.value)}
                  />
                </label>
              </div>
            </details>
            <label className="block text-sm text-slate-700">
              <div className="font-semibold text-brand-navy">
                OVERRIDE field
              </div>
              <input
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2"
                value={variableConfirmation}
                onChange={(event) => setVariableConfirmation(event.target.value)}
                placeholder={variablePolicy?.confirmationKeyword ?? "OVERRIDE"}
              />
            </label>
            {variableError ? <div className="rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{variableError}</div> : null}
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => void saveVariableFamily()}
                disabled={variableBusy || variableConfirmation !== (variablePolicy?.confirmationKeyword ?? "OVERRIDE")}
                className="rounded-lg bg-brand-blue px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                Save shared override
              </button>
              <button
                type="button"
                onClick={() => void resetVariableFamily()}
                disabled={variableBusy || variableConfirmation !== (variablePolicy?.confirmationKeyword ?? "OVERRIDE")}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-brand-navy disabled:opacity-60"
              >
                Reset this family
              </button>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
