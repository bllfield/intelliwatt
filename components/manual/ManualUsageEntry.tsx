"use client";

import * as React from "react";
import { anchorEndDateUtc, lastFullMonthChicago, monthsEndingAt } from "@/lib/time/chicago";

type TravelRange = { startDate: string; endDate: string };

type ManualUsagePayload =
  | {
      mode: "MONTHLY";
      anchorEndDate: string; // YYYY-MM-DD
      monthlyKwh: Array<{ month: string; kwh: number | "" }>; // month == YYYY-MM
      travelRanges: TravelRange[];
      // legacy
      anchorEndMonth?: string;
      billEndDay?: number;
    }
  | {
      mode: "ANNUAL";
      anchorEndDate: string; // YYYY-MM-DD
      annualKwh: number | "";
      travelRanges: TravelRange[];
      // legacy
      endDate?: string;
    };

type LoadResp =
  | { ok: true; houseId: string; payload: ManualUsagePayload | null; updatedAt: string | null }
  | { ok: false; error: string };

function clampInt(n: unknown, lo: number, hi: number): number {
  const x = typeof n === "number" && Number.isFinite(n) ? Math.trunc(n) : Number(n);
  const y = Number.isFinite(x) ? x : lo;
  return Math.max(lo, Math.min(hi, y));
}

