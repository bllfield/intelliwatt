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
      maskedIntervals: number;
      metrics: any;
      primaryPercentMetric: number | null;
      byMonth: any[];
      byHour: any[];
      byDayType: any[];
      worstDays: any[];
      diagnostics: any;
      pasteSummary: string;
      message?: string;
    }
  | { ok: false; error: string; message?: string };

const DEFAULT_RANGE: RangeRow = { startDate: "", endDate: "" };

function formatDate(d: string) {
  return d ? new Date(d + "T12:00:00Z").toLocaleDateString("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }) : "";
}

export default function GapFillLabClient() {
  const [email, setEmail] = useState("");
  const [timezone, setTimezone] = useState("America/Chicago");
  const [ranges, setRanges] = useState<RangeRow[]>([{ ...DEFAULT_RANGE }]);
  const [houseId, setHouseId] = useState("");
  const [houses, setHouses] = useState<HouseOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ApiResponse | null>(null);

  function addRange() {
    setRanges((prev) => [...prev, { ...DEFAULT_RANGE }]);
  }

  function removeRange(i: number) {
    setRanges((prev) => (prev.length <= 1 ? prev : prev.filter((_, j) => j !== i)));
  }

  function updateRange(i: number, field: "startDate" | "endDate", value: string) {
    setRanges((prev) => prev.map((r, j) => (j === i ? { ...r, [field]: value.slice(0, 10) } : r)));
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
          rangesToMask: [],
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
    const validRanges = ranges.filter((r) => r.startDate && r.endDate);
    if (!validRanges.length) {
      setError("Add at least one travel/vacant range (start and end date).");
      return;
    }
    setLoading(true);
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 120_000); // 2 min
      const res = await fetch("/api/admin/tools/gapfill-lab", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: trimmed,
          timezone,
          rangesToMask: validRanges,
          houseId: houseId || undefined,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      const data = (await res.json().catch(() => null)) as ApiResponse;
      if (!res.ok) {
        setError((data as any)?.message ?? (data as any)?.error ?? `Request failed (${res.status})`);
        setResult(null);
        return;
      }
      setResult(data);
      if (data.ok && data.houses?.length) setHouses(data.houses);
    } catch (e: any) {
      const msg = e?.name === "AbortError"
        ? "Request took too long (2 min). Try a shorter travel range."
        : (e?.message ?? String(e));
      setError(msg);
      setResult(null);
    } finally {
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
              onChange={(e) => setHouseId(e.target.value)}
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
          <label className="block text-sm font-medium text-brand-navy mb-2">Travel/Vacant ranges (start – end date, YYYY-MM-DD)</label>
          <div className="space-y-2">
            {ranges.map((r, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <input
                  type="date"
                  value={r.startDate}
                  onChange={(e) => updateRange(i, "startDate", e.target.value)}
                  className="border border-brand-blue/30 rounded px-3 py-2 text-brand-navy"
                />
                <span className="text-brand-navy/60">–</span>
                <input
                  type="date"
                  value={r.endDate}
                  onChange={(e) => updateRange(i, "endDate", e.target.value)}
                  className="border border-brand-blue/30 rounded px-3 py-2 text-brand-navy"
                />
                <button type="button" onClick={() => removeRange(i)} className="text-rose-600 hover:underline text-sm">
                  Remove
                </button>
              </div>
            ))}
            <button type="button" onClick={addRange} className="text-brand-blue hover:underline text-sm">
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
          <span className="text-sm text-brand-navy/60">May take 30–60 seconds.</span>
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
              {result.house?.label} · {result.maskedIntervals} masked intervals
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

          {result.ok && result.maskedIntervals === 0 && result.message && (
            <p className="text-brand-navy/70">{result.message}</p>
          )}
        </div>
      )}
    </div>
  );
}
