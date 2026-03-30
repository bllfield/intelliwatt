"use client";

import { useMemo, useState } from "react";
import { UsageChartsPanel } from "@/components/usage/UsageChartsPanel";
import { ValidationComparePanel } from "@/components/usage/ValidationComparePanel";
import { HomeDetailsClient } from "@/components/home/HomeDetailsClient";
import { AppliancesClient } from "@/components/appliances/AppliancesClient";
import {
  gapfillFailureFieldsFromJson,
  gapfillPrimaryErrorLine,
  type GapfillFailureFields,
} from "@/components/admin/gapfillLabAdminUi";
import type { FingerprintBuildFreshnessPayload } from "@/lib/api/gapfillLabAdminSerialization";
import { buildGapfillExportPayload } from "./exportPayload";

type HouseOption = { id: string; label: string; esiid?: string | null };
type DateRange = { startDate: string; endDate: string };

type UsagePayload = {
  source: string;
  timezone: string;
  coverageStart: string | null;
  coverageEnd: string | null;
  intervalCount: number;
  daily: Array<{ date: string; kwh: number; source?: "ACTUAL" | "SIMULATED" | "MISSING_REFERENCE" }>;
  monthly: Array<{ month: string; kwh: number }>;
  weekdayKwh: number;
  weekendKwh: number;
  fifteenCurve: Array<{ hhmm: string; avgKw: number }>;
  stitchedMonth?: any;
};

type RunResult = {
  ok: true;
  action: string;
  sourceUser?: { id: string; email: string };
  /** Present on several actions including canonical recalc when the lab resolves the owner user. */
  sourceUserId?: string;
  sourceHouses?: HouseOption[];
  selectedSourceHouseId?: string;
  sourceHouse?: HouseOption;
  testHome?: HouseOption & { identityLabel?: string | null };
  homeProfile?: any;
  applianceProfile?: any;
  travelRangesFromDb?: DateRange[];
  testHomeLink?: any;
  usage365?: UsagePayload;
  baselineDatasetProjection?: any;
  scoredDayTruthRows?: Array<{
    localDate: string;
    actualDayKwh: number;
    freshCompareSimDayKwh: number;
    actualVsFreshErrorKwh: number;
    dayType: "weekday" | "weekend";
    percentError?: number | null;
  }>;
  metrics?: Record<string, number>;
  canonicalWindow?: { startDate: string; endDate: string; helper?: string };
  modelAssumptions?: Record<string, unknown>;
  compareTruth?: Record<string, unknown>;
  userDefaultValidationSelectionMode?: string;
  adminLabDefaultValidationSelectionMode?: string;
  supportedValidationSelectionModes?: string[];
  selectionDiagnostics?: Record<string, unknown>;
  validationSelectionDiagnostics?: Record<string, unknown>;
  weatherKind?: string;
  testSelectionMode?: string;
  sourceHouseId?: string;
  /** Past sim scenario id for the test-home build when returned by the API. */
  scenarioId?: string | null;
  testHomeId?: string;
  treatmentMode?: string | null;
  simulatorMode?: string;
  adminValidationMode?: string;
  effectiveValidationSelectionMode?: string | null;
  effectiveValidationSelectionModeSource?: string;
  fingerprintBuildFreshness?: FingerprintBuildFreshnessPayload | null;
  buildId?: string | null;
  artifactId?: string | null;
  correlationId?: string;
  artifactCacheUpdatedAt?: string | null;
  artifactEngineVersion?: string | null;
  artifactInputHash?: string | null;
  buildLastBuiltAt?: string | null;
  buildInputsHash?: string | null;
  compareProjection?: {
    rows?: Array<{
      localDate: string;
      dayType: "weekday" | "weekend";
      actualDayKwh: number;
      simulatedDayKwh: number;
      errorKwh: number;
      percentError: number | null;
    }>;
    metrics?: Record<string, unknown>;
  };
  canonicalReadResultSummary?: Record<string, unknown>;
  baselineProjectionSummary?: Record<string, unknown>;
  compareProjectionSummary?: Record<string, unknown>;
  sharedResultPayloadSummary?: Record<string, unknown>;
  pipelineDiagnosticsSummary?: Record<string, unknown>;
  diagnosticsVerdict?: Record<string, unknown>;
} | {
  ok: false;
  error: string;
  message?: string;
  detail?: string;
  testHomeLink?: any;
  failureCode?: string;
  failureMessage?: string;
  reasonCode?: string;
};

const EMPTY_RANGE: DateRange = { startDate: "", endDate: "" };
const TEST_HOME_DISPLAY_LABEL = "Test Home";
/** Client wait for gapfill-lab POST; keep under `maxDuration` in `app/api/admin/tools/gapfill-lab/route.ts` (300s). */
const GAPFILL_LAB_HTTP_FETCH_MS = 295_000;

function prettyJson(v: unknown): string {
  return JSON.stringify(v ?? {}, null, 2);
}

function parseJsonSafe(s: string): { ok: true; value: any } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(s) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "invalid_json" };
  }
}

function Modal(props: { open: boolean; title: string; onClose: () => void; children: React.ReactNode }) {
  if (!props.open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-5xl rounded-3xl border border-brand-blue/15 bg-white shadow-2xl">
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
        <div className="max-h-[80vh] overflow-auto px-6 py-5">{props.children}</div>
      </div>
    </div>
  );
}

function toPayloadFromBaseline(dataset: any, timezone: string): UsagePayload | null {
  if (!dataset || typeof dataset !== "object") return null;
  const daily = Array.isArray(dataset.daily)
    ? dataset.daily
        .map((d: any) => ({
          date: String(d?.date ?? "").slice(0, 10),
          kwh: Number(d?.kwh ?? 0) || 0,
          source:
            String(d?.source ?? "").toUpperCase() === "SIMULATED"
              ? ("SIMULATED" as const)
              : String(d?.source ?? "").toUpperCase() === "MISSING_REFERENCE"
                ? ("MISSING_REFERENCE" as const)
                : ("ACTUAL" as const),
        }))
        .filter((d: any) => /^\d{4}-\d{2}-\d{2}$/.test(d.date))
    : [];
  const monthly = Array.isArray(dataset.monthly)
    ? dataset.monthly
        .map((m: any) => ({ month: String(m?.month ?? "").slice(0, 7), kwh: Number(m?.kwh ?? 0) || 0 }))
        .filter((m: any) => /^\d{4}-\d{2}$/.test(m.month))
    : [];
  const source = String(dataset?.summary?.source ?? "SIMULATED");
  const coverageStart = typeof dataset?.summary?.start === "string" ? dataset.summary.start.slice(0, 10) : null;
  const coverageEnd = typeof dataset?.summary?.end === "string" ? dataset.summary.end.slice(0, 10) : null;
  const intervalCount = Number(dataset?.summary?.intervalsCount ?? dataset?.series?.intervals15?.length ?? 0) || 0;
  const fifteenCurve = Array.isArray(dataset?.insights?.fifteenMinuteAverages)
    ? dataset.insights.fifteenMinuteAverages
        .map((row: any) => ({
          hhmm: String(row?.hhmm ?? ""),
          avgKw: Number(row?.avgKw ?? 0) || 0,
        }))
        .filter((row: any) => /^\d{2}:\d{2}$/.test(row.hhmm))
    : [];
  return {
    source,
    timezone,
    coverageStart,
    coverageEnd,
    intervalCount,
    daily,
    monthly,
    weekdayKwh: Number(dataset?.insights?.weekdayVsWeekend?.weekday ?? 0) || 0,
    weekendKwh: Number(dataset?.insights?.weekdayVsWeekend?.weekend ?? 0) || 0,
    fifteenCurve,
    stitchedMonth: dataset?.insights?.stitchedMonth ?? null,
  };
}

