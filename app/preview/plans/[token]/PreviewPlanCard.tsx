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
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="text-sm text-slate-600 truncate">{plan.supplierName}</div>
          <div className="mt-1 text-lg font-semibold text-slate-900 truncate">{plan.planName}</div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-600">
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1">{term}</span>
            {plan.rateType ? (
              <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1">
                {String(plan.rateType).toUpperCase()}
              </span>
            ) : null}
            {renewable ? (
              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-emerald-700">
                {renewable}
              </span>
            ) : null}
          </div>
        </div>

        <div className="flex flex-col items-start gap-2 sm:items-end">
          <div className="text-xs text-slate-600">Avg price @ {basisKwh} kWh</div>
          <div className="text-2xl font-semibold text-slate-900">{fmtCents(basisRate)}</div>
          <div className="flex flex-wrap items-center gap-3 text-xs">
            {plan.documents.eflUrl ? (
              <a className="font-semibold text-blue-700 hover:underline" href={plan.documents.eflUrl} target="_blank" rel="noreferrer">
                View EFL
              </a>
            ) : (
              <span className="text-slate-500">No EFL</span>
            )}
            {plan.documents.tosUrl ? (
              <a className="font-semibold text-blue-700 hover:underline" href={plan.documents.tosUrl} target="_blank" rel="noreferrer">
                Terms
              </a>
            ) : null}
            {plan.documents.yracUrl ? (
              <a className="font-semibold text-blue-700 hover:underline" href={plan.documents.yracUrl} target="_blank" rel="noreferrer">
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
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-center">
          <div className="text-[0.7rem] uppercase tracking-wide text-slate-500">500</div>
          <div className="mt-1 text-sm font-semibold text-slate-900">{fmtCents(plan.pricing.avgPriceCentsPerKwh500)}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-center">
          <div className="text-[0.7rem] uppercase tracking-wide text-slate-500">1000</div>
          <div className="mt-1 text-sm font-semibold text-slate-900">{fmtCents(plan.pricing.avgPriceCentsPerKwh1000)}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-center">
          <div className="text-[0.7rem] uppercase tracking-wide text-slate-500">2000</div>
          <div className="mt-1 text-sm font-semibold text-slate-900">{fmtCents(plan.pricing.avgPriceCentsPerKwh2000)}</div>
        </div>
      </div>

      <div className="mt-3 text-xs text-slate-500">
        EFL average prices shown at 500/1000/2000 kWh.
        {plan.tdspName ? <> · TDSP: <span className="font-medium text-slate-600">{plan.tdspName}</span></> : null}
      </div>
    </div>
  );
}


