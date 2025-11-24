/**
 * Plan Cost Engine
 *
 * Core entry point for computing the cost of a single plan over a given
 * interval usage series, using PlanRules from the EFL Fact Card Engine as the
 * source of pricing truth.
 *
 * Intentionally pure and side-effect free:
 *  - No DB access
 *  - No HTTP calls
 *  - No WattBuy/SMT-specific types
 */

import type {
  PlanCostEngineInput,
  PlanCostResult,
} from "@/lib/planAnalyzer/planTypes";

/**
 * Compute the total cost of a single plan over a given usage profile.
 *
 * High-level algorithm (to be implemented later):
 *  1. For each IntervalUsagePoint:
 *     - Determine the applicable pricing band via PlanRules.
 *     - Compute per-interval charges (import/export).
 *     - Collect a PlanIntervalCost row.
 *
 *  2. Group intervals by local day/month using the provided timezone:
 *     - Sum kWh and dollar amounts.
 *     - Apply base charges and bill credits from PlanRules.
 *
 *  3. Return a PlanCostResult (interval detail, daily/monthly rollups, totals).
 */
export function computePlanCost(input: PlanCostEngineInput): PlanCostResult {
  void input;
  throw new Error(
    "computePlanCost is not implemented yet. Implement in a dedicated follow-up step.",
  );
}

