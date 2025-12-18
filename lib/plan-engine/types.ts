export type IntervalUsageRow = { ts: Date; kwh: number };

export type TdspRatesInput = {
  perKwhDeliveryChargeCents: number;
  monthlyCustomerChargeDollars: number;
};

export type RatePlanTemplateInput = {
  // Stored `RatePlan.rateStructure` (JSON) from master DB
  rateStructure: unknown;
  // Optional `RatePlan.planRules` (may not exist in schema in some envs)
  planRules?: unknown | null;
};

export type IntervalTrueCostResult =
  | {
      status: "OK";
      annualCostDollars: number;
      repEnergyDollars: number;
      tdspDeliveryDollars: number;
      tdspFixedDollars: number;
      totalDollars: number; // alias of annualCostDollars
      intervalRowsPriced: number;
      kwhPriced: number;
      notes: string[];
    }
  | { status: "NOT_IMPLEMENTED"; reason: string; notes?: string[] }
  | { status: "ERROR"; reason: string };


