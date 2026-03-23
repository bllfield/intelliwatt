"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { UsageChartsPanel } from "@/components/usage/UsageChartsPanel";

type HouseOption = { id: string; label: string };
type RangeRow = { startDate: string; endDate: string };
type Usage365Payload = {
  source: string;
  timezone: string;
  coverageStart: string | null;
  coverageEnd: string | null;
  intervalCount: number;
  daily: Array<{ date: string; kwh: number; source?: "ACTUAL" | "SIMULATED" }>;
  monthly: Array<{ month: string; kwh: number }>;
  weekdayKwh: number;
  weekendKwh: number;
  fifteenCurve: Array<{ hhmm: string; avgKw: number }>;
  stitchedMonth?: {
    mode: "PRIOR_YEAR_TAIL";
    yearMonth: string;
    haveDaysThrough: number;
    missingDaysFrom: number;
    missingDaysTo: number;
    borrowedFromYearMonth: string;
    completenessRule: string;
  } | null;
};

type ScoredDayWeatherRow = {
  localDate: string;
  avgTempF: number | null;
  minTempF: number | null;
  maxTempF: number | null;
  hdd65: number | null;
  cdd65: number | null;
  weatherBasisUsed: string | null;
  weatherKindUsed: string | null;
  weatherSourceUsed: string | null;
  weatherProviderName: string | null;
  weatherFallbackReason: string | null;
};

type ScoredDayWeatherTruth = {
  availability: string;
  reasonCode: string;
  explanation: string;
  source: string;
  scoredDateCount: number;
  weatherRowCount: number;
  missingDateCount: number;
  missingDateSample: string[];
};

type TravelVacantParityRow = {
  localDate: string;
  artifactCanonicalSimDayKwh: number | null;
  freshSharedDayCalcKwh: number | null;
  parityMatch: boolean | null;
  artifactReferenceAvailability: "available" | "missing_canonical_artifact_day_total";
  freshCompareAvailability: "available" | "missing_fresh_shared_compare_output";
  parityReasonCode: string;
};

type TravelVacantParityTruth = {
  availability: string;
  reasonCode: string;
  explanation: string;
  source: string;
  comparisonBasis: string;
  requestedDateCount: number;
  validatedDateCount: number;
  mismatchCount: number;
  missingArtifactReferenceCount: number;
  missingFreshCompareCount: number;
  requestedDateSample: string[];
  exactProofRequired: boolean;
  exactProofSatisfied: boolean;
};

type ScoredDayTruthRow = {
  localDate: string;
  actualDayKwh: number;
  freshCompareSimDayKwh: number;
  displayedPastStyleSimDayKwh: number | null;
  actualVsFreshErrorKwh: number;
  displayVsFreshParityMatch: boolean | null;
  parityAvailability?: string | null;
  parityReasonCode?: string | null;
  dayType: "weekday" | "weekend";
  weatherBasis: string | null;
  weatherSourceUsed?: string | null;
  weatherFallbackReason?: string | null;
  avgTempF: number | null;
  minTempF: number | null;
  maxTempF: number | null;
  hdd65: number | null;
  cdd65: number | null;
  fallbackLevel: string | null;
  selectedDayTotalSource: string | null;
  selectedShapeVariant: string | null;
  selectedReferenceMatchTier: string | null;
  selectedMatchSampleCount: number | null;
  reasonCode: string | null;
};

type ApiResponse =
  | {
      ok: true;
      house: HouseOption;
      houses: HouseOption[];
      homeProfile: any;
      applianceProfile: any;
      modelAssumptions: any;
      testIntervalsCount: number;
      metrics: any;
      primaryPercentMetric: number | null;
      byMonth: any[];
      byHour: any[];
      byDayType: any[];
      worstDays: any[];
      diagnostics: any;
      pasteSummary: string;
      responseMode?: "heavy_only_compact";
      fullReportText?: string;
      fullReportJson?: { scenario?: { testRangesInput?: RangeRow[]; testSelectionMode?: string } } | null;
      message?: string;
      travelRangesFromDb?: Array<{ startDate: string; endDate: string }>;
      testSelectionMode?: "manual_ranges" | "random_days";
      testDaysRequested?: number;
      testDaysSelected?: number;
      seedUsed?: string | null;
      testRangesUsed?: RangeRow[];
      testMode?: string;
      candidateDaysAfterModeFilterCount?: number | null;
      minDayCoveragePct?: number;
      candidateWindowStartUtc?: string | null;
      candidateWindowEndUtc?: string | null;
      trainingMaxDays?: number;
      trainingGapDays?: number;
      excludedFromTest_travelCount?: number;
      excludedFromTraining_travelCount?: number;
      excludedFromTraining_testCount?: number;
      trainingCoverage?: { expected: number; found: number | null; pct: number | null };
      usage365?: Usage365Payload;
      truthEnvelope?: any;
      hasScoreableIntervals?: boolean;
      compareCoreMode?: string;
      compareCoreStepTimings?: Record<string, number>;
      selectedFreshIntervalCount?: number;
      selectedActualIntervalCount?: number;
      artifactReferenceDayCount?: number;
      scoredDayWeatherRows?: ScoredDayWeatherRow[];
      scoredDayWeatherTruth?: ScoredDayWeatherTruth;
      travelVacantParityRows?: TravelVacantParityRow[];
      travelVacantParityTruth?: TravelVacantParityTruth;
      heavyStartedAt?: string;
      heavyEndedAt?: string;
      heavyElapsedMs?: number;
      heavyLastCompletedStep?: string | null;
      heavyStepsMs?: Record<string, number>;
      heavyFailedStep?: string;
      heavyTruth?: any;
      compareTruth?: {
        compareFreshModeUsed?: string | null;
        compareFreshModeLabel?: string | null;
        compareCalculationScope?: string | null;
        compareCalculationScopeLabel?: string | null;
        compareSharedCalcPath?: string | null;
        compareSimSource?: string | null;
        displaySimSource?: string | null;
        weatherBasisUsed?: string | null;
        travelVacantParitySource?: string | null;
        travelVacantParityComparisonBasis?: string | null;
        travelVacantParityAvailability?: string | null;
        travelVacantParityExactProofSatisfied?: boolean | null;
        architectureNote?: string | null;
      } | null;
      displaySimulated?: {
        source: string | null;
        coverageStart: string | null;
        coverageEnd: string | null;
        daily: Array<{ date: string; simKwh: number; source?: "ACTUAL" | "SIMULATED" }>;
        monthly: Array<{ month: string; kwh: number }>;
        stitchedMonth?: Usage365Payload["stitchedMonth"];
      };
      scoredDayTruthRows?: ScoredDayTruthRow[];
      missAttributionSummary?: any;
      accuracyTuningBreakdowns?: any;
    }
  | {
      ok: false;
      error: string;
      message?: string;
      explanation?: string;
      missingData?: string[];
      reasonCode?: string;
      overlapCount?: number;
      overlapSample?: string[];
    };

const DEFAULT_RANGE: RangeRow = { startDate: "", endDate: "" };

function formatDate(d: string) {
  return d ? new Date(d + "T12:00:00Z").toLocaleDateString("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }) : "";
}

function badgeClass(kind: "ok" | "warn" | "error" | "neutral"): string {
  if (kind === "ok") return "px-2 py-0.5 rounded text-xs font-semibold bg-emerald-100 text-emerald-800";
  if (kind === "warn") return "px-2 py-0.5 rounded text-xs font-semibold bg-amber-100 text-amber-800";
  if (kind === "error") return "px-2 py-0.5 rounded text-xs font-semibold bg-rose-100 text-rose-800";
  return "px-2 py-0.5 rounded text-xs font-semibold bg-brand-navy/10 text-brand-navy";
}

export function extractCompareCoreScoredDayWeather(result: ApiResponse | null): {
  rows: ScoredDayWeatherRow[];
  truth: ScoredDayWeatherTruth | null;
} {
  const truthEnvelope = result && result.ok ? ((result as any).truthEnvelope ?? null) : null;
  const rows =
    result && result.ok
      ? (Array.isArray((result as any)?.scoredDayWeatherRows)
          ? ((result as any).scoredDayWeatherRows as ScoredDayWeatherRow[])
          : Array.isArray((truthEnvelope as any)?.scoredDayWeatherRows)
            ? ((truthEnvelope as any).scoredDayWeatherRows as ScoredDayWeatherRow[])
            : [])
      : [];
  const truth =
    result && result.ok
      ? (((result as any)?.scoredDayWeatherTruth ?? (truthEnvelope as any)?.scoredDayWeatherTruth ?? null) as ScoredDayWeatherTruth | null)
      : null;
  return { rows, truth };
}

export function mergeScoredDayTruthRowsWithCompareCoreWeather(
  rows: ScoredDayTruthRow[],
  weatherRows: ScoredDayWeatherRow[],
  fallbackWeatherBasis: string | null
): ScoredDayTruthRow[] {
  const weatherByDate = new Map<string, ScoredDayWeatherRow>();
  for (const row of weatherRows) {
    const dk = String(row.localDate ?? "").slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(dk) && !weatherByDate.has(dk)) weatherByDate.set(dk, row);
  }
  return rows.map((row) => {
    const weather = weatherByDate.get(String(row.localDate ?? "").slice(0, 10));
    if (!weather) return row;
    return {
      ...row,
      weatherBasis: row.weatherBasis ?? weather.weatherBasisUsed ?? fallbackWeatherBasis ?? null,
      weatherSourceUsed: row.weatherSourceUsed ?? weather.weatherSourceUsed ?? null,
      weatherFallbackReason: row.weatherFallbackReason ?? weather.weatherFallbackReason ?? null,
      avgTempF: row.avgTempF ?? weather.avgTempF ?? null,
      minTempF: row.minTempF ?? weather.minTempF ?? null,
      maxTempF: row.maxTempF ?? weather.maxTempF ?? null,
      hdd65: row.hdd65 ?? weather.hdd65 ?? null,
      cdd65: row.cdd65 ?? weather.cdd65 ?? null,
    };
  });
}

const VALID_RANDOM_TEST_MODES = ["fixed", "random", "winter", "summer", "shoulder", "extreme_weather"] as const;
type RandomTestMode = (typeof VALID_RANDOM_TEST_MODES)[number];

type WeatherKindOption = "ACTUAL_LAST_YEAR" | "NORMAL_AVG" | "open_meteo";
type ChartMode = "usage365" | "gapfill";
// Heavy compare can legitimately spend up to the route's shared-compare timeout
// plus the report-builder timeout. Keep the client budget slightly above that
// so route-side failure classification still reaches the UI, without waiting ~15 min.
const GAPFILL_COMPARE_HEAVY_TIMEOUT_MS = 195_000;
// Keep client timeout above route compare-core timeouts so route step-level
// timeout classification can return to UI before the browser aborts.
const GAPFILL_COMPARE_CORE_TIMEOUT_MS = 150_000;
const GAPFILL_REBUILD_TIMEOUT_MS = 150_000;
const GAPFILL_LOOKUP_TIMEOUT_MS = 120_000;
const GAPFILL_USAGE365_TIMEOUT_MS = 180_000;
type OrchestratorPhaseKey =
  | "lookup_inputs"
  | "usage365_load"
  | "artifact_ensure"
  | "compare_core"
  | "compare_heavy";
type OrchestratorPhaseStatus = "pending" | "active" | "done" | "error" | "skipped";
type OrchestratorPhase = {
  key: OrchestratorPhaseKey;
  label: string;
  status: OrchestratorPhaseStatus;
  startedAt: string | null;
  endedAt: string | null;
  elapsedMs: number | null;
  errorCode: string | null;
  errorMessage: string | null;
};

export type NormalizedUiError = {
  name: string;
  message: string;
  isAbortError: boolean;
};
const ORCHESTRATOR_PHASE_BLUEPRINT: Array<{ key: OrchestratorPhaseKey; label: string }> = [
  { key: "lookup_inputs", label: "Lookup & Inputs" },
  { key: "usage365_load", label: "Usage 365 Load" },
  { key: "artifact_ensure", label: "Artifact Ensure" },
  { key: "compare_core", label: "Compare Core" },
  { key: "compare_heavy", label: "Compare Heavy Report" },
];

function normalizeDailyRowsToWindow<T extends { date: string }>(
  rows: T[],
  coverageStart: string | null,
  coverageEnd: string | null,
  maxDays = 365
): T[] {
  const start = typeof coverageStart === "string" && /^\d{4}-\d{2}-\d{2}$/.test(coverageStart) ? coverageStart : null;
  const end = typeof coverageEnd === "string" && /^\d{4}-\d{2}-\d{2}$/.test(coverageEnd) ? coverageEnd : null;
  const seen = new Set<string>();
  const filtered = rows
    .filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(String(row?.date ?? "")))
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .filter((row) => {
      const d = String(row.date);
      if (seen.has(d)) return false;
      seen.add(d);
      if (start && d < start) return false;
      if (end && d > end) return false;
      return true;
    });
  const limit = Math.max(1, Math.trunc(Number(maxDays) || 365));
  return filtered.length > limit ? filtered.slice(filtered.length - limit) : filtered;
}

export function normalizeUnknownUiError(
  value: unknown,
  fallbackMessage = "Unexpected error"
): NormalizedUiError {
  const fromObject = value != null && typeof value === "object" ? (value as Record<string, unknown>) : null;
  const nameRaw = fromObject && typeof fromObject.name === "string" ? fromObject.name.trim() : "";
  const messageRaw = fromObject && typeof fromObject.message === "string" ? fromObject.message.trim() : "";
  const codeRaw = fromObject && typeof fromObject.code === "string" ? fromObject.code.trim() : "";
  const objectMessage = (() => {
    if (!fromObject) return "";
    try {
      const json = JSON.stringify(fromObject);
      return json && json !== "{}" ? json : "";
    } catch {
      return "";
    }
  })();
  const primitiveMessage =
    typeof value === "string"
      ? value.trim()
      : typeof value === "number" || typeof value === "boolean" || typeof value === "bigint"
        ? String(value)
        : "";
  const name = nameRaw || (codeRaw === "ABORT_ERR" ? "AbortError" : "Error");
  const message = messageRaw || primitiveMessage || objectMessage || fallbackMessage;
  const abortLikeMessage = message.toLowerCase().includes("abort");
  return {
    name,
    message,
    isAbortError: name === "AbortError" || codeRaw === "ABORT_ERR" || abortLikeMessage,
  };
}

export function classifyHeavyDiagnosticsUiFailure(value: unknown): {
  errorCode:
    | "compare_heavy_client_timeout"
    | "compare_heavy_client_fetch_failure"
    | "compare_heavy_client_exception";
  failureKind: "client_timeout" | "fetch_failure" | "client_exception";
  phase:
    | "compare_heavy_timeout"
    | "compare_heavy_fetch_failure"
    | "compare_heavy_exception"
    | "compare_heavy_retry_timeout"
    | "compare_heavy_retry_fetch_failure"
    | "compare_heavy_retry_exception";
  message: string;
  normalized: NormalizedUiError;
} {
  const normalized = normalizeUnknownUiError(
    value,
    "Heavy diagnostics request failed before a response was returned."
  );
  const lowerMessage = normalized.message.toLowerCase();
  if (normalized.isAbortError) {
    return {
      errorCode: "compare_heavy_client_timeout",
      failureKind: "client_timeout",
      phase: "compare_heavy_timeout",
      message: "Heavy diagnostics request timed out in client before backend response.",
      normalized,
    };
  }
  if (
    normalized.name === "TypeError" ||
    lowerMessage.includes("failed to fetch") ||
    lowerMessage.includes("networkerror") ||
    lowerMessage.includes("network error")
  ) {
    return {
      errorCode: "compare_heavy_client_fetch_failure",
      failureKind: "fetch_failure",
      phase: "compare_heavy_fetch_failure",
      message: normalized.message || "Heavy diagnostics request failed in the network/fetch layer.",
      normalized,
    };
  }
  return {
    errorCode: "compare_heavy_client_exception",
    failureKind: "client_exception",
    phase: "compare_heavy_exception",
    message: normalized.message,
    normalized,
  };
}

