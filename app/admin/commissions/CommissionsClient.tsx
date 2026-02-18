"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

type Row = {
  id: string;
  userId: string;
  userEmail: string | null;
  type: string | null;
  amount: number | null;
  status: string | null;
  earnedAt: string | null;
  createdAt: string | null;
};

type ApiResp =
  | {
      ok: true;
      q: string | null;
      status: "any" | "pending" | "earned";
      page: number;
      pageSize: number;
      total: number;
      totalPages: number;
      totals?: { earnedDollarsInPage?: number; pendingDollarsInPage?: number };
      rows: Row[];
    }
  | { ok?: false; error?: string; [k: string]: any };

const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function fmtMoney2(n: number | null | undefined): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  return currency.format(n);
}

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "—";
  return d.toLocaleString();
}

export function CommissionsClient() {
  const sp = useSearchParams();
  const initialQ = (sp?.get("q") ?? "").trim();
  const initialStatus = (sp?.get("status") ?? "").trim().toLowerCase();

  const [adminToken, setAdminToken] = React.useState("");
  const [q, setQ] = React.useState(initialQ);
  const [status, setStatus] = React.useState<"any" | "pending" | "earned">(
    initialStatus === "pending" ? "pending" : initialStatus === "earned" ? "earned" : "any",
  );
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(50);
  const [loading, setLoading] = React.useState(false);
  const [resp, setResp] = React.useState<ApiResp | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    try {
      const stored = window.localStorage.getItem("intelliwattAdminToken") || "";
      if (stored.trim()) setAdminToken(stored.trim());
    } catch {
      // ignore
    }
  }, []);

  const withAdminHeaders = React.useCallback(
    (init?: RequestInit): RequestInit => {
      const headers = new Headers(init?.headers ?? {});
      if (adminToken.trim()) headers.set("x-admin-token", adminToken.trim());
      return { ...init, headers };
    },
    [adminToken],
  );

  const fetchRows = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      if (status !== "any") params.set("status", status);
      params.set("page", String(page));
      params.set("pageSize", String(pageSize));
      const r = await fetch(`/api/admin/commissions?${params.toString()}`, withAdminHeaders({ cache: "no-store" }));
      const j = (await r.json().catch(() => null)) as any;
      if (!r.ok || j?.ok !== true) {
        setResp(j);
        setError(j?.error || `HTTP ${r.status}`);
        return;
      }
      setResp(j as ApiResp);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [q, status, page, pageSize, withAdminHeaders]);

  React.useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  const rows = resp && (resp as any).ok === true ? ((resp as any).rows as Row[]) : [];
  const totalPages = resp && (resp as any).ok === true ? Number((resp as any).totalPages ?? 1) : 1;
  const total = resp && (resp as any).ok === true ? Number((resp as any).total ?? 0) : 0;

  return (
    <div className="mx-auto max-w-7xl px-4 py-10">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-brand-navy">Commissions</h1>
          <div className="mt-1 text-sm text-brand-navy/70">Track lifetime earned vs pending commissions.</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/admin"
            className="inline-flex items-center rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50"
          >
            Back to Admin
          </Link>
          <button
            type="button"
            onClick={() => fetchRows()}
            className="inline-flex items-center rounded-full border border-brand-blue/40 bg-brand-blue/10 px-4 py-2 text-sm font-semibold text-brand-navy hover:bg-brand-blue/20"
          >
            Refresh
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-brand-blue/15 bg-brand-white p-5 shadow-sm">
        <div className="grid gap-3 md:grid-cols-8">
          <div className="md:col-span-3">
            <label className="block text-xs font-semibold uppercase tracking-wide text-brand-navy/70">Search</label>
            <input
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
              placeholder="email contains… (or exact userId)"
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
          </div>

          <div className="md:col-span-2">
            <label className="block text-xs font-semibold uppercase tracking-wide text-brand-navy/70">Status</label>
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value as any);
                setPage(1);
              }}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            >
              <option value="any">Any</option>
              <option value="pending">Pending</option>
              <option value="earned">Earned (paid/approved)</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-brand-navy/70">Page size</label>
            <select
              value={String(pageSize)}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            >
              <option value="20">20</option>
              <option value="50">50</option>
              <option value="100">100</option>
              <option value="200">200</option>
            </select>
          </div>
        </div>

        {error ? <div className="mt-4 text-sm text-rose-700">Error: {error}</div> : null}
        <div className="mt-4 text-xs text-brand-navy/70">
          {loading ? "Loading…" : `Showing page ${page} / ${totalPages} · ${total} rows`}
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-brand-navy/20">
                <th className="py-3 px-3 text-left font-semibold text-brand-navy">User</th>
                <th className="py-3 px-3 text-left font-semibold text-brand-navy">Type</th>
                <th className="py-3 px-3 text-left font-semibold text-brand-navy">Amount</th>
                <th className="py-3 px-3 text-left font-semibold text-brand-navy">Status</th>
                <th className="py-3 px-3 text-left font-semibold text-brand-navy">Earned at</th>
                <th className="py-3 px-3 text-left font-semibold text-brand-navy">Created</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 px-3 text-center text-brand-navy/60">
                    {loading ? "Loading…" : "No rows"}
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id} className="border-b border-brand-navy/10 hover:bg-brand-navy/5">
                    <td className="py-3 px-3 text-brand-navy">
                      {r.userEmail ? (
                        <a className="font-semibold hover:underline" href={`/admin/helpdesk/impersonate?email=${encodeURIComponent(r.userEmail)}`}>
                          {r.userEmail}
                        </a>
                      ) : (
                        <span className="font-mono text-xs">{r.userId}</span>
                      )}
                    </td>
                    <td className="py-3 px-3 text-brand-navy">{r.type ?? "—"}</td>
                    <td className="py-3 px-3 text-brand-navy font-semibold">{fmtMoney2(r.amount)}</td>
                    <td className="py-3 px-3 text-brand-navy">{r.status ?? "—"}</td>
                    <td className="py-3 px-3 text-brand-navy">{fmtDateTime(r.earnedAt)}</td>
                    <td className="py-3 px-3 text-brand-navy">{fmtDateTime(r.createdAt)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-xs text-brand-navy/70">
            Page {page} / {totalPages}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={page <= 1 || loading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50"
            >
              Prev
            </button>
            <button
              type="button"
              disabled={page >= totalPages || loading}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

