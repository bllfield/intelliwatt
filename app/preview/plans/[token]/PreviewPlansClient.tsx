"use client";

import { useMemo, useState } from "react";
import { PreviewPlanCard } from "./PreviewPlanCard";

type Plan = Parameters<typeof PreviewPlanCard>[0]["plan"];

function numOrInf(v: any): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
}

export default function PreviewPlansClient(props: { plans: Plan[] }) {
  const [basisKwh, setBasisKwh] = useState<500 | 1000 | 2000>(1000);

  const sorted = useMemo(() => {
    const key = (p: Plan) =>
      basisKwh === 500
        ? numOrInf(p.pricing.avgPriceCentsPerKwh500)
        : basisKwh === 2000
          ? numOrInf(p.pricing.avgPriceCentsPerKwh2000)
          : numOrInf(p.pricing.avgPriceCentsPerKwh1000);

    const out = props.plans.slice();
    out.sort((a, b) => {
      const ka = key(a);
      const kb = key(b);
      if (ka < kb) return -1;
      if (ka > kb) return 1;
      const sa = `${a.supplierName} ${a.planName}`.toLowerCase();
      const sb = `${b.supplierName} ${b.planName}`.toLowerCase();
      if (sa < sb) return -1;
      if (sa > sb) return 1;
      return 0;
    });
    return out;
  }, [basisKwh, props.plans]);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-16">
      <div className="pt-10">
        <div className="text-3xl font-semibold text-slate-900">Energy Plans</div>
        <div className="mt-2 text-sm text-slate-600">
          Example presentation of plan cards (static snapshot) with required disclosures.
        </div>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm text-slate-600">
            Sorted by lowest average price at{" "}
            <span className="font-semibold text-slate-900">{basisKwh} kWh</span>.
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <span className="font-medium">Usage basis</span>
            <select
              value={basisKwh}
              onChange={(e) => setBasisKwh(Number(e.target.value) as any)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
            >
              <option value={500}>500 kWh</option>
              <option value={1000}>1000 kWh</option>
              <option value={2000}>2000 kWh</option>
            </select>
          </label>
        </div>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2">
        {sorted.map((p, idx) => (
          <PreviewPlanCard key={`${p.supplierName}-${p.planName}-${idx}`} plan={p} basisKwh={basisKwh} />
        ))}
      </div>
    </div>
  );
}


