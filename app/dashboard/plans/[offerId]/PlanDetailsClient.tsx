"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type ApiResp =
  | { ok: false; error: string }
  | {
      ok: true;
      offerId: string;
      plan: any;
      template: any | null;
      usage: any;
      variables: any;
      math: any | null;
      outputs: any;
      notes?: string[];
    };

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

function fmtKwh(n: any): string {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return "—";
  // Show whole kWh like the Usage page (no decimals shown).
  const whole = Number(v.toFixed(0));
  return `${whole.toLocaleString()} kWh`;
}

function fmtDollars(n: any): string {
  if (n == null) return "—";
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return "—";
  return `$${v.toFixed(2)}`;
}

export default function PlanDetailsClient({ offerId }: { offerId: string }) {
  const [data, setData] = useState<ApiResp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    async function run() {
      setLoading(true);
      setError(null);
      try {
        const r = await fetch(
          `/api/dashboard/plans/detail?offerId=${encodeURIComponent(offerId)}`,
          {
          signal: controller.signal,
          },
        );
        const j = (await r.json().catch(() => null)) as ApiResp | null;
        if (controller.signal.aborted) return;
        if (!r.ok || !j || !(j as any).ok) {
          setError((j as any)?.error ?? `Request failed (${r.status})`);
          setData(j);
          return;
        }
        setData(j);
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
  }, [offerId]);

  const ok = Boolean((data as any)?.ok);
  const plan = ok ? (data as any).plan : null;
  const template = ok ? (data as any).template : null;
  const usage = ok ? (data as any).usage : null;
  const outputs = ok ? (data as any).outputs : null;
  const math = ok ? (data as any).math : null;

  const requiredBucketKeys = useMemo(
    () => (Array.isArray(template?.requiredBucketKeys) ? (template.requiredBucketKeys as any[]).map(String) : []),
    [template],
  );
  const bucketDefs = useMemo(() => (usage?.bucketDefs ?? []) as Array<{ key: string; label: string }>, [usage]);
  const shownBucketDefs = useMemo(() => {
    if (!requiredBucketKeys.length) return bucketDefs;
    const wanted = new Set(requiredBucketKeys);
    return bucketDefs.filter((b) => wanted.has(String((b as any)?.key ?? "")));
  }, [bucketDefs, requiredBucketKeys]);
  const bucketTable = useMemo(() => (usage?.bucketTable ?? []) as any[], [usage]);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-16">
      <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="text-xs text-brand-cyan/70">
            <Link href="/dashboard/plans" className="text-brand-blue hover:underline">
              ← Back to Plans
            </Link>
          </div>
          <div className="mt-2 text-2xl font-semibold text-brand-white">
            {plan?.supplierName ?? "Plan"} — {plan?.planName ?? offerId}
          </div>
          <div className="mt-1 text-sm text-brand-cyan/70">
            OfferId: <span className="font-mono">{offerId}</span>
          </div>
        </div>

        {plan?.eflUrl ? (
          <Link href={plan.eflUrl} target="_blank" rel="noreferrer" className="text-sm font-semibold text-brand-blue hover:underline">
            View EFL
          </Link>
        ) : null}
      </div>

      {loading ? <div className="mt-8 text-brand-cyan/70">Loading…</div> : null}
      {error ? <div className="mt-8 text-rose-200">Error: {error}</div> : null}

      {ok ? (
        <>
          <div className="mt-6 text-xs text-brand-cyan/60">
            Buckets used by this plan:{" "}
            {requiredBucketKeys.length ? (
              <span className="font-mono text-brand-white/80">{requiredBucketKeys.join(", ")}</span>
            ) : (
              <span className="font-mono text-brand-white/80">—</span>
            )}
          </div>

          <div className="mt-8 grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="rounded-2xl border border-brand-cyan/20 bg-brand-navy p-4">
              <div className="text-[0.7rem] font-semibold uppercase tracking-[0.22em] text-brand-cyan/60">Usage snapshot</div>
              <div className="mt-3 text-sm text-brand-cyan/75">
                <div>
                  Total (last 365 days): <span className="font-semibold text-brand-white/90">{fmtKwh(usage?.annualKwh)}</span>
                </div>
                <div>
                  Avg monthly (total/12): <span className="font-semibold text-brand-white/90">{fmtKwh(usage?.avgMonthlyKwh)}</span> / mo
                </div>
                <div className="mt-2 text-xs text-brand-cyan/60">
                  Source: <span className="font-mono">{usage?.source ?? "—"}</span>{" "}
                  {usage?.windowEnd ? (
                    <>
                      · Window ends: <span className="font-mono">{String(usage.windowEnd).slice(0, 10)}</span>
                    </>
                  ) : null}
                </div>
                {usage?.cutoff ? (
                  <div className="mt-1 text-xs text-brand-cyan/60">
                    Cutoff (latest - 365d): <span className="font-mono">{String(usage.cutoff).slice(0, 10)}</span>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="rounded-2xl border border-brand-cyan/20 bg-brand-navy p-4">
              <div className="text-[0.7rem] font-semibold uppercase tracking-[0.22em] text-brand-cyan/60">Plan variables used</div>
              <div className="mt-3 space-y-2 text-sm text-brand-cyan/75">
                <div>
                  REP energy: <span className="font-semibold text-brand-white/90">{fmtNum((data as any).variables?.rep?.energyCentsPerKwh, 4)}¢/kWh</span>
                </div>
                <div>
                  REP fixed: <span className="font-semibold text-brand-white/90">{fmtDollars((data as any).variables?.rep?.fixedMonthlyChargeDollars)}</span>/mo
                </div>
                <div>
                  TDSP delivery:{" "}
                  <span className="font-semibold text-brand-white/90">{fmtNum((data as any).variables?.tdsp?.perKwhDeliveryChargeCents, 4)}¢/kWh</span>
                </div>
                <div>
                  TDSP customer: <span className="font-semibold text-brand-white/90">{fmtDollars((data as any).variables?.tdsp?.monthlyCustomerChargeDollars)}</span>/mo
                </div>
                {(data as any).variables?.tdsp?.effectiveDate ? (
                  <div className="text-xs text-brand-cyan/60">
                    TDSP effective: <span className="font-mono">{String((data as any).variables.tdsp.effectiveDate).slice(0, 10)}</span>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="rounded-2xl border border-brand-cyan/20 bg-brand-navy p-4">
              <div className="text-[0.7rem] font-semibold uppercase tracking-[0.22em] text-brand-cyan/60">Outputs</div>
              <div className="mt-3 space-y-2 text-sm text-brand-cyan/75">
                <div>
                  Est. monthly:{" "}
                  <span className="font-semibold text-brand-white/90">{fmtDollars(outputs?.trueCostEstimate?.monthlyCostDollars)}</span>
                </div>
                <div>
                  Est. annual:{" "}
                  <span className="font-semibold text-brand-white/90">{fmtDollars(outputs?.trueCostEstimate?.annualCostDollars)}</span>
                </div>
                <div>
                  Effective price:{" "}
                  <span className="font-semibold text-brand-white/90">{fmtNum(outputs?.effectiveCentsPerKwh, 4)}¢/kWh</span>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-8 rounded-2xl border border-brand-cyan/20 bg-brand-navy p-4">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <div className="text-[0.7rem] font-semibold uppercase tracking-[0.22em] text-brand-cyan/60">
                  Calculation attribution (kWh applied per variable)
                </div>
                <div className="mt-1 text-xs text-brand-cyan/60">
                  Shows the same engine components used for IntelliWatt ranking (REP + TDSP + credits/minimums when present).
                </div>
              </div>
              {template ? (
                <div className="text-xs text-brand-cyan/60">
                  Template: <span className="font-mono">{template.ratePlanId}</span> ({template.planCalcStatus})
                </div>
              ) : (
                <div className="text-xs text-brand-cyan/60">Template: —</div>
              )}
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="rounded-xl border border-brand-cyan/15 bg-brand-white/5 p-3">
                <div className="text-xs font-semibold text-brand-white/90">Status + totals</div>
                <div className="mt-2 text-xs text-brand-cyan/75">
                  <div>
                    Status:{" "}
                    <span className="font-mono text-brand-white/90">
                      {String(outputs?.trueCostEstimate?.status ?? math?.status ?? "—")}
                    </span>
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
                        <div>Minimum usage fee: {fmtDollars((math.componentsV2 as any).minimumUsageFeeDollars)}</div>
                      ) : null}
                      {"minimumBillTopUpDollars" in (math.componentsV2 ?? {}) ? (
                        <div>Minimum bill top-up: {fmtDollars((math.componentsV2 as any).minimumBillTopUpDollars)}</div>
                      ) : null}
                      <div className="mt-1">Total: {fmtDollars(math.componentsV2?.totalDollars)}</div>
                    </>
                  ) : math?.components ? (
                    <>
                      <div>Energy: {fmtDollars(math.components?.energyOnlyDollars)}</div>
                      <div>Delivery: {fmtDollars(math.components?.deliveryDollars)}</div>
                      <div>Base fees: {fmtDollars(math.components?.baseFeesDollars)}</div>
                      {"creditsDollars" in (math.components ?? {}) ? (
                        <div>Credits: {fmtDollars((math.components as any).creditsDollars)}</div>
                      ) : null}
                      <div className="mt-1">Total: {fmtDollars(math.components?.totalDollars)}</div>
                    </>
                  ) : (
                    <div className="text-brand-cyan/70">Math breakdown not available for this plan yet.</div>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="mt-8 rounded-2xl border border-brand-cyan/20 bg-brand-navy p-4">
            <div className="text-[0.7rem] font-semibold uppercase tracking-[0.22em] text-brand-cyan/60">
              Bucket totals (buckets required by this plan; months overlapping the last-365-days window)
            </div>
            <div className="mt-3 overflow-auto rounded-xl border border-brand-cyan/15">
              <table className="min-w-[900px] w-full text-xs">
                <thead className="bg-brand-white/5 text-brand-cyan/70">
                  <tr>
                    <th className="px-3 py-2 text-left">Year-Month</th>
                    {shownBucketDefs.map((b) => (
                      <th key={b.key} className="px-3 py-2 text-left whitespace-nowrap" title={b.key}>
                        {b.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="text-brand-cyan/80">
                  {bucketTable.map((r) => (
                    <tr key={r.yearMonth} className="border-t border-brand-cyan/10">
                      <td className="px-3 py-2 font-mono text-brand-white/90">{r.yearMonth}</td>
                      {shownBucketDefs.map((b) => (
                        <td key={b.key} className="px-3 py-2 whitespace-nowrap">
                          {r[b.key] == null ? "—" : fmtKwh0(r[b.key])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-2 text-xs text-brand-cyan/60">
              {Array.isArray((data as any).notes) ? (data as any).notes.join(" ") : null}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}


