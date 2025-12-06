"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type UsageDebugTotals = {
  intervalCount: number;
  totalKwh: number;
  earliestTs: string | null;
  latestTs: string | null;
};

type UsageDebugSmtTotals = UsageDebugTotals & {
  uniqueEsiids: number;
};

type UsageDebugSmtTopEsiid = {
  esiid: string;
  intervalCount: number;
  totalKwh: number;
  lastTimestamp: string | null;
};

type UsageDebugSmtInterval = {
  esiid: string;
  meter: string;
  ts: string;
  kwh: number;
  source: string | null;
};

type UsageDebugSmtRawFile = {
  id: string;
  filename: string;
  sizeBytes: number;
  source: string;
  storagePath: string | null;
  createdAt: string;
  updatedAt: string;
  receivedAt: string | null;
};

type UsageDebugSmt = {
  totals: UsageDebugSmtTotals;
  topEsiids: UsageDebugSmtTopEsiid[];
  latestIntervals: UsageDebugSmtInterval[];
  rawFiles: UsageDebugSmtRawFile[];
};

type UsageDebugModuleInterval = {
  esiid: string | null;
  meter: string | null;
  ts: string;
  kwh: number;
  filled: boolean;
  source: string | null;
};

type UsageDebugModule = {
  totals: UsageDebugTotals;
  latestRows: UsageDebugModuleInterval[];
  windowDays?: number;
};

type UsageDebugResponse = {
  ok: true;
  smt: UsageDebugSmt;
  usageModule: UsageDebugModule;
};

const AUTO_REFRESH_MS = 120_000;

