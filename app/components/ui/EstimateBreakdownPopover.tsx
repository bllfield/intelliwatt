"use client";

import React, { useState } from "react";

type Props = {
  trigger: React.ReactNode; // the inline "Est. $X/mo · incl. TDSP" element
  repAnnualDollars: number;
  tdspDeliveryAnnualDollars?: number;
  tdspFixedAnnualDollars?: number;
  totalAnnualDollars: number;
  effectiveDate?: string; // ISO
};

function round2(v: number): number {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

function fmtPerMoPerYr(annualDollars: number | undefined): string | null {
  if (typeof annualDollars !== "number" || !Number.isFinite(annualDollars)) return null;
  const mo = round2(annualDollars / 12);
  const yr = round2(annualDollars);
  return `$${mo.toFixed(2)}/mo ($${yr.toFixed(2)}/yr)`;
}

function fmtIsoDate(iso: string | undefined): string | null {
  if (!iso) return null;
  const s = String(iso).trim();
  if (!s) return null;
  // Best-effort YYYY-MM-DD (don’t throw if server sends a non-ISO string)
  if (s.length >= 10) return s.slice(0, 10);
  return s;
}

export function EstimateBreakdownPopover(props: Props) {
  const [open, setOpen] = useState(false);

  const rep = fmtPerMoPerYr(props.repAnnualDollars);
  const tdspDelivery = fmtPerMoPerYr(props.tdspDeliveryAnnualDollars);
  const tdspFixed = fmtPerMoPerYr(props.tdspFixedAnnualDollars);
  const total = fmtPerMoPerYr(props.totalAnnualDollars);
  const effective = fmtIsoDate(props.effectiveDate);

  return (
    <span className="relative inline-flex" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        className="font-semibold text-brand-white/90 hover:underline underline-offset-2"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        onBlur={() => setOpen(false)}
      >
        {props.trigger}
      </button>

      {open ? (
        <div className="absolute left-0 top-full z-50 mt-2 w-[260px] rounded-2xl border border-brand-cyan/25 bg-brand-navy/95 p-3 shadow-[0_18px_40px_rgba(0,0,0,0.35)] backdrop-blur">
          <div className="text-[0.65rem] uppercase tracking-[0.22em] text-brand-cyan/60">Estimate breakdown</div>
          <div className="mt-2 space-y-1 text-xs text-brand-cyan/75">
            {rep ? (
              <div className="flex items-center justify-between gap-3">
                <span>Plan (REP)</span>
                <span className="font-mono text-brand-white/90">{rep}</span>
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
            {total ? (
              <div className="mt-1 flex items-center justify-between gap-3 border-t border-brand-cyan/15 pt-2">
                <span className="text-brand-cyan/80">Total</span>
                <span className="font-mono font-semibold text-brand-white">{total}</span>
              </div>
            ) : null}
            {effective ? (
              <div className="mt-2 text-[0.7rem] text-brand-cyan/60">
                Effective: <span className="font-mono">{effective}</span>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </span>
  );
}


