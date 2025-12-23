import { requiredBucketsForRateStructure } from "@/lib/plan-engine/requiredBucketsForPlan";
import { extractDeterministicTouSchedule } from "@/lib/plan-engine/touPeriods";
import { detectIndexedOrVariable, extractEflAveragePriceAnchors } from "@/lib/plan-engine/indexedPricing";
import { extractDeterministicTierSchedule } from "@/lib/plan-engine/tieredPricing";
import { extractDeterministicBillCredits } from "@/lib/plan-engine/billCredits";
import { extractDeterministicMinimumRules } from "@/lib/plan-engine/minimumRules";

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

  // IMPORTANT:
  // If this structure is TOU-like, do NOT treat any single energyRateCents/defaultRate as a fixed-rate plan.
  // Many TOU templates store an "energyRateCents" convenience value (often Off-Peak) which must not
  // short-circuit TOU pricing paths or dashboard gating.
  const rsAny: any = rateStructure as any;
  const hasTouSignals =
    rsAny?.type === "TIME_OF_USE" ||
    rsAny?.planType === "tou" ||
    (Array.isArray(rsAny?.timeOfUsePeriods) && rsAny.timeOfUsePeriods.length > 0) ||
    (Array.isArray((rsAny?.planRules as any)?.timeOfUsePeriods) && (rsAny.planRules as any).timeOfUsePeriods.length > 0) ||
    (Array.isArray(rsAny?.timeOfUseTiers) && rsAny.timeOfUseTiers.length > 0) ||
    (rsAny?.type === "TIME_OF_USE" && Array.isArray(rsAny?.tiers) && rsAny.tiers.length > 0) ||
    (Array.isArray(rsAny?.tiers) && rsAny.tiers.length > 0);
  if (hasTouSignals) return null;

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
  estimateModesAllowed?: Array<"INDEXED_EFL_ANCHOR_APPROX">;
  combo?: {
    hasTiered: boolean;
    hasTou: boolean;
    hasBillCredits: boolean; // only true when credits.ok and rules.length > 0
    supportedTieredPlusCredits: boolean;
    supportedTouPlusCredits: boolean;
    reason?: string;
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
  indexed?: {
    isIndexed: boolean;
    kind: "INDEXED" | "VARIABLE" | null;
    anchors: { centsPerKwhAt500: number | null; centsPerKwhAt1000: number | null; centsPerKwhAt2000: number | null };
    approxPossible: boolean;
    notes: string[];
  };
  tiered?: ReturnType<typeof extractDeterministicTierSchedule>;
  billCredits?: ReturnType<typeof extractDeterministicBillCredits>;
  minimumRules?: ReturnType<typeof extractDeterministicMinimumRules>;
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
  const indexed = detectIndexedOrVariable(rs);
  const anchors = extractEflAveragePriceAnchors(rs);
  const tiered = extractDeterministicTierSchedule(rs);
  const billCredits = extractDeterministicBillCredits(rs);
  const minimumRules = extractDeterministicMinimumRules({ rateStructure: rs });
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
      if (minimumRules.ok) {
        return {
          planCalcVersion: 1,
          planCalcStatus: "COMPUTABLE" as const,
          planCalcReasonCode: "FIXED_PLUS_MINIMUM_RULES_OK",
          requiredBucketKeys: ["kwh.m.all.total"],
          supportedFeatures: { ...inferred.features, supportsMinimumRules: true, notes: [...inferred.notes, ...(minimumRules.minimum?.notes ?? [])] },
        };
      }
      if (!minimumRules.ok && minimumRules.reason !== "NO_MIN_RULES") {
        return {
          planCalcVersion: 1,
          planCalcStatus: "NOT_COMPUTABLE" as const,
          planCalcReasonCode: minimumRules.reason,
          requiredBucketKeys: ["kwh.m.all.total"],
          supportedFeatures: { ...inferred.features, supportsMinimumRules: true, notes: [...inferred.notes, ...(minimumRules.notes ?? [])] },
        };
      }
      if (billCredits.ok) {
        return {
          planCalcVersion: 1,
          planCalcStatus: "COMPUTABLE" as const,
          planCalcReasonCode: "FIXED_PLUS_BILL_CREDITS_OK",
          requiredBucketKeys: ["kwh.m.all.total"],
          supportedFeatures: { ...inferred.features, supportsCredits: true, notes: [...inferred.notes, ...(billCredits.credits?.notes ?? [])] },
        };
      }
      if (!billCredits.ok && billCredits.reason !== "NO_CREDITS") {
        return {
          planCalcVersion: 1,
          planCalcStatus: "NOT_COMPUTABLE" as const,
          planCalcReasonCode: billCredits.reason,
          requiredBucketKeys: ["kwh.m.all.total"],
          supportedFeatures: { ...inferred.features, supportsCredits: true, notes: [...inferred.notes, ...(billCredits.notes ?? [])] },
        };
      }
      return {
        planCalcVersion: 1,
        planCalcStatus: "COMPUTABLE" as const,
        planCalcReasonCode: "FIXED_RATE_OK",
        requiredBucketKeys: ["kwh.m.all.total"],
        supportedFeatures: { ...inferred.features, notes: inferred.notes },
      };
    }

    if (tou.schedule) {
      // TOU + deterministic bill credits is supported in non-dashboard flows.
      if (billCredits.ok && Array.isArray(billCredits.credits?.rules) && billCredits.credits.rules.length > 0) {
        return {
          planCalcVersion: 1,
          planCalcStatus: "COMPUTABLE" as const,
          planCalcReasonCode: "TOU_PLUS_CREDITS_OK",
          requiredBucketKeys,
          supportedFeatures: {
            ...inferred.features,
            supportsTouEnergy: true,
            supportsCredits: true,
            notes: [...inferred.notes, ...(tou.notes ?? []), ...(billCredits.credits?.notes ?? [])],
          },
        };
      }
      if (!billCredits.ok && billCredits.reason !== "NO_CREDITS") {
        return {
          planCalcVersion: 1,
          planCalcStatus: "NOT_COMPUTABLE" as const,
          planCalcReasonCode: billCredits.reason,
          requiredBucketKeys,
          supportedFeatures: {
            ...inferred.features,
            supportsTouEnergy: true,
            supportsCredits: true,
            notes: [...inferred.notes, ...(tou.notes ?? []), ...(billCredits.notes ?? [])],
          },
        };
      }
      return {
        planCalcVersion: 1,
        planCalcStatus: "COMPUTABLE" as const,
        planCalcReasonCode: "TOU_OK",
        requiredBucketKeys,
        supportedFeatures: { ...inferred.features, supportsTouEnergy: true, notes: [...inferred.notes, ...(tou.notes ?? [])] },
      };
    }

    if (tiered.ok) {
      // Tiered + deterministic bill credits is supported in non-dashboard flows.
      // Treat NO_CREDITS as "no credits present" (tiered-only), and propagate unsupported credit reasons.
      if (billCredits.ok && Array.isArray(billCredits.credits?.rules) && billCredits.credits.rules.length > 0) {
        return {
          planCalcVersion: 1,
          planCalcStatus: "COMPUTABLE" as const,
          planCalcReasonCode: "TIERED_PLUS_CREDITS_OK",
          requiredBucketKeys: ["kwh.m.all.total"],
          supportedFeatures: {
            ...inferred.features,
            supportsTieredEnergy: true,
            supportsCredits: true,
            notes: [...inferred.notes, ...(tiered.schedule?.notes ?? []), ...(billCredits.credits?.notes ?? [])],
          },
        };
      }
      if (!billCredits.ok && billCredits.reason !== "NO_CREDITS") {
        return {
          planCalcVersion: 1,
          planCalcStatus: "NOT_COMPUTABLE" as const,
          planCalcReasonCode: billCredits.reason,
          requiredBucketKeys: ["kwh.m.all.total"],
          supportedFeatures: {
            ...inferred.features,
            supportsTieredEnergy: true,
            supportsCredits: true,
            notes: [...inferred.notes, ...(tiered.schedule?.notes ?? []), ...(billCredits.notes ?? [])],
          },
        };
      }
      return {
        planCalcVersion: 1,
        planCalcStatus: "COMPUTABLE" as const,
        planCalcReasonCode: "TIERED_OK",
        requiredBucketKeys: ["kwh.m.all.total"],
        supportedFeatures: { ...inferred.features, supportsTieredEnergy: true, notes: [...inferred.notes, ...(tiered.schedule?.notes ?? [])] },
      };
    }
    if (!tiered.ok && tiered.reason && tiered.reason.startsWith("UNSUPPORTED_")) {
      return {
        planCalcVersion: 1,
        planCalcStatus: "NOT_COMPUTABLE" as const,
        planCalcReasonCode: tiered.reason,
        requiredBucketKeys: ["kwh.m.all.total"],
        supportedFeatures: { ...inferred.features, supportsTieredEnergy: true, notes: [...inferred.notes, ...(tiered.notes ?? [])] },
      };
    }

    if (indexed.isIndexed) {
      return {
        planCalcVersion: 1,
        planCalcStatus: "COMPUTABLE" as const,
        planCalcReasonCode: "INDEXED_APPROXIMATE_OK",
        requiredBucketKeys: ["kwh.m.all.total"],
        supportedFeatures: { ...inferred.features, notes: [...inferred.notes, ...(indexed.notes ?? []), "Indexed/variable pricing is computed in APPROX mode using EFL modeled anchors when available."] },
      };
    }

    if (minimumRules.ok) {
      return {
        planCalcVersion: 1,
        planCalcStatus: "COMPUTABLE" as const,
        planCalcReasonCode: "MINIMUM_RULES_OK",
        requiredBucketKeys: ["kwh.m.all.total"],
        supportedFeatures: { ...inferred.features, supportsMinimumRules: true, notes: [...inferred.notes, ...(minimumRules.minimum?.notes ?? [])] },
      };
    }
    if (!minimumRules.ok && minimumRules.reason !== "NO_MIN_RULES") {
      return {
        planCalcVersion: 1,
        planCalcStatus: "NOT_COMPUTABLE" as const,
        planCalcReasonCode: minimumRules.reason,
        requiredBucketKeys: ["kwh.m.all.total"],
        supportedFeatures: { ...inferred.features, supportsMinimumRules: true, notes: [...inferred.notes, ...(minimumRules.notes ?? [])] },
      };
    }

    if (billCredits.ok) {
      return {
        planCalcVersion: 1,
        planCalcStatus: "COMPUTABLE" as const,
        planCalcReasonCode: "BILL_CREDITS_OK",
        requiredBucketKeys: ["kwh.m.all.total"],
        supportedFeatures: { ...inferred.features, supportsCredits: true, notes: [...inferred.notes, ...(billCredits.credits?.notes ?? [])] },
      };
    }
    if (!billCredits.ok && billCredits.reason !== "NO_CREDITS") {
      return {
        planCalcVersion: 1,
        planCalcStatus: "NOT_COMPUTABLE" as const,
        planCalcReasonCode: billCredits.reason,
        requiredBucketKeys: ["kwh.m.all.total"],
        supportedFeatures: { ...inferred.features, supportsCredits: true, notes: [...inferred.notes, ...(billCredits.notes ?? [])] },
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

    const approxPossible = indexed.isIndexed && (anchors.centsPerKwhAt500 != null || anchors.centsPerKwhAt1000 != null || anchors.centsPerKwhAt2000 != null);
    const tieredPossible = tiered.ok;
    const creditsPossible = billCredits.ok;
    const minimumPossible = minimumRules.ok;

    const canRunWithoutBuckets = (fixed != null && !creditsPossible && !minimumPossible) || approxPossible;
    const canRunWithBuckets = fixed != null || !!tou.schedule || approxPossible || tieredPossible || creditsPossible || minimumPossible;
    const requiresUsageBuckets =
      (fixed == null && !approxPossible) || tieredPossible || !!tou.schedule || creditsPossible || minimumPossible;

    if (fixed != null) {
      if (creditsPossible && minimumPossible) notes.push(`Fixed REP energy rate detected (${fixed} ¢/kWh); bill credits + minimum rules require monthly totals.`);
      else if (creditsPossible) notes.push(`Fixed REP energy rate detected (${fixed} ¢/kWh); bill credits require monthly totals.`);
      else if (minimumPossible) notes.push(`Fixed REP energy rate detected (${fixed} ¢/kWh); minimum rules require monthly totals.`);
      else notes.push(`Fixed REP energy rate detected (${fixed} ¢/kWh); calculator can run without usage buckets.`);
    } else if (tou.schedule) {
      notes.push(`Deterministic TOU schedule detected; calculator requires usage buckets: ${requiredBucketKeys.join(", ")}`);
    } else if (tieredPossible) {
      notes.push("Deterministic tiered schedule detected; calculator requires kwh.m.all.total buckets per month.");
    } else if (approxPossible) {
      notes.push("Indexed/variable plan detected; calculator can run only in APPROXIMATE mode using EFL modeled price anchors (500/1000/2000).");
    } else if (creditsPossible) {
      notes.push("Bill credits detected; calculator requires kwh.m.all.total buckets per month.");
    } else if (minimumPossible) {
      notes.push("Minimum usage fee / minimum bill detected; calculator requires kwh.m.all.total buckets per month.");
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
    estimateModesAllowed: (() => {
      const approxPossible =
        indexed.isIndexed &&
        (anchors.centsPerKwhAt500 != null || anchors.centsPerKwhAt1000 != null || anchors.centsPerKwhAt2000 != null);
      return approxPossible ? ["INDEXED_EFL_ANCHOR_APPROX"] : [];
    })(),
    combo: (() => {
      const hasTiered = tiered.ok;
      const hasTou = !!tou.schedule;
      const hasBillCredits = billCredits.ok && Array.isArray(billCredits.credits?.rules) && billCredits.credits.rules.length > 0;
      const supportedTieredPlusCredits = hasTiered && hasBillCredits;
      const supportedTouPlusCredits = hasTou && hasBillCredits;
      const reason =
        (hasTiered || hasTou) && !billCredits.ok && billCredits.reason !== "NO_CREDITS"
          ? billCredits.reason
          : !hasTiered && !tiered.ok && tiered.reason !== "NO_TIER_DATA"
            ? tiered.reason
            : undefined;
      return { hasTiered, hasTou, hasBillCredits, supportedTieredPlusCredits, supportedTouPlusCredits, ...(reason ? { reason } : {}) };
    })(),
    tou,
    tiered,
    billCredits,
    minimumRules,
    requiredBuckets,
    requiredBucketKeys,
    calculatorDryRun,
    indexed: {
      isIndexed: indexed.isIndexed,
      kind: indexed.kind,
      anchors,
      approxPossible:
        indexed.isIndexed &&
        (anchors.centsPerKwhAt500 != null || anchors.centsPerKwhAt1000 != null || anchors.centsPerKwhAt2000 != null),
      notes: indexed.notes ?? [],
    },
  };
}
