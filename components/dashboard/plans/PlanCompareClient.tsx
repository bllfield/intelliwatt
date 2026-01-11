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
  detail?: {
    usage?: any;
    current?: any;
    offer?: any;
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

function fmtNum(n: any, digits = 2): string {
  if (n == null) return "—";
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return "—";
  return v.toFixed(digits);
}

function fmtKwh0(n: any): string {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return "—";
  const whole = Number(v.toFixed(0));
  return whole.toLocaleString();
}

function fmtDollars(n: any): string {
  if (n == null) return "—";
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return "—";
  return `$${v.toFixed(2)}`;
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

  const usageDetail = (data as any)?.detail?.usage ?? null;
  const offerDetail = (data as any)?.detail?.offer ?? null;
  const currentDetail = (data as any)?.detail?.current ?? null;

  return (
    <div className="mx-auto w-full max-w-5xl">
      <div className="mt-2 text-xs text-brand-cyan/70">
        <Link
          href={`/dashboard/plans/${encodeURIComponent(offerId)}`}
          className="text-brand-cyan/80 hover:text-brand-white hover:underline"
        >
          ← Back to Plan Details
        </Link>
      </div>

      <div className="mt-3 text-2xl font-semibold text-brand-white">Compare: Current Plan vs New Plan</div>
      <div className="mt-1 text-sm text-brand-cyan/70">
        OfferId: <span className="font-mono text-brand-white/90">{offerId}</span>
      </div>

      {loading ? (
        <div className="mt-8 rounded-3xl border border-brand-cyan/20 bg-brand-navy p-6 text-brand-cyan/80">
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
              className="inline-flex items-center justify-center rounded-full border border-brand-cyan/25 bg-brand-white/5 px-5 py-3 text-sm font-semibold text-brand-cyan hover:bg-brand-white/10"
            >
              Add current plan details
            </Link>
            <Link
              href="/dashboard/plans"
              className="inline-flex items-center justify-center rounded-full border border-brand-cyan/25 bg-brand-white/5 px-5 py-3 text-sm font-semibold text-brand-cyan hover:bg-brand-white/10"
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
                className="inline-flex items-center justify-center rounded-full border border-brand-cyan/25 bg-brand-white/5 px-5 py-3 text-sm font-semibold text-brand-cyan hover:bg-brand-white/10"
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
                className="inline-flex items-center justify-center rounded-full border border-brand-cyan/25 bg-brand-white/5 px-5 py-3 text-sm font-semibold text-brand-cyan hover:bg-brand-white/10"
              >
                Back to plans
              </Link>
            </div>
          ) : null}
        </div>
      ) : (
        <>
          <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="rounded-3xl border border-brand-cyan/20 bg-brand-navy p-6 text-brand-white shadow-[0_18px_40px_rgba(10,20,60,0.22)]">
              <div className="text-xs font-semibold uppercase tracking-wide text-brand-cyan/60">Current plan</div>
              <div className="mt-2 text-lg font-semibold text-brand-white/90">
                {data.currentPlan?.providerName ?? "Current provider"} — {data.currentPlan?.planName ?? "Current plan"}
              </div>
              <div className="mt-1 text-sm text-brand-cyan/70">Source: {data.currentPlan?.source ?? "—"}</div>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <div className="rounded-2xl border border-brand-cyan/15 bg-brand-white/5 p-4">
                  <div className="text-xs text-brand-cyan/70">Estimate</div>
                  <div className="mt-1 text-xl font-semibold text-brand-white/90">
                    {currentMonthly != null ? `${fmtDollars2(currentMonthly)}/mo` : "—"}
                  </div>
                  <div className="mt-1 text-sm text-brand-cyan/70">
                    {currentAnnual != null ? `${fmtDollars2(currentAnnual)}/yr` : "—"}
                  </div>
                </div>
                <div className="rounded-2xl border border-brand-cyan/15 bg-brand-white/5 p-4">
                  <div className="text-xs text-brand-cyan/70">Contract</div>
                  <div className="mt-1 text-sm font-medium text-brand-white/90">
                    {data.currentPlan?.contractEndDate ? data.currentPlan.contractEndDate.slice(0, 10) : "—"}
                  </div>
                  <div className="mt-1 text-sm text-brand-cyan/70">
                    ETF: {data.currentPlan?.earlyTerminationFeeCents ? fmtDollars2(etfDollars) : "—"}
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-3xl border border-brand-cyan/20 bg-brand-navy p-6 text-brand-white shadow-[0_18px_40px_rgba(10,20,60,0.22)]">
              <div className="text-xs font-semibold uppercase tracking-wide text-brand-cyan/60">New plan (selected)</div>
              <div className="mt-2 text-lg font-semibold text-brand-white/90">
                {data.offer?.supplierName ?? "Provider"} — {data.offer?.planName ?? "Plan"}
              </div>
              <div className="mt-1 text-sm text-brand-cyan/70">
                Term: {typeof data.offer?.termMonths === "number" ? `${data.offer?.termMonths} months` : "—"}
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3">
                <div className="rounded-2xl border border-brand-cyan/15 bg-brand-white/5 p-4">
                  <div className="text-xs text-brand-cyan/70">Estimate</div>
                  <div className="mt-1 text-xl font-semibold text-brand-white/90">
                    {offerMonthly != null ? `${fmtDollars2(offerMonthly)}/mo` : "—"}
                  </div>
                  <div className="mt-1 text-sm text-brand-cyan/70">
                    {offerAnnual != null ? `${fmtDollars2(offerAnnual)}/yr` : "—"}
                  </div>
                </div>
                <div className="rounded-2xl border border-brand-cyan/15 bg-brand-white/5 p-4">
                  <div className="text-xs text-brand-cyan/70">Termination fee toggle</div>
                  <label className="mt-2 flex items-center gap-2 text-sm text-brand-white/90">
                    <input
                      type="checkbox"
                      checked={includeEtf}
                      disabled={(data.currentPlan?.earlyTerminationFeeCents ?? 0) <= 0}
                      onChange={(e) => setIncludeEtf(e.target.checked)}
                      className="h-4 w-4 rounded border-brand-cyan/40 bg-brand-white/10"
                    />
                    Include ETF in “switch now” cost
                  </label>
                  <div className="mt-1 text-xs text-brand-cyan/70">
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
                    Choose this plan (Sign up)
                  </button>
                ) : (
                  <div className="rounded-2xl border border-brand-cyan/15 bg-brand-white/5 px-4 py-3 text-sm text-brand-cyan/70">
                    Signup link not available for this offer.
                  </div>
                )}
                <Link
                  href="/dashboard/plans"
                  className="inline-flex items-center justify-center rounded-full border border-brand-cyan/25 bg-brand-white/5 px-5 py-3 text-sm font-semibold text-brand-cyan hover:bg-brand-white/10"
                >
                  Pick a different plan
                </Link>
              </div>
            </div>
          </div>

          <div className="mt-6 rounded-3xl border border-brand-cyan/20 bg-brand-navy p-6 text-brand-white shadow-[0_18px_40px_rgba(10,20,60,0.22)]">
            <div className="text-xs font-semibold uppercase tracking-wide text-brand-cyan/60">Difference</div>
            <div className="mt-2 grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="rounded-2xl border border-brand-cyan/15 bg-brand-white/5 p-4">
                <div className="text-xs text-brand-cyan/70">Monthly delta</div>
                <div className="mt-1 text-xl font-semibold text-brand-white/90">
                  {monthlyDelta != null ? `${fmtDollars2(monthlyDelta)}/mo` : "—"}
                </div>
              </div>
              <div className="rounded-2xl border border-brand-cyan/15 bg-brand-white/5 p-4">
                <div className="text-xs text-brand-cyan/70">First-year delta (includes ETF if toggled)</div>
                <div className="mt-1 text-xl font-semibold text-brand-white/90">
                  {firstYearDelta != null ? fmtDollars2(firstYearDelta) : "—"}
                </div>
              </div>
              <div className="rounded-2xl border border-brand-cyan/15 bg-brand-white/5 p-4">
                <div className="text-xs text-brand-cyan/70">Usage basis</div>
                <div className="mt-1 text-sm text-brand-white/90">
                  {data.usage?.annualKwh != null ? `${Math.round(data.usage.annualKwh)} kWh/yr` : "—"}
                </div>
                <div className="mt-1 text-xs text-brand-cyan/70">Source: {data.usage?.source ?? "—"}</div>
              </div>
            </div>
          </div>

          <div className="mt-6 text-xs text-brand-cyan/60">
            Estimates are generated by the IntelliWatt plan engine using your stitched 12‑month usage window and current TDSP tariffs.
          </div>

          {/* Detailed breakdown (same style as Plan Details) */}
          <div className="mt-10 rounded-3xl border border-brand-cyan/20 bg-brand-navy p-5">
            <div className="text-sm font-semibold text-brand-white/90">Detailed engine breakdown</div>
            <div className="mt-1 text-xs text-brand-cyan/60">
              This shows the exact variables and per-month math the IntelliWatt plan engine used for the comparison.
            </div>

            <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-3">
              <div className="rounded-2xl border border-brand-cyan/20 bg-brand-navy p-4">
                <div className="text-[0.7rem] font-semibold uppercase tracking-[0.22em] text-brand-cyan/60">Usage snapshot</div>
                <div className="mt-3 text-sm text-brand-cyan/75">
                  <div>
                    Total (last 365 days):{" "}
                    <span className="font-semibold text-brand-white/90">{fmtKwh0(usageDetail?.annualKwh)} kWh</span>
                  </div>
                  <div>
                    Avg monthly (total/12):{" "}
                    <span className="font-semibold text-brand-white/90">{fmtKwh0(usageDetail?.avgMonthlyKwh)} kWh</span> / mo
                  </div>
                  <div className="mt-2 text-xs text-brand-cyan/60">
                    Source: <span className="font-mono">{usageDetail?.source ?? data?.usage?.source ?? "—"}</span>
                    {usageDetail?.windowEnd ? (
                      <>
                        {" "}· Window ends: <span className="font-mono">{String(usageDetail.windowEnd).slice(0, 10)}</span>
                      </>
                    ) : null}
                  </div>
                  {usageDetail?.cutoff ? (
                    <div className="mt-1 text-xs text-brand-cyan/60">
                      Cutoff (latest - 365d): <span className="font-mono">{String(usageDetail.cutoff).slice(0, 10)}</span>
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="rounded-2xl border border-brand-cyan/20 bg-brand-navy p-4 lg:col-span-2">
                <div className="text-[0.7rem] font-semibold uppercase tracking-[0.22em] text-brand-cyan/60">Plan variables used</div>
                <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                  {(["current", "offer"] as const).map((side) => {
                    const d = side === "current" ? currentDetail : offerDetail;
                    const title = side === "current" ? "Current plan" : "New plan";
                    const rows = Array.isArray(d?.variablesList) ? (d.variablesList as any[]) : [];
                    return (
                      <div key={side} className="rounded-xl border border-brand-cyan/15 bg-brand-white/5 p-3">
                        <div className="text-xs font-semibold text-brand-white/90">{title}</div>
                        <div className="mt-2 space-y-2 text-xs text-brand-cyan/75">
                          {rows.length ? (
                            rows.map((r) => (
                              <div key={String(r?.key ?? r?.label ?? Math.random())} className="flex items-center justify-between gap-3">
                                <span>{String(r?.label ?? "—")}</span>
                                <span className="font-semibold text-brand-white/90">{String(r?.value ?? "—")}</span>
                              </div>
                            ))
                          ) : (
                            <div className="text-brand-cyan/70">—</div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
              {(["current", "offer"] as const).map((side) => {
                const d = side === "current" ? currentDetail : offerDetail;
                const title = side === "current" ? "Current plan" : "New plan (selected)";
                const outputs = d?.outputs ?? null;
                const math = d?.math ?? null;
                const template = d?.template ?? null;
                const monthlyBreakdown = d?.monthlyBreakdown ?? null;

                return (
                  <div key={side} className="rounded-2xl border border-brand-cyan/20 bg-brand-navy p-4">
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                      <div>
                        <div className="text-[0.7rem] font-semibold uppercase tracking-[0.22em] text-brand-cyan/60">
                          {title}
                        </div>
                        <div className="mt-1 text-xs text-brand-cyan/60">
                          Template:{" "}
                          <span className="font-mono">
                            {String(template?.ratePlanId ?? "—")}
                          </span>{" "}
                          {template?.planCalcStatus ? `(${String(template.planCalcStatus)})` : ""}
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                      <div className="rounded-xl border border-brand-cyan/15 bg-brand-white/5 p-3">
                        <div className="text-xs font-semibold text-brand-white/90">Outputs</div>
                        <div className="mt-2 text-xs text-brand-cyan/75">
                          <div>
                            Est. monthly:{" "}
                            <span className="font-semibold text-brand-white/90">
                              {fmtDollars(outputs?.trueCostEstimate?.monthlyCostDollars)}
                            </span>
                          </div>
                          <div>
                            Est. annual:{" "}
                            <span className="font-semibold text-brand-white/90">
                              {fmtDollars(outputs?.trueCostEstimate?.annualCostDollars)}
                            </span>
                          </div>
                          <div>
                            Effective price:{" "}
                            <span className="font-semibold text-brand-white/90">
                              {fmtNum(outputs?.effectiveCentsPerKwh, 4)}¢/kWh
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="rounded-xl border border-brand-cyan/15 bg-brand-white/5 p-3">
                        <div className="text-xs font-semibold text-brand-white/90">Components</div>
                        <div className="mt-2 text-xs text-brand-cyan/75">
                          {math?.componentsV2 ? (
                            <>
                              <div>REP energy: {fmtDollars(math.componentsV2?.rep?.energyDollars)}</div>
                              <div>REP fixed: {fmtDollars(math.componentsV2?.rep?.fixedDollars)}</div>
                              <div>TDSP delivery: {fmtDollars(math.componentsV2?.tdsp?.deliveryDollars)}</div>
                              <div>TDSP fixed: {fmtDollars(math.componentsV2?.tdsp?.fixedDollars)}</div>
                              {"creditsDollars" in (math.componentsV2 ?? {}) ? (
                                <div>Credits: {fmtDollars((math.componentsV2 as any).creditsDollars)}</div>
                              ) : null}
                              {"minimumUsageFeeDollars" in (math.componentsV2 ?? {}) ? (
                                <div>Min usage fee: {fmtDollars((math.componentsV2 as any).minimumUsageFeeDollars)}</div>
                              ) : null}
                              {"minimumBillTopUpDollars" in (math.componentsV2 ?? {}) ? (
                                <div>Min bill top-up: {fmtDollars((math.componentsV2 as any).minimumBillTopUpDollars)}</div>
                              ) : null}
                              <div className="mt-1">Total: {fmtDollars(math.componentsV2?.totalDollars)}</div>
                            </>
                          ) : (
                            <div className="text-brand-cyan/70">Math breakdown not available.</div>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="mt-5 rounded-xl border border-brand-cyan/15 bg-brand-white/5 p-3">
                      <div className="text-xs font-semibold text-brand-white/90">Status + totals</div>
                      <div className="mt-2 text-xs text-brand-cyan/75">
                        <div>
                          Status: <span className="font-mono text-brand-white/90">{String(outputs?.trueCostEstimate?.status ?? math?.status ?? "—")}</span>
                        </div>
                        {(outputs?.trueCostEstimate?.reason ?? math?.reason) ? (
                          <div>
                            Reason: <span className="font-mono">{String(outputs?.trueCostEstimate?.reason ?? math?.reason)}</span>
                          </div>
                        ) : null}
                        <div className="mt-1">
                          Annual: <span className="font-semibold text-brand-white/90">{fmtDollars(outputs?.trueCostEstimate?.annualCostDollars)}</span>
                        </div>
                        <div>
                          Monthly: <span className="font-semibold text-brand-white/90">{fmtDollars(outputs?.trueCostEstimate?.monthlyCostDollars)}</span>
                        </div>
                      </div>
                    </div>

                    <div className="mt-5 rounded-xl border border-brand-cyan/15 bg-brand-white/5 p-3">
                      <div className="text-xs font-semibold text-brand-white/90">Monthly bill math</div>
                      {!monthlyBreakdown ? (
                        <div className="mt-2 text-xs text-brand-cyan/70">Monthly breakdown unavailable (needs an OK estimate and required usage buckets).</div>
                      ) : (
                        <>
                          <div className="mt-2 text-xs text-brand-cyan/60 font-mono">
                            rows={String(monthlyBreakdown?.monthsCount ?? "—")}
                            {" · "}annualFromRows=${fmtNum(monthlyBreakdown?.totals?.annualFromRows, 2)}
                            {" · "}expectedAnnual=${fmtNum(monthlyBreakdown?.totals?.expectedAnnual, 2)}
                            {typeof monthlyBreakdown?.totals?.deltaCents === "number" ? ` · deltaCents=${String(monthlyBreakdown.totals.deltaCents)}` : ""}
                          </div>

                          <div className="mt-3 overflow-auto rounded-xl border border-brand-cyan/15">
                            <table className="min-w-[1200px] w-full text-xs">
                              <thead className="bg-brand-white/5 text-brand-cyan/70">
                                <tr>
                                  <th className="px-3 py-2 text-left">Year-Month</th>
                                  <th className="px-3 py-2 text-left whitespace-nowrap">Total kWh</th>
                                  {(monthlyBreakdown?.repBuckets ?? []).map((b: any) => (
                                    <th key={`${b.bucketKey}-kwh`} className="px-3 py-2 text-left whitespace-nowrap" title={b.bucketKey}>
                                      {b.label} kWh
                                    </th>
                                  ))}
                                  {(monthlyBreakdown?.repBuckets ?? []).map((b: any) => (
                                    <th key={`${b.bucketKey}-rate`} className="px-3 py-2 text-left whitespace-nowrap" title={b.bucketKey}>
                                      {b.label} ¢/kWh
                                    </th>
                                  ))}
                                  {(monthlyBreakdown?.repBuckets ?? []).map((b: any) => (
                                    <th key={`${b.bucketKey}-cost`} className="px-3 py-2 text-left whitespace-nowrap" title={b.bucketKey}>
                                      {b.label} $
                                    </th>
                                  ))}
                                  <th className="px-3 py-2 text-left whitespace-nowrap">TDSP ¢/kWh</th>
                                  <th className="px-3 py-2 text-left whitespace-nowrap">TDSP delivery $</th>
                                  <th className="px-3 py-2 text-left whitespace-nowrap">REP fixed $</th>
                                  <th className="px-3 py-2 text-left whitespace-nowrap">TDSP fixed $</th>
                                  <th className="px-3 py-2 text-left whitespace-nowrap">Credits $</th>
                                  <th className="px-3 py-2 text-left whitespace-nowrap">Min usage fee $</th>
                                  <th className="px-3 py-2 text-left whitespace-nowrap">Min bill top-up $</th>
                                  <th className="px-3 py-2 text-left whitespace-nowrap">Month total $</th>
                                </tr>
                              </thead>

                              <tbody className="text-brand-cyan/80">
                                {(monthlyBreakdown?.rows ?? []).map((r: any) => {
                                  const repLines = Array.isArray(r?.repBuckets) ? (r.repBuckets as any[]) : [];
                                  const byKey = new Map(repLines.map((x) => [String(x.bucketKey), x]));
                                  return (
                                    <tr key={String(r?.yearMonth ?? Math.random())} className="border-t border-brand-cyan/10">
                                      <td className="px-3 py-2 font-mono text-brand-white/90">{String(r?.yearMonth ?? "")}</td>
                                      <td className="px-3 py-2">{fmtKwh0(r?.bucketTotalKwh)}</td>
                                      {(monthlyBreakdown?.repBuckets ?? []).map((b: any) => (
                                        <td key={`${r.yearMonth}-${b.bucketKey}-kwh`} className="px-3 py-2">
                                          {fmtKwh0(byKey.get(String(b.bucketKey))?.kwh ?? 0)}
                                        </td>
                                      ))}
                                      {(monthlyBreakdown?.repBuckets ?? []).map((b: any) => (
                                        <td key={`${r.yearMonth}-${b.bucketKey}-rate`} className="px-3 py-2">
                                          {fmtNum(byKey.get(String(b.bucketKey))?.repCentsPerKwh, 4)}¢
                                        </td>
                                      ))}
                                      {(monthlyBreakdown?.repBuckets ?? []).map((b: any) => (
                                        <td key={`${r.yearMonth}-${b.bucketKey}-cost`} className="px-3 py-2">
                                          {fmtDollars(byKey.get(String(b.bucketKey))?.repCostDollars)}
                                        </td>
                                      ))}
                                      <td className="px-3 py-2">{fmtNum(r?.tdsp?.perKwhDeliveryChargeCents, 4)}¢</td>
                                      <td className="px-3 py-2">{fmtDollars(r?.tdsp?.deliveryDollars)}</td>
                                      <td className="px-3 py-2">{fmtDollars(r?.repFixedMonthlyChargeDollars)}</td>
                                      <td className="px-3 py-2">{fmtDollars(r?.tdsp?.monthlyCustomerChargeDollars)}</td>
                                      <td className="px-3 py-2">{fmtDollars(r?.creditsDollars)}</td>
                                      <td className="px-3 py-2">{fmtDollars(r?.minimumUsageFeeDollars)}</td>
                                      <td className="px-3 py-2">{fmtDollars(r?.minimumBillTopUpDollars)}</td>
                                      <td className="px-3 py-2 font-semibold text-brand-white/90">{fmtDollars(r?.totalDollars)}</td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {showConfirm ? (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
              <div className="w-full max-w-lg rounded-3xl border border-brand-cyan/25 bg-brand-navy p-6 text-brand-white shadow-xl">
                <div className="text-lg font-semibold text-brand-white/90">You’re about to leave IntelliWatt to sign up</div>
                <div className="mt-2 text-sm text-brand-cyan/70">
                  We’ll open the provider enrollment flow in a new tab. Here’s what to expect:
                </div>
                <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-brand-cyan/80">
                  <li>You’ll complete enrollment details with the provider (address, contact info, etc.).</li>
                  <li>After enrollment, you may receive confirmation emails from the provider.</li>
                  <li>
                    Your comparison here assumes{" "}
                    <span className="font-semibold text-brand-white/90">
                      {includeEtf ? "switching now (ETF included)" : "switching after contract expiration (ETF excluded)"}
                    </span>
                    .
                  </li>
                </ul>
                <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
                  <button
                    type="button"
                    onClick={() => setShowConfirm(false)}
                    className="rounded-full border border-brand-cyan/25 bg-brand-white/5 px-5 py-3 text-sm font-semibold text-brand-cyan hover:bg-brand-white/10"
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


