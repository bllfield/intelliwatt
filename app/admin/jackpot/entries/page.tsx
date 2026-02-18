"use client";

import * as React from "react";
import Link from "next/link";

type Row = {
  userId: string;
  email: string;
  joinedAt: string;
  entriesEligibleTotal: number;
  entriesExpiredTotal: number;
  referralsTotal: number;
  referralsPending: number;
  referralsQualified: number;
  applianceCount: number;
  smartMeterEntryStatus: "ACTIVE" | "EXPIRING_SOON" | "EXPIRED" | null;
  currentPlanEntryStatus: "ACTIVE" | "EXPIRING_SOON" | "EXPIRED" | null;
  homeDetailsEntryStatus: "ACTIVE" | "EXPIRING_SOON" | "EXPIRED" | null;
  applianceDetailsEntryStatus: "ACTIVE" | "EXPIRING_SOON" | "EXPIRED" | null;
  testimonialEntryStatus: "ACTIVE" | "EXPIRING_SOON" | "EXPIRED" | null;
  referralEntryStatus: "ACTIVE" | "EXPIRING_SOON" | "EXPIRED" | null;
  commissionLifetimeEarnedDollars: number;
  commissionPendingDollars: number;
};

type ApiResp =
  | {
      ok: true;
      q: string | null;
      sort: string;
      dir: string;
      page: number;
      pageSize: number;
      total: number;
      totalPages: number;
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

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "—";
  return d.toLocaleDateString();
}

function badgeClass(status: string | null | undefined): string {
  if (!status) return "border-slate-200 bg-white text-slate-500";
  const s = String(status).toUpperCase();
  if (s === "ACTIVE") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (s === "EXPIRING_SOON") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-rose-200 bg-rose-50 text-rose-700";
}

function badgeLabel(status: string | null | undefined): string {
  if (!status) return "—";
  const s = String(status).toUpperCase();
  if (s === "ACTIVE") return "Active";
  if (s === "EXPIRING_SOON") return "Expiring";
  return "Expired";
}

function nextDir(curSort: string, curDir: string, nextSort: string): "asc" | "desc" {
  if (curSort !== nextSort) return "desc";
  return curDir === "asc" ? "desc" : "asc";
}

export default function JackpotEntriesAdminPage() {
  const [adminToken, setAdminToken] = React.useState("");
  const [q, setQ] = React.useState("");
  const [sort, setSort] = React.useState("entriesEligible");
  const [dir, setDir] = React.useState<"asc" | "desc">("desc");
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
      params.set("sort", sort);
      params.set("dir", dir);
      params.set("page", String(page));
      params.set("pageSize", String(pageSize));
      const r = await fetch(`/api/admin/jackpot/entries?${params.toString()}`, withAdminHeaders({ cache: "no-store" }));
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
  }, [q, sort, dir, page, pageSize, withAdminHeaders]);

  React.useEffect(() => {
    fetchRows();
  }, [fetchRows]);

  const rows = resp && (resp as any).ok === true ? ((resp as any).rows as Row[]) : [];
  const totalPages = resp && (resp as any).ok === true ? Number((resp as any).totalPages ?? 1) : 1;
  const total = resp && (resp as any).ok === true ? Number((resp as any).total ?? 0) : 0;

  const runEntriesRefresh = async () => {
    try {
      setLoading(true);
      setError(null);
      const r = await fetch("/api/admin/entries/recalculate", withAdminHeaders({ method: "POST", cache: "no-store" }));
      if (!r.ok) {
        const j = await r.json().catch(() => null);
        setError(j?.error || `HTTP ${r.status}`);
        return;
      }
      await fetchRows();
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-10">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-brand-navy">Jackpot Entries</h1>
          <div className="mt-1 text-sm text-brand-navy/70">
            Inspect the current eligible pool used for the next draw (based on Entry status).
          </div>
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
          <button
            type="button"
            onClick={runEntriesRefresh}
            className="inline-flex items-center rounded-full border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-100"
          >
            Recalculate entry statuses
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
                      const nd = nextDir(sort, dir, "entriesEligible");
                      setSort("entriesEligible");
                      setDir(nd);
                      setPage(1);
                    }}
                  >
                    Eligible entries
                  </button>
                </th>
                <th className="py-3 px-3 text-left font-semibold text-brand-navy">Expired entries</th>
                <th className="py-3 px-3 text-left font-semibold text-brand-navy">Referrals</th>
                <th className="py-3 px-3 text-left font-semibold text-brand-navy">Home</th>
                <th className="py-3 px-3 text-left font-semibold text-brand-navy">Appliances</th>
                <th className="py-3 px-3 text-left font-semibold text-brand-navy">Testimonial</th>
                <th className="py-3 px-3 text-left font-semibold text-brand-navy">Commission $</th>
                <th className="py-3 px-3 text-left font-semibold text-brand-navy">Pending $</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-8 px-3 text-center text-brand-navy/60">
                    {loading ? "Loading…" : "No users found"}
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.userId} className="border-b border-brand-navy/10 hover:bg-brand-navy/5">
                    <td className="py-3 px-3 text-brand-navy">
                      <div className="flex flex-col gap-1">
                        <a className="font-semibold hover:underline" href={`/admin/helpdesk/impersonate?email=${encodeURIComponent(r.email)}`}>
                          {r.email}
                        </a>
                        <div className="text-xs text-brand-navy/60">Joined {fmtDate(r.joinedAt)}</div>
                      </div>
                    </td>
                    <td className="py-3 px-3 text-brand-navy font-semibold">{r.entriesEligibleTotal}</td>
                    <td className="py-3 px-3 text-brand-navy">{r.entriesExpiredTotal}</td>
                    <td className="py-3 px-3 text-brand-navy">
                      <span className="font-semibold">{r.referralsTotal}</span>
                      <span className="text-xs text-brand-navy/60">{` (${r.referralsPending} pending, ${r.referralsQualified} qualified)`}</span>
                    </td>
                    <td className="py-3 px-3 text-brand-navy">
                      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${badgeClass(r.homeDetailsEntryStatus)}`}>
                        {badgeLabel(r.homeDetailsEntryStatus)}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-brand-navy">
                      <div className="flex flex-col gap-1">
                        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${badgeClass(r.applianceDetailsEntryStatus)}`}>
                          {badgeLabel(r.applianceDetailsEntryStatus)}
                        </span>
                        <span className="text-xs text-brand-navy/60">{r.applianceCount} item(s)</span>
                      </div>
                    </td>
                    <td className="py-3 px-3 text-brand-navy">
                      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold ${badgeClass(r.testimonialEntryStatus)}`}>
                        {badgeLabel(r.testimonialEntryStatus)}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-brand-navy font-semibold">{fmtMoney2(r.commissionLifetimeEarnedDollars)}</td>
                    <td className="py-3 px-3 text-brand-navy font-semibold">
                      <a className="hover:underline" href={`/admin/commissions?q=${encodeURIComponent(r.email)}&status=pending`}>
                        {fmtMoney2(r.commissionPendingDollars)}
                      </a>
                    </td>
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

