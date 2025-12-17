export type TrueCostStatus =
  | { status: "MISSING_USAGE"; reason: string }
  | { status: "MISSING_TEMPLATE"; reason: string }
  | { status: "NOT_IMPLEMENTED"; reason: string };

export function getTrueCostStatus(args: {
  hasUsage: boolean;
  ratePlanId: string | null;
}): TrueCostStatus {
  if (!args.hasUsage) {
    return { status: "MISSING_USAGE", reason: "No usage available for last 12 months" };
  }
  if (!args.ratePlanId) {
    return { status: "MISSING_TEMPLATE", reason: "Missing EFL template for this offer" };
  }
  return { status: "NOT_IMPLEMENTED", reason: "True-cost engine not wired yet" };
}


