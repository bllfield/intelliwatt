"use client";

import * as React from "react";
import Link from "next/link";

type InsightsRow = {
  userId: string;
  email: string;
  joinedAt: string;
  houseAddressId: string | null;
  addressLine1: string | null;
  city: string | null;
  state: string | null;
  zip5: string | null;
  esiid: string | null;
  utilityName: string | null;
  hasSmt: boolean;
  hasUsage: boolean;
  switchedWithUs: boolean;
  contractEndDate: string | null;
  savingsUntilContractEndNetEtf: number | null;
  savingsNext12MonthsNetEtf: number | null;
  savingsUntilContractEndNoEtf: number | null;
  savingsNext12MonthsNoEtf: number | null;
  etfDollars: number | null;
  wouldIncurEtfIfSwitchNow: boolean | null;
  snapshotComputedAt: string | null;
};

type InsightsResponse =
  | { ok: true; rows: InsightsRow[]; total: number; totalPages: number; page: number; pageSize: number; sort: string; dir: string }
  | { ok?: false; error?: string; [k: string]: any };

const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

function fmtMoney(n: number | null | undefined): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  return currency.format(Math.round(n));
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "—";
  return d.toLocaleDateString();
}

function nextDir(curSort: string, curDir: string, nextSort: string): "asc" | "desc" {
  if (curSort !== nextSort) return "desc";
  return curDir === "asc" ? "desc" : "asc";
}

