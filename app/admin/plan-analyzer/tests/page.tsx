export const dynamic = "force-dynamic";

import React from "react";
import {
  type RatePlanRef,
  type RatePlanWithRules,
  type PlanCostResult,
  type PlanComparisonResult,
  type IntervalUsagePoint,
} from "@/lib/planAnalyzer/planTypes";
import { computePlanCost } from "@/lib/planAnalyzer/planCostEngine";
import { comparePlans } from "@/lib/planAnalyzer/multiPlanAnalyzer";
import type { PlanRules } from "@/lib/efl/planEngine";
import { DateTime } from "luxon";

function buildFakeUsageSeries(): IntervalUsagePoint[] {
  const usage: IntervalUsagePoint[] = [];
  const base = DateTime.fromISO("2024-01-02T00:00:00", {
    zone: "America/Chicago",
  });

  for (let hour = 0; hour < 24; hour += 1) {
    const dt = base.plus({ hours: hour });
    const timestamp = dt.toISO({ suppressMilliseconds: true });

    let kwhImport = 0.5;
    if (hour >= 7 && hour <= 16) kwhImport = 1;
    if (hour >= 17) kwhImport = 1.5;

    usage.push({
      timestamp: timestamp ?? base.toISO({ suppressMilliseconds: true })!,
      kwhImport,
      kwhExport: 0,
    });
  }

  return usage;
}

function buildPlanRulesSamples(): {
  freeNights: PlanRules;
  flatRate: PlanRules;
} {
  const freeNights: PlanRules = {
    planType: "free-nights",
    defaultRateCentsPerKwh: 15,
    baseChargePerMonthCents: 0,
    timeOfUsePeriods: [
      {
        label: "Free Nights",
        startHour: 21,
        endHour: 7,
        daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
        rateCentsPerKwh: 0,
        isFree: true,
      },
    ],
    solarBuyback: null,
    billCredits: [],
  };

  const flatRate: PlanRules = {
    planType: "flat",
    defaultRateCentsPerKwh: 13,
    baseChargePerMonthCents: 0,
    timeOfUsePeriods: [],
    solarBuyback: null,
    billCredits: [],
  };

  return { freeNights, flatRate };
}

function buildRatePlansWithRules(): RatePlanWithRules[] {
  const { freeNights, flatRate } = buildPlanRulesSamples();

  const freeNightsRef: RatePlanRef = {
    id: "plan_free_nights_example",
    displayName: "Example Free Nights 21-07 (15¢ daytime)",
    source: "test",
    tdspCode: "ONCOR",
  };

  const flatRateRef: RatePlanRef = {
    id: "plan_flat_13c_example",
    displayName: "Example Flat 13¢ All Hours",
    source: "test",
    tdspCode: "ONCOR",
  };

  return [
    { plan: freeNightsRef, rules: freeNights },
    { plan: flatRateRef, rules: flatRate },
  ];
}

async function runPlanAnalyzerTests(): Promise<{
  tz: string;
  usageCount: number;
  planCount: number;
  singlePlanResult: PlanCostResult | { ok: false; error: string };
  comparisonResult: PlanComparisonResult | { ok: false; error: string };
}> {
  const tz = "America/Chicago";
  const usage = buildFakeUsageSeries();
  const plansWithRules = buildRatePlansWithRules();

  let singlePlanResult: PlanCostResult | { ok: false; error: string };
  try {
    singlePlanResult = computePlanCost({
      plan: plansWithRules[0],
      usage,
      tz,
    });
  } catch (error) {
    singlePlanResult = {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Unknown error in computePlanCost",
    };
  }

  let comparisonResult: PlanComparisonResult | { ok: false; error: string };
  try {
    comparisonResult = comparePlans({
      plans: plansWithRules,
      usage,
      tz,
    });
  } catch (error) {
    comparisonResult = {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Unknown error in comparePlans",
    };
  }

  return {
    tz,
    usageCount: usage.length,
    planCount: plansWithRules.length,
    singlePlanResult,
    comparisonResult,
  };
}

export default async function PlanAnalyzerTestsPage() {
  const results = await runPlanAnalyzerTests();

  return (
    <div className="space-y-6 p-6">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">Plan Analyzer Engine — Tests</h1>
        <p className="text-sm text-gray-500">
          Synthetic usage and example PlanRules to validate per-plan and
          multi-plan costing, rendered as JSON for quick inspection.
        </p>
      </header>

      <section className="rounded-lg border bg-white p-4 shadow-sm">
        <h2 className="text-lg font-semibold">Summary</h2>
        <p className="mt-1 text-xs text-gray-500">
          Time zone: {results.tz} · Usage intervals: {results.usageCount} ·
          Plans tested: {results.planCount}
        </p>
      </section>

      <section className="rounded-lg border bg-white p-4 shadow-sm">
        <h2 className="text-lg font-semibold">Single Plan Cost Result</h2>
        <p className="mt-1 text-xs text-gray-500">
          Output of computePlanCost for the Free Nights example plan.
        </p>
        <pre className="mt-3 max-h-[420px] overflow-auto rounded bg-gray-900 p-3 text-xs text-gray-100">
          {JSON.stringify(results.singlePlanResult, null, 2)}
        </pre>
      </section>

      <section className="rounded-lg border bg-white p-4 shadow-sm">
        <h2 className="text-lg font-semibold">Multi-Plan Comparison Result</h2>
        <p className="mt-1 text-xs text-gray-500">
          Output of comparePlans for Free Nights vs Flat 13¢.
        </p>
        <pre className="mt-3 max-h-[420px] overflow-auto rounded bg-gray-900 p-3 text-xs text-gray-100">
          {JSON.stringify(results.comparisonResult, null, 2)}
        </pre>
      </section>
    </div>
  );
}

