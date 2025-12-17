"use client";

import Link from "next/link";
import { useState } from "react";

type OfferRow = {
  offerId: string;
  supplierName?: string;
  planName?: string;
  termMonths?: number;
  rateType?: string;
  renewablePercent?: number;
  earlyTerminationFeeDollars?: number;
  baseMonthlyFeeDollars?: number;
  efl: {
    avgPriceCentsPerKwh500?: number;
    avgPriceCentsPerKwh1000?: number;
    avgPriceCentsPerKwh2000?: number;
    eflUrl?: string;
  };
  intelliwatt: {
    templateAvailable: boolean;
    ratePlanId?: string;
    statusLabel: "AVAILABLE" | "QUEUED" | "UNAVAILABLE";
    trueCostEstimate?:
      | {
          status: "OK";
          annualCostDollars: number;
          monthlyCostDollars: number;
          confidence?: "LOW" | "MEDIUM";
          componentsV2?: {
            rep?: {
              energyDollars?: number;
              fixedDollars?: number;
              creditsDollars?: number;
              totalDollars?: number;
            };
            tdsp?: {
              deliveryDollars?: number;
              fixedDollars?: number;
              totalDollars?: number;
            };
            totalDollars?: number;
          };
        }
      | { status: "MISSING_USAGE" }
      | { status: "MISSING_TEMPLATE" }
      | { status: "NOT_IMPLEMENTED" };
    tdspRatesApplied?:
      | {
          effectiveDate?: string;
          perKwhDeliveryChargeCents?: number;
          monthlyCustomerChargeDollars?: number;
        }
      | null;
  };
  utility?: { tdspSlug?: string; utilityName?: string };
};

function fmtCents(v: number | undefined): string {
  if (typeof v !== "number" || !Number.isFinite(v)) return "—";
  return `${v.toFixed(2)}¢`;
}

function fmtDollars2(v: number | undefined): string | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return v.toFixed(2);
}

