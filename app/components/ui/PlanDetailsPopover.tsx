"use client";

import React, { useMemo, useState } from "react";

type Props = {
  trigger: React.ReactNode;
  title?: string;
  // Backward-compatible: older callers passed `data`; new callers pass `offer`.
  offer?: any;
  data?: any;
};

export function PlanDetailsPopover(props: Props) {
  const [open, setOpen] = useState(false);

  const fields = useMemo(() => {
    const o = props.offer ?? props.data ?? {};
    const iw = o?.intelliwatt ?? {};
    const tce = iw?.trueCostEstimate ?? null;
    const tdsp = iw?.tdspRatesApplied ?? iw?.planCalcInputs?.tdsp ?? null;
    const inputs = iw?.planCalcInputs ?? null;

    const rows: Array<{ section: string; label: string; value: string }> = [];
    const push = (section: string, label: string, value: any) => {
      if (value == null) return;
      const s = typeof value === "string" ? value : typeof value === "number" ? String(value) : String(value);
      const v = s.trim();
      if (!v) return;
      rows.push({ section, label, value: v });
    };

    // Identity
    push("Plan", "Supplier", o?.supplierName);
    push("Plan", "Plan name", o?.planName);
    push("Plan", "Term months", typeof o?.termMonths === "number" ? `${o.termMonths}` : null);
    push("Plan", "Rate type", o?.rateType);
    push(
      "Plan",
      "Renewable %",
      typeof o?.renewablePercent === "number" ? `${Math.round(o.renewablePercent)}%` : null,
    );

    // Template / engine status
    push("IntelliWatt", "Status", iw?.statusLabel);
    push("IntelliWatt", "RatePlanId", iw?.ratePlanId);
    push("IntelliWatt", "Computability", iw?.planComputability?.status);
    push("IntelliWatt", "Reason", iw?.planComputability?.reasonCode ?? iw?.planComputability?.reason);
    push(
      "IntelliWatt",
      "Required buckets",
      Array.isArray(iw?.planComputability?.requiredBucketKeys) ? iw.planComputability.requiredBucketKeys.join(", ") : null,
    );

    // Usage inputs
    push(
      "Usage",
      "Historic usage (kWh/mo)",
      typeof iw?.usageKwhPerMonth === "number" ? `${Math.round(iw.usageKwhPerMonth)} kWh/mo` : null,
    );
    push(
      "Usage",
      "Annual kWh (calc input)",
      typeof inputs?.annualKwh === "number" ? `${Math.round(inputs.annualKwh)} kWh/yr` : null,
    );

    // TDSP inputs
    push(
      "TDSP",
      "Delivery (¢/kWh)",
      typeof tdsp?.perKwhDeliveryChargeCents === "number" ? `${tdsp.perKwhDeliveryChargeCents}` : null,
    );
    push(
      "TDSP",
      "Monthly customer charge ($/mo)",
      typeof tdsp?.monthlyCustomerChargeDollars === "number" ? `${tdsp.monthlyCustomerChargeDollars}` : null,
    );
    push("TDSP", "Effective date", tdsp?.effectiveDate);

    // REP / plan template inputs (v1 fixed-rate extractor)
    push(
      "REP",
      "Energy rate (¢/kWh)",
      typeof inputs?.rep?.energyCentsPerKwh === "number" ? `${inputs.rep.energyCentsPerKwh}` : null,
    );
    push(
      "REP",
      "Fixed monthly charge ($/mo)",
      typeof inputs?.rep?.fixedMonthlyChargeDollars === "number" ? `${inputs.rep.fixedMonthlyChargeDollars}` : null,
    );

    // Outputs
    push("Outputs", "Estimate status", tce?.status);
    push(
      "Outputs",
      "Est. monthly cost ($/mo)",
      tce?.status === "OK" && typeof tce?.monthlyCostDollars === "number" ? `${tce.monthlyCostDollars}` : null,
    );
    push(
      "Outputs",
      "Est. annual cost ($/yr)",
      tce?.status === "OK" && typeof tce?.annualCostDollars === "number" ? `${tce.annualCostDollars}` : null,
    );
    push(
      "Outputs",
      "Effective price (¢/kWh)",
      tce?.status === "OK" && typeof tce?.effectiveCentsPerKwh === "number" ? `${tce.effectiveCentsPerKwh}` : null,
    );

    return rows;
  }, [props.offer]);

  const sections = useMemo(() => {
    const map = new Map<string, Array<{ label: string; value: string }>>();
    for (const f of fields) {
      if (!map.has(f.section)) map.set(f.section, []);
      map.get(f.section)!.push({ label: f.label, value: f.value });
    }
    return Array.from(map.entries());
  }, [fields]);

  return (
    <span className="relative inline-flex" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        className="text-xs font-semibold text-brand-blue hover:underline underline-offset-2"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        onBlur={() => setOpen(false)}
      >
        {props.trigger}
      </button>

      {open ? (
        <div className="absolute right-0 top-full z-50 mt-2 w-[420px] max-w-[90vw] rounded-2xl border border-brand-cyan/25 bg-brand-navy/95 p-3 shadow-[0_18px_40px_rgba(0,0,0,0.35)] backdrop-blur">
          <div className="flex items-start justify-between gap-3">
            <div className="text-[0.65rem] font-semibold uppercase tracking-[0.22em] text-brand-cyan/60">
              {props.title ?? "Plan Details"}
            </div>
          </div>

          <div className="mt-3 max-h-[420px] overflow-auto rounded-xl border border-brand-cyan/15 bg-brand-navy px-3 py-2">
            {sections.length === 0 ? (
              <div className="text-xs text-brand-cyan/70">No details available.</div>
            ) : (
              <div className="flex flex-col gap-4">
                {sections.map(([section, rows]) => (
                  <div key={section}>
                    <div className="text-[0.65rem] font-semibold uppercase tracking-[0.22em] text-brand-cyan/60">
                      {section}
                    </div>
                    <div className="mt-2 grid grid-cols-1 gap-2">
                      {rows.map((r) => (
                        <label key={`${section}-${r.label}`} className="grid grid-cols-2 gap-2 items-center">
                          <span className="text-[0.7rem] text-brand-cyan/65">{r.label}</span>
                          <input
                            readOnly
                            value={r.value}
                            className="w-full rounded-lg border border-brand-cyan/20 bg-brand-white/5 px-2 py-1 text-[0.7rem] text-brand-white/90 outline-none"
                          />
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </span>
  );
}


