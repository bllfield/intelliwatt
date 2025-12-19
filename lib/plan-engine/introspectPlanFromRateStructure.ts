import { requiredBucketsForRateStructure } from "@/lib/plan-engine/requiredBucketsForPlan";
import { extractDeterministicTouSchedule } from "@/lib/plan-engine/touPeriods";

function isObject(v: unknown): v is Record<string, any> {
  return typeof v === "object" && v !== null;
}

function hasNonEmptyArray(v: unknown): boolean {
  return Array.isArray(v) && v.length > 0;
}

function safeNum(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Conservative extractor: tries common shapes to find a single fixed energy rate (cents/kWh).
 * Fail-closed: returns null unless we find exactly one confident number.
 *
 * IMPORTANT: Duplicated (intentionally) from calculatePlanCostForUsage.ts so this file stays client-safe.
 */
function extractFixedRepEnergyCentsPerKwh(rateStructure: any): number | null {
  if (!rateStructure || typeof rateStructure !== "object") return null;

  const candidates: unknown[] = [];

  // direct keys
  candidates.push(rateStructure?.repEnergyCentsPerKwh);
  candidates.push(rateStructure?.energyCentsPerKwh);
  candidates.push(rateStructure?.fixedEnergyCentsPerKwh);
  candidates.push(rateStructure?.rateCentsPerKwh);
  candidates.push(rateStructure?.baseRateCentsPerKwh);

  // common persisted keys from our current template pipeline
  candidates.push(rateStructure?.energyRateCents);
  candidates.push(rateStructure?.energyChargeCentsPerKwh);
  candidates.push(rateStructure?.defaultRateCentsPerKwh);

  // nested shapes
  candidates.push(rateStructure?.charges?.energy?.centsPerKwh);
  candidates.push(rateStructure?.charges?.rep?.energyCentsPerKwh);
  candidates.push(rateStructure?.energy?.centsPerKwh);

  // If your EFL template stores a single "pricePerKwh" in dollars, allow conversion ONLY if it looks like < 1.
  const maybeDollars = safeNum(rateStructure?.charges?.energy?.dollarsPerKwh);
  if (maybeDollars !== null && maybeDollars > 0 && maybeDollars < 1) {
    return maybeDollars * 100;
  }

  const nums = candidates
    .map(safeNum)
    .filter((x): x is number => x !== null)
    .filter((x) => x > 0 && x < 200); // cents/kWh sanity

  const uniq = Array.from(new Set(nums.map((n) => round2(n))));
  if (uniq.length !== 1) return null;
  return uniq[0];
}

/**
 * Client-safe best-effort feature inference.
 * (Cannot import `planComputability.ts` here because it depends on Prisma/server-only behavior.)
 */
function inferSupportedFeaturesFromRateStructure(rateStructure: unknown): { features: Record<string, any>; notes: string[] } {
  const notes: string[] = [];
  const rsAny = rateStructure as any;

  const fixedCents = extractFixedRepEnergyCentsPerKwh(rateStructure as any);
  const supportsFixedEnergyRate = fixedCents != null;
  if (!supportsFixedEnergyRate) {
    notes.push("Could not confidently extract a single fixed REP ¢/kWh rate from rateStructure (fail-closed).");
  }

  const supportsTouEnergy = (() => {
    if (!isObject(rsAny)) return false;
    const rs = rsAny as any;
    if (rs?.type === "TIME_OF_USE") return true;
    if (rs?.planType === "tou") return true;
    if (hasNonEmptyArray(rs?.timeOfUseTiers)) return true;
    if (rs?.type === "TIME_OF_USE" && hasNonEmptyArray(rs?.tiers)) return true;
    if (hasNonEmptyArray(rs?.timeOfUsePeriods)) return true;
    if (hasNonEmptyArray((rs?.planRules as any)?.timeOfUsePeriods)) return true;
    return false;
  })();

  const supportsWeekendSplitEnergy = (() => {
    if (!isObject(rsAny)) return false;
    const rs = rsAny as any;
    const periods: any[] = Array.isArray(rs?.timeOfUsePeriods)
      ? rs.timeOfUsePeriods
      : Array.isArray((rs?.planRules as any)?.timeOfUsePeriods)
        ? (rs.planRules as any).timeOfUsePeriods
        : [];
    if (!Array.isArray(periods) || periods.length === 0) return false;

    const hasWeekdayAllDay = periods.some((p) => {
      const startHour = typeof p?.startHour === "number" ? p.startHour : null;
      const endHour = typeof p?.endHour === "number" ? p.endHour : null;
      const days = Array.isArray(p?.daysOfWeek) ? (p.daysOfWeek as number[]) : null;
      return (
        startHour === 0 &&
        endHour === 24 &&
        Array.isArray(days) &&
        days.length === 5 &&
        days.every((d) => d === 1 || d === 2 || d === 3 || d === 4 || d === 5)
      );
    });
    const hasWeekendAllDay = periods.some((p) => {
      const startHour = typeof p?.startHour === "number" ? p.startHour : null;
      const endHour = typeof p?.endHour === "number" ? p.endHour : null;
      const days = Array.isArray(p?.daysOfWeek) ? (p.daysOfWeek as number[]) : null;
      return startHour === 0 && endHour === 24 && Array.isArray(days) && days.length === 2 && days.includes(0) && days.includes(6);
    });

    return hasWeekdayAllDay && hasWeekendAllDay;
  })();

  const supportsTieredEnergy = (() => {
    if (!isObject(rsAny)) return false;
    const rs = rsAny as any;
    return hasNonEmptyArray(rs?.usageTiers);
  })();

  const supportsCredits = (() => {
    if (!isObject(rsAny)) return false;
    const rs = rsAny as any;
    return hasNonEmptyArray(rs?.billCredits) || (isObject(rs?.billCredits) && hasNonEmptyArray(rs?.billCredits?.rules));
  })();

  const supportsBaseFees = (() => {
    if (!isObject(rsAny)) return false;
    const rs = rsAny as any;
    return typeof rs?.baseMonthlyFeeCents === "number";
  })();

  return {
    features: {
      supportsFixedEnergyRate,
      supportsTouEnergy,
      supportsWeekendSplitEnergy,
      supportsTieredEnergy,
      supportsCredits,
      supportsBaseFees,
    },
    notes,
  };
}

export type PlanEngineIntrospection = {
  planCalc: {
    planCalcVersion: number;
    planCalcStatus: "COMPUTABLE" | "NOT_COMPUTABLE" | "UNKNOWN";
    planCalcReasonCode: string;
    requiredBucketKeys: string[];
    supportedFeatures: Record<string, any>;
  };
  tou: ReturnType<typeof extractDeterministicTouSchedule>;
  requiredBuckets: ReturnType<typeof requiredBucketsForRateStructure>;
  requiredBucketKeys: string[];
  calculatorDryRun: {
    canRunWithoutBuckets: boolean;
    canRunWithBuckets: boolean;
    requiresUsageBuckets: boolean;
    requiredBucketKeys: string[];
    notes: string[];
  };
};

/**
 * Pure helper (no DB / no side effects):
 * - Derives plan computability summary (dashboard-safe gating status)
 * - Extracts deterministic TOU schedule (Phase-2)
 * - Derives required usage buckets from rateStructure (authoritative)
 *
 * IMPORTANT: Do not call derivePlanCalcRequirementsFromTemplate() here because it
 * does best-effort side effects (bucket registry writes) that we don't want in admin inspection.
 */
export function introspectPlanFromRateStructure(input: { rateStructure: any }): PlanEngineIntrospection {
  const rs = input.rateStructure;

  const inferred = inferSupportedFeaturesFromRateStructure(rs);
  const fixed = extractFixedRepEnergyCentsPerKwh(rs);
  const tou = extractDeterministicTouSchedule(rs);
  const requiredBuckets = requiredBucketsForRateStructure({ rateStructure: rs });
  const requiredBucketKeys = requiredBuckets.map((r) => r.key);

  const planCalc = (() => {
    // Mirrors `derivePlanCalcRequirementsFromTemplate` but without side effects.
    if (!rs) {
      return {
        planCalcVersion: 1,
        planCalcStatus: "UNKNOWN" as const,
        planCalcReasonCode: "MISSING_TEMPLATE",
        requiredBucketKeys: [],
        supportedFeatures: {},
      };
    }

    if (fixed != null) {
      return {
        planCalcVersion: 1,
        planCalcStatus: "COMPUTABLE" as const,
        planCalcReasonCode: "FIXED_RATE_OK",
        requiredBucketKeys: ["kwh.m.all.total"],
        supportedFeatures: { ...inferred.features, notes: inferred.notes },
      };
    }

    if (tou.schedule) {
      return {
        planCalcVersion: 1,
        // IMPORTANT: keep dashboard gating unchanged (TOU stays NOT_COMPUTABLE at plan-level).
        planCalcStatus: "NOT_COMPUTABLE" as const,
        planCalcReasonCode: "TOU_REQUIRES_USAGE_BUCKETS_PHASE2",
        requiredBucketKeys,
        supportedFeatures: { ...inferred.features, supportsTouEnergy: true, notes: [...inferred.notes, ...(tou.notes ?? [])] },
      };
    }

    if (inferred.features.supportsTouEnergy) {
      const reasonCode = (tou as any)?.reasonCode ? String((tou as any).reasonCode) : "UNSUPPORTED_RATE_STRUCTURE";
      return {
        planCalcVersion: 1,
        planCalcStatus: "NOT_COMPUTABLE" as const,
        planCalcReasonCode: reasonCode,
        requiredBucketKeys: ["kwh.m.all.total"],
        supportedFeatures: { ...inferred.features, notes: inferred.notes },
      };
    }

    return {
      planCalcVersion: 1,
      planCalcStatus: "NOT_COMPUTABLE" as const,
      planCalcReasonCode: "UNSUPPORTED_RATE_STRUCTURE",
      requiredBucketKeys: ["kwh.m.all.total"],
      supportedFeatures: { ...inferred.features, notes: inferred.notes },
    };
  })();

  const calculatorDryRun = (() => {
    const notes: string[] = [];

    const canRunWithoutBuckets = fixed != null;
    const canRunWithBuckets = fixed != null || !!tou.schedule;
    const requiresUsageBuckets = fixed == null;

    if (fixed != null) {
      notes.push(`Fixed REP energy rate detected (${fixed} ¢/kWh); calculator can run without usage buckets.`);
    } else if (tou.schedule) {
      notes.push(`Deterministic TOU schedule detected; calculator requires usage buckets: ${requiredBucketKeys.join(", ")}`);
    } else {
      notes.push("No single fixed REP energy rate detected; TOU schedule extraction failed or unsupported (fail-closed).");
    }

    return {
      canRunWithoutBuckets,
      canRunWithBuckets,
      requiresUsageBuckets,
      requiredBucketKeys,
      notes,
    };
  })();

  return {
    planCalc,
    tou,
    requiredBuckets,
    requiredBucketKeys,
    calculatorDryRun,
  };
}

