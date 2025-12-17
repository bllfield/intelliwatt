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
}): TrueCostEstimate {
  if (!args.hasUsage) return { status: "MISSING_USAGE", notes: ["No usage available"] };
  if (!args.ratePlanId) return { status: "MISSING_TEMPLATE", notes: ["Missing EFL template"] };
  return { status: "NOT_IMPLEMENTED", notes: ["Calculator not wired yet"] };
}


