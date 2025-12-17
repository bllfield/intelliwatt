export type TrueCostEstimate =
  | {
      status: "OK";
      annualCostDollars: number;
      monthlyCostDollars: number;
      confidence: "LOW" | "MEDIUM";
      components: {
        energyOnlyDollars: number;
        deliveryDollars?: number;
        baseFeesDollars?: number;
        totalDollars: number;
      };
      componentsV2: {
        rep: {
          energyDollars: number;
          fixedDollars?: number;
          creditsDollars?: number;
          totalDollars: number;
        };
        tdsp?: {
          deliveryDollars: number;
          fixedDollars: number;
          totalDollars: number;
        };
        totalDollars: number;
      };
      notes?: string[];
    }
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
  tdspRates?: {
    tdspSlug: string;
    effectiveDate: string; // ISO
    perKwhDeliveryChargeCents: number;
    monthlyCustomerChargeDollars: number;
  } | null;
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

  const repEnergyDollars = Number(((totalKwh * avg) / 100).toFixed(2));

  const tdsp = args.tdspRates ?? null;
  const tdspDeliveryDollars =
    tdsp && typeof tdsp.perKwhDeliveryChargeCents === "number" && Number.isFinite(tdsp.perKwhDeliveryChargeCents)
      ? Number(((totalKwh * tdsp.perKwhDeliveryChargeCents) / 100).toFixed(2))
      : 0;
  const tdspFixedDollars =
    tdsp && typeof tdsp.monthlyCustomerChargeDollars === "number" && Number.isFinite(tdsp.monthlyCustomerChargeDollars)
      ? Number((tdsp.monthlyCustomerChargeDollars * 12).toFixed(2))
      : 0;
  const tdspTotalDollars = Number((tdspDeliveryDollars + tdspFixedDollars).toFixed(2));

  const totalDollars = Number((repEnergyDollars + tdspTotalDollars).toFixed(2));
  const annualCostDollars = totalDollars;
  const monthlyCostDollars = Number((annualCostDollars / 12).toFixed(2));
  return {
    status: "OK",
    annualCostDollars,
    monthlyCostDollars,
    confidence: "MEDIUM",
    components: {
      energyOnlyDollars: repEnergyDollars,
      ...(tdsp ? { deliveryDollars: tdspDeliveryDollars, baseFeesDollars: tdspFixedDollars } : {}),
      totalDollars: annualCostDollars,
    },
    componentsV2: {
      rep: {
        energyDollars: repEnergyDollars,
        totalDollars: repEnergyDollars,
      },
      ...(tdsp
        ? {
            tdsp: {
              deliveryDollars: tdspDeliveryDollars,
              fixedDollars: tdspFixedDollars,
              totalDollars: tdspTotalDollars,
            },
          }
        : {}),
      totalDollars: annualCostDollars,
    },
    notes: [
      "Proxy: avgPriceCentsPerKwh1000 * annual kWh",
      ...(tdsp ? ["Includes TDSP delivery"] : []),
    ],
  };
}


