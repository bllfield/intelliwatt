"use client";

import { useMemo, useState } from "react";
import { UsageChartsPanel } from "@/components/usage/UsageChartsPanel";

type HouseOption = { id: string; label: string; esiid?: string | null };
type DateRange = { startDate: string; endDate: string };

type UsagePayload = {
  source: string;
  timezone: string;
  coverageStart: string | null;
  coverageEnd: string | null;
  intervalCount: number;
  daily: Array<{ date: string; kwh: number }>;
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
  }>;
  metrics?: Record<string, number>;
  canonicalWindow?: { startDate: string; endDate: string; helper?: string };
  modelAssumptions?: Record<string, unknown>;
  compareTruth?: Record<string, unknown>;
  userDefaultValidationSelectionMode?: string;
  adminLabDefaultValidationSelectionMode?: string;
  supportedValidationSelectionModes?: string[];
  selectionDiagnostics?: Record<string, unknown>;
} | {
  ok: false;
  error: string;
  message?: string;
  detail?: string;
  testHomeLink?: any;
};

const EMPTY_RANGE: DateRange = { startDate: "", endDate: "" };

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

function toPayloadFromBaseline(dataset: any, timezone: string): UsagePayload | null {
  if (!dataset || typeof dataset !== "object") return null;
  const daily = Array.isArray(dataset.daily)
    ? dataset.daily
        .map((d: any) => ({ date: String(d?.date ?? "").slice(0, 10), kwh: Number(d?.kwh ?? 0) || 0 }))
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
  const [requestDebug, setRequestDebug] = useState<any[]>([]);
  const [usageMonthlyView, setUsageMonthlyView] = useState<"chart" | "table">("chart");
  const [usageDailyView, setUsageDailyView] = useState<"chart" | "table">("chart");

  async function runAction(action: string, extra: Record<string, unknown> = {}) {
    setLoading(true);
    setError(null);
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
    const resp = await fetch("/api/admin/tools/gapfill-lab", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = (await resp.json()) as RunResult;
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
      setError(json.message ?? json.error);
      setLoading(false);
      return json;
    }

    if (json.sourceHouses) {
      setSourceHouses(json.sourceHouses);
      if (!sourceHouseId && json.selectedSourceHouseId) setSourceHouseId(json.selectedSourceHouseId);
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
    if (!json.userDefaultValidationSelectionMode && json.adminLabDefaultValidationSelectionMode) {
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
    await runAction("run_test_home_canonical_recalc");
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
        <select className="border rounded px-3 py-2 text-sm" value={sourceHouseId} onChange={(e) => setSourceHouseId(e.target.value)}>
          <option value="">Select source house</option>
          {sourceHouses.map((h) => (
            <option key={h.id} value={h.id}>{h.label}</option>
          ))}
        </select>
        <div className="flex gap-2">
          <button className="px-3 py-2 rounded bg-brand-blue text-white text-sm" disabled={loading} onClick={onLookup}>Lookup</button>
          <button className="px-3 py-2 rounded bg-brand-navy text-white text-sm" disabled={loading || !sourceHouseId} onClick={onReplace}>
            Load/Replace Test Home
          </button>
        </div>
      </div>

      {(sourceHouse || testHome || testHomeLink) && (
        <div className="border rounded p-4 bg-white">
          <div className="font-semibold text-sm mb-2">Source/Test-Home Identity</div>
          <div className="text-sm text-brand-navy/80">
            Source: {sourceHouse ? sourceHouse.label : "—"} · Test Home: {testHome ? testHome.label : "—"}
          </div>
          <div className="text-xs text-brand-navy/70 mt-1">
            Link status: {String(testHomeLink?.status ?? "unknown")} {testHomeLink?.statusMessage ? `· ${String(testHomeLink.statusMessage)}` : ""}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="border rounded p-4">
          <div className="font-semibold text-sm mb-2">Canonical Home Inputs (Editable JSON)</div>
          <textarea className="w-full h-80 border rounded p-2 font-mono text-xs" value={homeProfileJson} onChange={(e) => setHomeProfileJson(e.target.value)} />
        </div>
        <div className="border rounded p-4">
          <div className="font-semibold text-sm mb-2">Canonical Appliance Inputs (Editable JSON)</div>
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
        </div>
      </div>

      {error ? <div className="p-3 rounded border border-red-300 bg-red-50 text-sm text-red-800">{error}</div> : null}

      {baselineChart?.daily?.length ? (
        <div className="border rounded p-4">
          <div className="font-semibold text-sm mb-2">Normal Baseline Display (validation days remain actual)</div>
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

      {result?.ok && Array.isArray(result.scoredDayTruthRows) && result.scoredDayTruthRows.length > 0 ? (
        <div className="border rounded p-4">
          <div className="font-semibold text-sm mb-2">Accuracy / Test Day Compare</div>
          <div className="text-xs text-brand-navy/80 mb-2">
            WAPE {Number(result.metrics?.wape ?? 0).toFixed(2)}% · MAE {Number(result.metrics?.mae ?? 0).toFixed(2)} · RMSE {Number(result.metrics?.rmse ?? 0).toFixed(2)}
          </div>
          <div className="overflow-auto">
            <table className="min-w-full text-xs border">
              <thead className="bg-brand-blue/5">
                <tr>
                  <th className="text-left p-2 border">Date</th>
                  <th className="text-left p-2 border">Day Type</th>
                  <th className="text-right p-2 border">Actual kWh</th>
                  <th className="text-right p-2 border">Sim kWh</th>
                  <th className="text-right p-2 border">Error kWh</th>
                  <th className="text-right p-2 border">Percent Error</th>
                </tr>
              </thead>
              <tbody>
                {result.scoredDayTruthRows.map((row) => (
                  <tr key={row.localDate}>
                    <td className="p-2 border">{row.localDate}</td>
                    <td className="p-2 border">{row.dayType}</td>
                    <td className="p-2 border text-right">{row.actualDayKwh.toFixed(2)}</td>
                    <td className="p-2 border text-right">{row.freshCompareSimDayKwh.toFixed(2)}</td>
                    <td className="p-2 border text-right">{row.actualVsFreshErrorKwh.toFixed(2)}</td>
                    <td className="p-2 border text-right">
                      {Math.abs(row.actualDayKwh) > 1e-6
                        ? `${((Math.abs(row.actualVsFreshErrorKwh) / Math.abs(row.actualDayKwh)) * 100).toFixed(2)}%`
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {result?.ok ? (
        <div className="border rounded p-4">
          <div className="font-semibold text-sm mb-2">Canonical Calculation Variables / Diagnostics</div>
          <pre className="text-xs bg-brand-navy/5 p-3 rounded overflow-x-auto">
            {JSON.stringify({
              canonicalWindow: result.canonicalWindow ?? null,
              modelAssumptions: result.modelAssumptions ?? null,
              compareTruth: result.compareTruth ?? null,
              selectionDiagnostics: result.selectionDiagnostics ?? null,
              userDefaultValidationSelectionMode,
              adminLabValidationSelectionMode,
              testHomeLink,
            }, null, 2)}
          </pre>
        </div>
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
    </div>
  );
}