function round2(v: number): number {
  // Match our “2 decimals” behavior used across the UI/engine scaffolding.
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

function fmtPerMoPerYr(annualDollars: number | undefined): string | null {
  if (typeof annualDollars !== "number" || !Number.isFinite(annualDollars)) return null;
  const mo = round2(annualDollars / 12);
  const yr = round2(annualDollars);
  return `$${mo.toFixed(2)}/mo ($${yr.toFixed(2)}/yr)`;
}

function badgeClasses(status: OfferRow["intelliwatt"]["statusLabel"]): string {
  if (status === "AVAILABLE") return "border-emerald-400/40 bg-emerald-500/10 text-emerald-200";
  if (status === "QUEUED") return "border-amber-400/40 bg-amber-500/10 text-amber-200";
  return "border-brand-cyan/20 bg-brand-white/5 text-brand-cyan/70";
}

export default function OfferCard({ offer }: { offer: OfferRow }) {
  const [estOpen, setEstOpen] = useState(false);
  const supplier = offer.supplierName ?? "Unknown supplier";
  const plan = offer.planName ?? "Unknown plan";
  const term = typeof offer.termMonths === "number" ? `${offer.termMonths} mo` : "Term —";
  const renewable =
    typeof offer.renewablePercent === "number" && Number.isFinite(offer.renewablePercent)
      ? `${Math.round(offer.renewablePercent)}% renewable`
      : null;
  const rateType = offer.rateType ? offer.rateType.toUpperCase() : null;

  const eflUrl = offer.efl?.eflUrl;
  const status = offer.intelliwatt.statusLabel;
  const statusText =
    status === "AVAILABLE" ? "AVAILABLE" : status === "QUEUED" ? "QUEUED" : "NOT AVAILABLE";

  const tce = offer.intelliwatt?.trueCostEstimate;
  const showEstimateLine = tce?.status === "OK";
  const estimateMonthly = showEstimateLine ? fmtDollars2((tce as any)?.monthlyCostDollars) : null;
  const tdspTag = offer.intelliwatt?.tdspRatesApplied ? "incl. TDSP" : null;
  const c2 = showEstimateLine ? (tce as any)?.componentsV2 : null;
  const repEnergy = fmtPerMoPerYr(c2?.rep?.energyDollars);
  const tdspDelivery = fmtPerMoPerYr(c2?.tdsp?.deliveryDollars);
  const tdspFixed = fmtPerMoPerYr(c2?.tdsp?.fixedDollars);
  const totalAnnual = fmtPerMoPerYr(c2?.totalDollars ?? (tce as any)?.annualCostDollars);
  const tdspEffective = offer.intelliwatt?.tdspRatesApplied?.effectiveDate ?? null;

  return (
    <div className="rounded-3xl border border-brand-cyan/25 bg-brand-navy p-5 shadow-[0_18px_40px_rgba(10,20,60,0.35)]">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-sm text-brand-cyan/70 truncate">{supplier}</div>
          <div className="mt-1 text-lg font-semibold text-brand-white truncate">{plan}</div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-brand-cyan/70">
            <span className="rounded-full border border-brand-cyan/20 bg-brand-white/5 px-2 py-1">{term}</span>
            {rateType ? (
              <span className="rounded-full border border-brand-cyan/20 bg-brand-white/5 px-2 py-1">
                {rateType}
              </span>
            ) : null}
            {renewable ? (
              <span className="rounded-full border border-brand-cyan/20 bg-brand-white/5 px-2 py-1">
                {renewable}
              </span>
            ) : null}
          </div>
        </div>

        <div className="flex flex-col items-end gap-2">
          <div
            className={`rounded-full border px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.22em] ${badgeClasses(
              status,
            )}`}
            title={offer.intelliwatt.ratePlanId ? `RatePlan: ${offer.intelliwatt.ratePlanId}` : undefined}
          >
            {statusText}
          </div>

          {eflUrl ? (
            <Link
              href={eflUrl}
              target="_blank"
              rel="noreferrer"
              className="text-xs font-semibold text-brand-blue hover:underline"
            >
              View EFL
            </Link>
          ) : (
            <div className="text-xs text-brand-cyan/60">No EFL link</div>
          )}
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-3">
        <div className="rounded-2xl border border-brand-cyan/20 bg-brand-white/5 p-3 text-center">
          <div className="text-[0.7rem] uppercase tracking-[0.25em] text-brand-cyan/60">500</div>
          <div className="mt-1 text-base font-semibold text-brand-white">
            {fmtCents(offer.efl?.avgPriceCentsPerKwh500)}
            <span className="text-xs font-medium text-brand-cyan/60">/kWh</span>
          </div>
        </div>
        <div className="rounded-2xl border border-brand-cyan/20 bg-brand-white/5 p-3 text-center">
          <div className="text-[0.7rem] uppercase tracking-[0.25em] text-brand-cyan/60">1000</div>
          <div className="mt-1 text-base font-semibold text-brand-white">
            {fmtCents(offer.efl?.avgPriceCentsPerKwh1000)}
            <span className="text-xs font-medium text-brand-cyan/60">/kWh</span>
          </div>
        </div>
        <div className="rounded-2xl border border-brand-cyan/20 bg-brand-white/5 p-3 text-center">
          <div className="text-[0.7rem] uppercase tracking-[0.25em] text-brand-cyan/60">2000</div>
          <div className="mt-1 text-base font-semibold text-brand-white">
            {fmtCents(offer.efl?.avgPriceCentsPerKwh2000)}
            <span className="text-xs font-medium text-brand-cyan/60">/kWh</span>
          </div>
        </div>
      </div>

      {showEstimateLine && estimateMonthly ? (
        <div className="mt-3 text-xs text-brand-cyan/70">
          <span
            className="relative inline-flex"
            onMouseEnter={() => setEstOpen(true)}
            onMouseLeave={() => setEstOpen(false)}
          >
            <button
              type="button"
              className="font-semibold text-brand-white/90 hover:underline underline-offset-2"
              aria-haspopup="dialog"
              aria-expanded={estOpen}
              onClick={() => setEstOpen((v) => !v)}
              onBlur={() => setEstOpen(false)}
            >
              Est. ${estimateMonthly}/mo
              {tdspTag ? <span className="text-brand-cyan/60"> · {tdspTag}</span> : null}
            </button>

            {estOpen ? (
              <div className="absolute left-0 top-full mt-2 w-[260px] rounded-2xl border border-brand-cyan/25 bg-brand-navy/95 p-3 shadow-[0_18px_40px_rgba(0,0,0,0.35)] backdrop-blur">
                <div className="text-[0.65rem] uppercase tracking-[0.22em] text-brand-cyan/60">Estimate breakdown</div>
                <div className="mt-2 space-y-1 text-xs text-brand-cyan/75">
                  {repEnergy ? (
                    <div className="flex items-center justify-between gap-3">
                      <span>Plan (REP)</span>
                      <span className="font-mono text-brand-white/90">{repEnergy}</span>
                    </div>
                  ) : null}
                  {tdspDelivery ? (
                    <div className="flex items-center justify-between gap-3">
                      <span>TDSP delivery</span>
                      <span className="font-mono text-brand-white/90">{tdspDelivery}</span>
                    </div>
                  ) : null}
                  {tdspFixed ? (
                    <div className="flex items-center justify-between gap-3">
                      <span>TDSP fixed</span>
                      <span className="font-mono text-brand-white/90">{tdspFixed}</span>
                    </div>
                  ) : null}
                  {totalAnnual ? (
                    <div className="mt-1 flex items-center justify-between gap-3 border-t border-brand-cyan/15 pt-2">
                      <span className="text-brand-cyan/80">Total</span>
                      <span className="font-mono font-semibold text-brand-white">{totalAnnual}</span>
                    </div>
                  ) : null}
                  {tdspEffective ? (
                    <div className="mt-2 text-[0.7rem] text-brand-cyan/60">
                      Effective: <span className="font-mono">{tdspEffective}</span>
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
          </span>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-brand-cyan/65">
        <div className="truncate">
          {offer.utility?.utilityName ? (
            <span className="truncate">{offer.utility.utilityName}</span>
          ) : offer.utility?.tdspSlug ? (
            <span className="uppercase">{offer.utility.tdspSlug}</span>
          ) : (
            <span>Utility —</span>
          )}
        </div>
        <div className="text-brand-cyan/55">
          EFL averages shown at 500/1000/2000 kWh. IntelliWatt ranking is a preview.
        </div>
      </div>
    </div>
  );
}