export default function GapFillLabCanonicalClient() {
  const [email, setEmail] = useState("brian@intellipath-solutions.com");
  const [timezone, setTimezone] = useState("America/Chicago");
  const [sourceHouses, setSourceHouses] = useState<HouseOption[]>([]);
  const [sourceHouseId, setSourceHouseId] = useState("");
  const [testHomeLink, setTestHomeLink] = useState<any>(null);
  const [testHome, setTestHome] = useState<any>(null);
  const [sourceHouse, setSourceHouse] = useState<any>(null);
  const [travelRanges, setTravelRanges] = useState<DateRange[]>([]);
  const [testRanges, setTestRanges] = useState<DateRange[]>([{ ...EMPTY_RANGE }]);
  const [randomMode, setRandomMode] = useState(false);
  const [testDays, setTestDays] = useState(21);
  const [weatherKind, setWeatherKind] = useState<"ACTUAL_LAST_YEAR" | "NORMAL_AVG" | "open_meteo">("open_meteo");
  const [userDefaultValidationSelectionMode, setUserDefaultValidationSelectionMode] = useState("random_simple");
  const [adminLabValidationSelectionMode, setAdminLabValidationSelectionMode] = useState("stratified_weather_balanced");
  /** Section 24 admin-only treatment; sent on recalc only — server applies in shared `recalcSimulatorBuild`. */
  const [adminLabTreatmentMode, setAdminLabTreatmentMode] = useState("actual_data_fingerprint");
  const [supportedValidationSelectionModes, setSupportedValidationSelectionModes] = useState<string[]>([
    "manual",
    "random_simple",
    "customer_style_seasonal_mix",
    "stratified_weather_balanced",
  ]);
  const [homeProfileJson, setHomeProfileJson] = useState("{}");
  const [applianceProfileJson, setApplianceProfileJson] = useState("{}");
  const [result, setResult] = useState<RunResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFailureFields, setLastFailureFields] = useState<GapfillFailureFields | null>(null);
  const [lastHttpStatus, setLastHttpStatus] = useState<number | null>(null);
  const [requestDebug, setRequestDebug] = useState<any[]>([]);
  const [usageMonthlyView, setUsageMonthlyView] = useState<"chart" | "table">("chart");
  const [usageDailyView, setUsageDailyView] = useState<"chart" | "table">("chart");
  const [openFullHomeEditor, setOpenFullHomeEditor] = useState(false);
  const [openFullApplianceEditor, setOpenFullApplianceEditor] = useState(false);
  const [exportNotice, setExportNotice] = useState<string | null>(null);

  const effectiveTestHomeId = String(testHomeLink?.testHomeHouseId ?? testHome?.id ?? "").trim();
  const parsedHomeProfile = useMemo(() => parseJsonSafe(homeProfileJson), [homeProfileJson]);
  const parsedApplianceProfile = useMemo(() => parseJsonSafe(applianceProfileJson), [applianceProfileJson]);

  function updateHomeField(field: string, value: unknown) {
    const parsed = parseJsonSafe(homeProfileJson);
    if (!parsed.ok) return;
    const next = { ...(parsed.value && typeof parsed.value === "object" ? parsed.value : {}) };
    (next as any)[field] = value;
    setHomeProfileJson(prettyJson(next));
  }

  function updateApplianceFuelConfiguration(value: string) {
    const parsed = parseJsonSafe(applianceProfileJson);
    if (!parsed.ok) return;
    const next = { ...(parsed.value && typeof parsed.value === "object" ? parsed.value : {}) };
    (next as any).fuelConfiguration = value;
    setApplianceProfileJson(prettyJson(next));
  }

  async function runAction(action: string, extra: Record<string, unknown> = {}) {
    setLoading(true);
    setError(null);
    setLastFailureFields(null);
    setLastHttpStatus(null);
    const payload = {
      action,
      email,
      timezone,
      sourceHouseId: sourceHouseId || undefined,
      weatherKind,
      includeUsage365: true,
      adminLabValidationSelectionMode,
      testRanges: randomMode ? [] : testRanges.filter((r) => r.startDate && r.endDate),
      testDays: randomMode ? testDays : undefined,
      ...extra,
    };
    let resp: Response;
    let json: RunResult;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), GAPFILL_LAB_HTTP_FETCH_MS);
      try {
        resp = await fetch("/api/admin/tools/gapfill-lab", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }
      json = (await resp.json().catch(async () => {
        const text = await resp.text().catch(() => "");
        return {
          ok: false,
          error: "route_response_parse_failed",
          message: text || `Request failed (${resp.status}).`,
        };
      })) as RunResult;
    } catch (err: unknown) {
      const timedOut = err instanceof Error && err.name === "AbortError";
      const fallback: RunResult = {
        ok: false,
        error: timedOut ? "request_timeout" : "request_failed",
        message: timedOut
          ? "Request timed out before server response. Retry recalc."
          : err instanceof Error
            ? err.message
            : "Request failed.",
      };
      const ff = gapfillFailureFieldsFromJson(fallback as Record<string, unknown>);
      setLastFailureFields({ ...ff, failureCode: timedOut ? "REQUEST_TIMEOUT" : "REQUEST_FAILED", failureMessage: gapfillPrimaryErrorLine(ff) });
      setRequestDebug((prev) => [
        {
          at: new Date().toISOString(),
          action,
          status: 0,
          request: payload,
          response: fallback,
        },
        ...prev,
      ].slice(0, 12));
      setResult(fallback);
      setError(gapfillPrimaryErrorLine(ff));
      setLoading(false);
      return fallback;
    }
    setLastHttpStatus(resp.status);
    setRequestDebug((prev) => [
      {
        at: new Date().toISOString(),
        action,
        status: resp.status,
        request: payload,
        response: json,
      },
      ...prev,
    ].slice(0, 12));
    setResult(json);
    if (!json.ok) {
      const ff = gapfillFailureFieldsFromJson(json as Record<string, unknown>);
      setLastFailureFields(ff);
      const isTimeout = resp.status === 504 || resp.status === 502 || String(json.error ?? "").includes("timeout");
      const line = isTimeout
        ? gapfillPrimaryErrorLine(ff) || "Server timed out before completion."
        : gapfillPrimaryErrorLine(ff);
      setError(line);
      setLoading(false);
      return json;
    }

    if (json.sourceHouses) {
      setSourceHouses(json.sourceHouses);
      const selected = String(json.selectedSourceHouseId ?? "").trim();
      if (selected) {
        setSourceHouseId(selected);
      } else if (!sourceHouseId && json.sourceHouses.length > 0) {
        setSourceHouseId(String(json.sourceHouses[0]?.id ?? ""));
      }
    }
    if (json.sourceHouse) setSourceHouse(json.sourceHouse);
    if (json.testHome) setTestHome(json.testHome);
    if (json.testHomeLink != null) setTestHomeLink(json.testHomeLink);
    if (json.userDefaultValidationSelectionMode) {
      setUserDefaultValidationSelectionMode(String(json.userDefaultValidationSelectionMode));
    }
    if (Array.isArray(json.supportedValidationSelectionModes) && json.supportedValidationSelectionModes.length > 0) {
      setSupportedValidationSelectionModes(json.supportedValidationSelectionModes.map((m) => String(m)));
    }
    if (typeof json.testSelectionMode === "string" && json.testSelectionMode.trim()) {
      setAdminLabValidationSelectionMode(String(json.testSelectionMode));
    } else if (!json.userDefaultValidationSelectionMode && json.adminLabDefaultValidationSelectionMode) {
      setAdminLabValidationSelectionMode(String(json.adminLabDefaultValidationSelectionMode));
    }
    if (json.travelRangesFromDb) {
      setTravelRanges(json.travelRangesFromDb);
    }
    if (json.homeProfile) setHomeProfileJson(prettyJson(json.homeProfile));
    if (json.applianceProfile) setApplianceProfileJson(prettyJson(json.applianceProfile));
    setLoading(false);
    return json;
  }

  async function onLookup() {
    await runAction("lookup_source_houses");
  }

  async function onSaveUserDefaultValidationMode() {
    await runAction("set_user_default_validation_selection_mode", {
      userDefaultValidationSelectionMode,
      includeUsage365: false,
    });
  }

  async function onReplace() {
    if (!sourceHouseId) {
      const lookupResult = await runAction("lookup_source_houses");
      const selected = String((lookupResult as any)?.selectedSourceHouseId ?? "").trim();
      if (!selected) {
        setError("No eligible source home was found for this user.");
        return;
      }
    }
    await runAction("replace_test_home_from_source");
  }

  async function onSaveInputs() {
    const parsedHome = parseJsonSafe(homeProfileJson);
    if (!parsedHome.ok) {
      setError(`Home profile JSON invalid: ${parsedHome.error}`);
      return;
    }
    const parsedAppliance = parseJsonSafe(applianceProfileJson);
    if (!parsedAppliance.ok) {
      setError(`Appliance profile JSON invalid: ${parsedAppliance.error}`);
      return;
    }
    await runAction("save_test_home_inputs", {
      homeProfile: parsedHome.value,
      applianceProfile: parsedAppliance.value,
      travelRanges,
    });
  }

  async function onRunRecalc() {
    await runAction("run_test_home_canonical_recalc", { adminLabTreatmentMode });
  }

  const usageChart = useMemo(() => {
    if (!result?.ok) return null;
    if (result.usage365 && Array.isArray(result.usage365.daily) && result.usage365.daily.length > 0) {
      return result.usage365;
    }
    return toPayloadFromBaseline(result.baselineDatasetProjection, timezone);
  }, [result, timezone]);

  const baselineChart = useMemo(() => {
    if (!result?.ok) return null;
    return toPayloadFromBaseline(result.baselineDatasetProjection, timezone);
  }, [result, timezone]);

  const compareProjectionForDisplay = useMemo(() => {
    if (!result?.ok) return { rows: [], metrics: {} as Record<string, unknown> };
    const sidecarRows = Array.isArray(result.compareProjection?.rows) ? result.compareProjection.rows : [];
    if (sidecarRows.length > 0) {
      return {
        rows: sidecarRows,
        metrics: (result.compareProjection?.metrics ?? {}) as Record<string, unknown>,
      };
    }
    const fallbackRows = Array.isArray(result.scoredDayTruthRows)
      ? result.scoredDayTruthRows.map((row) => ({
          localDate: String(row.localDate ?? "").slice(0, 10),
          dayType: (row.dayType === "weekend" ? "weekend" : "weekday") as "weekday" | "weekend",
          actualDayKwh: Number(row.actualDayKwh ?? 0) || 0,
          simulatedDayKwh: Number(row.freshCompareSimDayKwh ?? 0) || 0,
          errorKwh: Number(row.actualVsFreshErrorKwh ?? 0) || 0,
          percentError: row.percentError == null ? null : Number(row.percentError),
        }))
      : [];
    return {
      rows: fallbackRows,
      metrics: (result.metrics ?? {}) as Record<string, unknown>,
    };
  }, [result]);

  const hasCurveData = Boolean(
    (usageChart?.daily && usageChart.daily.length > 0) || (baselineChart?.daily && baselineChart.daily.length > 0)
  );

  const visibilityFromResult = useMemo(() => {
    if (!result?.ok) return null;
    const r = result;
    const ma = r.modelAssumptions && typeof r.modelAssumptions === "object" ? r.modelAssumptions : null;
    const userDef =
      (typeof r.userDefaultValidationSelectionMode === "string" ? r.userDefaultValidationSelectionMode : null) ??
      (ma && typeof (ma as any).userDefaultValidationSelectionMode === "string"
        ? (ma as any).userDefaultValidationSelectionMode
        : null);
    const adminLabVal =
      (typeof r.adminValidationMode === "string" ? r.adminValidationMode : null) ??
      (typeof r.testSelectionMode === "string" ? r.testSelectionMode : null) ??
      (ma && typeof (ma as any).adminLabValidationSelectionMode === "string"
        ? (ma as any).adminLabValidationSelectionMode
        : null);
    const apiFresh = r.fingerprintBuildFreshness ?? null;
    return {
      userDefaultValidationSelectionMode: userDef,
      adminLabValidationSelectionMode: adminLabVal,
      weatherKind: typeof r.weatherKind === "string" ? r.weatherKind : null,
      /** From API `treatmentMode` only — never derived client-side. */
      treatmentMode: r.treatmentMode ?? null,
      simulatorMode: r.simulatorMode ?? null,
      effectiveValidationSelectionMode:
        typeof r.effectiveValidationSelectionMode === "string" ? r.effectiveValidationSelectionMode : null,
      effectiveValidationSelectionModeSource: r.effectiveValidationSelectionModeSource ?? null,
      buildId: r.buildId ?? null,
      artifactId: r.artifactId ?? null,
      correlationId: r.correlationId ?? null,
      artifactCacheUpdatedAt: r.artifactCacheUpdatedAt ?? null,
      artifactEngineVersion: r.artifactEngineVersion ?? null,
      artifactInputHash: r.artifactInputHash ?? null,
      buildLastBuiltAt: r.buildLastBuiltAt ?? null,
      buildInputsHash: r.buildInputsHash ?? null,
      fingerprintBuildFreshness: apiFresh,
    };
  }, [result]);

  const apiSourceHouseId = result?.ok ? (result as any).sourceHouseId : undefined;
  const apiTestHomeId = result?.ok ? (result as any).testHomeId : undefined;
  const exportPayloadBase = useMemo(
    () => ({
      workspace: "gapfill-lab-canonical-client",
      formState: {
        email,
        timezone,
        sourceHouseId,
        weatherKind,
        randomMode,
        testDays,
        userDefaultValidationSelectionMode,
        adminLabValidationSelectionMode,
        adminLabTreatmentMode,
        supportedValidationSelectionModes,
        travelRanges,
        testRanges,
        homeProfileJson,
        applianceProfileJson,
      },
      uiState: {
        loading,
        error,
        lastHttpStatus,
        lastFailureFields,
        usageMonthlyView,
        usageDailyView,
        effectiveTestHomeId,
      },
      linkedIdentity: {
        sourceHouse,
        testHome,
        testHomeLink,
        apiSourceHouseId,
        apiTestHomeId,
      },
      result: result ?? null,
      derived: {
        visibilityFromResult: visibilityFromResult ?? null,
        usageChart: usageChart ?? null,
        baselineChart: baselineChart ?? null,
        compareProjectionForDisplay: compareProjectionForDisplay ?? null,
      },
      requestDebug,
    }),
    [
      adminLabTreatmentMode,
      adminLabValidationSelectionMode,
      apiSourceHouseId,
      apiTestHomeId,
      applianceProfileJson,
      baselineChart,
      compareProjectionForDisplay,
      effectiveTestHomeId,
      email,
      error,
      homeProfileJson,
      lastFailureFields,
      lastHttpStatus,
      loading,
      randomMode,
      requestDebug,
      result,
      sourceHouse,
      sourceHouseId,
      supportedValidationSelectionModes,
      testDays,
      testHome,
      testHomeLink,
      testRanges,
      timezone,
      travelRanges,
      usageChart,
      usageDailyView,
      usageMonthlyView,
      userDefaultValidationSelectionMode,
      visibilityFromResult,
      weatherKind,
    ]
  );

  function buildExportPayload() {
    return buildGapfillExportPayload(exportPayloadBase);
  }

  async function onCopyAllData() {
    const payloadText = JSON.stringify(buildExportPayload(), null, 2);
    try {
      await navigator.clipboard.writeText(payloadText);
      setExportNotice("Copied full Gapfill data bundle to clipboard.");
    } catch {
      try {
        const ta = document.createElement("textarea");
        ta.value = payloadText;
        ta.setAttribute("readonly", "true");
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        setExportNotice("Copied full Gapfill data bundle to clipboard.");
      } catch {
        setExportNotice("Copy failed. Use Save all to file.");
      }
    }
  }

  function onSaveAllToFile() {
    const payloadText = JSON.stringify(buildExportPayload(), null, 2);
    const nowIso = new Date().toISOString().replace(/[:.]/g, "-");
    const fileName = `gapfill-lab-export-${nowIso}.json`;
    const blob = new Blob([payloadText], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setExportNotice(`Saved full Gapfill data bundle to ${fileName}.`);
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-brand-navy">Past Sim Canonical Calibration Lab</h1>
        <p className="text-sm text-brand-navy/70 mt-1">
          One reusable test home, one canonical recalc chain, one saved artifact family, plus separate accuracy projection.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <input className="border rounded px-3 py-2 text-sm" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Source user email" />
        <input className="border rounded px-3 py-2 text-sm" value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="Timezone" />
        <div className="border rounded px-3 py-2 text-sm text-brand-navy/70 flex items-center">
          Source home is auto-selected from lookup
        </div>
        <div className="flex gap-2">
          <button className="px-3 py-2 rounded bg-brand-blue text-white text-sm" disabled={loading} onClick={onLookup}>Lookup</button>
          <button className="px-3 py-2 rounded bg-brand-navy text-white text-sm" disabled={loading} onClick={onReplace}>
            Load/Replace Test Home
          </button>
        </div>
      </div>

      {(sourceHouse || testHome || testHomeLink || sourceHouseId) && (
        <div className="border rounded p-4 bg-white">
          <div className="font-semibold text-sm mb-2">Source / test home identity (plan §23)</div>
          <div className="grid gap-1 text-sm text-brand-navy/80 md:grid-cols-2">
            <div>
              <span className="text-xs font-semibold uppercase tracking-wide text-brand-navy/50">Source user (id / email)</span>
              <div className="font-mono text-xs mt-0.5">
                {result?.ok ? (
                  (() => {
                    const uid = result.sourceUser?.id ?? result.sourceUserId;
                    const uemail = result.sourceUser?.email ?? email;
                    return uid ? (
                      <>
                        <span className="block">{uid}</span>
                        <span className="text-brand-navy/70">{uemail}</span>
                      </>
                    ) : (
                      uemail
                    );
                  })()
                ) : (
                  email
                )}
              </div>
            </div>
            <div>
              <span className="text-xs font-semibold uppercase tracking-wide text-brand-navy/50">Source house id</span>
              <div className="font-mono text-xs mt-0.5">{(apiSourceHouseId ?? sourceHouse?.id ?? sourceHouseId) || "—"}</div>
              {sourceHouse?.label ? <div className="text-xs text-brand-navy/60">{sourceHouse.label}</div> : null}
            </div>
            <div>
              <span className="text-xs font-semibold uppercase tracking-wide text-brand-navy/50">Test home id</span>
              <div className="font-mono text-xs mt-0.5">{(apiTestHomeId ?? effectiveTestHomeId) || "—"}</div>
            </div>
            {result?.ok && result.scenarioId ? (
              <div className="md:col-span-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-brand-navy/50">Scenario id (Past Sim)</span>
                <div className="font-mono text-xs mt-0.5">{result.scenarioId}</div>
              </div>
            ) : null}
          </div>
          <div className="text-xs text-brand-navy/70 mt-2">
            Link status: {String(testHomeLink?.status ?? "unknown")}{" "}
            {testHomeLink?.statusMessage ? `· ${String(testHomeLink.statusMessage)}` : ""}
          </div>
        </div>
      )}

      <div className="border rounded p-4 bg-white space-y-3">
        <div className="font-semibold text-sm">Modes & diagnostics (authoritative API fields)</div>
        <div className="grid gap-3 md:grid-cols-2 text-sm">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-brand-navy/50">Admin lab weather treatment</div>
            <div className="mt-0.5 text-brand-navy/90">
              Control: <span className="font-mono">{weatherKind}</span>
              {visibilityFromResult?.weatherKind != null ? (
                <span className="text-brand-navy/70">
                  {" "}
                  · Last successful recalc response: <span className="font-mono">{visibilityFromResult.weatherKind}</span>
                </span>
              ) : (
                <span className="text-brand-navy/60"> · Run recalc to record server echo.</span>
              )}
            </div>
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-brand-navy/50">Admin lab treatment (Section 24)</div>
            <div className="mt-1">
              <label className="sr-only" htmlFor="admin-lab-treatment">
                Admin simulation treatment mode
              </label>
              <select
                id="admin-lab-treatment"
                className="w-full max-w-md border rounded px-2 py-1.5 text-xs font-mono bg-white"
                value={adminLabTreatmentMode}
                onChange={(e) => setAdminLabTreatmentMode(e.target.value)}
                disabled={loading}
              >
                <option value="actual_data_fingerprint">actual_data_fingerprint</option>
                <option value="whole_home_prior_only">whole_home_prior_only</option>
                <option value="manual_monthly_constrained">manual_monthly_constrained (MANUAL_TOTALS from source actuals)</option>
                <option value="manual_annual_constrained">manual_annual_constrained (MANUAL_TOTALS annual sum from source actuals)</option>
              </select>
            </div>
            <div className="mt-0.5 font-mono text-xs">
              Last recalc echo: {visibilityFromResult?.treatmentMode ?? "—"}
            </div>
            <div className="text-xs text-brand-navy/60 mt-1">
              Sent on &quot;Run canonical recalc&quot; only. Manual constraint modes upgrade the shared chain to{" "}
              <code className="font-mono">MANUAL_TOTALS</code> using monthly/annual totals from the source home&apos;s actual usage for the
              canonical window (same <code className="font-mono">fetchActualCanonicalMonthlyTotals</code> as baseline). Fingerprint treatment
              still applies after <code className="font-mono">resolveSimFingerprint</code>. Requires a ready whole-home fingerprint on the test
              home for constrained resolver surfaces. Echo: <span className="font-mono">simulatorMode</span> from the API after recalc.
            </div>
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-brand-navy/50">Simulator mode</div>
            <div className="mt-0.5 font-mono text-xs">{visibilityFromResult?.simulatorMode ?? "—"}</div>
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-brand-navy/50">System user-facing validation-day mode</div>
            <div className="mt-0.5 font-mono text-xs">
              {visibilityFromResult?.userDefaultValidationSelectionMode ?? userDefaultValidationSelectionMode}
            </div>
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-brand-navy/50">Admin lab validation-day mode</div>
            <div className="mt-0.5 font-mono text-xs">
              {visibilityFromResult?.adminLabValidationSelectionMode ?? adminLabValidationSelectionMode}
            </div>
            <div className="text-xs text-brand-navy/60 mt-1">Form control sends this on the next recalc; server echoes adminValidationMode when present.</div>
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-brand-navy/50">Effective validation-day mode</div>
            <div className="mt-0.5 font-mono text-xs">
              {visibilityFromResult?.effectiveValidationSelectionMode ?? "—"}
            </div>
            {visibilityFromResult?.effectiveValidationSelectionModeSource ? (
              <div className="text-xs text-brand-navy/60 mt-1">
                Source: {visibilityFromResult.effectiveValidationSelectionModeSource}
              </div>
            ) : null}
          </div>
          <div className="md:col-span-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-brand-navy/50">Build &amp; artifact ids</div>
            <dl className="mt-1 grid gap-1 text-xs font-mono sm:grid-cols-2">
              <div>buildId: {visibilityFromResult?.buildId ?? "—"}</div>
              <div>buildLastBuiltAt: {visibilityFromResult?.buildLastBuiltAt ?? "—"}</div>
              <div>buildInputsHash: {visibilityFromResult?.buildInputsHash ?? "—"}</div>
              <div>artifactId: {visibilityFromResult?.artifactId ?? "—"}</div>
              <div>artifactInputHash: {visibilityFromResult?.artifactInputHash ?? "—"}</div>
              <div>artifactCacheUpdatedAt: {visibilityFromResult?.artifactCacheUpdatedAt ?? "—"}</div>
              <div>artifactEngineVersion: {visibilityFromResult?.artifactEngineVersion ?? "—"}</div>
              <div>correlationId: {visibilityFromResult?.correlationId ?? "—"}</div>
            </dl>
          </div>
          <div className="md:col-span-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-brand-navy/50">Fingerprint / build freshness (API serialization)</div>
            {visibilityFromResult?.fingerprintBuildFreshness ? (
              <dl className="mt-1 grid gap-1 text-xs font-mono sm:grid-cols-2">
                <div className="flex flex-wrap gap-x-2">
                  <dt className="text-brand-navy/55">state</dt>
                  <dd>{visibilityFromResult.fingerprintBuildFreshness.state ?? "—"}</dd>
                </div>
                <div className="flex flex-wrap gap-x-2">
                  <dt className="text-brand-navy/55">builtAt</dt>
                  <dd>{visibilityFromResult.fingerprintBuildFreshness.builtAt ?? "—"}</dd>
                </div>
                <div className="flex flex-wrap gap-x-2 sm:col-span-2">
                  <dt className="text-brand-navy/55">staleReason</dt>
                  <dd className="whitespace-pre-wrap break-all">{visibilityFromResult.fingerprintBuildFreshness.staleReason ?? "—"}</dd>
                </div>
                <div className="flex flex-wrap gap-x-2">
                  <dt className="text-brand-navy/55">artifactHashMatch</dt>
                  <dd>
                    {visibilityFromResult.fingerprintBuildFreshness.artifactHashMatch == null
                      ? "—"
                      : String(visibilityFromResult.fingerprintBuildFreshness.artifactHashMatch)}
                  </dd>
                </div>
                <div className="flex flex-wrap gap-x-2">
                  <dt className="text-brand-navy/55">artifactSourceMode</dt>
                  <dd>{visibilityFromResult.fingerprintBuildFreshness.artifactSourceMode ?? "—"}</dd>
                </div>
                <div className="flex flex-wrap gap-x-2">
                  <dt className="text-brand-navy/55">artifactRecomputed</dt>
                  <dd>
                    {visibilityFromResult.fingerprintBuildFreshness.artifactRecomputed == null
                      ? "—"
                      : String(visibilityFromResult.fingerprintBuildFreshness.artifactRecomputed)}
                  </dd>
                </div>
              </dl>
            ) : (
              <div className="mt-1 text-xs text-brand-navy/60">
                Not provided on last response — run canonical recalc, or API did not serialize freshness.
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="border rounded p-4">
          <div className="font-semibold text-sm mb-2">Test Home Details (form + JSON)</div>
          <p className="text-xs text-brand-navy/70 mb-3">
            These edits are saved only to <span className="font-semibold">{TEST_HOME_DISPLAY_LABEL}</span> ({effectiveTestHomeId || "not linked yet"}), never to the selected source home.
          </p>
          <button
            type="button"
            className="mb-3 px-3 py-2 border rounded text-xs font-semibold"
            disabled={!effectiveTestHomeId}
            onClick={() => setOpenFullHomeEditor(true)}
          >
            Open Full Home Details Editor (all variables)
          </button>
          <div className="grid grid-cols-2 gap-2 mb-3">
            <label className="text-xs">
              <span className="block mb-1">Square feet</span>
              <input
                className="w-full border rounded px-2 py-2 text-sm"
                type="number"
                value={parsedHomeProfile.ok ? (parsedHomeProfile.value?.squareFeet ?? "") : ""}
                onChange={(e) => updateHomeField("squareFeet", e.target.value === "" ? null : Number(e.target.value))}
              />
            </label>
            <label className="text-xs">
              <span className="block mb-1">Home age</span>
              <input
                className="w-full border rounded px-2 py-2 text-sm"
                type="number"
                value={parsedHomeProfile.ok ? (parsedHomeProfile.value?.homeAge ?? "") : ""}
                onChange={(e) => updateHomeField("homeAge", e.target.value === "" ? null : Number(e.target.value))}
              />
            </label>
            <label className="text-xs">
              <span className="block mb-1">Summer temp (F)</span>
              <input
                className="w-full border rounded px-2 py-2 text-sm"
                type="number"
                value={parsedHomeProfile.ok ? (parsedHomeProfile.value?.summerTemp ?? "") : ""}
                onChange={(e) => updateHomeField("summerTemp", e.target.value === "" ? null : Number(e.target.value))}
              />
            </label>
            <label className="text-xs">
              <span className="block mb-1">Winter temp (F)</span>
              <input
                className="w-full border rounded px-2 py-2 text-sm"
                type="number"
                value={parsedHomeProfile.ok ? (parsedHomeProfile.value?.winterTemp ?? "") : ""}
                onChange={(e) => updateHomeField("winterTemp", e.target.value === "" ? null : Number(e.target.value))}
              />
            </label>
          </div>
          <textarea className="w-full h-80 border rounded p-2 font-mono text-xs" value={homeProfileJson} onChange={(e) => setHomeProfileJson(e.target.value)} />
        </div>
        <div className="border rounded p-4">
          <div className="font-semibold text-sm mb-2">Test Home Appliance Details (form + JSON)</div>
          <p className="text-xs text-brand-navy/70 mb-3">
            Structured field edits below write into the JSON payload and still save through the same test-home lab save action.
          </p>
          <button
            type="button"
            className="mb-3 px-3 py-2 border rounded text-xs font-semibold"
            disabled={!effectiveTestHomeId}
            onClick={() => setOpenFullApplianceEditor(true)}
          >
            Open Full Appliances Editor (all variables)
          </button>
          <div className="grid grid-cols-1 gap-2 mb-3">
            <label className="text-xs">
              <span className="block mb-1">Fuel configuration</span>
              <select
                className="w-full border rounded px-2 py-2 text-sm"
                value={parsedApplianceProfile.ok ? String(parsedApplianceProfile.value?.fuelConfiguration ?? "") : ""}
                onChange={(e) => updateApplianceFuelConfiguration(e.target.value)}
              >
                <option value="">Select…</option>
                <option value="all_electric">all_electric</option>
                <option value="mixed">mixed</option>
              </select>
            </label>
          </div>
          <textarea className="w-full h-80 border rounded p-2 font-mono text-xs" value={applianceProfileJson} onChange={(e) => setApplianceProfileJson(e.target.value)} />
        </div>
      </div>

      <div className="border rounded p-4 space-y-3">
        <div className="font-semibold text-sm">Travel/Vacant + Validation-Day Controls</div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <label className="text-xs">
            <span className="block mb-1">System default mode (user page; future recalcs)</span>
            <div className="flex gap-2">
              <select
                className="w-full border rounded px-2 py-2 text-sm"
                value={userDefaultValidationSelectionMode}
                onChange={(e) => setUserDefaultValidationSelectionMode(e.target.value)}
              >
                {supportedValidationSelectionModes.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
              <button
                className="px-2 py-2 border rounded text-xs"
                disabled={loading}
                onClick={onSaveUserDefaultValidationMode}
              >
                Save
              </button>
            </div>
          </label>
          <label className="text-xs">
            <span className="block mb-1">Admin lab mode (this run only)</span>
            <select
              className="w-full border rounded px-2 py-2 text-sm"
              value={adminLabValidationSelectionMode}
              onChange={(e) => setAdminLabValidationSelectionMode(e.target.value)}
            >
              {supportedValidationSelectionModes.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </label>
          <label className="text-xs">
            <span className="block mb-1">Weather Source</span>
            <select className="w-full border rounded px-2 py-2 text-sm" value={weatherKind} onChange={(e) => setWeatherKind(e.target.value as any)}>
              <option value="open_meteo">Live (Open-Meteo)</option>
              <option value="ACTUAL_LAST_YEAR">Last year temps</option>
              <option value="NORMAL_AVG">Average temps</option>
            </select>
          </label>
          <label className="text-xs flex items-center gap-2 mt-5">
            <input type="checkbox" checked={randomMode} onChange={(e) => setRandomMode(e.target.checked)} />
            Random 21 test days
          </label>
          {randomMode ? (
            <label className="text-xs">
              <span className="block mb-1">Test day count</span>
              <input className="w-full border rounded px-2 py-2 text-sm" type="number" value={testDays} min={1} max={365} onChange={(e) => setTestDays(Math.max(1, Math.min(365, Number(e.target.value) || 21)))} />
            </label>
          ) : null}
        </div>

        <div>
          <div className="text-xs font-semibold mb-1">Travel/Vacant Ranges (DB-backed)</div>
          <div className="space-y-2">
            {travelRanges.map((r, idx) => (
              <div key={`travel-${idx}`} className="flex gap-2">
                <input className="border rounded px-2 py-1 text-sm" value={r.startDate} onChange={(e) => {
                  const next = [...travelRanges];
                  next[idx] = { ...next[idx], startDate: e.target.value };
                  setTravelRanges(next);
                }} />
                <input className="border rounded px-2 py-1 text-sm" value={r.endDate} onChange={(e) => {
                  const next = [...travelRanges];
                  next[idx] = { ...next[idx], endDate: e.target.value };
                  setTravelRanges(next);
                }} />
                <button className="text-xs px-2 border rounded" onClick={() => setTravelRanges(travelRanges.filter((_, i) => i !== idx))}>Remove</button>
              </div>
            ))}
            <button className="text-xs px-2 py-1 border rounded" onClick={() => setTravelRanges((prev) => [...prev, { ...EMPTY_RANGE }])}>Add travel range</button>
          </div>
        </div>

        {!randomMode ? (
          <div>
            <div className="text-xs font-semibold mb-1">Validation test ranges (manual)</div>
            <div className="space-y-2">
              {testRanges.map((r, idx) => (
                <div key={`test-${idx}`} className="flex gap-2">
                  <input className="border rounded px-2 py-1 text-sm" value={r.startDate} onChange={(e) => {
                    const next = [...testRanges];
                    next[idx] = { ...next[idx], startDate: e.target.value };
                    setTestRanges(next);
                  }} />
                  <input className="border rounded px-2 py-1 text-sm" value={r.endDate} onChange={(e) => {
                    const next = [...testRanges];
                    next[idx] = { ...next[idx], endDate: e.target.value };
                    setTestRanges(next);
                  }} />
                  <button className="text-xs px-2 border rounded" onClick={() => setTestRanges(testRanges.filter((_, i) => i !== idx))}>Remove</button>
                </div>
              ))}
              <button className="text-xs px-2 py-1 border rounded" onClick={() => setTestRanges((prev) => [...prev, { ...EMPTY_RANGE }])}>Add test range</button>
            </div>
          </div>
        ) : null}

        <div className="flex gap-2">
          <button className="px-3 py-2 rounded border text-sm" onClick={onSaveInputs} disabled={loading}>Save Canonical Inputs</button>
          <button className="px-3 py-2 rounded bg-brand-blue text-white text-sm" onClick={onRunRecalc} disabled={loading}>
            Recalc Canonical Past Sim
          </button>
          <button
            className="px-3 py-2 rounded border text-sm"
            onClick={onCopyAllData}
            disabled={loading}
            type="button"
          >
            Copy all data
          </button>
          <button
            className="px-3 py-2 rounded border text-sm"
            onClick={onSaveAllToFile}
            disabled={loading}
            type="button"
          >
            Save all to file
          </button>
        </div>
        {exportNotice ? <div className="text-xs text-brand-navy/70">{exportNotice}</div> : null}
      </div>

      {loading ? (
        <div
          className="p-3 rounded border border-brand-blue/20 bg-brand-blue/5 text-sm text-brand-navy"
          role="status"
          aria-live="polite"
        >
          Loading…
        </div>
      ) : null}

      {error ? (
        <div className="p-3 rounded border border-rose-300 bg-rose-50 text-sm text-rose-900 space-y-2">
          <div className="font-semibold">Request did not complete successfully</div>
          <div>{error}</div>
          {lastHttpStatus != null ? (
            <div className="text-xs font-mono text-rose-800/90">HTTP {lastHttpStatus}</div>
          ) : null}
          {(lastFailureFields?.failureCode || lastFailureFields?.failureMessage) ? (
            <dl className="text-xs font-mono space-y-1 border-t border-rose-200/80 pt-2">
              {lastFailureFields.failureCode ? (
                <div>
                  <dt className="inline text-rose-800/70">failureCode:</dt>{" "}
                  <dd className="inline">{lastFailureFields.failureCode}</dd>
                </div>
              ) : null}
              {lastFailureFields.failureMessage ? (
                <div>
                  <dt className="inline text-rose-800/70">failureMessage:</dt>{" "}
                  <dd className="inline whitespace-pre-wrap">{lastFailureFields.failureMessage}</dd>
                </div>
              ) : null}
            </dl>
          ) : null}
          <div className="text-xs text-rose-800/80">Retry the action after fixing inputs or waiting out a timeout.</div>
        </div>
      ) : null}

      {result?.ok && !loading && !hasCurveData ? (
        <div className="p-3 rounded border border-amber-200 bg-amber-50 text-sm text-amber-950">
          No curve data in this response (empty usage / baseline daily series). This is not a success state for visualization — run lookup or recalc when inputs are ready.
        </div>
      ) : null}

      {baselineChart?.daily?.length ? (
        <div className="border rounded p-4">
          <div className="font-semibold text-sm mb-2">Normal Baseline Display (validation days remain actual)</div>
          <div className="text-xs text-brand-navy/70 mb-2">
            Source notation: ACTUAL or SIMULATED. Validation/test days remain ACTUAL in baseline; modeled values for those
            days appear only in compare.
          </div>
          <div className="text-xs font-mono text-brand-navy/70 mb-2">
            baselineActualDayCount: {String((result as any)?.baselineProjectionSummary?.actualDayCount ?? 0)} · baselineSimulatedDayCount:{" "}
            {String((result as any)?.baselineProjectionSummary?.simulatedDayCount ?? 0)}
          </div>
          <UsageChartsPanel
            monthly={baselineChart.monthly}
            stitchedMonth={baselineChart.stitchedMonth ?? null}
            weekdayKwh={baselineChart.weekdayKwh}
            weekendKwh={baselineChart.weekendKwh}
            monthlyView={usageMonthlyView}
            onMonthlyViewChange={setUsageMonthlyView}
            dailyView={usageDailyView}
            onDailyViewChange={setUsageDailyView}
            daily={baselineChart.daily}
            fifteenCurve={baselineChart.fifteenCurve}
            coverageStart={baselineChart.coverageStart}
            coverageEnd={baselineChart.coverageEnd}
          />
        </div>
      ) : null}

      {usageChart?.daily?.length ? (
        <div className="border rounded p-4">
          <div className="font-semibold text-sm mb-2">Usage 365 (source actual context)</div>
          <UsageChartsPanel
            monthly={usageChart.monthly}
            stitchedMonth={usageChart.stitchedMonth ?? null}
            weekdayKwh={usageChart.weekdayKwh}
            weekendKwh={usageChart.weekendKwh}
            monthlyView={usageMonthlyView}
            onMonthlyViewChange={setUsageMonthlyView}
            dailyView={usageDailyView}
            onDailyViewChange={setUsageDailyView}
            daily={usageChart.daily}
            fifteenCurve={usageChart.fifteenCurve}
            coverageStart={usageChart.coverageStart}
            coverageEnd={usageChart.coverageEnd}
          />
        </div>
      ) : null}

      {result?.ok && compareProjectionForDisplay.rows.length > 0 ? (
        <div className="border rounded p-4">
          <div className="font-semibold text-sm">Validation / Test Day Compare</div>
          <div className="mt-1 text-xs text-brand-navy/70">
            This section compares modeled vs actual on validation days for simulator accuracy transparency.
          </div>
          <ValidationComparePanel
            rows={compareProjectionForDisplay.rows}
            metrics={compareProjectionForDisplay.metrics}
          />
        </div>
      ) : result?.ok ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          No validation/test-day compare rows are available for this Past scenario yet.
        </div>
      ) : null}

      {result?.ok ? (
        <div className="border rounded p-4 space-y-3">
          <div className="font-semibold text-sm">Canonical Calculation Variables / Diagnostics</div>
          <div className="rounded border bg-brand-navy/5 p-3">
            <div className="font-semibold text-xs mb-2">Top-level Diagnostics Verdict</div>
            <div className="grid gap-1 text-xs font-mono md:grid-cols-2">
              <div>exactCanonicalReadSucceeded: {String((result.diagnosticsVerdict as any)?.exactCanonicalReadSucceeded ?? false)}</div>
              <div>usedFallbackArtifact: {String((result.diagnosticsVerdict as any)?.usedFallbackArtifact ?? false)}</div>
              <div>fallbackArtifactReason: {String((result.diagnosticsVerdict as any)?.fallbackArtifactReason ?? "—")}</div>
              <div>savedArtifactInputHash: {String((result.diagnosticsVerdict as any)?.savedArtifactInputHash ?? "—")}</div>
              <div>requestedInputHash: {String((result.diagnosticsVerdict as any)?.requestedInputHash ?? "—")}</div>
              <div>readArtifactInputHash: {String((result.diagnosticsVerdict as any)?.readArtifactInputHash ?? "—")}</div>
              <div>artifactHashMatch: {String((result.diagnosticsVerdict as any)?.artifactHashMatch ?? false)}</div>
              <div>baselineProjectionExpected: {String((result.diagnosticsVerdict as any)?.baselineProjectionExpected ?? false)}</div>
              <div>baselineProjectionApplied: {String((result.diagnosticsVerdict as any)?.baselineProjectionApplied ?? false)}</div>
              <div>baselineProjectionCorrect: {String((result.diagnosticsVerdict as any)?.baselineProjectionCorrect ?? false)}</div>
              <div>selectedValidationDateCount: {String((result.diagnosticsVerdict as any)?.selectedValidationDateCount ?? 0)}</div>
              <div>compareRowCount: {String((result.diagnosticsVerdict as any)?.compareRowCount ?? 0)}</div>
              <div>compareRowsMatchSelectedDates: {String((result.diagnosticsVerdict as any)?.compareRowsMatchSelectedDates ?? false)}</div>
              <div>validationLeakCountInBaseline: {String((result.diagnosticsVerdict as any)?.validationLeakCountInBaseline ?? 0)}</div>
              <div>
                travelVacantSimulatedDatesInBaselineCount:{" "}
                {String((result.diagnosticsVerdict as any)?.travelVacantSimulatedDatesInBaselineCount ?? 0)}
              </div>
              <div>
                validationDatesRenderedAsActualCount:{" "}
                {String((result.diagnosticsVerdict as any)?.validationDatesRenderedAsActualCount ?? 0)}
              </div>
              <div>
                validationDatesRenderedAsSimulatedCount:{" "}
                {String((result.diagnosticsVerdict as any)?.validationDatesRenderedAsSimulatedCount ?? 0)}
              </div>
            </div>
            <div className="mt-2 text-xs font-mono break-all">
              validationLeakDatesInBaseline:{" "}
              {JSON.stringify((result.diagnosticsVerdict as any)?.validationLeakDatesInBaseline ?? [], null, 0)}
            </div>
          </div>
          <div className="grid gap-2 text-xs md:grid-cols-2">
            <div className="rounded border bg-brand-navy/5 p-2">
              <div className="font-semibold mb-1">Read / projection truth</div>
              <div className="font-mono">readLayer: {String((result.canonicalReadResultSummary as any)?.readLayer ?? "—")}</div>
              <div className="font-mono">readMode: {String((result.canonicalReadResultSummary as any)?.readMode ?? "—")}</div>
              <div className="font-mono">projectionMode: {String((result.canonicalReadResultSummary as any)?.projectionMode ?? "—")}</div>
              <div className="font-mono">
                artifactSourceMode: {String((result.canonicalReadResultSummary as any)?.artifactSourceMode ?? "—")}
              </div>
              <div className="font-mono">
                validationProjectionApplied: {String((result.baselineProjectionSummary as any)?.applied ?? false)}
              </div>
              <div className="font-mono">
                compareProjectionAttached: {String((result.compareProjectionSummary as any)?.attached ?? false)}
              </div>
            </div>
            <div className="rounded border bg-brand-navy/5 p-2">
              <div className="font-semibold mb-1">Count summary</div>
              <div className="font-mono">
                validationOnlyDateKeyCount: {String((result.baselineProjectionSummary as any)?.validationOnlyDateKeyCount ?? 0)}
              </div>
              <div className="font-mono">
                compareRowsCount: {String((result.compareProjectionSummary as any)?.rowCount ?? 0)}
              </div>
              <div className="font-mono">
                baselineActualDayCount: {String((result.baselineProjectionSummary as any)?.actualDayCount ?? 0)}
              </div>
              <div className="font-mono">
                baselineSimulatedDayCount: {String((result.baselineProjectionSummary as any)?.simulatedDayCount ?? 0)}
              </div>
            </div>
          </div>

          <details className="rounded border p-3">
            <summary className="cursor-pointer font-semibold text-xs">Canonical Read Result Summary</summary>
            <pre className="mt-2 text-xs bg-brand-navy/5 p-3 rounded overflow-x-auto">
              {JSON.stringify(result.canonicalReadResultSummary ?? null, null, 2)}
            </pre>
          </details>

          <details className="rounded border p-3">
            <summary className="cursor-pointer font-semibold text-xs">Shared Result Payload Summary</summary>
            <pre className="mt-2 text-xs bg-brand-navy/5 p-3 rounded overflow-x-auto">
              {JSON.stringify(result.sharedResultPayloadSummary ?? null, null, 2)}
            </pre>
          </details>

          <details className="rounded border p-3">
            <summary className="cursor-pointer font-semibold text-xs">Baseline Projection Summary</summary>
            <pre className="mt-2 text-xs bg-brand-navy/5 p-3 rounded overflow-x-auto">
              {JSON.stringify(result.baselineProjectionSummary ?? null, null, 2)}
            </pre>
          </details>

          <details className="rounded border p-3">
            <summary className="cursor-pointer font-semibold text-xs">Compare Projection Summary</summary>
            <pre className="mt-2 text-xs bg-brand-navy/5 p-3 rounded overflow-x-auto">
              {JSON.stringify(result.compareProjectionSummary ?? null, null, 2)}
            </pre>
          </details>

          <details className="rounded border p-3">
            <summary className="cursor-pointer font-semibold text-xs">Pipeline Diagnostics Summary</summary>
            <pre className="mt-2 text-xs bg-brand-navy/5 p-3 rounded overflow-x-auto">
              {JSON.stringify(result.pipelineDiagnosticsSummary ?? null, null, 2)}
            </pre>
          </details>
        </div>
      ) : null}

      {result?.ok ? (
        <details className="border rounded p-4">
          <summary className="cursor-pointer font-semibold text-sm">Raw Shared Payload Details (summarized)</summary>
          <pre className="mt-3 text-xs bg-brand-navy/5 p-3 rounded overflow-x-auto">
            {JSON.stringify(
              {
                baselineDatasetSummary: {
                  summary: result.baselineDatasetProjection?.summary ?? null,
                  dailyCount: Array.isArray(result.baselineDatasetProjection?.daily)
                    ? result.baselineDatasetProjection.daily.length
                    : 0,
                  monthlyCount: Array.isArray(result.baselineDatasetProjection?.monthly)
                    ? result.baselineDatasetProjection.monthly.length
                    : 0,
                  intervalCount: Array.isArray(result.baselineDatasetProjection?.series?.intervals15)
                    ? result.baselineDatasetProjection.series.intervals15.length
                    : 0,
                  metaKeys:
                    result.baselineDatasetProjection?.meta &&
                    typeof result.baselineDatasetProjection.meta === "object"
                      ? Object.keys(result.baselineDatasetProjection.meta).sort()
                      : [],
                },
                compareProjectionSummary: {
                  rowCount: Array.isArray(result.compareProjection?.rows) ? result.compareProjection.rows.length : 0,
                  metrics: result.compareProjection?.metrics ?? {},
                },
              },
              null,
              2
            )}
          </pre>
        </details>
      ) : null}

      {result?.ok ? (
        <details className="border rounded p-4">
          <summary className="cursor-pointer font-semibold text-sm">Raw Compare Projection Payload</summary>
          <pre className="mt-3 text-xs bg-brand-navy/5 p-3 rounded overflow-x-auto">
            {JSON.stringify(result.compareProjection ?? null, null, 2)}
          </pre>
        </details>
      ) : null}

      <details className="border rounded p-4">
        <summary className="cursor-pointer font-semibold text-sm">Step Request / Response Payloads</summary>
        <div className="mt-3 space-y-3">
          {requestDebug.map((entry, idx) => (
            <pre key={idx} className="text-xs bg-brand-navy/5 p-3 rounded overflow-x-auto">
              {JSON.stringify(entry, null, 2)}
            </pre>
          ))}
        </div>
      </details>

      <Modal
        open={openFullHomeEditor}
        title="Test Home Details (Full Editor)"
        onClose={() => setOpenFullHomeEditor(false)}
      >
        <HomeDetailsClient
          houseId={effectiveTestHomeId || "test-home"}
          loadUrl="/api/admin/tools/gapfill-lab/test-home/home-profile"
          saveUrl="/api/admin/tools/gapfill-lab/test-home/home-profile"
          prefillUrl="/api/admin/tools/gapfill-lab/test-home/home-profile/prefill"
          awardEntries={false}
          onSaved={async () => {
            const refreshed = await fetch("/api/admin/tools/gapfill-lab/test-home/home-profile?houseId=test-home", {
              cache: "no-store",
            })
              .then((r) => r.json())
              .catch(() => null);
            if (refreshed?.ok && refreshed?.profile) {
              setHomeProfileJson(prettyJson(refreshed.profile));
            }
          }}
        />
      </Modal>

      <Modal
        open={openFullApplianceEditor}
        title="Test Home Appliances (Full Editor)"
        onClose={() => setOpenFullApplianceEditor(false)}
      >
        <AppliancesClient
          houseId={effectiveTestHomeId || "test-home"}
          loadUrl="/api/admin/tools/gapfill-lab/test-home/appliances"
          saveUrl="/api/admin/tools/gapfill-lab/test-home/appliances"
          awardEntries={false}
          onSaved={async () => {
            const refreshed = await fetch("/api/admin/tools/gapfill-lab/test-home/appliances?houseId=test-home", {
              cache: "no-store",
            })
              .then((r) => r.json())
              .catch(() => null);
            if (refreshed?.ok && refreshed?.profile) {
              setApplianceProfileJson(prettyJson(refreshed.profile));
            }
          }}
        />
      </Modal>
    </div>
  );
}