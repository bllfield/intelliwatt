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

import { DateTime } from "luxon";

import {
  type PlanCostEngineInput,
  type PlanCostResult,
  type PlanIntervalCost,
  type PlanDailyCostSummary,
  type PlanMonthlyCostSummary,
} from "@/lib/planAnalyzer/planTypes";
import {
  getIntervalPricingForTimestamp,
  computeIntervalCharge,
} from "@/lib/efl/planEngine";

/**
 * Compute the total cost of a single plan over a given usage profile.
 *
 * HIGH-LEVEL ALGORITHM:
 *  1. For each IntervalUsagePoint:
 *     - Determine the applicable pricing band via PlanRules.
 *     - Compute per-interval charges.
 *     - Collect a PlanIntervalCost row.
 *
 *  2. Group interval rows by local day and month (using the provided tz):
 *     - Sum import/export kWh.
 *     - Sum interval charges.
 *     - Apply base charges and (future) promotional bill credits.
 *
 *  3. Return a PlanCostResult with interval detail, daily/monthly rollups, totals.
 *
 * NOTE: This initial implementation does NOT yet model TDSP delivery charges or
 * complex bill credits. These remain TODO and currently default to 0.
 */
export function computePlanCost(input: PlanCostEngineInput): PlanCostResult {
  const { plan, usage, tz } = input;
  const { rules } = plan;

  if (!usage || usage.length === 0) {
    return {
      plan: plan.plan,
      intervalCosts: [],
      dailySummaries: [],
      monthlySummaries: [],
      totalCostDollars: 0,
    };
  }

  const intervalCosts: PlanIntervalCost[] = [];

  type DailyAgg = {
    totalImportKwh: number;
    totalExportKwh: number;
    energyChargesDollars: number;
  };

  type MonthlyAgg = {
    totalImportKwh: number;
    totalExportKwh: number;
    energyChargesDollars: number;
  };

  const dailyAgg: Record<string, DailyAgg> = {};
  const monthlyAgg: Record<string, MonthlyAgg> = {};

  const baseChargePerMonthDollars =
    rules.baseChargePerMonthCents != null
      ? rules.baseChargePerMonthCents / 100
      : 0;

  for (const point of usage) {
    const tsIso = point.timestamp;
    const dt = DateTime.fromISO(tsIso, { setZone: true }).setZone(tz);

    if (!dt.isValid) {
      // Skip invalid timestamps; future iterations may surface warnings instead.
      continue;
    }

    const dateKey = dt.toFormat("yyyy-LL-dd");
    const monthKey = dt.toFormat("yyyy-LL");
    const jsDate = dt.toJSDate();

    const pricing = getIntervalPricingForTimestamp(rules, jsDate);
    const intervalCharge = computeIntervalCharge(
      rules,
      jsDate,
      point.kwhImport,
      point.kwhExport ?? 0,
    );

    const intervalCost: PlanIntervalCost = {
      timestamp: dt.toISO() ?? tsIso,
      kwhImport: point.kwhImport,
      kwhExport: point.kwhExport ?? 0,
      importRateCentsPerKwh: pricing.importRateCentsPerKwh ?? null,
      exportCreditCentsPerKwh: pricing.exportCreditCentsPerKwh ?? null,
      importChargeDollars: intervalCharge.importChargeDollars ?? 0,
      exportCreditDollars: intervalCharge.exportCreditDollars ?? 0,
      periodLabel:
        typeof pricing.periodLabel === "string" ? pricing.periodLabel : null,
      isFree: Boolean(pricing.isFree),
    };

    intervalCosts.push(intervalCost);

    const netEnergyCharge =
      intervalCost.importChargeDollars + intervalCost.exportCreditDollars;

    const daily = (dailyAgg[dateKey] ||= {
      totalImportKwh: 0,
      totalExportKwh: 0,
      energyChargesDollars: 0,
    });
    daily.totalImportKwh += intervalCost.kwhImport;
    daily.totalExportKwh += intervalCost.kwhExport;
    daily.energyChargesDollars += netEnergyCharge;

    const monthly = (monthlyAgg[monthKey] ||= {
      totalImportKwh: 0,
      totalExportKwh: 0,
      energyChargesDollars: 0,
    });
    monthly.totalImportKwh += intervalCost.kwhImport;
    monthly.totalExportKwh += intervalCost.kwhExport;
    monthly.energyChargesDollars += netEnergyCharge;
  }

  const monthlySummaries: PlanMonthlyCostSummary[] = [];
  let totalCostDollars = 0;

  for (const [monthKey, agg] of Object.entries(monthlyAgg)) {
    const energyChargesDollars = agg.energyChargesDollars;
    const baseChargeDollars = baseChargePerMonthDollars;
    const tdspDeliveryDollars = 0; // TODO: model TDSP delivery charges
    const billCreditsDollars = 0; // TODO: integrate bill credit rules

    const total =
      energyChargesDollars +
      baseChargeDollars +
      tdspDeliveryDollars -
      billCreditsDollars;

    monthlySummaries.push({
      month: monthKey,
      totalImportKwh: agg.totalImportKwh,
      totalExportKwh: agg.totalExportKwh,
      energyChargesDollars,
      baseChargeDollars,
      billCreditsDollars,
      tdspDeliveryDollars,
      totalCostDollars: total,
    });

    totalCostDollars += total;
  }

  const dailySummaries: PlanDailyCostSummary[] = [];

  for (const [dateKey, agg] of Object.entries(dailyAgg)) {
    const dt = DateTime.fromISO(dateKey, { zone: tz });
    const daysInMonth = dt.daysInMonth || 30;
    const baseChargeDollars =
      daysInMonth > 0 ? baseChargePerMonthDollars / daysInMonth : 0;
    const billCreditsDollars = 0; // TODO: integrate bill credit rules

    const total =
      agg.energyChargesDollars + baseChargeDollars - billCreditsDollars;

    dailySummaries.push({
      date: dateKey,
      totalImportKwh: agg.totalImportKwh,
      totalExportKwh: agg.totalExportKwh,
      energyChargesDollars: agg.energyChargesDollars,
      baseChargeDollars,
      billCreditsDollars,
      totalCostDollars: total,
    });
  }

  dailySummaries.sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
  );
  monthlySummaries.sort((a, b) =>
    a.month < b.month ? -1 : a.month > b.month ? 1 : 0,
  );

  return {
    plan: plan.plan,
    intervalCosts,
    dailySummaries,
    monthlySummaries,
    totalCostDollars,
  };
}

