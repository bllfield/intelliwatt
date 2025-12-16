"use client";

import { useEffect, useMemo, useState } from "react";

type SortDir = "asc" | "desc";

type Row = {
  id: string;
  utilityId: string;
  state: string;
  supplier: string | null;
  planName: string | null;
  termMonths: number | null;
  rate500: number | null;
  rate1000: number | null;
  rate2000: number | null;
  cancelFee: string | null;
  eflUrl: string | null;
  eflPdfSha256: string | null;
  repPuctCertificate: string | null;
  eflVersionCode: string | null;
  updatedAt: string;
  lastSeenAt: string;
};

type ApiOk = { ok: true; count: number; rows: Row[] };
type ApiErr = { ok: false; error: string; details?: unknown };

function useLocalToken(key = "iw_admin_token") {
  const [token, setToken] = useState("");
  useEffect(() => {
    setToken(localStorage.getItem(key) || "");
  }, [key]);
  useEffect(() => {
    if (token) localStorage.setItem(key, token);
  }, [key, token]);
  return { token, setToken };
}

function numOrNull(x: any): number | null {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function bestRate(row: Row): number | null {
  const vals = [row.rate500, row.rate1000, row.rate2000]
    .map((v) => (typeof v === "number" ? v : null))
    .filter((v): v is number => v != null);
  if (!vals.length) return null;
  return Math.min(...vals);
}

function compare(a: any, b: any, dir: SortDir) {
  const mul = dir === "asc" ? 1 : -1;

  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;

  if (typeof a === "number" && typeof b === "number") return (a - b) * mul;
  return String(a).localeCompare(String(b)) * mul;
}

export default function WattbuyTemplatedPlansPage() {
  const { token, setToken } = useLocalToken();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [backfillNote, setBackfillNote] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(200);

  const [sortKey, setSortKey] = useState<
    | "supplier"
    | "planName"
    | "termMonths"
    | "bestRate"
    | "rate500"
    | "rate1000"
    | "rate2000"
    | "updatedAt"
  >("bestRate");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  async function load() {
    if (!token) {
      setError("Admin token required.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("limit", String(limit));
      if (q.trim()) params.set("q", q.trim());

      const res = await fetch(`/api/admin/wattbuy/templated-plans?${params}`, {
        headers: { "x-admin-token": token },
      });
      const data = (await res.json()) as ApiOk | ApiErr;
      if (!res.ok || !("ok" in data) || (data as any).ok !== true) {
        throw new Error((data as any)?.error || `HTTP ${res.status}`);
      }
      setRows((data as ApiOk).rows);
    } catch (e: any) {
      setError(e?.message || "Failed to load templated plans.");
    } finally {
      setLoading(false);
    }
  }

  async function backfill() {
    if (!token) {
      setError("Admin token required.");
      return;
    }
    setLoading(true);
    setError(null);
    setBackfillNote(null);
    try {
      const params = new URLSearchParams();
      params.set("limit", String(limit));
      if (q.trim()) params.set("q", q.trim());
      const res = await fetch(`/api/admin/wattbuy/templated-plans/backfill?${params}`, {
        method: "POST",
        headers: { "x-admin-token": token },
      });
      const data = (await res.json().catch(() => null)) as any;
      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      setBackfillNote(
        `Backfill complete: scanned=${data.scanned} updated=${data.updated} skipped=${data.skipped} ` +
          (data.reasons ? `reasons=${JSON.stringify(data.reasons)}` : ""),
      );
      await load();
    } catch (e: any) {
      setError(e?.message || "Backfill failed.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (token) {
      void load();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sorted = useMemo(() => {
    const out = [...rows];
    out.sort((ra, rb) => {
      const a: any =
        sortKey === "bestRate"
          ? bestRate(ra)
          : sortKey === "updatedAt"
            ? ra.updatedAt
            : (ra as any)[sortKey];
      const b: any =
        sortKey === "bestRate"
          ? bestRate(rb)
          : sortKey === "updatedAt"
            ? rb.updatedAt
            : (rb as any)[sortKey];
      return compare(a, b, sortDir);
    });
    return out;
  }, [rows, sortKey, sortDir]);

  function toggleSort(nextKey: typeof sortKey) {
    if (sortKey === nextKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(nextKey);
      setSortDir("asc");
    }
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-4">
      <h1 className="text-2xl font-semibold">📦 Templated Plans (RatePlan.rateStructure)</h1>

      <div className="rounded-2xl border bg-white p-4 space-y-3">
        <div className="grid gap-3 md:grid-cols-4">
          <div className="md:col-span-2">
            <label className="block text-sm mb-1">Search</label>
            <input
              className="w-full rounded-lg border px-3 py-2"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="supplier, plan, cert, version, sha…"
            />
          </div>
          <div>
            <label className="block text-sm mb-1">Limit</label>
            <input
              className="w-full rounded-lg border px-3 py-2"
              value={limit}
              onChange={(e) => setLimit(Math.max(1, Math.min(1000, numOrNull(e.target.value) ?? 200)))}
              type="number"
              min={1}
              max={1000}
            />
          </div>
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <label className="block text-sm mb-1">x-admin-token</label>
              <input
                className="w-full rounded-lg border px-3 py-2"
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="paste admin token"
              />
            </div>
            <button
              className="px-3 py-2 rounded-lg border hover:bg-gray-50"
              onClick={() => void load()}
              disabled={loading}
            >
              {loading ? "Loading…" : "Load"}
            </button>
            <button
              className="px-3 py-2 rounded-lg border hover:bg-gray-50"
              onClick={() => void backfill()}
              disabled={loading}
              title="Persist missing Term/500/1000/2000 into RatePlan using the stored rateStructure (does not guess TOU)."
            >
              {loading ? "Working…" : "Backfill missing columns"}
            </button>
          </div>
        </div>

        {error ? <div className="text-sm text-red-700">{error}</div> : null}
        {backfillNote ? <div className="text-xs text-gray-600">{backfillNote}</div> : null}
        <div className="text-xs text-gray-500">
          Shows plans where <span className="font-mono">RatePlan.rateStructure</span> is already stored (fast for users).
          Click headers to sort (best deals = lowest ¢/kWh).
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl border bg-white">
        <table className="min-w-full text-xs">
          <thead className="bg-gray-50 text-gray-700">
            <tr>
              <th className="px-2 py-2 text-left cursor-pointer" onClick={() => toggleSort("supplier")}>
                Supplier
              </th>
              <th className="px-2 py-2 text-left cursor-pointer" onClick={() => toggleSort("planName")}>
                Plan
              </th>
              <th className="px-2 py-2 text-right cursor-pointer" onClick={() => toggleSort("termMonths")}>
                Term
              </th>
              <th className="px-2 py-2 text-right cursor-pointer" onClick={() => toggleSort("bestRate")}>
                Best ¢/kWh
              </th>
              <th className="px-2 py-2 text-right cursor-pointer" onClick={() => toggleSort("rate500")}>
                500
              </th>
              <th className="px-2 py-2 text-right cursor-pointer" onClick={() => toggleSort("rate1000")}>
                1000
              </th>
              <th className="px-2 py-2 text-right cursor-pointer" onClick={() => toggleSort("rate2000")}>
                2000
              </th>
              <th className="px-2 py-2 text-left">PUCT</th>
              <th className="px-2 py-2 text-left">Ver</th>
              <th className="px-2 py-2 text-left cursor-pointer" onClick={() => toggleSort("updatedAt")}>
                Updated
              </th>
              <th className="px-2 py-2 text-left">EFL</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => {
              const best = bestRate(r);
              return (
                <tr key={r.id} className="border-t">
                  <td className="px-2 py-1 align-top">{r.supplier ?? "—"}</td>
                  <td className="px-2 py-1 align-top">
                    <div className="max-w-[260px] truncate" title={r.planName ?? undefined}>
                      {r.planName ?? "—"}
                    </div>
                    <div className="text-[10px] text-gray-500">
                      {r.utilityId}/{r.state}
                    </div>
                  </td>
                  <td className="px-2 py-1 align-top text-right">
                    {typeof r.termMonths === "number" ? `${r.termMonths} mo` : "—"}
                  </td>
                  <td className="px-2 py-1 align-top text-right font-mono">
                    {typeof best === "number" ? best.toFixed(3) : "—"}
                  </td>
                  <td className="px-2 py-1 align-top text-right font-mono">
                    {typeof r.rate500 === "number" ? r.rate500.toFixed(3) : "—"}
                  </td>
                  <td className="px-2 py-1 align-top text-right font-mono">
                    {typeof r.rate1000 === "number" ? r.rate1000.toFixed(3) : "—"}
                  </td>
                  <td className="px-2 py-1 align-top text-right font-mono">
                    {typeof r.rate2000 === "number" ? r.rate2000.toFixed(3) : "—"}
                  </td>
                  <td className="px-2 py-1 align-top font-mono">{r.repPuctCertificate ?? "—"}</td>
                  <td className="px-2 py-1 align-top">
                    <div className="max-w-[160px] truncate font-mono" title={r.eflVersionCode ?? undefined}>
                      {r.eflVersionCode ?? "—"}
                    </div>
                  </td>
                  <td className="px-2 py-1 align-top font-mono">
                    {r.updatedAt ? r.updatedAt.slice(0, 10) : "—"}
                  </td>
                  <td className="px-2 py-1 align-top">
                    {r.eflUrl ? (
                      <a className="underline" href={r.eflUrl} target="_blank" rel="noreferrer">
                        Open
                      </a>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              );
            })}
            {sorted.length === 0 ? (
              <tr>
                <td className="px-2 py-6 text-center text-sm text-gray-500" colSpan={11}>
                  No templated plans found.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}


