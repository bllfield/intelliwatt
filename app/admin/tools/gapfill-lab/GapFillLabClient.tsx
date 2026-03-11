"use client";

import { useState } from "react";
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
  daily: Array<{ date: string; kwh: number }>;
  monthly: Array<{ month: string; kwh: number }>;
  weekdayKwh: number;
  weekendKwh: number;
  fifteenCurve: Array<{ hhmm: string; avgKw: number }>;
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
      fullReportText?: string;
      fullReportJson?: { scenario?: { testRangesInput?: RangeRow[]; testSelectionMode?: string } } | null;
      message?: string;
      travelRangesFromDb?: Array<{ startDate: string; endDate: string }>;
      testSelectionMode?: "manual_ranges" | "random_days";
      testDaysRequested?: number;
      testDaysSelected?: number;
      seedUsed?: string | null;
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
    }
  | { ok: false; error: string; message?: string; overlapCount?: number; overlapSample?: string[] };

const DEFAULT_RANGE: RangeRow = { startDate: "", endDate: "" };

function formatDate(d: string) {
  return d ? new Date(d + "T12:00:00Z").toLocaleDateString("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }) : "";
}

const VALID_RANDOM_TEST_MODES = ["fixed", "random", "winter", "summer", "shoulder", "extreme_weather"] as const;
type RandomTestMode = (typeof VALID_RANDOM_TEST_MODES)[number];

type WeatherKindOption = "ACTUAL_LAST_YEAR" | "NORMAL_AVG" | "open_meteo";

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
  const [houseId, setHouseId] = useState("");
  const [houses, setHouses] = useState<HouseOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ApiResponse | null>(null);
  const [travelRangesFromDb, setTravelRangesFromDb] = useState<RangeRow[]>([]);
  const [usageMonthlyView, setUsageMonthlyView] = useState<"chart" | "table">("chart");
  const [usageDailyView, setUsageDailyView] = useState<"chart" | "table">("chart");

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
    }
  }

  async function handleLookup() {
    setError(null);
    setResult(null);
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) {
      setError("Enter an email address.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/admin/tools/gapfill-lab", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: trimmed,
          timezone,
          testRanges: [],
          houseId: houseId || undefined,
        }),
      });
      const data = (await res.json().catch(() => null)) as ApiResponse;
      if (!res.ok) {
        setError((data as any)?.message ?? (data as any)?.error ?? `Request failed (${res.status})`);
        setResult(null);
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
    } catch (e: any) {
      setError(e?.name === "AbortError" ? "Request timed out." : (e?.message ?? String(e)));
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  async function handleRunCompare() {
    setError(null);
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
    setLoading(true);
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    try {
      const controller = new AbortController();
      timeoutId = setTimeout(() => controller.abort(), 115_000);
      const body: Record<string, unknown> = {
        email: trimmed,
        timezone,
        houseId: houseId || undefined,
        weatherKind,
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
      const res = await fetch("/api/admin/tools/gapfill-lab", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const data = (await res.json().catch(() => null)) as ApiResponse;
      if (!res.ok) {
        const errMsg = (data as any)?.error === "test_overlaps_travel"
          ? "Test Dates overlap Vacant/Travel dates — remove overlap and retry."
          : ((data as any)?.message ?? (data as any)?.error ?? `Request failed (${res.status})`);
        setError(errMsg);
        setResult(null);
        return;
      }
      setResult(data);
      if (data.ok && data.houses?.length) setHouses(data.houses);
      if (data.ok && Array.isArray((data as any).travelRangesFromDb)) {
        setTravelRangesFromDb((data as any).travelRangesFromDb.map((r: RangeRow) => ({ startDate: r.startDate, endDate: r.endDate })));
      }
    } catch (e: any) {
      const msg = e?.name === "AbortError"
        ? "Request timed out. Try a shorter Test date range."
        : (e?.message ?? String(e));
      setError(msg);
      setResult(null);
    } finally {
      if (timeoutId != null) clearTimeout(timeoutId);
      setLoading(false);
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
            disabled={loading}
            className="px-4 py-2 bg-brand-blue text-white rounded hover:bg-brand-navy disabled:opacity-50"
          >
            Lookup
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
            Vacant/Travel (DB) are guardrails so we don’t accidentally test on customer-travel days. Only Test Dates are scored against actual intervals.
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
          <span className="text-sm text-brand-navy/60">Typically returns in seconds (test-days-only).</span>
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 rounded bg-rose-50 text-rose-800 border border-rose-200">
          {error}
        </div>
      )}

      {result && result.ok && (
        <div className="space-y-4">
          {result.usage365?.daily?.length ? (
            <details className="border border-brand-blue/20 rounded" open>
              <summary className="p-3 cursor-pointer font-semibold text-brand-navy bg-brand-blue/5 rounded-t">
                365-day usage chart (same as user Usage page)
              </summary>
              <div className="p-4 border-t border-brand-blue/20">
                <p className="text-sm text-brand-navy/70 mb-4">
                  Source: {result.usage365.source} · {result.usage365.intervalCount.toLocaleString()} intervals ·
                  {` ${result.usage365.coverageStart ?? "—"} to ${result.usage365.coverageEnd ?? "—"}`}
                </p>
                <UsageChartsPanel
                  monthly={result.usage365.monthly}
                  stitchedMonth={null}
                  weekdayKwh={result.usage365.weekdayKwh}
                  weekendKwh={result.usage365.weekendKwh}
                  monthlyView={usageMonthlyView}
                  onMonthlyViewChange={setUsageMonthlyView}
                  dailyView={usageDailyView}
                  onDailyViewChange={setUsageDailyView}
                  daily={result.usage365.daily}
                  fifteenCurve={result.usage365.fifteenCurve}
                  coverageStart={result.usage365.coverageStart}
                  coverageEnd={result.usage365.coverageEnd}
                />
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

          {result.ok && result.testIntervalsCount === 0 && result.message && (
            <p className="text-brand-navy/70">{result.message}</p>
          )}
        </div>
      )}
    </div>
  );
}