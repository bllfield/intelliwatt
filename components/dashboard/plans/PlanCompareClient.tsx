"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type ApiResp = {
  ok: boolean;
  error?: string;
  offer?: {
    offerId: string;
    supplierName: string | null;
    planName: string | null;
    termMonths: number | null;
    enrollLink: string | null;
  };
  currentPlan?: {
    source: "MANUAL" | "PARSED" | null;
    id: string;
    providerName: string | null;
    planName: string | null;
    contractEndDate: string | null;
    earlyTerminationFeeCents: number;
    isInContract: boolean | null;
  };
  tdspApplied?: {
    perKwhDeliveryChargeCents: number;
    monthlyCustomerChargeDollars: number;
    effectiveDate: string | null;
  } | null;
  usage?: {
    source: string | null;
    annualKwh: number | null;
    yearMonths: string[];
    requiredBucketKeys?: string[];
  };
  estimates?: {
    current: any;
    offer: any;
  };
};

function fmtDollars2(n: number | null | undefined): string {
  const x = typeof n === "number" && Number.isFinite(n) ? n : 0;
  return x.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function pickAnnual(est: any): number | null {
  const v = est?.annualCostDollars;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function pickMonthly(est: any): number | null {
  const v = est?.monthlyCostDollars;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export default function PlanCompareClient(props: { offerId: string }) {
  const offerId = String(props.offerId ?? "").trim();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ApiResp | null>(null);
  const [includeEtf, setIncludeEtf] = useState<boolean>(true);
  const [showConfirm, setShowConfirm] = useState(false);

  // Persist the last compared offer so the Dashboard "Compare" nav can jump straight here.
  useEffect(() => {
    try {
      if (offerId) window.localStorage.setItem("dashboard_compare_last_offer_id_v1", offerId);
    } catch {
      // ignore
    }
  }, [offerId]);

  const cacheKey = useMemo(() => `dashboard_plans_compare_resp_v1:${offerId}`, [offerId]);
  const cacheTtlMs = 15 * 60 * 1000; // 15 minutes

  useEffect(() => {
    if (!offerId) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    // session cache first
    try {
      const raw = window.sessionStorage.getItem(cacheKey);
      if (raw) {
        const parsed = JSON.parse(raw) as { t: number; resp: ApiResp };
        if (parsed?.resp && typeof parsed.t === "number" && Date.now() - parsed.t <= cacheTtlMs) {
          setData(parsed.resp);
          setLoading(false);
          return () => controller.abort();
        }
      }
    } catch {
      // ignore
    }

    async function run() {
      try {
        const r = await fetch(`/api/dashboard/plans/compare?offerId=${encodeURIComponent(offerId)}`, {
          signal: controller.signal,
        });
        const j = (await r.json().catch(() => null)) as ApiResp | null;
        if (controller.signal.aborted) return;
        if (!r.ok || !j || !(j as any).ok) {
          setError((j as any)?.error ?? `Request failed (${r.status})`);
          setData(j);
          return;
        }
        setData(j);
        try {
          window.sessionStorage.setItem(cacheKey, JSON.stringify({ t: Date.now(), resp: j }));
        } catch {
          // ignore
        }
      } catch (e: any) {
        if (controller.signal.aborted) return;
        setError(e?.message ?? String(e));
      } finally {
        if (controller.signal.aborted) return;
        setLoading(false);
      }
    }

    run();
    return () => controller.abort();
  }, [offerId, cacheKey, cacheTtlMs]);

  // Default ETF toggle based on contract status
  useEffect(() => {
    const isInContract = data?.currentPlan?.isInContract;
    const etfCents = data?.currentPlan?.earlyTerminationFeeCents ?? 0;
    if (typeof isInContract === "boolean" && etfCents > 0) {
      setIncludeEtf(isInContract);
    } else if (etfCents <= 0) {
      setIncludeEtf(false);
    }
  }, [data?.currentPlan?.isInContract, data?.currentPlan?.earlyTerminationFeeCents]);

  const currentAnnual = pickAnnual(data?.estimates?.current);
  const offerAnnual = pickAnnual(data?.estimates?.offer);
  const currentMonthly = pickMonthly(data?.estimates?.current);
  const offerMonthly = pickMonthly(data?.estimates?.offer);
  const etfDollars = (data?.currentPlan?.earlyTerminationFeeCents ?? 0) / 100;

  const firstYearCurrent = currentAnnual;
  const firstYearNew =
    typeof offerAnnual === "number" && Number.isFinite(offerAnnual)
      ? offerAnnual + (includeEtf ? etfDollars : 0)
      : null;

  const firstYearDelta =
    typeof firstYearCurrent === "number" && typeof firstYearNew === "number"
      ? firstYearNew - firstYearCurrent
      : null;

  const monthlyDelta =
    typeof currentMonthly === "number" && typeof offerMonthly === "number"
      ? offerMonthly - currentMonthly
      : null;

  const canSignup = Boolean(data?.offer?.enrollLink);
  const enrollLink = (data?.offer?.enrollLink ?? "").trim();

  return (
    <div className="mx-auto w-full max-w-5xl">
      <div className="mt-2 text-xs text-brand-navy">
        <Link href={`/dashboard/plans/${encodeURIComponent(offerId)}`} className="text-brand-navy hover:underline">
          ← Back to Plan Details
        </Link>
      </div>

      <div className="mt-3 text-2xl font-semibold text-brand-navy">Compare: Current Plan vs New Plan</div>
      <div className="mt-1 text-sm text-brand-navy/70">
        OfferId: <span className="font-mono">{offerId}</span>
      </div>

      {loading ? (
        <div className="mt-8 rounded-2xl border border-brand-blue/20 bg-brand-blue/5 p-6 text-brand-navy">
          Loading comparison…
        </div>
      ) : error ? (
        <div className="mt-8 rounded-2xl border border-red-300 bg-red-50 p-6 text-red-900">
          <div className="font-semibold">Failed to load comparison</div>
          <div className="mt-1 text-sm">{error}</div>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <Link
              href="/dashboard/api"
              className="inline-flex items-center justify-center rounded-full bg-brand-blue px-5 py-3 text-sm font-semibold text-white hover:bg-brand-blue/90"
            >
              Connect usage
            </Link>
            <Link
              href="/dashboard/current-rate"
              className="inline-flex items-center justify-center rounded-full border border-brand-blue/30 bg-white px-5 py-3 text-sm font-semibold text-brand-blue hover:bg-brand-blue/5"
            >
              Add current plan details
            </Link>
            <Link
              href="/dashboard/plans"
              className="inline-flex items-center justify-center rounded-full border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Back to plans
            </Link>
          </div>
        </div>
      ) : data?.ok !== true ? (
        <div className="mt-8 rounded-2xl border border-red-300 bg-red-50 p-6 text-red-900">
          <div className="font-semibold">Failed to load</div>
          <div className="mt-1 text-sm">{String((data as any)?.error ?? "Unknown error")}</div>
          {String((data as any)?.error ?? "").trim() === "no_usage_window" ? (
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <Link
                href="/dashboard/api"
                className="inline-flex items-center justify-center rounded-full bg-brand-blue px-5 py-3 text-sm font-semibold text-white hover:bg-brand-blue/90"
              >
                Connect usage to see comparison
              </Link>
              <Link
                href="/dashboard/plans"
                className="inline-flex items-center justify-center rounded-full border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Back to plans
              </Link>
            </div>
          ) : String((data as any)?.error ?? "").trim() === "no_current_plan" ? (
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <Link
                href="/dashboard/current-rate"
                className="inline-flex items-center justify-center rounded-full bg-brand-blue px-5 py-3 text-sm font-semibold text-white hover:bg-brand-blue/90"
              >
                Add current plan details to compare
              </Link>
              <Link
                href="/dashboard/plans"
                className="inline-flex items-center justify-center rounded-full border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Back to plans
              </Link>
            </div>
          ) : null}
        </div>
      ) : (
        <>
          <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="rounded-3xl border border-brand-blue/20 bg-white p-6 text-brand-navy">
              <div className="text-xs font-semibold uppercase tracking-wide text-brand-navy/60">Current plan</div>
              <div className="mt-2 text-lg font-semibold">
                {data.currentPlan?.providerName ?? "Current provider"} — {data.currentPlan?.planName ?? "Current plan"}
              </div>
              <div className="mt-1 text-sm text-brand-navy/70">Source: {data.currentPlan?.source ?? "—"}</div>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-xs text-slate-600">Estimate</div>
                  <div className="mt-1 text-xl font-semibold">
                    {currentMonthly != null ? `${fmtDollars2(currentMonthly)}/mo` : "—"}
                  </div>
                  <div className="mt-1 text-sm text-slate-600">
                    {currentAnnual != null ? `${fmtDollars2(currentAnnual)}/yr` : "—"}
                  </div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-xs text-slate-600">Contract</div>
                  <div className="mt-1 text-sm font-medium">
                    {data.currentPlan?.contractEndDate ? data.currentPlan.contractEndDate.slice(0, 10) : "—"}
                  </div>
                  <div className="mt-1 text-sm text-slate-600">
                    ETF: {data.currentPlan?.earlyTerminationFeeCents ? fmtDollars2(etfDollars) : "—"}
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-3xl border border-brand-blue/20 bg-white p-6 text-brand-navy">
              <div className="text-xs font-semibold uppercase tracking-wide text-brand-navy/60">New plan (selected)</div>
              <div className="mt-2 text-lg font-semibold">
                {data.offer?.supplierName ?? "Provider"} — {data.offer?.planName ?? "Plan"}
              </div>
              <div className="mt-1 text-sm text-brand-navy/70">
                Term: {typeof data.offer?.termMonths === "number" ? `${data.offer?.termMonths} months` : "—"}
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-xs text-slate-600">Estimate</div>
                  <div className="mt-1 text-xl font-semibold">
                    {offerMonthly != null ? `${fmtDollars2(offerMonthly)}/mo` : "—"}
                  </div>
                  <div className="mt-1 text-sm text-slate-600">
                    {offerAnnual != null ? `${fmtDollars2(offerAnnual)}/yr` : "—"}
                  </div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-xs text-slate-600">Termination fee toggle</div>
                  <label className="mt-2 flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={includeEtf}
                      disabled={(data.currentPlan?.earlyTerminationFeeCents ?? 0) <= 0}
                      onChange={(e) => setIncludeEtf(e.target.checked)}
                      className="h-4 w-4"
                    />
                    Include ETF in “switch now” cost
                  </label>
                  <div className="mt-1 text-xs text-slate-600">
                    Toggle off to see the savings if you switch after your contract expires.
                  </div>
                </div>
              </div>

              <div className="mt-5 flex flex-col gap-2 sm:flex-row">
                {canSignup ? (
                  <button
                    type="button"
                    onClick={() => setShowConfirm(true)}
                    className="inline-flex items-center justify-center rounded-full bg-brand-blue px-5 py-3 text-sm font-semibold text-white hover:bg-brand-blue/90"
                  >
                    Choose this plan (WattBuy signup)
                  </button>
                ) : (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                    Signup link not available for this offer.
                  </div>
                )}
                <Link
                  href="/dashboard/plans"
                  className="inline-flex items-center justify-center rounded-full border border-brand-blue/30 bg-white px-5 py-3 text-sm font-semibold text-brand-blue hover:bg-brand-blue/5"
                >
                  Pick a different plan
                </Link>
              </div>
            </div>
          </div>

          <div className="mt-6 rounded-3xl border border-brand-blue/20 bg-brand-blue/5 p-6 text-brand-navy">
            <div className="text-xs font-semibold uppercase tracking-wide text-brand-navy/60">Difference</div>
            <div className="mt-2 grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="rounded-2xl border border-brand-blue/20 bg-white p-4">
                <div className="text-xs text-brand-navy/60">Monthly delta</div>
                <div className="mt-1 text-xl font-semibold">{monthlyDelta != null ? `${fmtDollars2(monthlyDelta)}/mo` : "—"}</div>
              </div>
              <div className="rounded-2xl border border-brand-blue/20 bg-white p-4">
                <div className="text-xs text-brand-navy/60">First-year delta (includes ETF if toggled)</div>
                <div className="mt-1 text-xl font-semibold">{firstYearDelta != null ? fmtDollars2(firstYearDelta) : "—"}</div>
              </div>
              <div className="rounded-2xl border border-brand-blue/20 bg-white p-4">
                <div className="text-xs text-brand-navy/60">Usage basis</div>
                <div className="mt-1 text-sm">
                  {data.usage?.annualKwh != null ? `${Math.round(data.usage.annualKwh)} kWh/yr` : "—"}
                </div>
                <div className="mt-1 text-xs text-brand-navy/60">Source: {data.usage?.source ?? "—"}</div>
              </div>
            </div>
          </div>

          <div className="mt-6 text-xs text-brand-navy/60">
            Estimates are generated by the IntelliWatt plan engine using your stitched 12‑month usage window and current TDSP tariffs.
          </div>

          {showConfirm ? (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
              <div className="w-full max-w-lg rounded-3xl border border-brand-blue/25 bg-white p-6 text-brand-navy shadow-xl">
                <div className="text-lg font-semibold">You’re about to leave IntelliWatt to sign up</div>
                <div className="mt-2 text-sm text-brand-navy/70">
                  We’ll open WattBuy in a new tab for the plan enrollment flow. Here’s what to expect:
                </div>
                <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-brand-navy/80">
                  <li>You’ll complete enrollment details with the provider (address, contact info, etc.).</li>
                  <li>After enrollment, you may receive confirmation emails from the provider and/or WattBuy.</li>
                  <li>
                    Your comparison here assumes{" "}
                    <span className="font-semibold">{includeEtf ? "switching now (ETF included)" : "switching after contract expiration (ETF excluded)"}</span>.
                  </li>
                </ul>
                <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
                  <button
                    type="button"
                    onClick={() => setShowConfirm(false)}
                    className="rounded-full border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowConfirm(false);
                      try {
                        if (enrollLink) window.open(enrollLink, "_blank", "noopener,noreferrer");
                      } catch {
                        // ignore
                      }
                    }}
                    className="rounded-full bg-brand-blue px-5 py-3 text-sm font-semibold text-white hover:bg-brand-blue/90"
                  >
                    Continue to signup
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}