export default function AdminUsersPage() {
  const [adminToken, setAdminToken] = React.useState("");

  const [q, setQ] = React.useState("");
  const [hasSmt, setHasSmt] = React.useState<"any" | "true" | "false">("any");
  const [hasUsage, setHasUsage] = React.useState<"any" | "true" | "false">("any");
  const [switched, setSwitched] = React.useState<"any" | "true" | "false">("any");

  const [sort, setSort] = React.useState("savingsToEndNet");
  const [dir, setDir] = React.useState<"asc" | "desc">("desc");
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(50);

  const [loading, setLoading] = React.useState(false);
  const [resp, setResp] = React.useState<InsightsResponse | null>(null);
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

  const fetchInsights = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      params.set("hasSmt", hasSmt);
      params.set("hasUsage", hasUsage);
      params.set("switched", switched);
      params.set("sort", sort);
      params.set("dir", dir);
      params.set("page", String(page));
      params.set("pageSize", String(pageSize));

      const r = await fetch(`/api/admin/users/insights?${params.toString()}`, withAdminHeaders({ cache: "no-store" }));
      const j = (await r.json().catch(() => null)) as any;
      if (!r.ok || j?.ok !== true) {
        setResp(j);
        setError(j?.error || `HTTP ${r.status}`);
        return;
      }
      setResp(j as InsightsResponse);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  }, [q, hasSmt, hasUsage, switched, sort, dir, page, pageSize, withAdminHeaders]);

  React.useEffect(() => {
    fetchInsights();
  }, [fetchInsights]);

  const rows = resp && (resp as any).ok === true ? ((resp as any).rows as InsightsRow[]) : [];
  const totalPages = resp && (resp as any).ok === true ? Number((resp as any).totalPages ?? 1) : 1;
  const total = resp && (resp as any).ok === true ? Number((resp as any).total ?? 0) : 0;

  return (
    <div className="mx-auto max-w-7xl px-4 py-10">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-brand-navy">Users</h1>
          <div className="mt-1 text-sm text-brand-navy/70">
            Filter, sort, and drill into user analysis + SMT + contract details.
          </div>
        </div>
        <div className="flex gap-2">
          <Link
            href="/admin"
            className="inline-flex items-center rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50"
          >
            Back to Admin
          </Link>
          <button
            type="button"
            onClick={() => fetchInsights()}
            className="inline-flex items-center rounded-full border border-brand-blue/40 bg-brand-blue/10 px-4 py-2 text-sm font-semibold text-brand-blue hover:bg-brand-blue/20"
          >
            Refresh
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-brand-blue/15 bg-brand-white p-5 shadow-sm">
        <div className="grid gap-3 md:grid-cols-6">
          <div className="md:col-span-2">
            <label className="block text-xs font-semibold uppercase tracking-wide text-brand-navy/70">Search</label>
            <input
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
              placeholder="email contains…"
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-brand-navy/70">Has SMT</label>
            <select
              value={hasSmt}
              onChange={(e) => {
                setHasSmt(e.target.value as any);
                setPage(1);
              }}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            >
              <option value="any">Any</option>
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-brand-navy/70">Has usage</label>
            <select
              value={hasUsage}
              onChange={(e) => {
                setHasUsage(e.target.value as any);
                setPage(1);
              }}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            >
              <option value="any">Any</option>
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-brand-navy/70">Switched</label>
            <select
              value={switched}
              onChange={(e) => {
                setSwitched(e.target.value as any);
                setPage(1);
              }}
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
            >
              <option value="any">Any</option>
              <option value="true">Yes</option>
              <option value="false">No</option>
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
          {loading ? "Loading…" : `Showing page ${page} / ${totalPages} · ${total} users`}
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-brand-navy/20">
                <th className="py-3 px-3 text-left font-semibold text-brand-navy">
                  <button
                    type="button"
                    className="hover:underline"
                    onClick={() => {
                      const nd = nextDir(sort, dir, "email");
                      setSort("email");
                      setDir(nd);
                      setPage(1);
                    }}
                  >
                    Email
                  </button>
                </th>
                <th className="py-3 px-3 text-left font-semibold text-brand-navy">
                  <button
                    type="button"
                    className="hover:underline"
                    onClick={() => {
                      const nd = nextDir(sort, dir, "joined");
                      setSort("joined");
                      setDir(nd);
                      setPage(1);
                    }}
                  >
                    Joined
                  </button>
                </th>
                <th className="py-3 px-3 text-left font-semibold text-brand-navy">Usage</th>
                <th className="py-3 px-3 text-left font-semibold text-brand-navy">SMT</th>
                <th className="py-3 px-3 text-left font-semibold text-brand-navy">
                  <button
                    type="button"
                    className="hover:underline"
                    onClick={() => {
                      const nd = nextDir(sort, dir, "contractEnd");
                      setSort("contractEnd");
                      setDir(nd);
                      setPage(1);
                    }}
                  >
                    Contract end
                  </button>
                </th>
                <th className="py-3 px-3 text-left font-semibold text-brand-navy">
                  <button
                    type="button"
                    className="hover:underline"
                    onClick={() => {
                      const nd = nextDir(sort, dir, "savingsToEndNet");
                      setSort("savingsToEndNet");
                      setDir(nd);
                      setPage(1);
                    }}
                  >
                    Savings to end (net ETF)
                  </button>
                </th>
                <th className="py-3 px-3 text-left font-semibold text-brand-navy">
                  <button
                    type="button"
                    className="hover:underline"
                    onClick={() => {
                      const nd = nextDir(sort, dir, "savings12Net");
                      setSort("savings12Net");
                      setDir(nd);
                      setPage(1);
                    }}
                  >
                    Savings 12 mo (net ETF)
                  </button>
                </th>
                <th className="py-3 px-3 text-left font-semibold text-brand-navy">Switched</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 px-3 text-center text-brand-navy/60">
                    {loading ? "Loading…" : "No users found"}
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <React.Fragment key={r.userId}>
                    <tr className="border-b border-brand-navy/10 hover:bg-brand-navy/5">
                      <td className="py-3 px-3 text-brand-navy">
                        <div className="flex flex-col gap-1">
                          <a className="font-semibold hover:underline" href={`/admin/helpdesk/impersonate?email=${encodeURIComponent(r.email)}`}>
                            {r.email}
                          </a>
                          <div className="text-xs text-brand-navy/60">
                            {r.utilityName ? `${r.utilityName} · ` : ""}
                            {r.addressLine1 ? r.addressLine1 : "—"}
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-3 text-brand-navy">{fmtDate(r.joinedAt)}</td>
                      <td className="py-3 px-3">{r.hasUsage ? <span className="text-emerald-700">Yes</span> : <span className="text-slate-500">No</span>}</td>
                      <td className="py-3 px-3">{r.hasSmt ? <span className="text-emerald-700">Yes</span> : <span className="text-slate-500">No</span>}</td>
                      <td className="py-3 px-3 text-brand-navy">{fmtDate(r.contractEndDate)}</td>
                      <td className="py-3 px-3 text-brand-navy font-semibold">{fmtMoney(r.savingsUntilContractEndNetEtf)}</td>
                      <td className="py-3 px-3 text-brand-navy font-semibold">{fmtMoney(r.savingsNext12MonthsNetEtf)}</td>
                      <td className="py-3 px-3">{r.switchedWithUs ? <span className="text-emerald-700">Yes</span> : <span className="text-slate-500">No</span>}</td>
                    </tr>
                    <tr className="border-b border-brand-navy/10">
                      <td colSpan={8} className="px-3 pb-4">
                        <details className="mt-2">
                          <summary className="cursor-pointer select-none text-xs font-semibold uppercase tracking-wide text-brand-navy/60">
                            Details
                          </summary>
                          <div className="mt-3 grid gap-2 text-xs text-brand-navy/80 md:grid-cols-3">
                            <div>
                              <div className="font-semibold text-brand-navy">House</div>
                              <div className="font-mono">{r.houseAddressId ?? "—"}</div>
                              <div className="mt-1 font-mono">ESIID: {r.esiid ?? "—"}</div>
                            </div>
                            <div>
                              <div className="font-semibold text-brand-navy">Savings (no ETF)</div>
                              <div>To end: {fmtMoney(r.savingsUntilContractEndNoEtf)}</div>
                              <div>12 mo: {fmtMoney(r.savingsNext12MonthsNoEtf)}</div>
                            </div>
                            <div>
                              <div className="font-semibold text-brand-navy">ETF</div>
                              <div>ETF: {fmtMoney(r.etfDollars)}</div>
                              <div>Would incur if switch now: {r.wouldIncurEtfIfSwitchNow == null ? "Unknown" : r.wouldIncurEtfIfSwitchNow ? "Yes" : "No"}</div>
                              <div className="mt-1 text-brand-navy/60">Snapshot: {fmtDate(r.snapshotComputedAt)}</div>
                            </div>
                          </div>
                        </details>
                      </td>
                    </tr>
                  </React.Fragment>
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