const fmtNum = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });
const fmtKwh = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 3 });
const fmtDate = (v: string | null) => (v ? new Date(v).toLocaleString() : "—");
const fmtBytes = (size: number) => {
  if (!Number.isFinite(size) || size <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const idx = Math.min(Math.floor(Math.log(size) / Math.log(1024)), units.length - 1);
  const val = size / Math.pow(1024, idx);
  return `${val.toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`;
};

export default function AdminUsageProduction() {
  const [adminToken, setAdminToken] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<UsageDebugResponse | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem("intelliwattAdminToken");
    if (stored) setAdminToken(stored);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const trimmed = adminToken.trim();
    if (trimmed) {
      window.localStorage.setItem("intelliwattAdminToken", trimmed);
    } else {
      window.localStorage.removeItem("intelliwattAdminToken");
    }
  }, [adminToken]);

  const fetchDebug = useCallback(async () => {
    const token = adminToken.trim();
    if (!token) {
      setError("Set x-admin-token to view production data.");
      setData(null);
      setLoading(false);
      return;
    }

    setRefreshing(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/usage/debug", {
        headers: {
          "x-admin-token": token,
          accept: "application/json",
        },
        cache: "no-store",
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Usage debug failed: ${res.status} ${text}`.trim());
      }

      const payload = (await res.json()) as UsageDebugResponse;
      setData(payload);
      setLastUpdated(new Date().toISOString());
    } catch (err: any) {
      setError(err?.message ?? "Failed to load usage debug data");
      setData(null);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [adminToken]);

  useEffect(() => {
    fetchDebug();
  }, [fetchDebug]);

  useEffect(() => {
    const id = setInterval(() => {
      if (!refreshing) fetchDebug();
    }, AUTO_REFRESH_MS);
    return () => clearInterval(id);
  }, [fetchDebug, refreshing]);

  const smt = data?.smt;
  const usage = data?.usageModule;
  const topEsiids = useMemo(() => smt?.topEsiids ?? [], [smt]);

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Production Usage & SMT</h1>
          <p className="text-sm text-neutral-600">Read-only production signals. No test uploads or dummy data.</p>
          {lastUpdated ? (
            <p className="text-xs text-neutral-500">Last updated {fmtDate(lastUpdated)}</p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <input
            type="password"
            value={adminToken}
            onChange={(e) => setAdminToken(e.target.value)}
            placeholder="x-admin-token"
            className="w-64 rounded border px-3 py-2 text-sm"
          />
          <button
            type="button"
            onClick={fetchDebug}
            disabled={refreshing}
            className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {refreshing ? "Refreshing" : "Refresh"}
          </button>
          <a
            href="/admin/smt/inspector"
            className="rounded border border-neutral-300 px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-100"
          >
            Go to test tools
          </a>
        </div>
      </div>

      {error ? (
        <div className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-700">{error}</div>
      ) : null}

      {loading ? (
        <div className="text-sm text-neutral-600">Loading</div>
      ) : null}

      {data && (
        <div className="space-y-6">
          <section className="space-y-2 rounded border border-neutral-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-lg font-semibold text-neutral-900">SMT Production Stats</h2>
                <p className="text-sm text-neutral-600">Latest intervals, raw files, and top ESIIDs from live DB.</p>
              </div>
              <div className="text-sm text-neutral-600">Intervals: {fmtNum(smt?.totals.intervalCount ?? 0)} · ESIIDs: {fmtNum(smt?.totals.uniqueEsiids ?? 0)} · Window {fmtDate(smt?.totals.earliestTs ?? null)} → {fmtDate(smt?.totals.latestTs ?? null)}</div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-neutral-800">Latest Intervals</h3>
                <div className="max-h-80 overflow-auto rounded border border-neutral-200 bg-neutral-900 p-3 text-xs text-neutral-100">
                  {smt?.latestIntervals?.length ? (
                    smt.latestIntervals.map((row) => (
                      <div key={`${row.esiid}-${row.meter}-${row.ts}`} className="flex items-center gap-3 border-b border-neutral-800 py-1 last:border-none">
                        <span className="min-w-[150px] font-mono text-[11px] text-neutral-300">{row.ts}</span>
                        <span className="w-28 font-mono text-[11px] uppercase text-neutral-200">{row.esiid}</span>
                        <span className="w-16 font-mono text-[11px] uppercase text-neutral-300">{row.meter}</span>
                        <span className="w-16 text-right font-mono text-[11px] text-neutral-100">{row.kwh.toFixed(3)}</span>
                        <span className="flex-1 text-[11px] text-neutral-400">{row.source ?? "smt"}</span>
                      </div>
                    ))
                  ) : (
                    <div className="text-neutral-400">No intervals found.</div>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <h3 className="text-sm font-semibold text-neutral-800">Raw Files (latest)</h3>
                <div className="max-h-80 overflow-auto rounded border border-neutral-200 bg-neutral-50 p-3 text-xs text-neutral-800">
                  {smt?.rawFiles?.length ? (
                    smt.rawFiles.map((file) => {
                      const isError = (file.source ?? "").toLowerCase().includes("error");
                      return (
                        <div key={file.id} className={`border-b border-neutral-200 py-1 last:border-none ${isError ? "bg-red-50" : ""}`}>
                          <div className="flex items-center justify-between gap-2">
                            <span className={`font-mono text-[11px] ${isError ? "text-red-700" : "text-neutral-800"}`}>{file.filename}</span>
                            <span className="text-[11px] text-neutral-600">{fmtBytes(file.sizeBytes)}</span>
                          </div>
                          <div className="text-[11px] text-neutral-500">{file.source}  {fmtDate(file.createdAt)}</div>
                        </div>
                      );
                    })
                  ) : (
                    <div className="text-neutral-500">No raw files found.</div>
                  )}
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-neutral-800">Top ESIIDs (by intervals)</h3>
              <div className="overflow-hidden rounded border border-neutral-200">
                <table className="min-w-full divide-y divide-neutral-200 text-xs">
                  <thead className="bg-neutral-100 text-neutral-700">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">ESIID</th>
                      <th className="px-3 py-2 text-left font-medium">Intervals</th>
                      <th className="px-3 py-2 text-left font-medium">kWh</th>
                      <th className="px-3 py-2 text-left font-medium">Last ts</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-200">
                    {topEsiids.length ? (
                      topEsiids.map((row) => (
                        <tr key={row.esiid} className="odd:bg-white even:bg-neutral-50">
                          <td className="px-3 py-2 font-mono text-[11px] uppercase text-neutral-800">{row.esiid}</td>
                          <td className="px-3 py-2 text-neutral-800">{fmtNum(row.intervalCount)}</td>
                          <td className="px-3 py-2 text-neutral-800">{fmtKwh(row.totalKwh)}</td>
                          <td className="px-3 py-2 text-neutral-600">{fmtDate(row.lastTimestamp)}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={4} className="px-3 py-3 text-center text-neutral-500">No ESIIDs yet.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          <section className="space-y-2 rounded border border-neutral-200 bg-white p-4 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-lg font-semibold text-neutral-900">Usage Module (production)</h2>
                <p className="text-sm text-neutral-600">Latest normalized usage rows in prod DB.</p>
              </div>
              <div className="text-sm text-neutral-600">Rows: {fmtNum(usage?.totals.intervalCount ?? 0)} · kWh {fmtKwh(usage?.totals.totalKwh ?? 0)} · Window {fmtDate(usage?.totals.earliestTs ?? null)} → {fmtDate(usage?.totals.latestTs ?? null)}</div>
            </div>

            <div className="max-h-96 overflow-auto rounded border border-neutral-200 bg-neutral-900 p-3 text-xs text-neutral-100">
              {usage?.latestRows?.length ? (
                usage.latestRows.map((row, idx) => (
                  <div key={`${row.esiid ?? "unknown"}-${row.meter ?? ""}-${row.ts}-${idx}`} className="flex items-center gap-3 border-b border-neutral-800 py-1 last:border-none">
                    <span className="min-w-[150px] font-mono text-[11px] text-neutral-300">{row.ts}</span>
                    <span className="w-28 font-mono text-[11px] uppercase text-neutral-200">{row.esiid ?? "—"}</span>
                    <span className="w-16 font-mono text-[11px] uppercase text-neutral-300">{row.meter ?? "—"}</span>
                    <span className="w-16 text-right font-mono text-[11px] text-neutral-100">{row.kwh.toFixed(3)}</span>
                    <span className="flex-1 text-[11px] text-neutral-400">{row.source ?? "usage"}</span>
                  </div>
                ))
              ) : (
                <div className="text-neutral-400">No usage rows found.</div>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
