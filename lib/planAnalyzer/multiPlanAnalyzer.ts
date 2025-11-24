/**
 * Multi-Plan Analyzer
 *
 * Compares a set of candidate plans over the same usage series by invoking the
 * per-plan cost engine and sorting by total cost.
 */

import type {
  PlanComparisonInput,
  PlanComparisonResult,
  PlanCostResult,
} from "@/lib/planAnalyzer/planTypes";
import { computePlanCost } from "@/lib/planAnalyzer/planCostEngine";

/**
 * Compare multiple plans against a shared usage profile.
 *
 * NOTE: Until computePlanCost is implemented, this function will propagate the
 * "not implemented" error thrown by that stub.
 */
export function comparePlans(
  input: PlanComparisonInput,
): PlanComparisonResult {
  const { plans, usage, tz } = input;

  const costResults: PlanCostResult[] = plans.map((planWithRules) =>
    computePlanCost({
      plan: planWithRules,
      usage,
      tz,
    }),
  );

  const sortedPlanIds = [...costResults]
    .sort((a, b) => a.totalCostDollars - b.totalCostDollars)
    .map((result) => result.plan.id);

  return {
    plans: costResults,
    sortedPlanIds,
  };
}

