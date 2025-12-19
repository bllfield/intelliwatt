"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";

type ApiOk = {
  ok: true;
  offerId: string;
  link: any | null;
  ratePlan: any | null;
  masterPlan: any | null;
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
              <div className="text-sm font-semibold">Plan Engine View</div>
              <div className="text-xs font-mono">
                status={data.introspection?.planCalc?.planCalcStatus ?? "—"} reason={data.introspection?.planCalc?.planCalcReasonCode ?? "—"}
              </div>
              <div className="text-xs text-gray-700">
                <span className="text-gray-500">requiredBucketKeys:</span>{" "}
                <span className="font-mono break-all">
                  {Array.isArray(data.introspection?.requiredBucketKeys) ? data.introspection.requiredBucketKeys.join(", ") : "—"}
                </span>
              </div>
            </div>
          </div>
        ) : null}

        <div className="rounded-xl border bg-white p-4 space-y-3">
          <div className="text-sm font-semibold">Estimate for a home (optional)</div>
          <div className="text-xs text-gray-600">
            Requires a <span className="font-mono">homeId</span> (HouseAddress.id). Uses bucket-gated estimator + optional backfill.
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
          <pre className="text-xs bg-gray-50 rounded-lg p-3 overflow-auto max-h-[520px]">
            {estimateJson ? pretty(estimateJson) : "—"}
          </pre>
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

