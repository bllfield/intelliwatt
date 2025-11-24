/**
 * Plan Analyzer Engine — Core Types
 *
 * Canonical CDM for:
 *  - Usage inputs (15-minute interval kWh import/export series)
 *  - Per-interval pricing / charges for a given plan
 *  - Daily and monthly billing summaries
 *  - Overall per-plan cost results
 *  - Rate plan references (kept decoupled from Prisma/WattBuy specifics)
 *
 * All higher-level modules (plan cost engine, multi-plan analyzer, HTTP routes,
 * UI) should depend on these types rather than re-declaring their own variants.
 */

import type { PlanRules } from "@/lib/efl/planEngine";

/**
 * One usage point (typically 15 minutes) of import/export energy.
 * Timestamps MUST be ISO 8601 strings with timezone.
 */
export interface IntervalUsagePoint {
  timestamp: string;
  kwhImport: number;
  kwhExport: number;
}

/**
 * Detailed pricing + charges for a single interval for a specific plan.
 * This is derived from PlanRules via the plan cost engine.
 */
export interface PlanIntervalCost {
  timestamp: string;
  kwhImport: number;
  kwhExport: number;

  importRateCentsPerKwh: number | null;
  exportCreditCentsPerKwh: number | null;

  importChargeDollars: number;
  exportCreditDollars: number;

  periodLabel: string | null;
  isFree: boolean;
}

/**
 * Daily cost rollup for a given plan.
 * All values are already in dollars for display & comparison.
 */
export interface PlanDailyCostSummary {
  date: string;
  totalImportKwh: number;
  totalExportKwh: number;
  energyChargesDollars: number;
  baseChargeDollars: number;
  billCreditsDollars: number;
  totalCostDollars: number;
}

/**
 * Monthly cost rollup for a given plan.
 * Includes TDSP delivery as a separate field for plans where that matters.
 */
export interface PlanMonthlyCostSummary {
  month: string;
  totalImportKwh: number;
  totalExportKwh: number;
  energyChargesDollars: number;
  baseChargeDollars: number;
  billCreditsDollars: number;
  tdspDeliveryDollars: number;
  totalCostDollars: number;
}

/**
 * Minimal reference to a rate plan for the analyzer stack.
 *
 * Decoupled from Prisma/WattBuy. Adapter layers can map concrete models into
 * this interface for use by the cost engine.
 */
export interface RatePlanRef {
  id: string;
  displayName: string;
  source: string;
  tdspCode?: string | null;
}

/**
 * Rate plan + attached PlanRules from the EFL Fact Card Engine.
 */
export interface RatePlanWithRules {
  plan: RatePlanRef;
  rules: PlanRules;
}

/**
 * Input to the per-plan cost engine.
 */
export interface PlanCostEngineInput {
  plan: RatePlanWithRules;
  usage: IntervalUsagePoint[];
  tz: string;
}

/**
 * Output for a single plan's cost calculation over the analysis window.
 */
export interface PlanCostResult {
  plan: RatePlanRef;
  intervalCosts: PlanIntervalCost[];
  dailySummaries: PlanDailyCostSummary[];
  monthlySummaries: PlanMonthlyCostSummary[];
  totalCostDollars: number;
}

/**
 * Input to the multi-plan comparison engine.
 */
export interface PlanComparisonInput {
  plans: RatePlanWithRules[];
  usage: IntervalUsagePoint[];
  tz: string;
}

/**
 * Output of the multi-plan comparison engine.
 */
export interface PlanComparisonResult {
  plans: PlanCostResult[];
  sortedPlanIds: string[];
}