export function ManualUsageEntry({ houseId }: { houseId: string }) {
  const [activeTab, setActiveTab] = React.useState<"MONTHLY" | "ANNUAL">("MONTHLY");
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [savedAt, setSavedAt] = React.useState<string | null>(null);

  const [monthlyAnchorEndDate, setMonthlyAnchorEndDate] = React.useState<string>(`${lastFullMonthChicago()}-15`);
  const [monthlyKwh, setMonthlyKwh] = React.useState<Array<{ month: string; kwh: number | "" }>>(
    monthsEndingAt(lastFullMonthChicago(), 12).map((m) => ({ month: m, kwh: "" })),
  );
  const [annualAnchorEndDate, setAnnualAnchorEndDate] = React.useState<string>("");
  const [annualKwh, setAnnualKwh] = React.useState<number | "">("");

  React.useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/user/manual-usage?houseId=${encodeURIComponent(houseId)}`, {
          cache: "no-store",
        });
        const json = (await res.json().catch(() => null)) as LoadResp | null;
        if (!res.ok || !json || (json as any).ok !== true) {
          throw new Error((json as any)?.error || `HTTP ${res.status}`);
        }
        if (cancelled) return;
        const payload = (json as any).payload as ManualUsagePayload | null;
        setSavedAt((json as any).updatedAt ?? null);
        if (payload?.mode === "MONTHLY") {
          setActiveTab("MONTHLY");
          const anchor =
            typeof (payload as any).anchorEndDate === "string" && String((payload as any).anchorEndDate).trim().length > 0
              ? String((payload as any).anchorEndDate).slice(0, 10)
              : typeof (payload as any).anchorEndMonth === "string"
                ? (() => {
                    const endMonth = String((payload as any).anchorEndMonth).trim();
                    const day = clampInt((payload as any).billEndDay ?? 15, 1, 31);
                    const d = anchorEndDateUtc(endMonth, day);
                    return d ? d.toISOString().slice(0, 10) : `${endMonth}-15`;
                  })()
                : `${lastFullMonthChicago()}-15`;
          setMonthlyAnchorEndDate(anchor);
          const months = monthsEndingAt(anchor.slice(0, 7), 12);
          const map = new Map<string, number | "">(
            payload.monthlyKwh.map((r) => [r.month, typeof r.kwh === "number" ? r.kwh : ""]),
          );
          setMonthlyKwh(months.map((m) => ({ month: m, kwh: map.get(m) ?? "" })));
          return;
        }
        if (payload?.mode === "ANNUAL") {
          setActiveTab("ANNUAL");
          setAnnualAnchorEndDate(String((payload as any).anchorEndDate ?? (payload as any).endDate ?? "").slice(0, 10));
          setAnnualKwh(payload.annualKwh);
          return;
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "Failed to load manual usage");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [houseId]);

  React.useEffect(() => {
    // Keep month labels stable when anchor changes (months are billing-period labels ending at anchor's month).
    setMonthlyKwh((prev) => {
      const months = monthsEndingAt(String(monthlyAnchorEndDate ?? "").slice(0, 7), 12);
      const map = new Map(prev.map((r) => [r.month, r.kwh]));
      return months.map((m) => ({ month: m, kwh: map.get(m) ?? "" }));
    });
  }, [monthlyAnchorEndDate]);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const payload: ManualUsagePayload =
        activeTab === "MONTHLY"
          ? {
              mode: "MONTHLY",
              anchorEndDate: String(monthlyAnchorEndDate ?? "").slice(0, 10),
              monthlyKwh: monthlyKwh.map((r) => ({ month: r.month, kwh: r.kwh === "" ? "" : Number(r.kwh) })),
              travelRanges: [],
            }
          : {
              mode: "ANNUAL",
              anchorEndDate: String(annualAnchorEndDate ?? "").slice(0, 10),
              annualKwh: annualKwh === "" ? "" : Number(annualKwh),
              travelRanges: [],
            };

      const res = await fetch("/api/user/manual-usage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ houseId, payload }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json || json.ok !== true) {
        throw new Error(json?.error || `HTTP ${res.status}`);
      }
      setSavedAt(json.updatedAt ?? new Date().toISOString());
    } catch (e: any) {
      setError(e?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div id="manual-entry" className="space-y-6">
      <div className="rounded-3xl border border-brand-cyan/30 bg-brand-navy/90 p-6 text-brand-cyan shadow-[0_16px_45px_rgba(16,46,90,0.22)]">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.3em] text-brand-cyan/60">Manual usage</p>
            <p className="mt-2 text-sm text-brand-cyan/80">
              Enter your kWh totals to generate a simulated 15‑minute usage curve for IntelliWatt comparisons.
            </p>
            {savedAt ? (
              <p className="mt-2 text-xs text-brand-cyan/60">Last saved: {new Date(savedAt).toLocaleString()}</p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setActiveTab("MONTHLY")}
              className={`rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-wide transition ${
                activeTab === "MONTHLY"
                  ? "border-brand-blue bg-brand-blue/20 text-brand-navy"
                  : "border-brand-cyan/20 bg-brand-navy text-brand-cyan/80 hover:bg-brand-cyan/5"
              }`}
            >
              Monthly
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("ANNUAL")}
              className={`rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-wide transition ${
                activeTab === "ANNUAL"
                  ? "border-brand-blue bg-brand-blue/20 text-brand-navy"
                  : "border-brand-cyan/20 bg-brand-navy text-brand-cyan/80 hover:bg-brand-cyan/5"
              }`}
            >
              Annual
            </button>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="rounded-3xl border border-brand-cyan/25 bg-brand-navy/90 p-6 text-brand-cyan">
          Loading…
        </div>
      ) : (
        <>
          {activeTab === "MONTHLY" ? (
            <div className="rounded-3xl border border-brand-cyan/25 bg-brand-navy/90 p-6 text-brand-cyan shadow-[0_16px_45px_rgba(16,46,90,0.22)]">
              <p className="text-sm font-semibold uppercase tracking-[0.3em] text-brand-cyan/60">
                Monthly entry
              </p>

              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-[0.7rem] font-semibold uppercase tracking-wide text-brand-cyan/60">
                    Anchor end date (meter read end date)
                  </label>
                  <input
                    type="date"
                    value={monthlyAnchorEndDate}
                    onChange={(e) => setMonthlyAnchorEndDate(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-brand-cyan/20 bg-brand-navy px-3 py-2 text-sm text-brand-cyan"
                  />
                  <p className="mt-2 text-xs text-brand-cyan/60">
                    We model 12 billing periods ending at this date (America/Chicago). UI labels periods by the end month.
                  </p>
                </div>
                <div className="text-xs text-brand-cyan/70 sm:flex sm:items-end">
                  Each “month” entered is treated as a billing-period total (not a calendar month). We generate a curve that
                  matches these totals exactly.
                </div>
              </div>

              <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {monthlyKwh.map((r, idx) => (
                  <div key={r.month} className="rounded-2xl border border-brand-cyan/15 bg-brand-navy px-4 py-3">
                    <label className="block text-[0.7rem] font-semibold uppercase tracking-wide text-brand-cyan/60">
                      {r.month}
                    </label>
                    <input
                      type="number"
                      min={0}
                      step="0.1"
                      value={r.kwh}
                      onChange={(e) => {
                        const v = e.target.value === "" ? "" : Number(e.target.value);
                        setMonthlyKwh((prev) => {
                          const next = prev.slice();
                          next[idx] = { ...next[idx], kwh: v === "" ? "" : Number.isFinite(v) ? v : "" };
                          return next;
                        });
                      }}
                      className="mt-1 w-full rounded-lg border border-brand-cyan/20 bg-brand-navy px-3 py-2 text-sm text-brand-cyan"
                      placeholder="kWh"
                    />
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="rounded-3xl border border-brand-cyan/25 bg-brand-navy/90 p-6 text-brand-cyan shadow-[0_16px_45px_rgba(16,46,90,0.22)]">
              <p className="text-sm font-semibold uppercase tracking-[0.3em] text-brand-cyan/60">
                Annual entry
              </p>

              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-[0.7rem] font-semibold uppercase tracking-wide text-brand-cyan/60">
                    Anchor end date
                  </label>
                  <input
                    type="date"
                    value={annualAnchorEndDate}
                    onChange={(e) => setAnnualAnchorEndDate(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-brand-cyan/20 bg-brand-navy px-3 py-2 text-sm text-brand-cyan"
                  />
                </div>
                <div>
                  <label className="block text-[0.7rem] font-semibold uppercase tracking-wide text-brand-cyan/60">
                    Annual kWh
                  </label>
                  <input
                    type="number"
                    min={0}
                    step="0.1"
                    value={annualKwh}
                    onChange={(e) => setAnnualKwh(e.target.value === "" ? "" : Number(e.target.value))}
                    className="mt-1 w-full rounded-lg border border-brand-cyan/20 bg-brand-navy px-3 py-2 text-sm text-brand-cyan"
                    placeholder="kWh"
                  />
                </div>
              </div>
              <p className="mt-2 text-xs text-brand-cyan/60">
                We’ll distribute the annual total across 12 billing periods ending at this date using a deterministic seasonal profile.
              </p>
            </div>
          )}

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-xs text-brand-navy/70">
              {error ? <span className="text-rose-700">Error: {error}</span> : null}
            </div>
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="inline-flex items-center justify-center rounded-full border border-brand-blue/60 bg-brand-blue/15 px-6 py-2 text-xs font-semibold uppercase tracking-wide text-brand-navy transition hover:border-brand-blue hover:bg-brand-blue/25 disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save manual usage"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

