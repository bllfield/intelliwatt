"use client";

import { PlanDisclosuresPopover } from "@/app/components/ui/PlanDisclosuresPopover";

type Plan = {
  supplierName: string;
  planName: string;
  termMonths: number | null;
  rateType: string | null;
  renewablePercent: number | null;
  tdspName: string | null;
  pricing: {
    avgPriceCentsPerKwh500: number | null;
    avgPriceCentsPerKwh1000: number | null;
    avgPriceCentsPerKwh2000: number | null;
  };
  documents: {
    eflUrl: string | null;
    tosUrl: string | null;
    yracUrl: string | null;
  };
  disclosures: {
    supplierPuctRegistration: string | null;
    supplierContactEmail: string | null;
    supplierContactPhone: string | null;
    cancellationFeeText: string | null;
  };
};

function fmtCents(v: number | null | undefined): string {
  if (typeof v !== "number" || !Number.isFinite(v)) return "—";
  return `${v.toFixed(2)}¢/kWh`;
}

function fmtPct(v: number | null | undefined): string | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return `${Math.round(v)}% renewable`;
}

export function PreviewPlanCard(props: { plan: Plan; basisKwh: 500 | 1000 | 2000 }) {
  const { plan, basisKwh } = props;
  const term = typeof plan.termMonths === "number" ? `${plan.termMonths} months` : "—";
  const renewable = fmtPct(plan.renewablePercent);
  const basisRate =
    basisKwh === 500
      ? plan.pricing.avgPriceCentsPerKwh500
      : basisKwh === 2000
        ? plan.pricing.avgPriceCentsPerKwh2000
        : plan.pricing.avgPriceCentsPerKwh1000;

  return (
    <div className="rounded-3xl border border-brand-cyan/25 bg-brand-navy p-5 shadow-[0_18px_40px_rgba(10,20,60,0.35)]">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="text-sm text-brand-cyan/70 truncate">{plan.supplierName}</div>
          <div className="mt-1 text-lg font-semibold text-brand-white truncate">{plan.planName}</div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-brand-cyan/70">
            <span className="rounded-full border border-brand-cyan/20 bg-brand-white/5 px-2 py-1">{term}</span>
            {plan.rateType ? (
              <span className="rounded-full border border-brand-cyan/20 bg-brand-white/5 px-2 py-1">
                {String(plan.rateType).toUpperCase()}
              </span>
            ) : null}
            {renewable ? (
              <span className="rounded-full border border-brand-cyan/20 bg-brand-white/5 px-2 py-1">{renewable}</span>
            ) : null}
          </div>
        </div>

        <div className="flex flex-col items-start gap-2 sm:items-end">
          <div className="text-xs text-brand-cyan/70">Avg price @ {basisKwh} kWh</div>
          <div className="text-2xl font-semibold text-brand-white">{fmtCents(basisRate)}</div>
          <div className="flex flex-wrap items-center gap-3 text-xs">
            {plan.documents.eflUrl ? (
              <a className="font-semibold text-brand-blue hover:underline" href={plan.documents.eflUrl} target="_blank" rel="noreferrer">
                View EFL
              </a>
            ) : (
              <span className="text-brand-cyan/60">No EFL</span>
            )}
            {plan.documents.tosUrl ? (
              <a className="font-semibold text-brand-blue hover:underline" href={plan.documents.tosUrl} target="_blank" rel="noreferrer">
                Terms
              </a>
            ) : null}
            {plan.documents.yracUrl ? (
              <a className="font-semibold text-brand-blue hover:underline" href={plan.documents.yracUrl} target="_blank" rel="noreferrer">
                YRAC
              </a>
            ) : null}
            <PlanDisclosuresPopover
              trigger="Disclosures"
              supplierName={plan.supplierName}
              planName={plan.planName}
              distributorName={plan.tdspName}
              eflUrl={plan.documents.eflUrl}
              disclosures={{
                supplierPuctRegistration: plan.disclosures.supplierPuctRegistration,
                supplierContactEmail: plan.disclosures.supplierContactEmail,
                supplierContactPhone: plan.disclosures.supplierContactPhone,
                cancellationFeeText: plan.disclosures.cancellationFeeText,
                tosUrl: plan.documents.tosUrl,
                yracUrl: plan.documents.yracUrl,
              }}
            />
          </div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3">
        <div className="rounded-2xl border border-brand-cyan/20 bg-brand-white/5 p-3 text-center">
          <div className="text-[0.7rem] uppercase tracking-[0.25em] text-brand-cyan/60">500</div>
          <div className="mt-1 text-base font-semibold text-brand-white">{fmtCents(plan.pricing.avgPriceCentsPerKwh500)}</div>
        </div>
        <div className="rounded-2xl border border-brand-cyan/20 bg-brand-white/5 p-3 text-center">
          <div className="text-[0.7rem] uppercase tracking-[0.25em] text-brand-cyan/60">1000</div>
          <div className="mt-1 text-base font-semibold text-brand-white">{fmtCents(plan.pricing.avgPriceCentsPerKwh1000)}</div>
        </div>
        <div className="rounded-2xl border border-brand-cyan/20 bg-brand-white/5 p-3 text-center">
          <div className="text-[0.7rem] uppercase tracking-[0.25em] text-brand-cyan/60">2000</div>
          <div className="mt-1 text-base font-semibold text-brand-white">{fmtCents(plan.pricing.avgPriceCentsPerKwh2000)}</div>
        </div>
      </div>

      <div className="mt-3 text-xs text-brand-cyan/55">
        EFL average prices shown at 500/1000/2000 kWh.
        {plan.tdspName ? <> · TDSP: <span className="font-medium text-brand-cyan/70">{plan.tdspName}</span></> : null}
      </div>
    </div>
  );
}


