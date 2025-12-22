import { calculatePlanCostForUsage } from "@/lib/plan-engine/calculatePlanCostForUsage";

function round2(n: number): number {
  if (!Number.isFinite(n)) return n;
  return Math.round(n * 100) / 100;
}

/**
 * Canonical server-side wrapper for producing the "true cost" estimate object that
 * all UIs should display (cards, sorting, detail page).
 *
 * Goal: one place to call the plan engine and produce a stable payload.
 */
export function estimateTrueCost(args: {
  annualKwh: number;
  monthsCount: number;
  rateStructure: any;
  usageBucketsByMonth?: Record<string, Record<string, number>>;
  tdspRates: {
    perKwhDeliveryChargeCents: number;
    monthlyCustomerChargeDollars: number;
    effectiveDate?: string | null;
  };
}): any {
  const est = calculatePlanCostForUsage({
    annualKwh: args.annualKwh,
    monthsCount: args.monthsCount,
    tdsp: {
      perKwhDeliveryChargeCents: Number(args.tdspRates?.perKwhDeliveryChargeCents ?? 0) || 0,
      monthlyCustomerChargeDollars: Number(args.tdspRates?.monthlyCustomerChargeDollars ?? 0) || 0,
      effectiveDate: args.tdspRates?.effectiveDate ?? undefined,
    },
    rateStructure: args.rateStructure,
    usageBucketsByMonth: args.usageBucketsByMonth,
  });

  // Sanity: ensure TDSP fixed fee is reflected in the output payload when provided.
  // This keeps list cards and detail page aligned even if upstream changes cause tdsp.fixedDollars
  // to be omitted in a particular call path.
  try {
    if (!est || est.status !== "OK") return est;
    const tdspMonthly =
      typeof args.tdspRates?.monthlyCustomerChargeDollars === "number" && Number.isFinite(args.tdspRates.monthlyCustomerChargeDollars)
        ? (args.tdspRates.monthlyCustomerChargeDollars as number)
        : null;
    if (tdspMonthly == null || tdspMonthly <= 0) return est;

    const mc = Math.max(1, Math.floor(args.monthsCount || 12));
    const c2 = (est as any)?.componentsV2 ?? null;
    const tdspFixedHas = typeof c2?.tdsp?.fixedDollars === "number" && Number.isFinite(c2.tdsp.fixedDollars) ? (c2.tdsp.fixedDollars as number) : 0;
    const tdspFixedShould = round2(tdspMonthly * mc);
    const delta = round2(tdspFixedShould - tdspFixedHas);
    if (Math.abs(delta) < 0.01) return est;

    const annualHas = typeof (est as any)?.annualCostDollars === "number" && Number.isFinite((est as any).annualCostDollars)
      ? ((est as any).annualCostDollars as number)
      : null;
    if (annualHas == null) return est;

    const annualNext = round2(annualHas + delta);
    const monthlyNext = round2(annualNext / mc);

    const tdspDeliveryHas =
      typeof c2?.tdsp?.deliveryDollars === "number" && Number.isFinite(c2.tdsp.deliveryDollars)
        ? (c2.tdsp.deliveryDollars as number)
        : null;

    const next = { ...(est as any) };
    next.annualCostDollars = annualNext;
    next.monthlyCostDollars = monthlyNext;

    if (c2 && c2.tdsp) {
      next.componentsV2 = {
        ...(c2 as any),
        tdsp: {
          ...(c2.tdsp as any),
          fixedDollars: tdspFixedShould,
          totalDollars:
            tdspDeliveryHas != null ? round2(tdspDeliveryHas + tdspFixedShould) : round2((c2.tdsp.totalDollars ?? 0) + delta),
        },
        totalDollars: annualNext,
      };
    }

    if ((est as any)?.components && typeof (est as any).components === "object") {
      const c1 = (est as any).components;
      const baseFeesHas =
        typeof c1?.baseFeesDollars === "number" && Number.isFinite(c1.baseFeesDollars) ? (c1.baseFeesDollars as number) : null;
      next.components = {
        ...(c1 as any),
        ...(baseFeesHas != null ? { baseFeesDollars: round2(baseFeesHas + delta) } : {}),
        totalDollars: annualNext,
      };
    }

    next.notes = Array.isArray((est as any)?.notes)
      ? Array.from(new Set([...(est as any).notes, "tdsp_fixed_sanity_applied"]))
      : ["tdsp_fixed_sanity_applied"];

    return next;
  } catch {
    return est;
  }
}


