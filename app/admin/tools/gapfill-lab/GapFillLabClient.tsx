"use client";

import { useState } from "react";
import Link from "next/link";

type HouseOption = { id: string; label: string };
type RangeRow = { startDate: string; endDate: string };

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
      fullReportJson?: object | null;
      message?: string;
      travelRangesFromDb?: Array<{ startDate: string; endDate: string }>;
    }
  | { ok: false; error: string; message?: string; overlapCount?: number; overlapSample?: string[] };

const DEFAULT_RANGE: RangeRow = { startDate: "", endDate: "" };

function formatDate(d: string) {
  return d ? new Date(d + "T12:00:00Z").toLocaleDateString("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }) : "";
}

export default function GapFillLabClient() {
  const [email, setEmail] = useState("");
  const [timezone, setTimezone] = useState("America/Chicago");
  const [testRanges, setTestRanges] = useState<RangeRow[]>([{ ...DEFAULT_RANGE }]);
  const [houseId, setHouseId] = useState("");
  const [houses, setHouses] = useState<HouseOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ApiResponse | null>(null);
  const [travelRangesFromDb, setTravelRangesFromDb] = useState<RangeRow[]>([]);
  const [primeLoading, setPrimeLoading] = useState(false);
  const [primeMessage, setPrimeMessage] = useState<string | null>(null);

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
    setPrimeMessage(null);
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

  async function primeRequest(payload: { email: string; testRanges?: RangeRow[]; rangesToMask?: RangeRow[]; timezone?: string }) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 295_000); // ~4m55s, under server maxDuration 300s
    try {
      const res = await fetch("/api/admin/tools/prime-past-cache", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
        credentials: "include",
      });
      return res;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async function handlePrimePastCache() {
    setPrimeMessage(null);
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) {
      setPrimeMessage("Enter an email and run Lookup first.");
      return;
    }
    setPrimeLoading(true);
    try {
      const res = await primeRequest({ email: trimmed });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string; message?: string } | null;
      if (res.ok && data?.ok) {
        setPrimeMessage("Past cache primed. Run Compare can reuse it and finish in seconds.");
      } else {
        const msg =
          (data as any)?.message ??
          (data as any)?.error ??
          (res.status === 503
            ? "Build timed out (4 min). Prime from Admin → Usage (droplet) or try Run Compare."
            : res.status === 500
              ? "Server error or timeout. Try Run Compare (cache may exist) or prime from Admin → Usage."
              : `Failed (${res.status})`);
        setPrimeMessage(msg);
      }
    } catch (e: any) {
      const msg = e?.name === "AbortError"
        ? "Prime hit the 5 min limit. Try again or run Compare (it will build and then you can prime next time)."
        : (e?.message ?? String(e));
      setPrimeMessage(msg);
    } finally {
      setPrimeLoading(false);
    }
  }

  async function handlePrimeForCompare() {
    setPrimeMessage(null);
    const trimmed = email.trim().toLowerCase();
    const validRanges = testRanges.filter((r) => r.startDate && r.endDate);
    if (!trimmed) {
      setPrimeMessage("Enter an email and run Lookup first.");
      return;
    }
    if (!validRanges.length) {
      setPrimeMessage("Add at least one Test Date range, then click Prime for Compare.");
      return;
    }
    setPrimeLoading(true);
    try {
      const res = await primeRequest({
        email: trimmed,
        testRanges: validRanges,
        rangesToMask: validRanges,
        timezone,
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string; message?: string } | null;
      if (res.ok && data?.ok) {
        setPrimeMessage("Lab cache primed for these ranges. Run Compare will finish in seconds.");
      } else {
        setPrimeMessage(
          (data as any)?.message ?? (data as any)?.error ?? (res.status === 500 ? "Server error or timeout." : `Failed (${res.status})`)
        );
      }
    } catch (e: any) {
      setPrimeMessage(
        e?.name === "AbortError"
          ? "Prime hit the 5 min limit. Try Run Compare after (it may build and save for next time)."
          : (e?.message ?? String(e))
      );
    } finally {
      setPrimeLoading(false);
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
    if (!validRanges.length) {
      setError("Add at least one Test Date range (start and end date).");
      return;
    }
    setLoading(true);
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    try {
      const controller = new AbortController();
      timeoutId = setTimeout(() => controller.abort(), 55_000);
      const res = await fetch("/api/admin/tools/gapfill-lab", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: trimmed,
          timezone,
          testRanges: validRanges,
          houseId: houseId || undefined,
        }),
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

        <div className="p-3 rounded border border-brand-blue/20 bg-brand-blue/5">
          <div className="text-sm font-medium text-brand-navy mb-1">Prime cache (optional)</div>
          <p className="text-sm text-brand-navy/70 mb-2">
            <strong>Prime for Compare</strong> is what makes Run Compare fast when you have ranges: enter your travel ranges below, then click it. Wait 1–5 min; after that, Run Compare finishes in seconds. <strong>Prime Past cache</strong> only primes the dashboard Past (does not help Run Compare when you have ranges).
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handlePrimeForCompare}
              disabled={!email.trim() || primeLoading || !testRanges.some((r) => r.startDate && r.endDate)}
              className="px-3 py-1.5 bg-brand-blue text-white rounded text-sm hover:bg-brand-navy disabled:opacity-50"
            >
              {primeLoading ? "Priming…" : "Prime for Compare"}
            </button>
            <button
              type="button"
              onClick={handlePrimePastCache}
              disabled={!email.trim() || primeLoading}
              className="px-3 py-1.5 bg-brand-navy/80 text-white rounded text-sm hover:bg-brand-navy disabled:opacity-50"
            >
              Prime Past cache
            </button>
            {primeMessage && (
              <span className={`text-sm ${primeMessage.startsWith("Lab cache primed") || primeMessage.startsWith("Past cache primed") ? "text-green-700" : "text-rose-700"}`}>
                {primeMessage}
              </span>
            )}
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-brand-navy mb-2">Vacant / Travel Dates (User Data)</label>
          <p className="text-sm text-brand-navy/60 mb-2">
            Read-only list from the customer’s saved travel/vacant dates. Vacant/Travel dates are excluded from the model and are never scored.
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
          <label className="block text-sm font-medium text-brand-navy mb-2">Test Dates (Accuracy Test)</label>
          <p className="text-sm text-brand-navy/60 mb-2">
            Only Test Dates are scored against actual intervals. Do not overlap Vacant/Travel dates above.
          </p>
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
          <div className="p-4 rounded bg-brand-blue/5 border border-brand-blue/20">
            <div className="font-semibold text-brand-navy">Simulation Audit Report</div>
            <div className="text-sm text-brand-navy/80 mt-1">
              {result.house?.label} · {result.testIntervalsCount} test intervals
              {result.metrics ? ` · WAPE ${result.metrics.wape}% · MAE ${result.metrics.mae} kWh · RMSE ${result.metrics.rmse}` : ""}
            </div>
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