export function classifyArtifactEnsureUiFailure(value: unknown): {
  errorCode:
    | "artifact_ensure_client_timeout"
    | "artifact_ensure_client_fetch_failure"
    | "artifact_ensure_client_exception";
  failureKind: "client_timeout" | "fetch_failure" | "client_exception";
  phase: "artifact_ensure_timeout" | "artifact_ensure_fetch_failure" | "artifact_ensure_exception";
  message: string;
  normalized: NormalizedUiError;
} {
  const normalized = normalizeUnknownUiError(
    value,
    "Artifact ensure request failed before a response was returned."
  );
  const lowerMessage = normalized.message.toLowerCase();
  if (normalized.isAbortError) {
    return {
      errorCode: "artifact_ensure_client_timeout",
      failureKind: "client_timeout",
      phase: "artifact_ensure_timeout",
      message: "Artifact ensure request timed out in client before backend response.",
      normalized,
    };
  }
  if (lowerMessage.includes("failed to fetch")) {
    return {
      errorCode: "artifact_ensure_client_fetch_failure",
      failureKind: "fetch_failure",
      phase: "artifact_ensure_fetch_failure",
      message: "Artifact ensure request failed to fetch before backend response.",
      normalized,
    };
  }
  return {
    errorCode: "artifact_ensure_client_exception",
    failureKind: "client_exception",
    phase: "artifact_ensure_exception",
    message: normalized.message,
    normalized,
  };
}

export function markActiveOrchestratorPhasesErrored<T extends {
  status: string;
  startedAt: string | null;
  endedAt: string | null;
  elapsedMs: number | null;
  errorCode: string | null;
  errorMessage: string | null;
}>(
  phases: T[],
  args: { errorCode: string; errorMessage: string; nowMs?: number }
): T[] {
  const nowMs = Number.isFinite(args.nowMs) ? Number(args.nowMs) : Date.now();
  const endedAt = new Date(nowMs).toISOString();
  return phases.map((phase) => {
    if (phase.status !== "active") return phase;
    const startedMs = phase.startedAt ? new Date(phase.startedAt).getTime() : NaN;
    return {
      ...phase,
      status: "error",
      endedAt,
      elapsedMs: Number.isFinite(startedMs) ? Math.max(0, nowMs - startedMs) : phase.elapsedMs,
      errorCode: args.errorCode,
      errorMessage: args.errorMessage,
    };
  });
}

function formatApiError(data: any, status: number): string {
  const base = String(data?.message ?? data?.error ?? `Request failed (${status})`);
  const explanation = String(data?.explanation ?? "").trim();
  const detail = String(data?.detail ?? "").trim();
  const missing = Array.isArray(data?.missingData) ? data.missingData.map((v: unknown) => String(v)).filter(Boolean) : [];
  if (!explanation && missing.length === 0 && !detail) return base;
  const parts: string[] = [base];
  if (explanation) parts.push(`Why: ${explanation}`);
  if (missing.length > 0) parts.push(`Missing data: ${missing.join(", ")}`);
  if (detail) parts.push(`Detail: ${detail}`);
  return parts.join("\n");
}

function toReplayTestRanges(raw: unknown): RangeRow[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((r) => ({
      startDate: String((r as any)?.startDate ?? "").slice(0, 10),
      endDate: String((r as any)?.endDate ?? "").slice(0, 10),
    }))
    .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.startDate) && /^\d{4}-\d{2}-\d{2}$/.test(r.endDate));
}

function buildCompareBodyAfterRebuild(
  originalBody: Record<string, unknown>,
  rebuildData: ApiResponse
): Record<string, unknown> {
  const replayRanges = toReplayTestRanges((rebuildData as any)?.testRangesUsed);
  const nextBody: Record<string, unknown> = { ...originalBody };
  if (replayRanges.length > 0) {
    delete nextBody.testDays;
    delete nextBody.testMode;
    delete nextBody.seed;
    delete nextBody.minDayCoveragePct;
    delete nextBody.stratifyByMonth;
    delete nextBody.stratifyByWeekend;
    nextBody.testRanges = replayRanges;
  }
  const exactArtifactInputHash =
    typeof (rebuildData as any)?.artifactInputHashUsed === "string" && String((rebuildData as any)?.artifactInputHashUsed).trim()
      ? String((rebuildData as any)?.artifactInputHashUsed).trim()
      : typeof (rebuildData as any)?.requestedInputHash === "string" && String((rebuildData as any)?.requestedInputHash).trim()
        ? String((rebuildData as any)?.requestedInputHash).trim()
        : "";
  const exactArtifactScenarioId =
    typeof (rebuildData as any)?.artifactScenarioId === "string" && String((rebuildData as any)?.artifactScenarioId).trim()
      ? String((rebuildData as any)?.artifactScenarioId).trim()
      : typeof (rebuildData as any)?.scenarioId === "string" && String((rebuildData as any)?.scenarioId).trim()
        ? String((rebuildData as any)?.scenarioId).trim()
        : "";
  if (exactArtifactInputHash) {
    nextBody.requestedInputHash = exactArtifactInputHash;
    nextBody.requireExactArtifactMatch = true;
    nextBody.artifactIdentitySource = "same_run_artifact_ensure";
    if (exactArtifactScenarioId) nextBody.artifactScenarioId = exactArtifactScenarioId;
  }
  return nextBody;
}

function resolveCompareFreshModeRequested(args: {
  includeDiagnostics: boolean;
  includeFullReportText: boolean;
}): "selected_days" | "full_window" {
  return args.includeDiagnostics || args.includeFullReportText ? "full_window" : "selected_days";
}

function isArtifactRebuildRequiredError(errorCode: unknown): boolean {
  const code = String(errorCode ?? "").trim();
  return (
    code === "artifact_missing_rebuild_required" ||
    code === "artifact_scope_mismatch_rebuild_required" ||
    code === "artifact_stale_rebuild_required" ||
    code === "artifact_compare_join_incomplete_rebuild_required" ||
    code === "past_rebuild_failed"
  );
}

