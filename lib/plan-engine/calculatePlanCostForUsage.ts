export type TrueCostEstimate =
  | { status: "OK"; annualCostDollars: number; notes?: string[] }
  | { status: "MISSING_USAGE"; notes?: string[] }
  | { status: "MISSING_TEMPLATE"; notes?: string[] }
  | { status: "NOT_IMPLEMENTED"; notes?: string[] };

export function calculatePlanCostForUsage(args: {
  offerId: string;
  ratePlanId: string | null;
  tdspSlug: string | null;
  hasUsage: boolean;
  usageSummaryTotalKwh?: number | null;
  avgPriceCentsPerKwh1000?: number | null;
}): TrueCostEstimate {
  if (!args.hasUsage) return { status: "MISSING_USAGE", notes: ["No usage available"] };
  if (!args.ratePlanId) return { status: "MISSING_TEMPLATE", notes: ["Missing EFL template"] };

  const totalKwh = args.usageSummaryTotalKwh;
  if (typeof totalKwh !== "number" || !Number.isFinite(totalKwh) || totalKwh <= 0) {
    return { status: "MISSING_USAGE", notes: ["Usage total missing"] };
  }

  const avg = args.avgPriceCentsPerKwh1000;
  if (typeof avg !== "number" || !Number.isFinite(avg)) {
    return { status: "NOT_IMPLEMENTED", notes: ["Missing avg 1000 kWh EFL price"] };
  }

  const annualEnergyCostEstimateDollars = (totalKwh * avg) / 100;
  const annualCostDollars = Number(annualEnergyCostEstimateDollars.toFixed(2));
  return {
    status: "OK",
    annualCostDollars,
    notes: ["Proxy: avgPriceCentsPerKwh1000 * annual kWh"],
  };
}


