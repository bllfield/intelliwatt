"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";

type ApiOk = {
  ok: true;
  offerId: string;
  link: any | null;
  ratePlan: any | null;
  masterPlan: any | null;
  eflRawText: string | null;
  introspection: any | null;
};
type ApiErr = { ok: false; error: string; detail?: any };

function pretty(x: any) {
  try {
    return JSON.stringify(x, null, 2);
  } catch {
    return String(x);
  }
}

function useLocalToken(key = "iw_admin_token") {
  const [token, setToken] = useState("");
  useEffect(() => {
    try {
      setToken(localStorage.getItem(key) || "");
    } catch {
      setToken("");
    }
  }, [key]);
  useEffect(() => {
    try {
      if (token) localStorage.setItem(key, token);
    } catch {
      // ignore
    }
  }, [key, token]);
  return { token, setToken };
}

function toNum(v: any): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

function extractFixedEnergyCentsPerKwh(rateStructure: any): number | null {
  if (!rateStructure || typeof rateStructure !== "object") return null;
  const candidates: any[] = [
    rateStructure.energyRateCents,
    rateStructure.defaultRateCentsPerKwh,
    rateStructure.repEnergyCentsPerKwh,
    rateStructure.energyCentsPerKwh,
    rateStructure.energyChargeCentsPerKwh,
  ];
  const nums = candidates.map(toNum).filter((x): x is number => x != null);
  if (nums.length === 0) return null;
  // If multiple conflicting values exist, fail-closed and don’t show a single “fixed” number.
  const uniq = Array.from(new Set(nums.map((n) => Math.round(n * 1000) / 1000)));
  return uniq.length === 1 ? uniq[0] : null;
}

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export default function AdminPlanDetailsPage({ params }: { params: { offerId: string } }) {
  const offerId = String(params?.offerId ?? "").trim();
  const { token, setToken } = useLocalToken();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ApiOk | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setData(null);
    try {
      const res = await fetch(`/api/admin/plans/details?offerId=${encodeURIComponent(offerId)}`, {
        headers: { "x-admin-token": token },
        cache: "no-store",
      });
      const json = (await res.json().catch(() => null)) as ApiOk | ApiErr | null;
      if (!res.ok || !json || (json as any).ok !== true) {
        setError((json as any)?.error ? String((json as any).error) : `http_${res.status}`);
        return;
      }
      setData(json as ApiOk);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }, [offerId, token]);

  useEffect(() => {
    // Auto-load when token present.
    if (token && offerId) void load();
  }, [token, offerId, load]);

  // --- estimation runner (homeId-scoped)
  const [homeId, setHomeId] = useState("");
  const [monthsCount, setMonthsCount] = useState(12);
  const [backfill, setBackfill] = useState(false);
  const [estimateLoading, setEstimateLoading] = useState(false);
  const [estimateErr, setEstimateErr] = useState<string | null>(null);
  const [estimateJson, setEstimateJson] = useState<any>(null);

  const monthsClamped = useMemo(() => Math.max(1, Math.min(12, Math.floor(Number(monthsCount) || 12))), [monthsCount]);

  const runEstimate = useCallback(async () => {
    setEstimateLoading(true);
    setEstimateErr(null);
    setEstimateJson(null);
    try {
      const res = await fetch("/api/admin/plan-engine/offer-estimate", {
        method: "POST",
        headers: { "content-type": "application/json", "x-admin-token": token },
        body: JSON.stringify({
          offerId,
          homeId: homeId.trim(),
          monthsCount: monthsClamped,
          backfill,
        }),
      });
      const json = await res.json().catch(() => null);
      setEstimateJson(json);
      if (!res.ok) {
        setEstimateErr(json?.error ? String(json.error) : `http_${res.status}`);
      }
    } catch (e: any) {
      setEstimateErr(e?.message ?? String(e));
    } finally {
      setEstimateLoading(false);
    }
  }, [token, offerId, homeId, monthsClamped, backfill]);

  // --- bucket coverage matrix (homeId + requiredBucketKeys)
  const [coverageLoading, setCoverageLoading] = useState(false);
  const [coverageErr, setCoverageErr] = useState<string | null>(null);
  const [coverageJson, setCoverageJson] = useState<any>(null);

  const requiredBucketKeys = useMemo(() => {
    const keys = data?.introspection?.requiredBucketKeys;
    return Array.isArray(keys) ? (keys as string[]).map((k) => String(k)).filter(Boolean) : [];
  }, [data]);

  const planVars = useMemo(() => {
    const rp = data?.ratePlan ?? null;
    const rs = rp?.rateStructure ?? null;
    const type = String(rs?.type ?? "").toUpperCase() || "UNKNOWN";
    const baseMonthlyFeeCents = toNum(rs?.baseMonthlyFeeCents);
    const tdspIncluded = rs?.tdspDeliveryIncludedInEnergyCharge === true;
    const fixedEnergy = extractFixedEnergyCentsPerKwh(rs);
    const hasTouTiers = Array.isArray(rs?.tiers) && rs.tiers.length > 0;
    const hasCredits = Boolean(rs?.billCredits?.hasBillCredit) || Array.isArray(rs?.billCredits?.rules);
    const hasTiers = Array.isArray(rs?.usageTiers) && rs.usageTiers.length > 0;

    const rows: Array<{ key: string; value: string; notes?: string }> = [
      { key: "rateStructure.type", value: type },
      {
        key: "baseMonthlyFeeCents",
        value: baseMonthlyFeeCents == null ? "—" : String(baseMonthlyFeeCents),
      },
      {
        key: "fixedEnergyCentsPerKwh",
        value: fixedEnergy == null ? "—" : String(fixedEnergy),
        notes: fixedEnergy == null ? "Not a single unambiguous fixed rate (or not FIXED)." : undefined,
      },
      { key: "tdspDeliveryIncludedInEnergyCharge", value: tdspIncluded ? "true" : "false" },
      { key: "hasUsageTiers", value: hasTiers ? "true" : "false" },
      { key: "hasBillCredits", value: hasCredits ? "true" : "false" },
      { key: "hasTouTiers", value: hasTouTiers ? "true" : "false" },
    ];
    return rows;
  }, [data]);

  const estimateVars = useMemo(() => {
    if (!estimateJson?.ok) return null;
    const tdsp = estimateJson?.tdspApplied ?? null;
    const rows: Array<{ key: string; value: string }> = [
      { key: "homeId", value: String(estimateJson.homeId ?? "—") },
      { key: "esiid", value: String(estimateJson.esiid ?? "—") },
      { key: "tdspSlug", value: String(estimateJson.tdspSlug ?? "—") },
      { key: "annualKwh", value: String(estimateJson.annualKwh ?? "—") },
      {
        key: "tdspApplied.perKwhDeliveryChargeCents",
        value: tdsp?.perKwhDeliveryChargeCents != null ? String(tdsp.perKwhDeliveryChargeCents) : "—",
      },
      {
        key: "tdspApplied.monthlyCustomerChargeDollars",
        value: tdsp?.monthlyCustomerChargeDollars != null ? String(tdsp.monthlyCustomerChargeDollars) : "—",
      },
      { key: "monthsCount", value: String(estimateJson.monthsCount ?? "—") },
      { key: "monthsIncluded", value: Array.isArray(estimateJson.monthsIncluded) ? estimateJson.monthsIncluded.join(", ") : "—" },
      { key: "backfill.ok", value: String(Boolean(estimateJson?.backfill?.ok)) },
      { key: "estimate.status", value: String(estimateJson?.estimate?.status ?? "—") },
      { key: "estimate.reason", value: String(estimateJson?.estimate?.reason ?? "—") },
    ];
    return rows;
  }, [estimateJson]);

  const loadCoverage = useCallback(async () => {
    setCoverageLoading(true);
    setCoverageErr(null);
    setCoverageJson(null);
    try {
      if (!token) {
        setCoverageErr("admin_token_required");
        return;
      }
      const hid = homeId.trim();
      if (!hid) {
        setCoverageErr("homeId_required");
        return;
      }
      if (!requiredBucketKeys.length) {
        setCoverageErr("no_requiredBucketKeys");
        return;
      }

      const sp = new URLSearchParams();
      sp.set("homeId", hid);
      sp.set("monthsCount", String(monthsClamped));
      for (const k of requiredBucketKeys) sp.append("bucketKeys", k);

      const res = await fetch(`/api/admin/usage/bucket-coverage?${sp.toString()}`, {
        headers: { "x-admin-token": token },
        cache: "no-store",
      });
      const json = await res.json().catch(() => null);
      setCoverageJson(json);
      if (!res.ok) {
        setCoverageErr(json?.error ? String(json.error) : `http_${res.status}`);
      }
    } catch (e: any) {
      setCoverageErr(e?.message ?? String(e));
    } finally {
      setCoverageLoading(false);
    }
  }, [token, homeId, monthsClamped, requiredBucketKeys]);

  return (
    <main className="min-h-screen w-full bg-gray-50">
      <div className="mx-auto max-w-6xl px-4 py-10 space-y-6">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold">Plan Details</h1>
          <div className="text-sm text-gray-600">
            offerId: <span className="font-mono">{offerId || "—"}</span>
          </div>
        </div>

        <div className="rounded-xl border bg-white p-4 space-y-3">
          <div className="text-sm font-semibold">Admin token</div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              className="flex-1 min-w-[260px] rounded-lg border px-3 py-2 font-mono text-xs"
              placeholder="x-admin-token"
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
            <button
              className="rounded-lg border px-3 py-2 hover:bg-gray-50 disabled:opacity-60"
              disabled={!token || !offerId || loading}
              onClick={() => void load()}
            >
              {loading ? "Loading…" : "Refresh"}
            </button>
          </div>
          {error ? <div className="text-sm text-red-700">{error}</div> : null}
        </div>

        {data ? (
          <div className="space-y-4">
            <div className="rounded-xl border bg-white p-4 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-semibold">EFL raw text</div>
                <button
                  className="rounded-lg border px-3 py-1.5 text-xs hover:bg-gray-50 disabled:opacity-60"
                  disabled={!data.eflRawText}
                  onClick={async () => {
                    if (!data.eflRawText) return;
                    const ok = await copyToClipboard(data.eflRawText);
                    if (!ok) alert("Copy failed.");
                  }}
                >
                  Copy
                </button>
              </div>
              <pre className="text-xs bg-gray-50 rounded-lg p-3 overflow-auto max-h-[520px]">
                {data.eflRawText ? data.eflRawText : "— (no stored raw text found for this EFL fingerprint)"}
              </pre>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-xl border bg-white p-4 space-y-2">
                <div className="text-sm font-semibold">Offer summary</div>
                <div className="text-xs text-gray-700 space-y-1">
                  <div>
                    <span className="text-gray-500">MasterPlan:</span>{" "}
                    <span className="font-mono">{data.masterPlan?.id ?? "—"}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">Supplier:</span> {data.masterPlan?.supplierName ?? data.ratePlan?.supplier ?? "—"}
                  </div>
                  <div>
                    <span className="text-gray-500">Plan:</span> {data.masterPlan?.planName ?? data.ratePlan?.planName ?? "—"}
                  </div>
                  <div>
                    <span className="text-gray-500">Term:</span>{" "}
                    <span className="font-mono">{data.masterPlan?.termMonths ?? data.ratePlan?.termMonths ?? "—"}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">TDSP:</span>{" "}
                    <span className="font-mono">{data.masterPlan?.tdsp ?? data.ratePlan?.utilityId ?? "—"}</span>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 text-xs">
                  {data.ratePlan?.eflSourceUrl ? (
                    <a className="underline" href={String(data.ratePlan.eflSourceUrl)} target="_blank" rel="noreferrer">
                      EFL source
                    </a>
                  ) : null}
                  {data.ratePlan?.eflUrl ? (
                    <a className="underline" href={String(data.ratePlan.eflUrl)} target="_blank" rel="noreferrer">
                      EFL
                    </a>
                  ) : null}
                  {data.ratePlan?.tosUrl ? (
                    <a className="underline" href={String(data.ratePlan.tosUrl)} target="_blank" rel="noreferrer">
                      TOS
                    </a>
                  ) : null}
                  {data.ratePlan?.yracUrl ? (
                    <a className="underline" href={String(data.ratePlan.yracUrl)} target="_blank" rel="noreferrer">
                      YRAC
                    </a>
                  ) : null}
                </div>
              </div>

              <div className="rounded-xl border bg-white p-4 space-y-2">
                <div className="text-sm font-semibold">Plan variables (template → calculator inputs)</div>
                <div className="text-xs text-gray-600">
                  These are the variables the engine will use (or require) to compute this plan.
                </div>
                <div className="overflow-auto rounded border">
                  <table className="min-w-full text-xs">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-2 py-2 text-left">variable</th>
                        <th className="px-2 py-2 text-left">value</th>
                        <th className="px-2 py-2 text-left">notes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {planVars.map((r) => (
                        <tr key={r.key} className="border-t">
                          <td className="px-2 py-2 font-mono">{r.key}</td>
                          <td className="px-2 py-2 font-mono">{r.value}</td>
                          <td className="px-2 py-2 text-gray-600">{r.notes ?? ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div className="rounded-xl border bg-white p-4 space-y-2">
              <div className="text-sm font-semibold">Plan calc requirements</div>
              <div className="text-xs font-mono">
                status={data.introspection?.planCalc?.planCalcStatus ?? "—"} reason={data.introspection?.planCalc?.planCalcReasonCode ?? "—"}
              </div>
              <div className="text-xs text-gray-700">
                <span className="text-gray-500">requiredBucketKeys:</span>{" "}
                <span className="font-mono break-all">{requiredBucketKeys.length ? requiredBucketKeys.join(", ") : "—"}</span>
              </div>
            </div>
          </div>
        ) : null}

        <div className="rounded-xl border bg-white p-4 space-y-3">
          <div className="text-sm font-semibold">Estimate for a home (runs the calculator)</div>
          <div className="text-xs text-gray-600">
            Enter a <span className="font-mono">homeId</span>. If usage buckets exist (or you enable backfill), this will run the estimate for this specific home.
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-xs">
              <div className="text-gray-600 mb-1">homeId</div>
              <input
                className="w-[420px] max-w-[90vw] rounded-lg border px-3 py-2 font-mono text-xs"
                value={homeId}
                onChange={(e) => setHomeId(e.target.value)}
                placeholder="cuid/uuid from HouseAddress.id"
              />
            </label>
            <label className="text-xs">
              <div className="text-gray-600 mb-1">monthsCount</div>
              <input
                className="w-28 rounded-lg border px-3 py-2 font-mono text-xs"
                type="number"
                min={1}
                max={12}
                value={monthsCount}
                onChange={(e) => setMonthsCount(Number(e.target.value))}
              />
            </label>
            <label className="inline-flex items-center gap-2 text-xs mt-5">
              <input type="checkbox" checked={backfill} onChange={(e) => setBackfill(e.target.checked)} />
              backfill
            </label>
            <button
              className="rounded-lg bg-black text-white px-4 py-2 text-sm disabled:opacity-60 mt-5"
              disabled={!token || !homeId.trim() || estimateLoading}
              onClick={() => void runEstimate()}
            >
              {estimateLoading ? "Running…" : "Run estimate"}
            </button>
          </div>

          {estimateErr ? <div className="text-sm text-red-700">{estimateErr}</div> : null}

          {estimateVars ? (
            <div className="space-y-2">
              <div className="text-xs text-gray-600">Calculator inputs (this run)</div>
              <div className="overflow-auto rounded border">
                <table className="min-w-full text-xs">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-2 py-2 text-left">variable</th>
                      <th className="px-2 py-2 text-left">value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {estimateVars.map((r) => (
                      <tr key={r.key} className="border-t">
                        <td className="px-2 py-2 font-mono">{r.key}</td>
                        <td className="px-2 py-2 font-mono break-all">{r.value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}

          <details className="text-xs text-gray-700">
            <summary className="cursor-pointer select-none">Estimate raw JSON</summary>
            <pre className="mt-2 bg-gray-50 rounded-lg p-3 overflow-auto max-h-[520px]">{estimateJson ? pretty(estimateJson) : "—"}</pre>
          </details>
        </div>

        <div className="rounded-xl border bg-white p-4 space-y-3">
          <div className="text-sm font-semibold">Bucket Coverage (read-only)</div>
          <div className="text-xs text-gray-600">
            Matrix of <span className="font-mono">requiredBucketKeys</span> × months for the selected <span className="font-mono">homeId</span>.
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              className="rounded-lg border px-3 py-1.5 text-xs hover:bg-gray-50 disabled:opacity-60"
              disabled={!token || !homeId.trim() || coverageLoading || requiredBucketKeys.length === 0}
              onClick={() => void loadCoverage()}
              title="Reads existing monthly buckets only (no backfill)."
            >
              {coverageLoading ? "Loading…" : "Load bucket coverage"}
            </button>
            <div className="text-xs text-gray-500">
              required keys: <span className="font-mono">{requiredBucketKeys.length}</span>
            </div>
          </div>
          {coverageErr ? <div className="text-sm text-red-700">{coverageErr}</div> : null}

          {coverageJson?.ok && Array.isArray(coverageJson.months) && Array.isArray(coverageJson.bucketKeys) ? (
            <div className="space-y-3">
              <div className="text-xs text-gray-700">
                fullyCoveredMonths:{" "}
                <span className="font-mono">{String(coverageJson?.summary?.fullyCoveredMonths ?? "—")}</span> /{" "}
                <span className="font-mono">{String((coverageJson.months as any[]).length)}</span>
              </div>

              {Array.isArray(coverageJson?.summary?.missingKeysTop) && coverageJson.summary.missingKeysTop.length > 0 ? (
                <div className="flex flex-wrap gap-2 text-xs">
                  {coverageJson.summary.missingKeysTop.map((k: any) => (
                    <span key={String(k)} className="px-2 py-1 rounded-full bg-red-50 text-red-700 border border-red-200 font-mono">
                      {String(k)}
                    </span>
                  ))}
                </div>
              ) : null}

              <div className="overflow-auto rounded border">
                <table className="min-w-full text-xs">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-2 py-2 text-left">month</th>
                      {(coverageJson.bucketKeys as any[]).map((k: any) => (
                        <th key={String(k)} className="px-2 py-2 text-left font-mono">
                          {String(k).replace(/^kwh\.m\./, "")}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(coverageJson.months as any[]).map((m: any) => {
                      const ym = String(m);
                      const row = (coverageJson.cells && coverageJson.cells[ym]) ? coverageJson.cells[ym] : {};
                      return (
                        <tr key={ym} className="border-t">
                          <td className="px-2 py-2 font-mono">{ym}</td>
                          {(coverageJson.bucketKeys as any[]).map((k: any) => {
                            const kk = String(k);
                            const cell = row?.[kk] ?? null;
                            const present = Boolean(cell?.present);
                            const kwh = typeof cell?.kwhTotal === "number" ? cell.kwhTotal : null;
                            const sourceKey = cell?.sourceKey ? String(cell.sourceKey) : null;
                            const title = sourceKey ? `from ${sourceKey}` : "";
                            return (
                              <td key={`${ym}:${kk}`} className="px-2 py-2" title={title}>
                                {present ? (
                                  <span className="font-mono text-green-700">
                                    ✅ {kwh != null ? kwh.toFixed(3) : ""}
                                    {sourceKey ? <span className="text-gray-500"> (alias)</span> : null}
                                  </span>
                                ) : (
                                  <span className="font-mono text-red-700">❌</span>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="text-xs text-gray-500">No coverage loaded yet.</div>
          )}

          <details className="text-xs text-gray-700">
            <summary className="cursor-pointer select-none">Coverage raw JSON</summary>
            <pre className="mt-2 bg-gray-50 rounded-lg p-3 overflow-auto max-h-[520px]">{coverageJson ? pretty(coverageJson) : "—"}</pre>
          </details>
        </div>

        <details className="rounded-xl border bg-white p-4">
          <summary className="cursor-pointer text-sm font-semibold">Raw JSON</summary>
          <pre className="mt-3 text-xs bg-gray-50 rounded-lg p-3 overflow-auto max-h-[720px]">
            {data ? pretty(data) : "—"}
          </pre>
        </details>
      </div>
    </main>
  );
}