export default function GapFillLabClient() {
  const [email, setEmail] = useState("");
  const [timezone, setTimezone] = useState("America/Chicago");
  const [weatherKind, setWeatherKind] = useState<WeatherKindOption>("ACTUAL_LAST_YEAR");
  const [testMode, setTestMode] = useState<"manual_ranges" | "random_days">("manual_ranges");
  const [randomTestMode, setRandomTestMode] = useState<RandomTestMode>("fixed");
  const [testRanges, setTestRanges] = useState<RangeRow[]>([{ ...DEFAULT_RANGE }]);
  const [testDays, setTestDays] = useState(21);
  const [seed, setSeed] = useState("");
  const [minDayCoveragePct, setMinDayCoveragePct] = useState(95);
  const [stratifyByMonth, setStratifyByMonth] = useState(true);
  const [stratifyByWeekend, setStratifyByWeekend] = useState(true);
  const [fullDiagnosticsOnEnsure, setFullDiagnosticsOnEnsure] = useState(false);
  const [fullDiagnosticsOnCore, setFullDiagnosticsOnCore] = useState(false);
  const [runHeavyDiagnosticsStep, setRunHeavyDiagnosticsStep] = useState(true);
  const [houseId, setHouseId] = useState("");
  const [houses, setHouses] = useState<HouseOption[]>([]);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [usage365Loading, setUsage365Loading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [rebuildLoading, setRebuildLoading] = useState(false);
  const [progressStatus, setProgressStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [artifactMissing, setArtifactMissing] = useState(false);
  const [lastCompareBody, setLastCompareBody] = useState<Record<string, unknown> | null>(null);
  const [lastAttemptDebug, setLastAttemptDebug] = useState<Record<string, unknown> | null>(null);
  const [orchestratorPhases, setOrchestratorPhases] = useState<OrchestratorPhase[]>(
    ORCHESTRATOR_PHASE_BLUEPRINT.map((p) => ({
      key: p.key,
      label: p.label,
      status: "pending",
      startedAt: null,
      endedAt: null,
      elapsedMs: null,
      errorCode: null,
      errorMessage: null,
    }))
  );
  const [heavyRetryBody, setHeavyRetryBody] = useState<Record<string, unknown> | null>(null);
  const [result, setResult] = useState<ApiResponse | null>(null);
  const [travelRangesFromDb, setTravelRangesFromDb] = useState<RangeRow[]>([]);
  const [usageMonthlyView, setUsageMonthlyView] = useState<"chart" | "table">("chart");
  const [usageDailyView, setUsageDailyView] = useState<"chart" | "table">("chart");
  const [chartMode, setChartMode] = useState<ChartMode>("usage365");
  const compareInFlightRef = useRef(false);
  const rebuildInFlightRef = useRef(false);

  function resetOrchestratorPhases() {
    setOrchestratorPhases(
      ORCHESTRATOR_PHASE_BLUEPRINT.map((p) => ({
        key: p.key,
        label: p.label,
        status: "pending",
        startedAt: null,
        endedAt: null,
        elapsedMs: null,
        errorCode: null,
        errorMessage: null,
      }))
    );
  }

  function updateOrchestratorPhase(
    key: OrchestratorPhaseKey,
    patch: Partial<OrchestratorPhase>
  ) {
    setOrchestratorPhases((prev) =>
      prev.map((phase) => (phase.key === key ? { ...phase, ...patch } : phase))
    );
  }

  useEffect(() => {
    setLastAttemptDebug((prev) => {
      if (!prev) return prev;
      return { ...prev, phaseTimeline: orchestratorPhases };
    });
  }, [orchestratorPhases]);

  const gapfillChartData = useMemo(() => {
    if (!result || !result.ok) return null;
    const dailyChartRows = Array.isArray((result as any)?.displaySimulated?.daily)
      ? ((result as any).displaySimulated.daily as Array<{ date: string; simKwh: number; source?: "ACTUAL" | "SIMULATED" }>)
      : Array.isArray((result as any).diagnostics?.dailyTotalsChartSim)
      ? ((result as any).diagnostics.dailyTotalsChartSim as Array<{ date: string; simKwh: number; source?: "ACTUAL" | "SIMULATED" }>)
      : Array.isArray((result as any).diagnostics?.dailyTotalsMasked)
        ? ((result as any).diagnostics.dailyTotalsMasked as Array<{ date: string; simKwh?: number; kwh?: number }>)
      : [];
    if (!dailyChartRows.length) return null;

    const rawDaily = dailyChartRows
      .map((d) => ({
        date: String(d.date ?? ""),
        kwh: Number((d as any).simKwh ?? (d as any).kwh ?? 0) || 0,
        ...(String((d as any)?.source ?? "").toUpperCase() === "SIMULATED" ? { source: "SIMULATED" as const } : {}),
      }))
      .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.date))
      .sort((a, b) => (a.date < b.date ? -1 : 1));
    const coverageStart =
      (result as any)?.displaySimulated?.coverageStart ??
      (result as any)?.truthEnvelope?.windowUsedForScoring?.startDate ??
      (result as any)?.parity?.windowStartUtc ??
      rawDaily[0]?.date ??
      null;
    const coverageEnd =
      (result as any)?.displaySimulated?.coverageEnd ??
      (result as any)?.truthEnvelope?.windowUsedForScoring?.endDate ??
      (result as any)?.parity?.windowEndUtc ??
      rawDaily[rawDaily.length - 1]?.date ??
      null;
    const daily = normalizeDailyRowsToWindow(rawDaily, coverageStart, coverageEnd, 365);

    if (!daily.length) return null;

    const monthly = Array.isArray((result as any)?.displaySimulated?.monthly)
      ? ((result as any).displaySimulated.monthly as Array<{ month: string; kwh: number }>)
          .map((m) => ({ month: String(m.month ?? ""), kwh: Number(m.kwh) || 0 }))
          .filter((m) => /^\d{4}-\d{2}$/.test(m.month))
          .sort((a, b) => (a.month < b.month ? -1 : 1))
      : Array.isArray((result as any)?.diagnostics?.monthlyTotalsChartSim)
      ? ((result as any).diagnostics.monthlyTotalsChartSim as Array<{ month: string; kwh: number }>)
          .map((m) => ({ month: String(m.month ?? ""), kwh: Number(m.kwh) || 0 }))
          .filter((m) => /^\d{4}-\d{2}$/.test(m.month))
          .sort((a, b) => (a.month < b.month ? -1 : 1))
      : Array.from(
          daily.reduce((acc, d) => {
            const month = d.date.slice(0, 7);
            acc.set(month, (acc.get(month) ?? 0) + d.kwh);
            return acc;
          }, new Map<string, number>())
        )
          .sort((a, b) => (a[0] < b[0] ? -1 : 1))
          .map(([month, kwh]) => ({ month, kwh }));

    const weekdayWeekend = daily.reduce(
      (acc, d) => {
        const dow = new Date(`${d.date}T12:00:00.000Z`).getUTCDay();
        if (dow === 0 || dow === 6) acc.weekend += d.kwh;
        else acc.weekday += d.kwh;
        return acc;
      },
      { weekday: 0, weekend: 0 }
    );

    const hourly = Array.isArray((result as any).diagnostics?.hourlyProfileMasked)
      ? ((result as any).diagnostics.hourlyProfileMasked as Array<{ hour: number; simMeanKwh: number }>)
      : [];
    const fifteenCurve = hourly
      .filter((h) => Number.isFinite(Number(h.hour)) && Number(h.hour) >= 0 && Number(h.hour) <= 23)
      .sort((a, b) => Number(a.hour) - Number(b.hour))
      .map((h) => ({
        hhmm: `${String(Number(h.hour)).padStart(2, "0")}:00`,
        // simMeanKwh is per 15m interval in this diagnostics view; convert to avg kW.
        avgKw: (Number(h.simMeanKwh) || 0) * 4,
      }));

    return {
      source: "GAPFILL_SIMULATED_TEST_WINDOW",
      timezone: timezone || "America/Chicago",
      // Prefer shared canonical window metadata from backend for date-label parity with Usage charts.
      coverageStart,
      coverageEnd,
      intervalCount: Number((result as any)?.diagnostics?.chartIntervalCount ?? (result as any).testIntervalsCount ?? (result as any)?.parity?.intervalCount ?? 0) || 0,
      daily,
      monthly,
      weekdayKwh: weekdayWeekend.weekday,
      weekendKwh: weekdayWeekend.weekend,
      fifteenCurve,
      stitchedMonth: (result as any)?.displaySimulated?.stitchedMonth ?? (result as any)?.diagnostics?.stitchedMonthChartSim ?? null,
    };
  }, [result, timezone]);
  const usage365ChartData = useMemo(() => {
    if (!result || !result.ok || !result.usage365?.daily?.length) return null;
    const normalizedDaily = normalizeDailyRowsToWindow(
      result.usage365.daily,
      result.usage365.coverageStart ?? null,
      result.usage365.coverageEnd ?? null,
      365
    );
    if (!normalizedDaily.length) return null;
    const normalizedCoverageStart = normalizedDaily[0]?.date ?? result.usage365.coverageStart ?? null;
    const normalizedCoverageEnd = normalizedDaily[normalizedDaily.length - 1]?.date ?? result.usage365.coverageEnd ?? null;
    return {
      ...result.usage365,
      coverageStart: normalizedCoverageStart,
      coverageEnd: normalizedCoverageEnd,
      daily: normalizedDaily,
    };
  }, [result]);
  const hasUsage365ChartData = Boolean(usage365ChartData?.daily?.length);
  const hasGapfillChartData = Boolean(gapfillChartData?.daily?.length);
  const effectiveChartMode: ChartMode =
    chartMode === "usage365" && !hasUsage365ChartData && hasGapfillChartData
      ? "gapfill"
      : chartMode === "gapfill" && !hasGapfillChartData && hasUsage365ChartData
        ? "usage365"
        : chartMode;
  const truthEnvelope = result && result.ok ? (result as any).truthEnvelope ?? null : null;
  const artifactFromEnvelope = truthEnvelope?.artifact ?? null;
  const artifactFromTopLevel =
    result && result.ok
      ? {
          sourceMode: (result as any)?.artifactSourceMode ?? null,
          sourceNote: (result as any)?.artifactSourceNote ?? null,
          requestedInputHash: (result as any)?.requestedInputHash ?? null,
          artifactInputHashUsed: (result as any)?.artifactInputHashUsed ?? null,
          artifactHashMatch: (result as any)?.artifactHashMatch ?? null,
          scenarioId: (result as any)?.artifactScenarioId ?? null,
          createdAt: (result as any)?.artifactCreatedAt ?? null,
          updatedAt: (result as any)?.artifactUpdatedAt ?? null,
          rebuiltRequested: Boolean((result as any)?.rebuilt),
          autoRebuilt: (result as any)?.artifactAutoRebuilt === true,
          pathKind:
            (result as any)?.artifactAutoRebuilt || (result as any)?.rebuilt
              ? "full_rebuild"
              : ["exact_hash_match", "latest_by_scenario_fallback"].includes(String((result as any)?.artifactSourceMode ?? ""))
                ? "cheap_read"
                : null,
        }
      : null;
  const artifactStatus = artifactFromEnvelope ?? artifactFromTopLevel;
  const scoredDayTruthRows =
    result && result.ok && Array.isArray((result as any).scoredDayTruthRows)
      ? ((result as any).scoredDayTruthRows as ScoredDayTruthRow[])
      : [];
  const { rows: compareCoreScoredDayWeatherRows, truth: compareCoreScoredDayWeatherTruth } =
    extractCompareCoreScoredDayWeather(result);
  const usageShapeDependencyStatus = truthEnvelope?.usageShapeDependencyStatus;
  const usageShapeDiag =
    result && result.ok ? ((result as any)?.modelAssumptions?.usageShapeProfileDiag ?? null) : null;
  const usageShapeNeedsAction =
    Boolean(usageShapeDependencyStatus) &&
    String(usageShapeDependencyStatus?.status ?? "").toLowerCase() !== "available";
  const compareTruth =
    result && result.ok
      ? ((result as any).compareTruth ?? truthEnvelope?.compareTruth ?? null)
      : null;
  const travelVacantParityRows: TravelVacantParityRow[] =
    result && result.ok
      ? (Array.isArray((result as any)?.travelVacantParityRows)
          ? ((result as any).travelVacantParityRows as TravelVacantParityRow[])
          : Array.isArray((truthEnvelope as any)?.travelVacantParityRows)
            ? ((truthEnvelope as any).travelVacantParityRows as TravelVacantParityRow[])
            : [])
      : [];
  const travelVacantParityTruth: TravelVacantParityTruth | null =
    result && result.ok
      ? (((result as any)?.travelVacantParityTruth ?? (truthEnvelope as any)?.travelVacantParityTruth ?? null) as TravelVacantParityTruth | null)
      : null;
  const scoredDayTruthRowsForDisplay = useMemo(
    () =>
      mergeScoredDayTruthRowsWithCompareCoreWeather(
        scoredDayTruthRows,
        compareCoreScoredDayWeatherRows,
        (compareTruth?.weatherBasisUsed ?? truthEnvelope?.weatherBasisUsed ?? null) as string | null
      ),
    [scoredDayTruthRows, compareCoreScoredDayWeatherRows, compareTruth?.weatherBasisUsed, truthEnvelope?.weatherBasisUsed]
  );
  const noScoreableIntervals = result && result.ok && (result as any).hasScoreableIntervals === false;
  const mismatchRowsCount = scoredDayTruthRowsForDisplay.filter((row) => row.displayVsFreshParityMatch === false).length;
  const largeErrorRowsCount = scoredDayTruthRowsForDisplay.filter((row) => Math.abs(Number(row.actualVsFreshErrorKwh) || 0) >= 5).length;
  const missAttribution = result && result.ok ? ((result as any).missAttributionSummary ?? null) : null;
  const tuningBreakdowns = result && result.ok ? ((result as any).accuracyTuningBreakdowns ?? null) : null;
  const phaseStateByKey = new Map(orchestratorPhases.map((p) => [p.key, p.status] as const));
  const phaseHasError = (...keys: OrchestratorPhaseKey[]) =>
    keys.some((key) => phaseStateByKey.get(key) === "error");
  const hybridStepStatus: Array<{ key: string; label: string; state: "done" | "active" | "pending"; failed?: boolean }> = [
    {
      key: "lookup",
      label: "Lookup",
      failed: phaseHasError("lookup_inputs"),
      state:
        phaseHasError("lookup_inputs")
          ? "pending"
          : phaseStateByKey.get("lookup_inputs") === "done"
          ? "done"
          : phaseStateByKey.get("lookup_inputs") === "active"
            ? "active"
            : houses.length > 0
              ? "done"
              : lookupLoading
                ? "active"
                : "pending",
    },
    {
      key: "dependency",
      label: "Dependency Check",
      failed: phaseHasError("usage365_load"),
      state:
        phaseHasError("usage365_load")
          ? "pending"
          : phaseStateByKey.get("usage365_load") === "done"
          ? "done"
          : phaseStateByKey.get("usage365_load") === "active"
            ? "active"
            : truthEnvelope
              ? "done"
              : (loading || rebuildLoading)
                ? "active"
                : "pending",
    },
    {
      key: "artifact",
      label: "Artifact Ensure/Rebuild",
      failed: phaseHasError("artifact_ensure"),
      state:
        phaseHasError("artifact_ensure")
          ? "pending"
          : phaseStateByKey.get("artifact_ensure") === "done" ||
        truthEnvelope?.artifact ||
        (result && result.ok && (result as any).rebuilt != null)
          ? "done"
          : phaseStateByKey.get("artifact_ensure") === "active" || rebuildLoading
            ? "active"
            : "pending",
    },
    {
      key: "compare",
      label: "Compare",
      failed: phaseHasError("compare_core", "compare_heavy"),
      state:
        phaseHasError("compare_core", "compare_heavy")
          ? "pending"
          : phaseStateByKey.get("compare_heavy") === "done" ||
        phaseStateByKey.get("compare_core") === "done" ||
        (result && result.ok && result.metrics)
          ? "done"
          : phaseStateByKey.get("compare_heavy") === "active" ||
            phaseStateByKey.get("compare_core") === "active" ||
            loading
            ? "active"
            : "pending",
    },
  ];

  function addTestRange() {
    setTestRanges((prev) => [...prev, { ...DEFAULT_RANGE }]);
  }

  function removeTestRange(i: number) {
    setTestRanges((prev) => (prev.length <= 1 ? prev : prev.filter((_, j) => j !== i)));
  }

  function updateTestRange(i: number, field: "startDate" | "endDate", value: string) {
    setTestRanges((prev) => prev.map((r, j) => (j === i ? { ...r, [field]: value.slice(0, 10) } : r)));
  }

  function handleHouseChange(newHouseId: string) {
    if (newHouseId !== houseId) {
      setHouseId(newHouseId);
      setTestRanges([{ ...DEFAULT_RANGE }]);
      // House selection changes request identity; clear prior run state to avoid stale carry-over.
      setResult(null);
      setError(null);
      setArtifactMissing(false);
      setLastCompareBody(null);
      setLastAttemptDebug(null);
      setHeavyRetryBody(null);
      resetOrchestratorPhases();
      setChartMode("usage365");
    }
  }

  async function postGapfill(body: Record<string, unknown>, timeoutMs = 320_000): Promise<{ res: Response; data: ApiResponse }> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch("/api/admin/tools/gapfill-lab", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const responseText = await res.text();
      let parsed: any = null;
      try {
        parsed = responseText ? JSON.parse(responseText) : null;
      } catch {
        parsed = null;
      }
      const requestIdHeaders = {
        xRequestId: res.headers.get("x-request-id"),
        xVercelId: res.headers.get("x-vercel-id"),
        cfRay: res.headers.get("cf-ray"),
      };
      const data = (parsed ??
        ({
          ok: false as const,
          error: "invalid_json_response",
          message: `Server returned a non-JSON response (HTTP ${res.status}).`,
          detail: JSON.stringify(
            {
              status: res.status,
              statusText: res.statusText || null,
              requestIdHeaders,
              bodyPreview: String(responseText ?? "").slice(0, 1200),
            },
            null,
            2
          ),
        } as any)) as ApiResponse;
      return { res, data };
    } catch (err: unknown) {
      const normalized = normalizeUnknownUiError(
        err,
        "Request failed before server response was received."
      );
      const wrapped = new Error(normalized.message);
      wrapped.name = normalized.name;
      throw wrapped;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  function mergeSuccessfulResult(data: ApiResponse) {
    setResult((prev) => {
      if (data.ok && prev?.ok) {
        if ((data as any).responseMode === "heavy_only_compact") {
          return {
            ...prev,
            ...data,
            diagnostics: data.diagnostics ?? prev.diagnostics,
            fullReportText: (data as any).fullReportText ?? (prev as any).fullReportText,
            fullReportJson: (data as any).fullReportJson ?? (prev as any).fullReportJson,
            missAttributionSummary: data.missAttributionSummary ?? prev.missAttributionSummary,
            accuracyTuningBreakdowns: data.accuracyTuningBreakdowns ?? prev.accuracyTuningBreakdowns,
            compareCoreTiming: (prev as any).compareCoreTiming,
            compareCoreMode: prev.compareCoreMode,
            compareCoreStepTimings: prev.compareCoreStepTimings,
            heavyStartedAt: (data as any).heavyStartedAt ?? (prev as any).heavyStartedAt,
            heavyEndedAt: (data as any).heavyEndedAt ?? (prev as any).heavyEndedAt,
            heavyElapsedMs: (data as any).heavyElapsedMs ?? (prev as any).heavyElapsedMs,
            heavyLastCompletedStep: (data as any).heavyLastCompletedStep ?? (prev as any).heavyLastCompletedStep,
            heavyStepsMs: (data as any).heavyStepsMs ?? (prev as any).heavyStepsMs,
            heavyFailedStep: (data as any).heavyFailedStep ?? (prev as any).heavyFailedStep,
            heavyTruth: (data as any).heavyTruth ?? (prev as any).heavyTruth,
          } as ApiResponse;
        }
        return {
          ...data,
          ...(data.houses?.length ? {} : prev.houses?.length ? { houses: prev.houses } : {}),
          ...(data.primaryPercentMetric != null ? {} : prev.primaryPercentMetric != null ? { primaryPercentMetric: prev.primaryPercentMetric } : {}),
          ...(data.pasteSummary ? {} : prev.pasteSummary ? { pasteSummary: prev.pasteSummary } : {}),
          ...(data.usage365 ? {} : prev.usage365 ? { usage365: prev.usage365 } : {}),
          // Keep compare artifacts when a usage-only refresh returns no compare payload.
          ...(data.metrics ? {} : prev.metrics ? { metrics: prev.metrics } : {}),
          ...(data.testIntervalsCount != null ? {} : prev.testIntervalsCount != null ? { testIntervalsCount: prev.testIntervalsCount } : {}),
          ...(Array.isArray(data.byMonth) && data.byMonth.length > 0 ? {} : Array.isArray(prev.byMonth) ? { byMonth: prev.byMonth } : {}),
          ...(Array.isArray(data.byHour) && data.byHour.length > 0 ? {} : Array.isArray(prev.byHour) ? { byHour: prev.byHour } : {}),
          ...(Array.isArray(data.byDayType) && data.byDayType.length > 0 ? {} : Array.isArray(prev.byDayType) ? { byDayType: prev.byDayType } : {}),
          ...(Array.isArray(data.worstDays) && data.worstDays.length > 0 ? {} : Array.isArray(prev.worstDays) ? { worstDays: prev.worstDays } : {}),
          ...(data.diagnostics ? {} : prev.diagnostics ? { diagnostics: prev.diagnostics } : {}),
          // Never retain stale parity window metadata across requests.
          ...((data as any).fullReportText ? {} : (prev as any).fullReportText ? { fullReportText: (prev as any).fullReportText } : {}),
          ...((data as any).fullReportJson ? {} : (prev as any).fullReportJson ? { fullReportJson: (prev as any).fullReportJson } : {}),
          ...(data.homeProfile == null && prev.homeProfile != null ? { homeProfile: prev.homeProfile } : {}),
          ...(data.applianceProfile == null && prev.applianceProfile != null ? { applianceProfile: prev.applianceProfile } : {}),
          ...(data.modelAssumptions == null && prev.modelAssumptions != null ? { modelAssumptions: prev.modelAssumptions } : {}),
        };
      }
      return data;
    });
    if (data.ok && data.houses?.length) setHouses(data.houses);
    if (data.ok && Array.isArray((data as any).travelRangesFromDb)) {
      setTravelRangesFromDb((data as any).travelRangesFromDb.map((r: RangeRow) => ({ startDate: r.startDate, endDate: r.endDate })));
    }
  }

  function buildCompareBody(
    trimmedEmail: string,
    validRanges: RangeRow[],
    options: { includeDiagnostics: boolean; includeFullReportText: boolean }
  ): Record<string, unknown> {
    const body: Record<string, unknown> = {
      email: trimmedEmail,
      timezone,
      houseId: houseId || undefined,
      weatherKind,
      includeUsage365: false,
      includeDiagnostics: options.includeDiagnostics,
      includeFullReportText: options.includeFullReportText,
    };
    if (testMode === "random_days") {
      body.testDays = testDays;
      body.testMode = randomTestMode;
      if (seed.trim()) body.seed = seed.trim();
      body.minDayCoveragePct = minDayCoveragePct / 100;
      body.stratifyByMonth = stratifyByMonth;
      body.stratifyByWeekend = stratifyByWeekend;
      body.testRanges = [];
    } else {
      body.testRanges = validRanges;
    }
    return body;
  }

  async function handleLookup() {
    setError(null);
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) {
      setError("Enter an email address.");
      return;
    }
    setResult(null);
    setLookupLoading(true);
    try {
      const res = await fetch("/api/admin/tools/gapfill-lab", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: trimmed,
          timezone,
          testRanges: [],
          houseId: houseId || undefined,
          includeUsage365: false,
        }),
      });
      const data = (await res.json().catch(() => null)) as ApiResponse;
      if (!res.ok) {
        setError(formatApiError(data, res.status));
        return;
      }
      if (data.ok && data.houses?.length) {
        setHouses(data.houses);
        const currentInList = houseId && data.houses.some((h) => h.id === houseId);
        setHouseId(currentInList ? houseId : data.houses[0].id);
      }
      if (data.ok && Array.isArray((data as any).travelRangesFromDb)) {
        setTravelRangesFromDb((data as any).travelRangesFromDb.map((r: RangeRow) => ({ startDate: r.startDate, endDate: r.endDate })));
      }
      setResult(data);
    } catch (e: unknown) {
      const normalized = normalizeUnknownUiError(e, "Lookup failed.");
      setError(normalized.isAbortError ? "Request timed out." : normalized.message);
    } finally {
      setLookupLoading(false);
    }
  }

  async function handleLoadUsage365() {
    setError(null);
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) {
      setError("Enter an email address.");
      return;
    }
    setUsage365Loading(true);
    try {
      const { res, data } = await postGapfill({
        email: trimmed,
        timezone,
        testRanges: [],
        houseId: houseId || undefined,
        includeUsage365: true,
      });
      if (!res.ok) {
        setError(formatApiError(data, res.status));
        return;
      }
      if (!data.ok) {
        setError(formatApiError(data, res.status));
        return;
      }
      mergeSuccessfulResult(data);
    } catch (e: unknown) {
      const normalized = normalizeUnknownUiError(e, "Usage 365 request failed.");
      setError(
        normalized.isAbortError
          ? "Request timed out while loading Usage 365."
          : normalized.message
      );
    } finally {
      setUsage365Loading(false);
    }
  }

  async function handleRunCompare() {
    if (compareInFlightRef.current || rebuildInFlightRef.current) {
      setError("A Gap-Fill request is already running. Wait for it to finish.");
      return;
    }
    setError(null);
    setProgressStatus(null);
    setArtifactMissing(false);
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) {
      setError("Enter an email address.");
      return;
    }
    const validRanges = testRanges.filter((r) => r.startDate && r.endDate);
    if (testMode === "manual_ranges" && !validRanges.length) {
      setError("Add at least one Test Date range (start and end date), or use Random Test Days.");
      return;
    }
    setResult(null);
    compareInFlightRef.current = true;
    setLoading(true);
    setHeavyRetryBody(null);
    resetOrchestratorPhases();
    try {
      const runStartedAt = new Date().toISOString();
      const togglesSnapshot = {
        fullDiagnosticsOnEnsure: fullDiagnosticsOnEnsure === true,
        fullDiagnosticsOnCore: fullDiagnosticsOnCore === true,
        runHeavyDiagnosticsStep: runHeavyDiagnosticsStep === true,
      };
      const compareCoreIncludesHeavyPayload =
        togglesSnapshot.fullDiagnosticsOnCore && !togglesSnapshot.runHeavyDiagnosticsStep;
      const baseCompareBody = buildCompareBody(trimmed, validRanges, {
        includeDiagnostics: compareCoreIncludesHeavyPayload,
        includeFullReportText: compareCoreIncludesHeavyPayload,
      });
      setLastCompareBody(baseCompareBody);
      const compareCoreFreshModeRequested = resolveCompareFreshModeRequested({
        includeDiagnostics: compareCoreIncludesHeavyPayload,
        includeFullReportText: compareCoreIncludesHeavyPayload,
      });
      setLastAttemptDebug({
        startedAt: runStartedAt,
        phase: "orchestrator_started",
        orchestration: "lookup_inputs -> usage365_load -> artifact_ensure -> compare_core -> compare_heavy",
        requestBody: baseCompareBody,
        requestTruth: {
          includeDiagnostics: compareCoreIncludesHeavyPayload,
          includeFullReportText: compareCoreIncludesHeavyPayload,
          compareFreshModeRequested: compareCoreFreshModeRequested,
          runHeavyDiagnosticsStep: togglesSnapshot.runHeavyDiagnosticsStep,
        },
        fullDiagnosticsOnEnsure: togglesSnapshot.fullDiagnosticsOnEnsure,
        fullDiagnosticsOnCore: togglesSnapshot.fullDiagnosticsOnCore,
        runHeavyDiagnosticsStep: togglesSnapshot.runHeavyDiagnosticsStep,
      });
      const startByPhase = new Map<OrchestratorPhaseKey, number>();
      let activePhaseKey: OrchestratorPhaseKey | null = null;
      const startPhase = (key: OrchestratorPhaseKey, statusLabel: string) => {
        const startedAtMs = Date.now();
        startByPhase.set(key, startedAtMs);
        activePhaseKey = key;
        updateOrchestratorPhase(key, {
          status: "active",
          startedAt: new Date(startedAtMs).toISOString(),
          endedAt: null,
          elapsedMs: null,
          errorCode: null,
          errorMessage: null,
        });
        setProgressStatus(statusLabel);
      };
      const finishPhase = (key: OrchestratorPhaseKey, status: "done" | "error", info?: { errorCode?: string | null; errorMessage?: string | null }) => {
        const endedAtMs = Date.now();
        const startedAtMs = startByPhase.get(key) ?? endedAtMs;
        if (activePhaseKey === key) activePhaseKey = null;
        updateOrchestratorPhase(key, {
          status,
          endedAt: new Date(endedAtMs).toISOString(),
          elapsedMs: Math.max(0, endedAtMs - startedAtMs),
          errorCode: info?.errorCode ?? null,
          errorMessage: info?.errorMessage ?? null,
        });
      };

      // 1) Lookup & Inputs
      const lookupBody: Record<string, unknown> = {
        email: trimmed,
        timezone,
        houseId: houseId || undefined,
        testRanges: [],
        includeUsage365: false,
      };
      startPhase("lookup_inputs", "Lookup/Input resolution running...");
      const { res: lookupRes, data: lookupData } = await postGapfill(lookupBody, GAPFILL_LOOKUP_TIMEOUT_MS);
      if (!lookupRes.ok || !lookupData.ok) {
        finishPhase("lookup_inputs", "error", {
          errorCode: String((lookupData as any)?.error ?? "lookup_failed"),
          errorMessage: formatApiError(lookupData as any, lookupRes.status),
        });
        setError(formatApiError(lookupData as any, lookupRes.status));
        setLastAttemptDebug((prev) => ({
          ...(prev ?? {}),
          phase: "lookup_inputs_error",
          lookupStatus: lookupRes.status,
          lookupError: (lookupData as any)?.error ?? null,
          lookupMessage: (lookupData as any)?.message ?? null,
          lookupBody,
          lookupResponse: lookupData,
        }));
        setProgressStatus(null);
        return;
      }
      finishPhase("lookup_inputs", "done");
      mergeSuccessfulResult(lookupData);
      setLastAttemptDebug((prev) => ({
        ...(prev ?? {}),
        lookupStatus: lookupRes.status,
        lookupBody,
        lookupResponse: lookupData,
      }));

      // 2) Usage 365 Load
      const usageBody: Record<string, unknown> = {
        email: trimmed,
        timezone,
        houseId: houseId || undefined,
        testRanges: [],
        includeUsage365: true,
      };
      startPhase("usage365_load", "Loading Usage 365...");
      const { res: usageRes, data: usageData } = await postGapfill(usageBody, GAPFILL_USAGE365_TIMEOUT_MS);
      if (!usageRes.ok || !usageData.ok) {
        finishPhase("usage365_load", "error", {
          errorCode: String((usageData as any)?.error ?? "usage365_failed"),
          errorMessage: formatApiError(usageData as any, usageRes.status),
        });
        // Non-blocking: keep pipeline moving, but capture exact failure.
        setLastAttemptDebug((prev) => ({
          ...(prev ?? {}),
          phase: "usage365_load_error_non_blocking",
          usageStatus: usageRes.status,
          usageError: (usageData as any)?.error ?? null,
          usageMessage: (usageData as any)?.message ?? null,
          usageBody,
          usageResponse: usageData,
        }));
      } else {
        finishPhase("usage365_load", "done");
        mergeSuccessfulResult(usageData);
        setLastAttemptDebug((prev) => ({
          ...(prev ?? {}),
          usageStatus: usageRes.status,
          usageBody,
          usageResponse: usageData,
        }));
      }

      // 3) Artifact ensure/rebuild-only
      startPhase("artifact_ensure", "Ensuring shared artifact...");
      const ensureBody: Record<string, unknown> = {
        ...baseCompareBody,
        includeDiagnostics: togglesSnapshot.fullDiagnosticsOnEnsure,
        includeFullReportText: togglesSnapshot.fullDiagnosticsOnEnsure,
        rebuildArtifact: true,
        rebuildOnly: true,
      };
      let ensureRes: Response;
      let ensureData: ApiResponse;
      try {
        const ensureResult = await postGapfill(ensureBody, GAPFILL_REBUILD_TIMEOUT_MS);
        ensureRes = ensureResult.res;
        ensureData = ensureResult.data;
      } catch (ensureErr: unknown) {
        const failure = classifyArtifactEnsureUiFailure(ensureErr);
        finishPhase("artifact_ensure", "error", {
          errorCode: failure.errorCode,
          errorMessage: failure.message,
        });
        setArtifactMissing(true);
        setError(failure.message);
        setLastAttemptDebug((prev) => ({
          ...(prev ?? {}),
          phase: failure.phase,
          ensureBody,
          ensureFailureKind: failure.failureKind,
          ensureError: failure.errorCode,
          ensureMessage: failure.message,
          ensureRequestTruth: {
            includeDiagnostics: togglesSnapshot.fullDiagnosticsOnEnsure,
            includeFullReportText: togglesSnapshot.fullDiagnosticsOnEnsure,
            compareFreshModeRequested: resolveCompareFreshModeRequested({
              includeDiagnostics: togglesSnapshot.fullDiagnosticsOnEnsure,
              includeFullReportText: togglesSnapshot.fullDiagnosticsOnEnsure,
            }),
          },
        }));
        setProgressStatus(null);
        return;
      }
      if (!ensureRes.ok || !ensureData.ok) {
        finishPhase("artifact_ensure", "error", {
          errorCode: String((ensureData as any)?.error ?? "artifact_ensure_failed"),
          errorMessage: formatApiError(ensureData as any, ensureRes.status),
        });
        const ensureErrCode = String((ensureData as any)?.error ?? "");
        setArtifactMissing(isArtifactRebuildRequiredError(ensureErrCode));
        setError(formatApiError(ensureData as any, ensureRes.status));
        setLastAttemptDebug((prev) => ({
          ...(prev ?? {}),
          phase: "artifact_ensure_error",
          ensureStatus: ensureRes.status,
          ensureError: (ensureData as any)?.error ?? null,
          ensureMessage: (ensureData as any)?.message ?? null,
          ensureBody,
          ensureRequestTruth: {
            includeDiagnostics: togglesSnapshot.fullDiagnosticsOnEnsure,
            includeFullReportText: togglesSnapshot.fullDiagnosticsOnEnsure,
            compareFreshModeRequested: resolveCompareFreshModeRequested({
              includeDiagnostics: togglesSnapshot.fullDiagnosticsOnEnsure,
              includeFullReportText: togglesSnapshot.fullDiagnosticsOnEnsure,
            }),
            runHeavyDiagnosticsStep: togglesSnapshot.runHeavyDiagnosticsStep,
          },
          ensureResponse: ensureData,
        }));
        setProgressStatus(null);
        return;
      }
      finishPhase("artifact_ensure", "done");
      setArtifactMissing(false);
      setLastAttemptDebug((prev) => ({
        ...(prev ?? {}),
        ensureStatus: ensureRes.status,
        ensureBody,
        ensureRequestTruth: {
          includeDiagnostics: togglesSnapshot.fullDiagnosticsOnEnsure,
          includeFullReportText: togglesSnapshot.fullDiagnosticsOnEnsure,
          compareFreshModeRequested: resolveCompareFreshModeRequested({
            includeDiagnostics: togglesSnapshot.fullDiagnosticsOnEnsure,
            includeFullReportText: togglesSnapshot.fullDiagnosticsOnEnsure,
          }),
          runHeavyDiagnosticsStep: togglesSnapshot.runHeavyDiagnosticsStep,
        },
        ensureResponse: ensureData,
      }));

      // 4) Compare core (lighter payload)
      const compareBodyBase = buildCompareBodyAfterRebuild(baseCompareBody, ensureData);
      setLastCompareBody(compareBodyBase);
      startPhase("compare_core", "Running compare core...");
      const compareCoreFetchStartedAt = new Date().toISOString();
      setLastAttemptDebug((prev) => ({
        ...(prev ?? {}),
        compareCoreBody: compareBodyBase,
        compareCoreRequestTruth: {
          includeDiagnostics: compareCoreIncludesHeavyPayload,
          includeFullReportText: compareCoreIncludesHeavyPayload,
          compareFreshModeRequested: compareCoreFreshModeRequested,
          runHeavyDiagnosticsStep: togglesSnapshot.runHeavyDiagnosticsStep,
        },
        compareCoreFetchStartedAt,
      }));
      let coreRes: Response;
      let coreData: ApiResponse;
      try {
        const coreResult = await postGapfill(compareBodyBase, GAPFILL_COMPARE_CORE_TIMEOUT_MS);
        coreRes = coreResult.res;
        coreData = coreResult.data;
      } catch (coreErr: unknown) {
        const normalizedCoreError = normalizeUnknownUiError(
          coreErr,
          "Compare core request failed before a response was returned."
        );
        const compareCoreFetchSettledAt = new Date().toISOString();
        const timedOut = normalizedCoreError.isAbortError;
        finishPhase("compare_core", "error", {
          errorCode: timedOut ? "compare_core_client_timeout" : "compare_core_client_exception",
          errorMessage: timedOut
            ? "Compare core request timed out in client before backend response."
            : normalizedCoreError.message,
        });
        setError(
          timedOut
            ? "Compare core request timed out in client. Check Last Attempt Debug for request payload and rerun."
            : normalizedCoreError.message
        );
        setLastAttemptDebug((prev) => ({
          ...(prev ?? {}),
          phase: timedOut ? "compare_core_timeout" : "compare_core_exception",
          compareCoreFetchSettledAt,
          compareCoreTimeoutMs: GAPFILL_COMPARE_CORE_TIMEOUT_MS,
          coreError: timedOut ? "compare_core_client_timeout" : "compare_core_client_exception",
          coreMessage: normalizedCoreError.message,
          coreStatus: null,
          coreResponse: null,
        }));
        setProgressStatus(null);
        return;
      }
      const compareCoreFetchSettledAt = new Date().toISOString();
      if (!coreRes.ok || !coreData.ok) {
        finishPhase("compare_core", "error", {
          errorCode: String((coreData as any)?.error ?? "compare_core_failed"),
          errorMessage: formatApiError(coreData as any, coreRes.status),
        });
        const coreErrCode = String((coreData as any)?.error ?? "");
        setArtifactMissing(isArtifactRebuildRequiredError(coreErrCode));
        setError(formatApiError(coreData as any, coreRes.status));
        setLastAttemptDebug((prev) => ({
          ...(prev ?? {}),
          phase: "compare_core_error",
          coreStatus: coreRes.status,
          coreError: (coreData as any)?.error ?? null,
          coreMessage: (coreData as any)?.message ?? null,
          compareCoreFetchSettledAt,
          compareCoreBody: compareBodyBase,
          compareCoreRequestTruth: {
            includeDiagnostics: compareCoreIncludesHeavyPayload,
            includeFullReportText: compareCoreIncludesHeavyPayload,
            compareFreshModeRequested: compareCoreFreshModeRequested,
            runHeavyDiagnosticsStep: togglesSnapshot.runHeavyDiagnosticsStep,
          },
          coreResponse: coreData,
        }));
        setProgressStatus(null);
        return;
      }
      finishPhase("compare_core", "done");
      mergeSuccessfulResult(coreData);
      setLastAttemptDebug((prev) => ({
        ...(prev ?? {}),
        coreStatus: coreRes.status,
        compareCoreFetchSettledAt,
        compareCoreBody: compareBodyBase,
        compareCoreRequestTruth: {
          includeDiagnostics: compareCoreIncludesHeavyPayload,
          includeFullReportText: compareCoreIncludesHeavyPayload,
          compareFreshModeRequested: compareCoreFreshModeRequested,
          runHeavyDiagnosticsStep: togglesSnapshot.runHeavyDiagnosticsStep,
        },
        coreResponse: coreData,
      }));
      if (compareCoreIncludesHeavyPayload || !togglesSnapshot.runHeavyDiagnosticsStep) {
        const nowIso = new Date().toISOString();
        const skipReason = !togglesSnapshot.runHeavyDiagnosticsStep
          ? "Heavy diagnostics step disabled by toggle."
          : "Heavy step skipped because core already included full diagnostics/report.";
        updateOrchestratorPhase("compare_heavy", {
          status: "skipped",
          startedAt: nowIso,
          endedAt: nowIso,
          elapsedMs: 0,
          errorCode: null,
          errorMessage: skipReason,
        });
        setHeavyRetryBody(null);
        setLastAttemptDebug((prev) => ({
          ...(prev ?? {}),
          phase: "orchestrator_success_heavy_skipped",
          compareHeavySkippedReason: skipReason,
          finishedAt: new Date().toISOString(),
        }));
        setProgressStatus(null);
        return;
      }

      // 5) Compare heavy report (full diagnostics/text)
      const compareBodyHeavy = {
        ...compareBodyBase,
        includeDiagnostics: true,
        includeFullReportText: true,
        responseMode: "heavy_only_compact" as const,
      };
      const compareHeavyFreshModeRequested = resolveCompareFreshModeRequested({
        includeDiagnostics: true,
        includeFullReportText: true,
      });
      startPhase("compare_heavy", "Building heavy diagnostics report...");
      let heavyRes: Response;
      let heavyData: ApiResponse;
      try {
        const heavyResult = await postGapfill(compareBodyHeavy, GAPFILL_COMPARE_HEAVY_TIMEOUT_MS);
        heavyRes = heavyResult.res;
        heavyData = heavyResult.data;
      } catch (heavyErr: unknown) {
        const failure = classifyHeavyDiagnosticsUiFailure(heavyErr);
        finishPhase("compare_heavy", "error", {
          errorCode: failure.errorCode,
          errorMessage: failure.message,
        });
        setHeavyRetryBody(compareBodyHeavy);
        setError(`Core compare completed, but heavy diagnostics/report failed.\n${failure.message}`);
        setLastAttemptDebug((prev) => ({
          ...(prev ?? {}),
          phase: failure.phase,
          heavyStatus: null,
          heavyError: failure.errorCode,
          heavyMessage: failure.message,
          heavyFailureKind: failure.failureKind,
          compareHeavyBody: compareBodyHeavy,
          compareHeavyRequestTruth: {
            includeDiagnostics: true,
            includeFullReportText: true,
            compareFreshModeRequested: compareHeavyFreshModeRequested,
            runHeavyDiagnosticsStep: togglesSnapshot.runHeavyDiagnosticsStep,
          },
          heavyResponse: null,
        }));
        setProgressStatus("Core compare complete. Heavy diagnostics failed; retry heavy report.");
        return;
      }
      if (!heavyRes.ok || !heavyData.ok) {
        finishPhase("compare_heavy", "error", {
          errorCode: String((heavyData as any)?.error ?? "compare_heavy_failed"),
          errorMessage: formatApiError(heavyData as any, heavyRes.status),
        });
        setHeavyRetryBody(compareBodyHeavy);
        setError(
          `Core compare completed, but heavy diagnostics/report failed.\n${formatApiError(
            heavyData as any,
            heavyRes.status
          )}`
        );
        setLastAttemptDebug((prev) => ({
          ...(prev ?? {}),
          phase: "compare_heavy_error",
          heavyStatus: heavyRes.status,
          heavyError: (heavyData as any)?.error ?? null,
          heavyMessage: (heavyData as any)?.message ?? null,
          heavyFailureKind:
            heavyRes.status === 504 || String((heavyData as any)?.error ?? "") === "compare_core_route_timeout"
              ? "route_timeout"
              : String((heavyData as any)?.error ?? "") === "compare_core_route_exception"
                ? "route_exception"
                : "route_error_response",
          compareHeavyBody: compareBodyHeavy,
          compareHeavyRequestTruth: {
            includeDiagnostics: true,
            includeFullReportText: true,
            compareFreshModeRequested: compareHeavyFreshModeRequested,
            runHeavyDiagnosticsStep: togglesSnapshot.runHeavyDiagnosticsStep,
          },
          heavyResponse: heavyData,
        }));
        setProgressStatus("Core compare complete. Heavy diagnostics failed; retry heavy report.");
        return;
      }
      finishPhase("compare_heavy", "done");
      mergeSuccessfulResult(heavyData);
      setHeavyRetryBody(null);
      setLastAttemptDebug((prev) => ({
        ...(prev ?? {}),
        phase: "orchestrator_success",
        heavyStatus: heavyRes.status,
        compareHeavyBody: compareBodyHeavy,
        compareHeavyRequestTruth: {
          includeDiagnostics: true,
          includeFullReportText: true,
          compareFreshModeRequested: compareHeavyFreshModeRequested,
          runHeavyDiagnosticsStep: togglesSnapshot.runHeavyDiagnosticsStep,
        },
        heavyResponse: heavyData,
        finishedAt: new Date().toISOString(),
      }));
      setProgressStatus(null);
    } catch (e: unknown) {
      const normalizedError = normalizeUnknownUiError(
        e,
        "Pipeline step failed. See Last Attempt Debug + Orchestrator Timeline for details."
      );
      setOrchestratorPhases((prev) =>
        markActiveOrchestratorPhasesErrored(prev, {
          errorCode: normalizedError.isAbortError ? "phase_timeout" : "phase_exception",
          errorMessage: normalizedError.message,
        })
      );
      setProgressStatus(null);
      const msg =
        normalizedError.isAbortError
          ? "Pipeline step timed out. See Last Attempt Debug + Orchestrator Timeline for failing phase."
          : normalizedError.message;
      if (normalizedError.isAbortError) setArtifactMissing(true);
      setError(msg);
      setLastAttemptDebug((prev) => ({
        ...(prev ?? {}),
        phase: normalizedError.isAbortError ? "orchestrator_timeout" : "orchestrator_exception",
        errorName: normalizedError.name,
        errorMessage: normalizedError.message,
      }));
    } finally {
      setLoading(false);
      compareInFlightRef.current = false;
    }
  }

  async function handleRetryHeavyDiagnostics() {
    if (compareInFlightRef.current || rebuildInFlightRef.current) {
      setError("A Gap-Fill request is already running. Wait for it to finish.");
      return;
    }
    if (!heavyRetryBody) {
      setError("No heavy-report retry payload is available. Run Compare first.");
      return;
    }
    compareInFlightRef.current = true;
    setLoading(true);
    setError(null);
    updateOrchestratorPhase("compare_heavy", {
      status: "active",
      startedAt: new Date().toISOString(),
      endedAt: null,
      elapsedMs: null,
      errorCode: null,
      errorMessage: null,
    });
    setProgressStatus("Retrying heavy diagnostics report...");
    try {
      setLastAttemptDebug((prev) => ({
        ...(prev ?? {}),
        phase: "compare_heavy_retry_started",
        timeoutMs: GAPFILL_COMPARE_HEAVY_TIMEOUT_MS,
        compareHeavyRetryBody: heavyRetryBody,
      }));
      const startedAtMs = Date.now();
      let res: Response;
      let data: ApiResponse;
      try {
        const retryResult = await postGapfill(heavyRetryBody, GAPFILL_COMPARE_HEAVY_TIMEOUT_MS);
        res = retryResult.res;
        data = retryResult.data;
      } catch (e: unknown) {
        const failure = classifyHeavyDiagnosticsUiFailure(e);
        updateOrchestratorPhase("compare_heavy", {
          status: "error",
          endedAt: new Date().toISOString(),
          errorCode: failure.errorCode,
          errorMessage: failure.message,
        });
        setError(failure.message);
        setLastAttemptDebug((prev) => ({
          ...(prev ?? {}),
          phase:
            failure.failureKind === "client_timeout"
              ? "compare_heavy_retry_timeout"
              : failure.failureKind === "fetch_failure"
                ? "compare_heavy_retry_fetch_failure"
                : "compare_heavy_retry_exception",
          heavyRetryError: failure.errorCode,
          heavyRetryMessage: failure.message,
          heavyRetryFailureKind: failure.failureKind,
        }));
        return;
      }
      if (!res.ok || !data.ok) {
        const endedAtMs = Date.now();
        updateOrchestratorPhase("compare_heavy", {
          status: "error",
          endedAt: new Date(endedAtMs).toISOString(),
          elapsedMs: endedAtMs - startedAtMs,
          errorCode: String((data as any)?.error ?? "compare_heavy_retry_failed"),
          errorMessage: formatApiError(data as any, res.status),
        });
        setError(formatApiError(data as any, res.status));
        setLastAttemptDebug((prev) => ({
          ...(prev ?? {}),
          phase: "compare_heavy_retry_error",
          heavyRetryStatus: res.status,
          heavyRetryError: (data as any)?.error ?? null,
          heavyRetryMessage: (data as any)?.message ?? null,
          heavyRetryFailureKind:
            res.status === 504 || String((data as any)?.error ?? "") === "compare_core_route_timeout"
              ? "route_timeout"
              : String((data as any)?.error ?? "") === "compare_core_route_exception"
                ? "route_exception"
                : "route_error_response",
        }));
        return;
      }
      const endedAtMs = Date.now();
      updateOrchestratorPhase("compare_heavy", {
        status: "done",
        endedAt: new Date(endedAtMs).toISOString(),
        elapsedMs: endedAtMs - startedAtMs,
        errorCode: null,
        errorMessage: null,
      });
      mergeSuccessfulResult(data);
      setHeavyRetryBody(null);
      setLastAttemptDebug((prev) => ({
        ...(prev ?? {}),
        phase: "compare_heavy_retry_success",
        heavyRetryStatus: res.status,
      }));
      setProgressStatus(null);
    } catch (e: any) {
      const normalized = normalizeUnknownUiError(
        e,
        "Heavy diagnostics retry failed after the request started."
      );
      updateOrchestratorPhase("compare_heavy", {
        status: "error",
        endedAt: new Date().toISOString(),
        errorCode: normalized.name ?? "compare_heavy_retry_exception",
        errorMessage: normalized.message,
      });
      setError(normalized.message);
      setLastAttemptDebug((prev) => ({
        ...(prev ?? {}),
        phase: "compare_heavy_retry_exception",
        errorName: normalized.name ?? null,
        errorMessage: normalized.message,
      }));
    } finally {
      setLoading(false);
      compareInFlightRef.current = false;
    }
  }

  async function handleRebuildAndRetry() {
    if (compareInFlightRef.current || rebuildInFlightRef.current) {
      setError("A Gap-Fill request is already running. Wait for it to finish.");
      return;
    }
    rebuildInFlightRef.current = true;
    if (!lastCompareBody) {
      setError("No prior compare request found. Run Compare first.");
      rebuildInFlightRef.current = false;
      return;
    }
    setResult(null);
    setRebuildLoading(true);
    setError(null);
    setProgressStatus(null);
    setHeavyRetryBody(null);
    try {
      const rebuildBody = { ...lastCompareBody, rebuildArtifact: true, rebuildOnly: true };
      setLastAttemptDebug((prev) => ({
        ...(prev ?? {}),
        phase: "manual_rebuild_started",
        timeoutMs: GAPFILL_REBUILD_TIMEOUT_MS,
        rebuildBody,
      }));
      const { res: rebuildRes, data: rebuildData } = await postGapfill(
        rebuildBody,
        GAPFILL_REBUILD_TIMEOUT_MS
      );
      if (!rebuildRes.ok) {
        setProgressStatus(null);
        const errMsg = formatApiError(rebuildData, rebuildRes.status);
        setError(errMsg);
        setArtifactMissing(isArtifactRebuildRequiredError((rebuildData as any)?.error));
        setLastAttemptDebug((prev) => ({
          ...(prev ?? {}),
          phase: "manual_rebuild_error",
          rebuildStatus: rebuildRes.status,
          rebuildError: (rebuildData as any)?.error ?? null,
          rebuildMessage: (rebuildData as any)?.message ?? null,
        }));
        return;
      }
      const compareBody = buildCompareBodyAfterRebuild(lastCompareBody, rebuildData);
      setLastCompareBody(compareBody);
      setArtifactMissing(false);
      setProgressStatus("Rebuild complete. Click \"Run Compare\" to load results.");
      setError(null);
      // Do not auto-run compare here; it often times out. User runs compare in a separate request with full timeout budget.
    } catch (e: any) {
      setProgressStatus(null);
      setError(e?.name === "AbortError" ? "Request timed out while rebuilding or re-running compare. Retry once more." : (e?.message ?? String(e)));
      setLastAttemptDebug((prev) => ({
        ...(prev ?? {}),
        phase: e?.name === "AbortError" ? "manual_rebuild_timeout" : "manual_rebuild_exception",
        errorName: e?.name ?? null,
        errorMessage: e?.message ?? String(e),
      }));
    } finally {
      setRebuildLoading(false);
      rebuildInFlightRef.current = false;
    }
  }

  async function copyPasteSummary() {
    if (!result || !result.ok || !result.pasteSummary) return;
    try {
      await navigator.clipboard.writeText(result.pasteSummary);
    } catch {
      // ignore
    }
  }

  async function copyFullReport() {
    if (!result || !result.ok) return;
    const text = (result as any).fullReportText ?? "";
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // ignore
    }
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="mb-6">
        <Link href="/admin" className="text-brand-blue hover:underline text-sm">
          ← Admin
        </Link>
        <h1 className="text-2xl font-bold text-brand-navy mt-2">Gap-Fill Lab</h1>
        <p className="text-brand-navy/70 text-sm mt-1">
          Compare gap-fill simulation vs actual usage on masked (travel/vacant) intervals. Uses email only (no homeId).
        </p>
      </div>

      <div className="space-y-4 mb-8">
        <div>
          <label className="block text-sm font-medium text-brand-navy mb-1">Email (required)</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="user@example.com"
            className="w-full max-w-md border border-brand-blue/30 rounded px-3 py-2 text-brand-navy"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-brand-navy mb-1">Timezone</label>
          <input
            type="text"
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            className="w-full max-w-md border border-brand-blue/30 rounded px-3 py-2 text-brand-navy"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleLookup}
            disabled={lookupLoading || loading || rebuildLoading || usage365Loading}
            className="px-4 py-2 bg-brand-blue text-white rounded hover:bg-brand-navy disabled:opacity-50"
          >
            {lookupLoading ? "Looking up..." : "Lookup"}
          </button>
          <button
            type="button"
            onClick={handleLoadUsage365}
            disabled={usage365Loading || lookupLoading || loading || rebuildLoading}
            className="px-4 py-2 bg-brand-navy text-white rounded hover:bg-brand-blue disabled:opacity-50"
          >
            {usage365Loading ? "Loading Usage 365..." : "Load Usage (365-day)"}
          </button>
        </div>

        {houses.length > 1 && (
          <div>
            <label className="block text-sm font-medium text-brand-navy mb-1">House</label>
            <select
              value={houseId}
              onChange={(e) => handleHouseChange(e.target.value)}
              className="w-full max-w-md border border-brand-blue/30 rounded px-3 py-2 text-brand-navy"
            >
              {houses.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.label}
                </option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-brand-navy mb-2">Vacant/Travel (DB)</label>
          <p className="text-sm text-brand-navy/60 mb-2">
            Vacant/Travel (DB) still guard scored actual days, and compare also validates those dates through the shared Past simulation path against canonical artifact simulated-day totals.
          </p>
          {travelRangesFromDb.length > 0 ? (
            <div className="p-3 rounded border border-brand-blue/20 bg-brand-navy/5 space-y-1">
              {travelRangesFromDb.map((r, i) => (
                <div key={i} className="text-sm text-brand-navy">
                  {formatDate(r.startDate)} – {formatDate(r.endDate)}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-brand-navy/60 italic">Run Lookup to load. None saved if empty.</p>
          )}
        </div>
        <div>
          <label className="block text-sm font-medium text-brand-navy mb-2">Test Dates</label>
          <p className="text-sm text-brand-navy/60 mb-2">
            Only Test Dates are scored against actual intervals. Do not overlap Vacant/Travel (DB) above when using manual ranges.
          </p>
          <div className="flex flex-wrap gap-2 mb-2">
            <button
              type="button"
              onClick={() => setTestMode("manual_ranges")}
              className={`px-3 py-1.5 rounded text-sm ${testMode === "manual_ranges" ? "bg-brand-navy text-white" : "bg-brand-navy/10 text-brand-navy"}`}
            >
              Manual Test Ranges
            </button>
            <button
              type="button"
              onClick={() => setTestMode("random_days")}
              className={`px-3 py-1.5 rounded text-sm ${testMode === "random_days" ? "bg-brand-navy text-white" : "bg-brand-navy/10 text-brand-navy"}`}
            >
              Random Test Days
            </button>
          </div>
          {testMode === "manual_ranges" && (
            <div className="space-y-2">
              {testRanges.map((r, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2">
                  <input
                    type="date"
                    value={r.startDate}
                    onChange={(e) => updateTestRange(i, "startDate", e.target.value)}
                    className="border border-brand-blue/30 rounded px-3 py-2 text-brand-navy"
                  />
                  <span className="text-brand-navy/60">–</span>
                  <input
                    type="date"
                    value={r.endDate}
                    onChange={(e) => updateTestRange(i, "endDate", e.target.value)}
                    className="border border-brand-blue/30 rounded px-3 py-2 text-brand-navy"
                  />
                  <button type="button" onClick={() => removeTestRange(i)} className="text-rose-600 hover:underline text-sm">
                    Remove
                  </button>
                </div>
              ))}
              <button type="button" onClick={addTestRange} className="text-brand-blue hover:underline text-sm">
                + Add range
              </button>
            </div>
          )}
          {testMode === "random_days" && (
            <div className="p-3 rounded border border-brand-blue/20 bg-brand-navy/5 space-y-3 max-w-md">
              <div>
                <label className="block text-xs text-brand-navy/70 mb-1">Test day selection mode</label>
                <select
                  value={randomTestMode}
                  onChange={(e) => setRandomTestMode(e.target.value as RandomTestMode)}
                  className="w-full border border-brand-blue/30 rounded px-2 py-1.5 text-brand-navy"
                >
                  <option value="fixed">Fixed (deterministic, same days every run)</option>
                  <option value="random">Random (different days each run)</option>
                  <option value="winter">Winter (Dec, Jan, Feb only)</option>
                  <option value="summer">Summer (Jun, Jul, Aug only)</option>
                  <option value="shoulder">Shoulder (Mar–May, Sep–Nov)</option>
                  <option value="extreme_weather">Extreme weather (min ≤ -2°C or max ≥ 35°C)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-brand-navy/70 mb-1">Test Days</label>
                <input
                  type="number"
                  min={1}
                  max={365}
                  value={testDays}
                  onChange={(e) => setTestDays(Math.max(1, Math.min(365, parseInt(e.target.value, 10) || 21)))}
                  className="w-24 border border-brand-blue/30 rounded px-2 py-1.5 text-brand-navy"
                />
              </div>
              <div>
                <label className="block text-xs text-brand-navy/70 mb-1">Seed (optional; blank = server picks)</label>
                <input
                  type="text"
                  value={seed}
                  onChange={(e) => setSeed(e.target.value)}
                  placeholder="e.g. my-run-1"
                  className="w-full border border-brand-blue/30 rounded px-2 py-1.5 text-brand-navy"
                />
              </div>
              <div>
                <label className="block text-xs text-brand-navy/70 mb-1">Min Day Coverage %</label>
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={minDayCoveragePct}
                  onChange={(e) => setMinDayCoveragePct(Math.max(1, Math.min(100, parseInt(e.target.value, 10) || 95)))}
                  className="w-20 border border-brand-blue/30 rounded px-2 py-1.5 text-brand-navy"
                />
              </div>
              <div className="flex flex-wrap gap-4">
                <label className="flex items-center gap-2 text-sm text-brand-navy">
                  <input
                    type="checkbox"
                    checked={stratifyByMonth}
                    onChange={(e) => setStratifyByMonth(e.target.checked)}
                    className="rounded"
                  />
                  Stratify by month
                </label>
                <label className="flex items-center gap-2 text-sm text-brand-navy">
                  <input
                    type="checkbox"
                    checked={stratifyByWeekend}
                    onChange={(e) => setStratifyByWeekend(e.target.checked)}
                    className="rounded"
                  />
                  Stratify by weekend/weekday
                </label>
              </div>
              {result && result.ok && (result as any).testSelectionMode === "random_days" && (result as any).fullReportJson?.scenario?.testRangesInput?.length > 0 && (
                <div className="mt-2 pt-2 border-t border-brand-blue/20">
                  <div className="text-xs text-brand-navy/70 mb-1">Selected Test Dates (read-only)</div>
                  <div className="text-sm text-brand-navy space-y-0.5">
                    {(result as any).fullReportJson.scenario.testRangesInput.slice(0, 10).map((r: RangeRow, i: number) => (
                      <div key={i}>{formatDate(r.startDate)} – {formatDate(r.endDate)}</div>
                    ))}
                    {(result as any).fullReportJson.scenario.testRangesInput.length > 10 && (
                      <div className="text-brand-navy/60">… and {(result as any).fullReportJson.scenario.testRangesInput.length - 10} more ranges</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
        <div>
          <label className="block text-sm font-medium text-brand-navy mb-2">Weather for simulation</label>
          <p className="text-sm text-brand-navy/60 mb-2">
            Choose which temperature source to use for gap-fill weather scaling (last year, normals, or live API).
          </p>
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-sm text-brand-navy cursor-pointer">
              <input
                type="radio"
                name="weatherKind"
                checked={weatherKind === "ACTUAL_LAST_YEAR"}
                onChange={() => setWeatherKind("ACTUAL_LAST_YEAR")}
                className="text-brand-blue"
              />
              Last year temps
            </label>
            <label className="flex items-center gap-2 text-sm text-brand-navy cursor-pointer">
              <input
                type="radio"
                name="weatherKind"
                checked={weatherKind === "NORMAL_AVG"}
                onChange={() => setWeatherKind("NORMAL_AVG")}
                className="text-brand-blue"
              />
              Average temps
            </label>
            <label className="flex items-center gap-2 text-sm text-brand-navy cursor-pointer">
              <input
                type="radio"
                name="weatherKind"
                checked={weatherKind === "open_meteo"}
                onChange={() => setWeatherKind("open_meteo")}
                className="text-brand-blue"
              />
              Live (Open-Meteo)
            </label>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleRunCompare}
            disabled={loading}
            className="px-4 py-2 bg-brand-navy text-white rounded hover:bg-brand-blue disabled:opacity-50"
          >
            {loading ? "Running…" : "Run Compare"}
          </button>
          <label className="flex items-center gap-2 text-sm text-brand-navy">
            <input
              type="checkbox"
              checked={fullDiagnosticsOnEnsure}
              onChange={(e) => setFullDiagnosticsOnEnsure(e.target.checked)}
              className="rounded"
            />
            Full diagnostics on artifact ensure
          </label>
          <label className="flex items-center gap-2 text-sm text-brand-navy">
            <input
              type="checkbox"
              checked={fullDiagnosticsOnCore}
              onChange={(e) => setFullDiagnosticsOnCore(e.target.checked)}
              className="rounded"
            />
            Full diagnostics on core compare
          </label>
          <label className="flex items-center gap-2 text-sm text-brand-navy">
            <input
              type="checkbox"
              checked={runHeavyDiagnosticsStep}
              onChange={(e) => setRunHeavyDiagnosticsStep(e.target.checked)}
              className="rounded"
            />
            Run heavy diagnostics step
          </label>
          <span className="text-sm text-brand-navy/60">Typically returns in seconds (test-days-only).</span>
        </div>
        {progressStatus && (
          <div className="text-sm text-brand-navy/80">{progressStatus}</div>
        )}
      </div>

      {error && (
        <div className="mb-6 p-4 rounded bg-rose-50 text-rose-800 border border-rose-200">
          <div className="whitespace-pre-line">{error}</div>
          {artifactMissing && (
            <button
              type="button"
              onClick={handleRebuildAndRetry}
              disabled={rebuildLoading || loading}
              className="mt-3 px-3 py-1.5 bg-brand-navy text-white rounded hover:bg-brand-blue disabled:opacity-50 text-sm"
            >
              {rebuildLoading ? "Rebuilding and retrying..." : "Rebuild artifact and retry"}
            </button>
          )}
          {!artifactMissing && heavyRetryBody && (
            <button
              type="button"
              onClick={handleRetryHeavyDiagnostics}
              disabled={loading || rebuildLoading}
              className="mt-3 px-3 py-1.5 bg-brand-navy text-white rounded hover:bg-brand-blue disabled:opacity-50 text-sm"
            >
              Retry heavy diagnostics only
            </button>
          )}
        </div>
      )}

      {(error || usageShapeNeedsAction || noScoreableIntervals || heavyRetryBody) && (
        <div className="mb-6 p-4 rounded border border-brand-blue/20 bg-white">
          <div className="font-semibold text-brand-navy mb-2">Failure / Dependency Summary</div>
          <div className="space-y-2 text-sm">
            {error && (
              <div>
                <span className={badgeClass("error")}>compare failure</span>
                <span className="ml-2 text-brand-navy/80">
                  {phaseStateByKey.get("compare_core") === "error"
                    ? "Compare core failed; see Orchestrator Timeline for exact reason."
                    : phaseStateByKey.get("compare_heavy") === "error"
                      ? "Heavy diagnostics failed; core compare may still be valid."
                      : "Request failed before completion."}
                </span>
              </div>
            )}
            {heavyRetryBody && (
              <div>
                <span className={badgeClass("warn")}>heavy diagnostics retry available</span>
                <span className="ml-2 text-brand-navy/80">
                  Core compare has run, but heavy report payload needs retry.
                </span>
              </div>
            )}
            {artifactMissing && (
              <div>
                <span className={badgeClass("warn")}>artifact rebuild required</span>
                <span className="ml-2 text-brand-navy/80">
                  Shared artifact is missing/stale/join-incomplete for this run. Use rebuild action.
                </span>
              </div>
            )}
            {noScoreableIntervals && (
              <div>
                <span className={badgeClass("warn")}>no scoreable intervals</span>
                <span className="ml-2 text-brand-navy/80">
                  Test date selection did not yield joinable actual-vs-sim intervals.
                </span>
              </div>
            )}
            {usageShapeNeedsAction && (
              <div>
                <span className={badgeClass("warn")}>usage-shape dependency needs action</span>
                <span className="ml-2 text-brand-navy/80">
                  Usage-shape profile is missing/not used for this run.
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {orchestratorPhases.some((phase) => phase.status !== "pending") && (
        <details className="mb-6 border border-brand-blue/20 rounded" open>
          <summary className="p-3 cursor-pointer font-semibold text-brand-navy bg-brand-blue/5 rounded-t">
            Orchestrator Timeline
          </summary>
          <div className="p-4 border-t border-brand-blue/20 space-y-2">
            {orchestratorPhases.map((phase) => (
              <div key={phase.key} className="p-3 border border-brand-blue/20 rounded text-sm">
                <div className="flex items-center justify-between gap-3">
                  <div className="font-medium text-brand-navy">{phase.label}</div>
                  <div
                    className={`font-semibold ${
                      phase.status === "done"
                        ? "text-emerald-700"
                        : phase.status === "active"
                          ? "text-amber-700"
                          : phase.status === "error"
                            ? "text-rose-700"
                            : "text-brand-navy/60"
                    }`}
                  >
                    {phase.status}
                  </div>
                </div>
                <div className="text-brand-navy/70 mt-1">
                  {phase.elapsedMs != null ? `elapsed ${phase.elapsedMs} ms` : "elapsed —"}
                </div>
                {phase.errorMessage && (
                  <div className="text-rose-700 mt-1 whitespace-pre-line">
                    {phase.errorCode ? `${phase.errorCode}: ` : ""}
                    {phase.errorMessage}
                  </div>
                )}
              </div>
            ))}
          </div>
        </details>
      )}

      {lastAttemptDebug && (
        <details className="mb-6 border border-brand-blue/20 rounded" open>
          <summary className="p-3 cursor-pointer font-semibold text-brand-navy bg-brand-blue/5 rounded-t">
            Step Request / Response Payloads
          </summary>
          <div className="p-4 border-t border-brand-blue/20 space-y-3">
            {[
              { key: "lookup_inputs", request: (lastAttemptDebug as any).lookupBody, response: (lastAttemptDebug as any).lookupResponse, status: (lastAttemptDebug as any).lookupStatus },
              { key: "usage365_load", request: (lastAttemptDebug as any).usageBody, response: (lastAttemptDebug as any).usageResponse, status: (lastAttemptDebug as any).usageStatus },
              { key: "artifact_ensure", request: (lastAttemptDebug as any).ensureBody, response: (lastAttemptDebug as any).ensureResponse, status: (lastAttemptDebug as any).ensureStatus },
              { key: "compare_core", request: (lastAttemptDebug as any).compareCoreBody, response: (lastAttemptDebug as any).coreResponse, status: (lastAttemptDebug as any).coreStatus },
              { key: "compare_heavy", request: (lastAttemptDebug as any).compareHeavyBody, response: (lastAttemptDebug as any).heavyResponse, status: (lastAttemptDebug as any).heavyStatus },
            ]
              .filter((row) => row.request != null || row.response != null || row.status != null)
              .map((row) => (
                <details key={row.key} className="border border-brand-blue/20 rounded">
                  <summary className="px-3 py-2 cursor-pointer text-sm font-medium text-brand-navy bg-brand-navy/5">
                    {row.key}
                    {row.status != null ? ` (status ${row.status})` : ""}
                  </summary>
                  <pre className="text-xs bg-brand-navy/5 p-3 rounded-b overflow-x-auto max-h-72 overflow-y-auto">
                    {JSON.stringify({ request: row.request ?? null, response: row.response ?? null }, null, 2)}
                  </pre>
                </details>
              ))}
          </div>
        </details>
      )}

      {lastAttemptDebug && (
        <details className="mb-6 border border-brand-blue/20 rounded" open>
          <summary className="p-3 cursor-pointer font-semibold text-brand-navy bg-brand-blue/5 rounded-t">
            Last Attempt Debug
          </summary>
          <div className="p-4 border-t border-brand-blue/20">
            <pre className="text-xs bg-brand-navy/5 p-3 rounded overflow-x-auto max-h-80 overflow-y-auto">
              {JSON.stringify(lastAttemptDebug, null, 2)}
            </pre>
          </div>
        </details>
      )}

      {result && result.ok && (
        <div className="space-y-4">
          {(hasUsage365ChartData || hasGapfillChartData) ? (
            <details className="border border-brand-blue/20 rounded" open>
              <summary className="p-3 cursor-pointer font-semibold text-brand-navy bg-brand-blue/5 rounded-t">
                Usage / Gap-Fill chart
              </summary>
              <div className="p-4 border-t border-brand-blue/20">
                <div className="mb-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setChartMode("usage365")}
                    className={`px-3 py-1.5 rounded text-sm border ${
                      effectiveChartMode === "usage365"
                        ? "bg-brand-navy text-white border-brand-navy"
                        : "bg-white text-brand-navy border-brand-blue/30"
                    }`}
                  >
                    Usage (365-day)
                  </button>
                  <button
                    type="button"
                    onClick={() => setChartMode("gapfill")}
                    className={`px-3 py-1.5 rounded text-sm border ${
                      effectiveChartMode === "gapfill"
                        ? "bg-brand-navy text-white border-brand-navy"
                        : "bg-white text-brand-navy border-brand-blue/30"
                    }`}
                  >
                    Gap-Fill (simulated test window)
                  </button>
                </div>
                {effectiveChartMode === "gapfill" && gapfillChartData ? (
                  <>
                    <p className="text-sm text-brand-navy/70 mb-4">
                      Source: {gapfillChartData.source} · {gapfillChartData.intervalCount.toLocaleString()} intervals ·
                      {` ${gapfillChartData.coverageStart ?? "—"} to ${gapfillChartData.coverageEnd ?? "—"}`}
                    </p>
                    <UsageChartsPanel
                      monthly={gapfillChartData.monthly}
                      stitchedMonth={gapfillChartData.stitchedMonth ?? null}
                      weekdayKwh={gapfillChartData.weekdayKwh}
                      weekendKwh={gapfillChartData.weekendKwh}
                      monthlyView={usageMonthlyView}
                      onMonthlyViewChange={setUsageMonthlyView}
                      dailyView={usageDailyView}
                      onDailyViewChange={setUsageDailyView}
                      daily={gapfillChartData.daily}
                      fifteenCurve={gapfillChartData.fifteenCurve}
                      coverageStart={gapfillChartData.coverageStart}
                      coverageEnd={gapfillChartData.coverageEnd}
                    />
                  </>
                ) : usage365ChartData?.daily?.length ? (
                  <>
                    <p className="text-sm text-brand-navy/70 mb-4">
                      Source: {usage365ChartData.source} · {usage365ChartData.intervalCount.toLocaleString()} intervals ·
                      {` ${usage365ChartData.coverageStart ?? "—"} to ${usage365ChartData.coverageEnd ?? "—"}`}
                    </p>
                    <UsageChartsPanel
                      monthly={usage365ChartData.monthly}
                      stitchedMonth={usage365ChartData.stitchedMonth ?? null}
                      weekdayKwh={usage365ChartData.weekdayKwh}
                      weekendKwh={usage365ChartData.weekendKwh}
                      monthlyView={usageMonthlyView}
                      onMonthlyViewChange={setUsageMonthlyView}
                      dailyView={usageDailyView}
                      onDailyViewChange={setUsageDailyView}
                      daily={usage365ChartData.daily}
                      fifteenCurve={usage365ChartData.fifteenCurve}
                      coverageStart={usage365ChartData.coverageStart}
                      coverageEnd={usage365ChartData.coverageEnd}
                    />
                  </>
                ) : (
                  <p className="text-sm text-brand-navy/70">
                    No chart data for this view yet. Load Usage (365-day) or run Compare.
                  </p>
                )}
              </div>
            </details>
          ) : null}

          <div className="p-4 rounded bg-brand-blue/5 border border-brand-blue/20">
            <div className="font-semibold text-brand-navy">Simulation Audit Report</div>
            <div className="text-sm text-brand-navy/80 mt-1">
              {result.house?.label} · {result.testIntervalsCount} test intervals
              {result.metrics ? ` · WAPE ${result.metrics.wape}% · MAE ${result.metrics.mae} kWh · RMSE ${result.metrics.rmse}` : ""}
            </div>
            {(result as any).testSelectionMode === "random_days" && (
              <div className="text-sm text-brand-navy/80 mt-1">
                Test selection: Random ({(result as any).testDaysSelected ?? "—"} days)
                {(result as any).testMode ? `, mode=${(result as any).testMode}` : ""}
                {(result as any).candidateDaysAfterModeFilterCount != null ? `, candidates after filter=${(result as any).candidateDaysAfterModeFilterCount}` : ""}
                {(result as any).seedUsed ? `, seed=${(result as any).seedUsed}` : ""}
                {(result as any).minDayCoveragePct != null ? `, minCoverage=${Math.round((result as any).minDayCoveragePct * 100)}%` : ""}
              </div>
            )}
          </div>

          <div className="p-4 rounded border border-brand-blue/20 bg-white">
            <div className="font-semibold text-brand-navy mb-2">Hybrid Automation Step Status</div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {hybridStepStatus.map((step) => (
                <div key={step.key} className="p-2 border border-brand-blue/20 rounded text-sm">
                  <div className="text-brand-navy">{step.label}</div>
                  <div
                    className={`font-semibold ${
                      step.failed
                        ? "text-rose-700"
                        : step.state === "done"
                        ? "text-emerald-700"
                        : step.state === "active"
                          ? "text-amber-700"
                          : "text-brand-navy/60"
                    }`}
                  >
                    {step.failed ? "error" : step.state}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <details className="border border-brand-blue/20 rounded" open>
            <summary className="p-3 cursor-pointer font-semibold text-brand-navy bg-brand-blue/5 rounded-t">
              Artifact Processing Status
            </summary>
            <div className="p-4 border-t border-brand-blue/20 space-y-3 text-sm">
              <div className="grid md:grid-cols-2 gap-3">
                <div className="p-3 rounded border border-brand-blue/20">
                  <div className="text-xs text-brand-navy/70">Artifact source mode</div>
                  <div className="font-mono">{String(artifactStatus?.sourceMode ?? "—")}</div>
                </div>
                <div className="p-3 rounded border border-brand-blue/20">
                  <div className="text-xs text-brand-navy/70">Artifact path kind</div>
                  <div className="font-mono">{String(artifactStatus?.pathKind ?? "—")}</div>
                </div>
                <div className="p-3 rounded border border-brand-blue/20">
                  <div className="text-xs text-brand-navy/70">Hash alignment</div>
                  <div className="font-mono">
                    {artifactStatus?.artifactHashMatch == null
                      ? "—"
                      : artifactStatus.artifactHashMatch
                        ? "match"
                        : "mismatch"}
                  </div>
                </div>
                <div className="p-3 rounded border border-brand-blue/20">
                  <div className="text-xs text-brand-navy/70">Scenario ID</div>
                  <div className="font-mono break-all">{String(artifactStatus?.scenarioId ?? "—")}</div>
                </div>
              </div>
              <div className="p-3 rounded border border-brand-blue/20">
                <div className="font-medium text-brand-navy mb-1">Artifact details</div>
                <pre className="text-xs bg-brand-navy/5 p-2 rounded overflow-x-auto">
                  {JSON.stringify(artifactStatus ?? null, null, 2)}
                </pre>
              </div>
            </div>
          </details>

          <details className="border border-brand-blue/20 rounded" open>
            <summary className="p-3 cursor-pointer font-semibold text-brand-navy bg-brand-blue/5 rounded-t">
              Shared Module Alignment
            </summary>
            <div className="p-4 border-t border-brand-blue/20 space-y-3 text-sm">
              <div className="grid md:grid-cols-2 gap-3">
                <div className="p-3 rounded border border-brand-blue/20">
                  <div className="text-xs text-brand-navy/70">Compare mode used</div>
                  <div className="mt-1 flex items-center gap-2">
                    <span className={badgeClass("neutral")}>
                      {String(compareTruth?.compareFreshModeUsed ?? truthEnvelope?.compareFreshModeUsed ?? "—")}
                    </span>
                    <span className="text-brand-navy/80">
                      {String(compareTruth?.compareFreshModeLabel ?? "—")}
                    </span>
                  </div>
                </div>
                <div className="p-3 rounded border border-brand-blue/20">
                  <div className="text-xs text-brand-navy/70">Calculation scope</div>
                  <div className="mt-1 flex items-center gap-2">
                    <span className={badgeClass("neutral")}>
                      {String(compareTruth?.compareCalculationScope ?? truthEnvelope?.compareCalculationScope ?? "—")}
                    </span>
                  </div>
                  <div className="text-brand-navy/80 mt-1">
                    {String(compareTruth?.compareCalculationScopeLabel ?? "—")}
                  </div>
                </div>
                <div className="p-3 rounded border border-brand-blue/20">
                  <div className="text-xs text-brand-navy/70">Shared calc path</div>
                  <div className="font-mono break-words">{String(compareTruth?.compareSharedCalcPath ?? truthEnvelope?.compareSharedCalcPath ?? "—")}</div>
                </div>
                <div className="p-3 rounded border border-brand-blue/20">
                  <div className="text-xs text-brand-navy/70">Compare sim source</div>
                  <div className="font-mono">{String(compareTruth?.compareSimSource ?? truthEnvelope?.compareSimSource ?? "—")}</div>
                </div>
                <div className="p-3 rounded border border-brand-blue/20">
                  <div className="text-xs text-brand-navy/70">Display sim source</div>
                  <div className="font-mono">{String(compareTruth?.displaySimSource ?? truthEnvelope?.displaySimSource ?? "—")}</div>
                </div>
                <div className="p-3 rounded border border-brand-blue/20">
                  <div className="text-xs text-brand-navy/70">Weather basis used</div>
                  <div className="font-mono">{String(compareTruth?.weatherBasisUsed ?? truthEnvelope?.weatherBasisUsed ?? "—")}</div>
                </div>
                <div className="p-3 rounded border border-brand-blue/20">
                  <div className="text-xs text-brand-navy/70">Travel/vacant parity</div>
                  <div className="font-mono">
                    {String(compareTruth?.travelVacantParityAvailability ?? travelVacantParityTruth?.availability ?? "—")}
                  </div>
                </div>
              </div>
              <div className="p-3 rounded border border-brand-blue/20">
                <div className="text-xs text-brand-navy/70">Architecture note</div>
                <div className="text-brand-navy/80 mt-1">
                  {String(compareTruth?.architectureNote ?? "—")}
                </div>
              </div>
              <div className="p-3 rounded border border-brand-blue/20">
                <div className="text-xs text-brand-navy/70">Display vs fresh parity</div>
                <div className="font-mono">
                  {truthEnvelope?.displayVsFreshParityForScoredDays
                    ? JSON.stringify(truthEnvelope.displayVsFreshParityForScoredDays)
                    : "—"}
                </div>
              </div>
            </div>
          </details>

          <details className="border border-brand-blue/20 rounded" open>
            <summary className="p-3 cursor-pointer font-semibold text-brand-navy bg-brand-blue/5 rounded-t">
              Compare-Core Weather Truth
            </summary>
            <div className="p-4 border-t border-brand-blue/20 space-y-3 text-sm">
              {compareCoreScoredDayWeatherTruth && (
                <div className="flex flex-wrap gap-2">
                  <span className={badgeClass(compareCoreScoredDayWeatherTruth.availability === "available" ? "ok" : "warn")}>
                    availability: {compareCoreScoredDayWeatherTruth.availability}
                  </span>
                  <span className={badgeClass("neutral")}>rows: {compareCoreScoredDayWeatherTruth.weatherRowCount}</span>
                  <span className={badgeClass(compareCoreScoredDayWeatherTruth.missingDateCount > 0 ? "warn" : "ok")}>
                    missing: {compareCoreScoredDayWeatherTruth.missingDateCount}
                  </span>
                </div>
              )}
              {compareCoreScoredDayWeatherRows.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs border border-brand-blue/20">
                    <thead>
                      <tr className="bg-brand-blue/10">
                        <th className="text-left p-2">Date</th>
                        <th className="text-right p-2">Avg/Min/Max F</th>
                        <th className="text-right p-2">HDD/CDD</th>
                        <th className="text-left p-2">Basis</th>
                        <th className="text-left p-2">Source</th>
                        <th className="text-left p-2">Fallback</th>
                      </tr>
                    </thead>
                    <tbody>
                      {compareCoreScoredDayWeatherRows.map((row) => (
                        <tr key={row.localDate} className="border-t border-brand-blue/10">
                          <td className="p-2 font-mono">{row.localDate}</td>
                          <td className="p-2 text-right font-mono">
                            {row.avgTempF ?? "—"} / {row.minTempF ?? "—"} / {row.maxTempF ?? "—"}
                          </td>
                          <td className="p-2 text-right font-mono">
                            {row.hdd65 ?? "—"} / {row.cdd65 ?? "—"}
                          </td>
                          <td className="p-2">{row.weatherBasisUsed ?? "—"}</td>
                          <td className="p-2">
                            <div className="font-mono">{row.weatherSourceUsed ?? "—"}</div>
                            <div className="text-brand-navy/60">{row.weatherProviderName ?? "—"}</div>
                          </td>
                          <td className="p-2">{row.weatherFallbackReason ?? "none"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-brand-navy/70">
                  No compare-core scored-day weather rows were returned for this run.
                </p>
              )}
            </div>
          </details>

          <details className="border border-brand-blue/20 rounded" open>
            <summary className="p-3 cursor-pointer font-semibold text-brand-navy bg-brand-blue/5 rounded-t">
              Travel / Vacant Parity Check
            </summary>
            <div className="p-4 border-t border-brand-blue/20 space-y-3 text-sm">
              {travelVacantParityTruth && (
                <div className="flex flex-wrap gap-2">
                  <span className={badgeClass(travelVacantParityTruth.exactProofSatisfied ? "ok" : "warn")}>
                    availability: {travelVacantParityTruth.availability}
                  </span>
                  <span className={badgeClass("neutral")}>requested: {travelVacantParityTruth.requestedDateCount}</span>
                  <span className={badgeClass(travelVacantParityTruth.validatedDateCount > 0 ? "ok" : "neutral")}>
                    validated: {travelVacantParityTruth.validatedDateCount}
                  </span>
                  <span className={badgeClass(travelVacantParityTruth.mismatchCount > 0 ? "error" : "ok")}>
                    mismatches: {travelVacantParityTruth.mismatchCount}
                  </span>
                </div>
              )}
              {travelVacantParityRows.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs border border-brand-blue/20">
                    <thead>
                      <tr className="bg-brand-blue/10">
                        <th className="text-left p-2">Date</th>
                        <th className="text-right p-2">Artifact canonical sim kWh</th>
                        <th className="text-right p-2">Fresh shared kWh</th>
                        <th className="text-left p-2">Artifact ref</th>
                        <th className="text-left p-2">Fresh output</th>
                        <th className="text-left p-2">Parity</th>
                        <th className="text-left p-2">Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {travelVacantParityRows.map((row) => (
                        <tr key={row.localDate} className="border-t border-brand-blue/10">
                          <td className="p-2 font-mono">{row.localDate}</td>
                          <td className="p-2 text-right font-mono">{row.artifactCanonicalSimDayKwh ?? "—"}</td>
                          <td className="p-2 text-right font-mono">{row.freshSharedDayCalcKwh ?? "—"}</td>
                          <td className="p-2">{row.artifactReferenceAvailability}</td>
                          <td className="p-2">{row.freshCompareAvailability}</td>
                          <td className="p-2">
                            {row.parityMatch == null ? (
                              <span className={badgeClass("neutral")}>n/a</span>
                            ) : row.parityMatch ? (
                              <span className={badgeClass("ok")}>match</span>
                            ) : (
                              <span className={badgeClass("error")}>mismatch</span>
                            )}
                          </td>
                          <td className="p-2">{row.parityReasonCode}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-brand-navy/70">
                  No DB travel/vacant parity rows were returned for this run.
                </p>
              )}
            </div>
          </details>

          <details className="border border-brand-blue/20 rounded" open>
            <summary className="p-3 cursor-pointer font-semibold text-brand-navy bg-brand-blue/5 rounded-t">
              Calculation / Input Truth
            </summary>
            <div className="p-4 border-t border-brand-blue/20 space-y-3 text-sm">
              <div className="grid md:grid-cols-2 gap-3">
                <div className="p-3 rounded border border-brand-blue/20">
                  <div className="text-xs text-brand-navy/70">Timezone used for scoring</div>
                  <div className="font-mono">{String(truthEnvelope?.timezoneUsedForScoring ?? "—")}</div>
                </div>
                <div className="p-3 rounded border border-brand-blue/20">
                  <div className="text-xs text-brand-navy/70">Scoring window</div>
                  <div className="font-mono">
                    {truthEnvelope?.windowUsedForScoring
                      ? `${truthEnvelope.windowUsedForScoring.startDate} to ${truthEnvelope.windowUsedForScoring.endDate}`
                      : "—"}
                  </div>
                </div>
                <div className="p-3 rounded border border-brand-blue/20">
                  <div className="text-xs text-brand-navy/70">Requested / scoring / scored intervals</div>
                  <div className="font-mono">
                    {String(truthEnvelope?.requestedTestDaysCount ?? "—")} / {String(truthEnvelope?.scoringTestDaysCount ?? "—")} /{" "}
                    {String(truthEnvelope?.scoredIntervalsCount ?? "—")}
                  </div>
                </div>
                <div className="p-3 rounded border border-brand-blue/20">
                  <div className="text-xs text-brand-navy/70">Travel/vacant exclusion count</div>
                  <div className="font-mono">{String(truthEnvelope?.travelVacantExclusionCount ?? "—")}</div>
                </div>
              </div>
              <div className="p-3 rounded border border-brand-blue/20">
                <div className="font-medium text-brand-navy mb-1">Artifact Outcome</div>
                <pre className="text-xs bg-brand-navy/5 p-2 rounded overflow-x-auto">
                  {JSON.stringify(truthEnvelope?.artifact ?? null, null, 2)}
                </pre>
              </div>
              <div className="p-3 rounded border border-brand-blue/20">
                <div className="font-medium text-brand-navy mb-1">Usage-Shape Dependency</div>
                <pre className="text-xs bg-brand-navy/5 p-2 rounded overflow-x-auto">
                  {JSON.stringify(usageShapeDependencyStatus ?? null, null, 2)}
                </pre>
                {usageShapeNeedsAction && (
                  <div className="mt-2 text-sm">
                    <Link className="text-brand-blue underline" href="/admin/tools/usage-shape-profile">
                      Open Usage Shape Profile tool
                    </Link>
                  </div>
                )}
              </div>
              <div className="p-3 rounded border border-brand-blue/20">
                <div className="font-medium text-brand-navy mb-1">Usage-Shape Profile Diagnostic</div>
                <pre className="text-xs bg-brand-navy/5 p-2 rounded overflow-x-auto">
                  {JSON.stringify(usageShapeDiag ?? null, null, 2)}
                </pre>
                {usageShapeNeedsAction && (
                  <div className="mt-2 text-xs text-amber-800">
                    Usage-shape dependency is not available for this run; open the Usage Shape Profile tool to inspect inputs/variables.
                  </div>
                )}
              </div>
            </div>
          </details>

          <details className="border border-brand-blue/20 rounded" open>
            <summary className="p-3 cursor-pointer font-semibold text-brand-navy bg-brand-blue/5 rounded-t">
              Scored Day Truth Table
            </summary>
            <div className="p-4 border-t border-brand-blue/20 space-y-3">
              {scoredDayTruthRowsForDisplay.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  <span className={badgeClass("neutral")}>rows: {scoredDayTruthRowsForDisplay.length}</span>
                  <span className={badgeClass(mismatchRowsCount > 0 ? "error" : "ok")}>
                    display-vs-fresh mismatches: {mismatchRowsCount}
                  </span>
                  <span className={badgeClass(largeErrorRowsCount > 0 ? "warn" : "ok")}>
                    |actual-fresh error| ≥ 5 kWh: {largeErrorRowsCount}
                  </span>
                </div>
              )}
              {scoredDayTruthRowsForDisplay.length > 0 ? (
                <div className="overflow-x-auto max-h-[28rem] overflow-y-auto">
                  <table className="w-full text-xs border border-brand-blue/20">
                    <thead>
                      <tr className="bg-brand-blue/10">
                        <th className="text-left p-2">Date</th>
                        <th className="text-right p-2">Actual kWh</th>
                        <th className="text-right p-2">Fresh compare kWh</th>
                        <th className="text-right p-2">Display sim kWh</th>
                        <th className="text-right p-2">Actual-Fresh error</th>
                        <th className="text-left p-2">Display-Fresh parity</th>
                        <th className="text-left p-2">Day type</th>
                        <th className="text-right p-2">Avg/Min/Max F</th>
                        <th className="text-right p-2">HDD/CDD</th>
                        <th className="text-left p-2">Weather basis</th>
                        <th className="text-left p-2">Weather source</th>
                        <th className="text-left p-2">Fallback</th>
                        <th className="text-left p-2">Day total source</th>
                        <th className="text-left p-2">Shape</th>
                        <th className="text-left p-2">Reference tier</th>
                        <th className="text-right p-2">Sample count</th>
                        <th className="text-left p-2">Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {scoredDayTruthRowsForDisplay.map((row) => {
                        const absErr = Math.abs(Number(row.actualVsFreshErrorKwh) || 0);
                        const mismatch = row.displayVsFreshParityMatch === false;
                        return (
                        <tr
                          key={row.localDate}
                          className={`border-t border-brand-blue/10 ${mismatch ? "bg-rose-50/60" : absErr >= 5 ? "bg-amber-50/50" : ""}`}
                        >
                          <td className="p-2 font-mono">{row.localDate}</td>
                          <td className="p-2 text-right font-mono">{row.actualDayKwh}</td>
                          <td className="p-2 text-right font-mono">{row.freshCompareSimDayKwh}</td>
                          <td className="p-2 text-right font-mono">{row.displayedPastStyleSimDayKwh}</td>
                          <td className="p-2 text-right font-mono">{row.actualVsFreshErrorKwh}</td>
                          <td className="p-2">
                            {row.displayVsFreshParityMatch ? (
                              <span className={badgeClass("ok")}>match</span>
                            ) : (
                              <span className={badgeClass("error")}>mismatch</span>
                            )}
                          </td>
                          <td className="p-2">{row.dayType}</td>
                          <td className="p-2 text-right font-mono">
                            {row.avgTempF ?? "—"} / {row.minTempF ?? "—"} / {row.maxTempF ?? "—"}
                          </td>
                          <td className="p-2 text-right font-mono">
                            {row.hdd65 ?? "—"} / {row.cdd65 ?? "—"}
                          </td>
                          <td className="p-2">{row.weatherBasis ?? "—"}</td>
                          <td className="p-2">
                            <div className="font-mono">{row.weatherSourceUsed ?? "—"}</div>
                            <div className="text-brand-navy/60">{row.weatherFallbackReason ?? "—"}</div>
                          </td>
                          <td className="p-2">
                            <span className={badgeClass(row.fallbackLevel ? "warn" : "neutral")}>
                              {row.fallbackLevel ?? "none"}
                            </span>
                          </td>
                          <td className="p-2">
                            <span className={badgeClass(row.selectedDayTotalSource ? "neutral" : "warn")}>
                              {row.selectedDayTotalSource ?? "unknown"}
                            </span>
                          </td>
                          <td className="p-2">
                            <span className={badgeClass(row.selectedShapeVariant ? "neutral" : "warn")}>
                              {row.selectedShapeVariant ?? "unknown"}
                            </span>
                          </td>
                          <td className="p-2">
                            <span className={badgeClass(row.selectedReferenceMatchTier ? "neutral" : "warn")}>
                              {row.selectedReferenceMatchTier ?? "unknown"}
                            </span>
                          </td>
                          <td className="p-2 text-right font-mono">{row.selectedMatchSampleCount ?? "—"}</td>
                          <td className="p-2">{row.reasonCode ?? "—"}</td>
                        </tr>
                      )})}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-brand-navy/70">No scored-day truth rows were returned for this run.</p>
              )}
            </div>
          </details>

          <details className="border border-brand-blue/20 rounded" open>
            <summary className="p-3 cursor-pointer font-semibold text-brand-navy bg-brand-blue/5 rounded-t">
              Accuracy Tuning Snapshot
            </summary>
            <div className="p-4 border-t border-brand-blue/20 space-y-3 text-sm">
              <div className="grid md:grid-cols-2 gap-3">
                <div className="p-3 rounded border border-brand-blue/20">
                  <div className="font-medium text-brand-navy mb-2">Top miss buckets</div>
                  {missAttribution?.categories ? (
                    <div className="space-y-1">
                      {Object.entries(missAttribution.categories as Record<string, any>)
                        .sort((a, b) => (Number((b[1] as any)?.count ?? 0) - Number((a[1] as any)?.count ?? 0)))
                        .slice(0, 6)
                        .map(([bucket, meta]) => (
                          <div key={bucket} className="flex items-center justify-between gap-3">
                            <span className="text-brand-navy/90">{bucket}</span>
                            <span className={badgeClass(String((meta as any)?.classification ?? "") === "supported" ? "ok" : "warn")}>
                              {Number((meta as any)?.count ?? 0)} · {String((meta as any)?.classification ?? "heuristic/provisional")}
                            </span>
                          </div>
                        ))}
                    </div>
                  ) : (
                    <p className="text-brand-navy/70">No miss attribution categories returned.</p>
                  )}
                </div>
                <div className="p-3 rounded border border-brand-blue/20">
                  <div className="font-medium text-brand-navy mb-2">Top worst days</div>
                  {Array.isArray(missAttribution?.topWorstErrorDates) && missAttribution.topWorstErrorDates.length > 0 ? (
                    <div className="space-y-1">
                      {missAttribution.topWorstErrorDates.slice(0, 8).map((d: any) => (
                        <div key={d.localDate} className="flex items-center justify-between gap-3">
                          <span className="font-mono">{d.localDate}</span>
                          <span className="font-mono">{d.absErrorKwh} kWh</span>
                          <span className={badgeClass("neutral")}>{d.summary ?? "—"}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-brand-navy/70">No worst-day summary returned.</p>
                  )}
                </div>
              </div>
              <div className="grid md:grid-cols-2 gap-3">
                <div className="p-3 rounded border border-brand-blue/20">
                  <div className="font-medium text-brand-navy mb-2">Temperature bands</div>
                  {Array.isArray(tuningBreakdowns?.byTemperatureBand) && tuningBreakdowns.byTemperatureBand.length > 0 ? (
                    <div className="space-y-1">
                      {tuningBreakdowns.byTemperatureBand.slice(0, 6).map((row: any) => (
                        <div key={row.bucket} className="flex items-center justify-between gap-3">
                          <span>{row.bucket}</span>
                          <span className="font-mono">n={row.count} · MAE {row.maeKwh} · WAPE {row.wapePct}%</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-brand-navy/70">No temperature-band breakdown returned.</p>
                  )}
                </div>
                <div className="p-3 rounded border border-brand-blue/20">
                  <div className="font-medium text-brand-navy mb-2">Weekday / weekend and fallback tier</div>
                  {Array.isArray(tuningBreakdowns?.byWeekdayWeekend) && tuningBreakdowns.byWeekdayWeekend.length > 0 ? (
                    <div className="space-y-1 mb-2">
                      {tuningBreakdowns.byWeekdayWeekend.slice(0, 3).map((row: any) => (
                        <div key={`day-${row.bucket}`} className="flex items-center justify-between gap-3">
                          <span>{row.bucket}</span>
                          <span className="font-mono">n={row.count} · MAE {row.maeKwh}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {Array.isArray(tuningBreakdowns?.byFallbackTier) && tuningBreakdowns.byFallbackTier.length > 0 ? (
                    <div className="space-y-1">
                      {tuningBreakdowns.byFallbackTier.slice(0, 6).map((row: any) => (
                        <div key={`fb-${row.bucket}`} className="flex items-center justify-between gap-3">
                          <span>{row.bucket}</span>
                          <span className="font-mono">n={row.count} · MAE {row.maeKwh}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-brand-navy/70">No fallback-tier breakdown returned.</p>
                  )}
                </div>
              </div>
              <div className="p-3 rounded border border-brand-blue/20">
                <div className="font-medium text-brand-navy mb-1">Miss Attribution Summary</div>
                <pre className="text-xs bg-brand-navy/5 p-2 rounded overflow-x-auto">
                  {JSON.stringify((result as any).missAttributionSummary ?? null, null, 2)}
                </pre>
              </div>
              <div className="p-3 rounded border border-brand-blue/20">
                <div className="font-medium text-brand-navy mb-1">Accuracy Tuning Breakdowns</div>
                <pre className="text-xs bg-brand-navy/5 p-2 rounded overflow-x-auto">
                  {JSON.stringify((result as any).accuracyTuningBreakdowns ?? null, null, 2)}
                </pre>
              </div>
            </div>
          </details>

          {/* Overview */}
          <details className="border border-brand-blue/20 rounded" open>
            <summary className="p-3 cursor-pointer font-semibold text-brand-navy bg-brand-blue/5 rounded-t">
              Overview
            </summary>
            <div className="p-4 border-t border-brand-blue/20 space-y-4">
              {result.metrics && (
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                  <div className="p-3 rounded border border-brand-blue/20">
                    <div className="text-xs text-brand-navy/60">WAPE (primary)</div>
                    <div className="font-mono">{result.metrics.wape}%</div>
                  </div>
                  <div className="p-3 rounded border border-brand-blue/20">
                    <div className="text-xs text-brand-navy/60">MAE</div>
                    <div className="font-mono">{result.metrics.mae} kWh</div>
                  </div>
                  <div className="p-3 rounded border border-brand-blue/20">
                    <div className="text-xs text-brand-navy/60">RMSE</div>
                    <div className="font-mono">{result.metrics.rmse}</div>
                  </div>
                  <div className="p-3 rounded border border-brand-blue/20">
                    <div className="text-xs text-brand-navy/60">MAPE</div>
                    <div className="font-mono">{result.metrics.mape}%</div>
                  </div>
                  <div className="p-3 rounded border border-brand-blue/20">
                    <div className="text-xs text-brand-navy/60">Max abs</div>
                    <div className="font-mono">{result.metrics.maxAbs} kWh</div>
                  </div>
                </div>
              )}
              {result.pasteSummary && (
                <div>
                  <div className="font-semibold text-brand-navy mb-2">Report summary (copy to paste)</div>
                  <textarea
                    readOnly
                    value={result.pasteSummary}
                    rows={12}
                    className="w-full border border-brand-blue/20 rounded p-3 font-mono text-sm resize-y"
                  />
                  <button
                    type="button"
                    onClick={copyPasteSummary}
                    className="mt-2 px-3 py-1.5 bg-brand-blue/20 text-brand-navy rounded hover:bg-brand-blue/30 text-sm"
                  >
                    Copy
                  </button>
                </div>
              )}
              {(result as any).fullReportText && (
                <div className="mt-4">
                  <div className="font-semibold text-brand-navy mb-2">FULL COPY/PASTE REPORT (for ChatGPT/Cursor)</div>
                  <textarea
                    readOnly
                    value={(result as any).fullReportText}
                    rows={24}
                    className="w-full border border-brand-blue/20 rounded p-3 font-mono text-sm resize-y"
                  />
                  <button
                    type="button"
                    onClick={copyFullReport}
                    className="mt-2 px-3 py-1.5 bg-brand-navy text-white rounded hover:bg-brand-blue text-sm"
                  >
                    Copy Full Report
                  </button>
                </div>
              )}
            </div>
          </details>

          {/* Inputs: Home + Appliance Profile */}
          <details className="border border-brand-blue/20 rounded">
            <summary className="p-3 cursor-pointer font-semibold text-brand-navy bg-brand-blue/5 rounded-t">
              Inputs (Home Profile + Appliance Profile)
            </summary>
            <div className="p-4 border-t border-brand-blue/20 space-y-4">
              {result.homeProfile ? (
                <div>
                  <div className="font-medium text-brand-navy mb-2">Home Profile</div>
                  <pre className="text-xs bg-brand-navy/5 p-3 rounded overflow-x-auto max-h-64 overflow-y-auto">
                    {JSON.stringify(result.homeProfile, null, 2)}
                  </pre>
                </div>
              ) : (
                <p className="text-brand-navy/70 text-sm">No home profile on file.</p>
              )}
              {result.applianceProfile ? (
                <div>
                  <div className="font-medium text-brand-navy mb-2">Appliance Profile</div>
                  <pre className="text-xs bg-brand-navy/5 p-3 rounded overflow-x-auto max-h-64 overflow-y-auto">
                    {JSON.stringify(result.applianceProfile, null, 2)}
                  </pre>
                </div>
              ) : (
                <p className="text-brand-navy/70 text-sm">No appliance profile on file.</p>
              )}
            </div>
          </details>

          {/* Assumptions */}
          <details className="border border-brand-blue/20 rounded">
            <summary className="p-3 cursor-pointer font-semibold text-brand-navy bg-brand-blue/5 rounded-t">
              Assumptions (modelAssumptions)
            </summary>
            <div className="p-4 border-t border-brand-blue/20">
              {result.modelAssumptions ? (
                <pre className="text-xs bg-brand-navy/5 p-3 rounded overflow-x-auto max-h-96 overflow-y-auto">
                  {JSON.stringify(result.modelAssumptions, null, 2)}
                </pre>
              ) : (
                <p className="text-brand-navy/70 text-sm">Run Compare to see assumptions.</p>
              )}
            </div>
          </details>

          {/* Diagnostics */}
          <details className="border border-brand-blue/20 rounded">
            <summary className="p-3 cursor-pointer font-semibold text-brand-navy bg-brand-blue/5 rounded-t">
              Diagnostics
            </summary>
            <div className="p-4 border-t border-brand-blue/20 space-y-4">
              {result.byMonth?.length > 0 && (
                <div>
                  <div className="font-semibold text-brand-navy mb-2">By month</div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm border border-brand-blue/20">
                      <thead>
                        <tr className="bg-brand-blue/10">
                          <th className="text-left p-2">Month</th>
                          <th className="text-right p-2">MAE</th>
                          <th className="text-right p-2">MAPE %</th>
                          <th className="text-right p-2">Count</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.byMonth.map((row: any) => (
                          <tr key={row.month} className="border-t border-brand-blue/10">
                            <td className="p-2">{row.month}</td>
                            <td className="text-right p-2 font-mono">{row.mae}</td>
                            <td className="text-right p-2 font-mono">{row.mape}</td>
                            <td className="text-right p-2">{row.count}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {result.byDayType?.length > 0 && (
                <div>
                  <div className="font-semibold text-brand-navy mb-2">By day type</div>
                  <table className="w-full text-sm border border-brand-blue/20 max-w-xs">
                    <thead>
                      <tr className="bg-brand-blue/10">
                        <th className="text-left p-2">Type</th>
                        <th className="text-right p-2">MAE</th>
                        <th className="text-right p-2">MAPE %</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.byDayType.map((row: any) => (
                        <tr key={row.dayType} className="border-t border-brand-blue/10">
                          <td className="p-2">{row.dayType}</td>
                          <td className="text-right p-2 font-mono">{row.mae}</td>
                          <td className="text-right p-2 font-mono">{row.mape}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {result.diagnostics?.dailyTotalsMasked?.length > 0 && (
                <div>
                  <div className="font-semibold text-brand-navy mb-2">Daily totals (masked)</div>
                  <div className="overflow-x-auto max-h-48 overflow-y-auto">
                    <table className="w-full text-sm border border-brand-blue/20">
                      <thead>
                        <tr className="bg-brand-blue/10">
                          <th className="text-left p-2">Date</th>
                          <th className="text-right p-2">Actual kWh</th>
                          <th className="text-right p-2">Sim kWh</th>
                          <th className="text-right p-2">Delta</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.diagnostics.dailyTotalsMasked.slice(0, 31).map((row: any) => (
                          <tr key={row.date} className="border-t border-brand-blue/10">
                            <td className="p-2">{row.date}</td>
                            <td className="text-right p-2 font-mono">{row.actualKwh}</td>
                            <td className="text-right p-2 font-mono">{row.simKwh}</td>
                            <td className="text-right p-2 font-mono">{row.deltaKwh}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {result.diagnostics?.hourlyProfileMasked?.length > 0 && (
                <div>
                  <div className="font-semibold text-brand-navy mb-2">Hourly profile (masked, mean kWh)</div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm border border-brand-blue/20">
                      <thead>
                        <tr className="bg-brand-blue/10">
                          <th className="text-left p-2">Hour</th>
                          <th className="text-right p-2">Actual mean</th>
                          <th className="text-right p-2">Sim mean</th>
                          <th className="text-right p-2">Delta</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.diagnostics.hourlyProfileMasked.map((row: any) => (
                          <tr key={row.hour} className="border-t border-brand-blue/10">
                            <td className="p-2">{row.hour}</td>
                            <td className="text-right p-2 font-mono">{row.actualMeanKwh}</td>
                            <td className="text-right p-2 font-mono">{row.simMeanKwh}</td>
                            <td className="text-right p-2 font-mono">{row.deltaMeanKwh}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {result.diagnostics?.seasonalSplit && (
                <div>
                  <div className="font-semibold text-brand-navy mb-2">Seasonal split</div>
                  <div className="grid grid-cols-3 gap-4 text-sm">
                    <div className="p-3 rounded border border-brand-blue/20">
                      <div className="text-brand-navy/70">Summer (Jun–Aug)</div>
                      <div className="font-mono">WAPE {result.diagnostics.seasonalSplit.summer.wape}% · MAE {result.diagnostics.seasonalSplit.summer.mae} · n={result.diagnostics.seasonalSplit.summer.count}</div>
                    </div>
                    <div className="p-3 rounded border border-brand-blue/20">
                      <div className="text-brand-navy/70">Winter (Dec–Feb)</div>
                      <div className="font-mono">WAPE {result.diagnostics.seasonalSplit.winter.wape}% · MAE {result.diagnostics.seasonalSplit.winter.mae} · n={result.diagnostics.seasonalSplit.winter.count}</div>
                    </div>
                    <div className="p-3 rounded border border-brand-blue/20">
                      <div className="text-brand-navy/70">Shoulder</div>
                      <div className="font-mono">WAPE {result.diagnostics.seasonalSplit.shoulder.wape}% · MAE {result.diagnostics.seasonalSplit.shoulder.mae} · n={result.diagnostics.seasonalSplit.shoulder.count}</div>
                    </div>
                  </div>
                </div>
              )}

              {result.diagnostics?.poolHoursErrorSplit && (
                <div>
                  <div className="font-semibold text-brand-navy mb-2">Pool hours error split</div>
                  <p className="text-sm text-brand-navy/80">{result.diagnostics.poolHoursErrorSplit.scheduleRuleUsed}</p>
                </div>
              )}

              {result.worstDays?.length > 0 && (
                <div>
                  <div className="font-semibold text-brand-navy mb-2">Top 10 worst days (by abs error)</div>
                  <ul className="text-sm list-disc list-inside">
                    {result.worstDays.map((d: any) => (
                      <li key={d.date}>
                        {formatDate(d.date)}: {d.absErrorKwh} kWh
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </details>

          <details className="border border-brand-blue/20 rounded">
            <summary className="p-3 cursor-pointer font-semibold text-brand-navy bg-brand-blue/5 rounded-t">
              Deep Diagnostics / Raw Payload
            </summary>
            <div className="p-4 border-t border-brand-blue/20">
              <pre className="text-xs bg-brand-navy/5 p-3 rounded overflow-x-auto max-h-96 overflow-y-auto">
                {JSON.stringify(result, null, 2)}
              </pre>
            </div>
          </details>

          {result.ok && result.testIntervalsCount === 0 && result.message && (
            <p className="text-brand-navy/70">{result.message}</p>
          )}
        </div>
      )}
    </div>
  );
}