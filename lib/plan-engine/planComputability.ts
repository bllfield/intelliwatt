import { requiredBucketsForPlan } from "@/lib/plan-engine/requiredBucketsForPlan";
import { extractFixedRepEnergyCentsPerKwh } from "@/lib/plan-engine/calculatePlanCostForUsage";
import { Prisma } from "@prisma/client";

export type ComputabilityStatus =
  | { status: "COMPUTABLE"; requiredBucketKeys: string[]; notes?: string[] }
  | {
      status: "NOT_COMPUTABLE";
      requiredBucketKeys?: string[];
      reasonCode: string;
      reason: string;
      details?: unknown;
    };

export type SupportedPlanFeatures = {
  supportsFixedEnergyRate: boolean;
  supportsTouEnergy: boolean;
  supportsTieredEnergy: boolean;
  supportsCredits: boolean;
  supportsBaseFees: boolean;
  supportsMinUsageFees: boolean;
  supportsTdspDelivery: boolean;
  supportsSolarBuyback: boolean;
};

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function hasNonEmptyArray(v: unknown): boolean {
  return Array.isArray(v) && v.length > 0;
}

function isPrismaJsonNullLike(v: unknown): boolean {
  // In Postgres JSONB, a stored JSON null is NOT SQL NULL, and Prisma represents it using sentinels.
  // Treat these as "missing rateStructure" for plan-calc purposes.
  return v === (Prisma as any).JsonNull || v === (Prisma as any).DbNull || v === (Prisma as any).AnyNull;
}

function bestEffortEnsureBucketsExist(requiredBucketKeys: string[]) {
  // Design+scaffold only: registry side-effect, no change to status logic in this step.
  // IMPORTANT: keep this server-only and best-effort; never let it break dashboard semantics.
  if (!Array.isArray(requiredBucketKeys) || requiredBucketKeys.length === 0) return;
  if (typeof window !== "undefined") return;

  void import("@/lib/usage/aggregateMonthlyBuckets")
    .then(({ ensureBucketsExist }) =>
      ensureBucketsExist({ bucketKeys: requiredBucketKeys }).catch((err: unknown) => {
        console.warn("[planComputability] ensureBucketsExist failed (best-effort)", err);
      }),
    )
    .catch((err: unknown) => {
      console.warn("[planComputability] ensureBucketsExist import failed (best-effort)", err);
    });
}

export function inferSupportedFeaturesFromTemplate(input: {
  rateStructure: unknown;
}): { features: SupportedPlanFeatures; notes: string[] } {
  const notes: string[] = [];

  const rsAny = input.rateStructure as any;
  const fixedCents = extractFixedRepEnergyCentsPerKwh(input.rateStructure as any);
  const supportsFixedEnergyRate = fixedCents != null;
  if (!supportsFixedEnergyRate) {
    notes.push("Could not confidently extract a single fixed REP ¢/kWh rate from rateStructure (fail-closed).");
  }

  // Detect TOU-like templates so we can set precise reason codes + required buckets (even if still not computable in v1).
  const supportsTouEnergy = (() => {
    if (!isObject(rsAny)) return false;
    const rs = rsAny as any;
    if (rs?.type === "TIME_OF_USE") return true;
    if (rs?.planType === "tou") return true;
    if (hasNonEmptyArray(rs?.timeOfUseTiers)) return true;
    // Current-plan style: TOU tiers may be stored under `tiers` when type=TIME_OF_USE.
    if (rs?.type === "TIME_OF_USE" && hasNonEmptyArray(rs?.tiers)) return true;
    if (hasNonEmptyArray(rs?.timeOfUsePeriods)) return true;
    if (hasNonEmptyArray((rs?.planRules as any)?.timeOfUsePeriods)) return true;
    return false;
  })();
  const supportsTieredEnergy = false;

  if (isObject(input.rateStructure)) {
    if (hasNonEmptyArray((input.rateStructure as any).timeOfUseTiers)) {
      notes.push("Detected timeOfUseTiers; TOU bucket calculation is limited (Phase-1 only) and not enabled in v1 dashboard yet.");
    }
    if (hasNonEmptyArray((input.rateStructure as any).tiers) || hasNonEmptyArray((input.rateStructure as any).usageTiers)) {
      notes.push("Detected tiered energy structures; tiered monthly computation is not enabled in v1 (conservative).");
    }
  }

  const supportsCredits = isObject(input.rateStructure) && hasNonEmptyArray((input.rateStructure as any).billCredits);
  const supportsBaseFees = isObject(input.rateStructure) && numOrNull((input.rateStructure as any).baseMonthlyFeeCents) != null;
  const supportsMinUsageFees = false; // conservative placeholder
  const supportsTdspDelivery = true; // handled outside rateStructure (TDSP tables), but still a supported component conceptually
  const supportsSolarBuyback = false; // explicitly unsupported for now

  return {
    features: {
      supportsFixedEnergyRate,
      supportsTouEnergy,
      supportsTieredEnergy,
      supportsCredits,
      supportsBaseFees,
      supportsMinUsageFees,
      supportsTdspDelivery,
      supportsSolarBuyback,
    },
    notes,
  };
}

export function derivePlanCalcRequirementsFromTemplate(args: {
  rateStructure: any | null | undefined;
}): {
  planCalcStatus: "COMPUTABLE" | "NOT_COMPUTABLE" | "UNKNOWN";
  planCalcReasonCode: string;
  requiredBucketKeys: string[];
  supportedFeatures: Record<string, any>;
  planCalcVersion: number; // 1
} {
  const planCalcVersion = 1 as const;

  const rs = args.rateStructure;
  if (!rs || isPrismaJsonNullLike(rs)) {
    return {
      planCalcVersion,
      planCalcStatus: "UNKNOWN",
      planCalcReasonCode: "MISSING_TEMPLATE",
      requiredBucketKeys: [],
      supportedFeatures: {},
    };
  }

  const inferred = inferSupportedFeaturesFromTemplate({ rateStructure: rs });
  const fixed = extractFixedRepEnergyCentsPerKwh(rs);

  const out = (() => {
    if (fixed != null) {
      return {
        planCalcVersion,
        planCalcStatus: "COMPUTABLE" as const,
        planCalcReasonCode: "FIXED_RATE_OK",
        requiredBucketKeys: ["kwh.m.all.total"],
        supportedFeatures: { ...inferred.features, notes: inferred.notes },
      };
    }

    if (inferred.features.supportsTouEnergy) {
      // We are not marking TOU computable yet (dashboard remains v1 fixed-only), but we want:
      // - a precise reason code
      // - requiredBucketKeys populated so the bucket registry can self-register definitions
      const reqs = requiredBucketsForPlan({ features: { supportsTouEnergy: true } });
      return {
        planCalcVersion,
        planCalcStatus: "NOT_COMPUTABLE" as const,
        // NOTE: We intentionally keep this NOT_COMPUTABLE until the dashboard passes bucket totals
        // into calculatePlanCostForUsage (no assumptions allowed).
        planCalcReasonCode: "TOU_PHASE1_REQUIRES_BUCKETS",
        requiredBucketKeys: reqs.map((r) => r.key),
        supportedFeatures: { ...inferred.features, notes: inferred.notes },
      };
    }

    return {
      planCalcVersion,
      planCalcStatus: "NOT_COMPUTABLE" as const,
      planCalcReasonCode: "UNSUPPORTED_RATE_STRUCTURE",
      // Even though we can't compute, we still record the intended usage bucket key for auditing/debug.
      requiredBucketKeys: ["kwh.m.all.total"],
      supportedFeatures: { ...inferred.features, notes: inferred.notes },
    };
  })();

  // Side-effect only (best-effort): ensure usage bucket definitions exist in the registry table.
  // This must not change status logic yet; unparsable keys are swallowed.
  bestEffortEnsureBucketsExist(out.requiredBucketKeys);

  return out;
}

export function canComputePlanFromBuckets(input: {
  ratePlanId: string | null;
  offerId: string;
  templateAvailable: boolean;
  template: { rateStructure: unknown } | null;
}): ComputabilityStatus {
  if (!input.ratePlanId || !input.templateAvailable || !input.template) {
    return {
      status: "NOT_COMPUTABLE",
      reasonCode: "MISSING_TEMPLATE",
      reason: "No RatePlan template is available for this offer.",
      details: {
        ratePlanId: input.ratePlanId,
        templateAvailable: input.templateAvailable,
        hasTemplate: !!input.template,
      },
    };
  }

  const inferred = inferSupportedFeaturesFromTemplate({ rateStructure: input.template.rateStructure });
  const derived = derivePlanCalcRequirementsFromTemplate({ rateStructure: input.template.rateStructure });

  // v1 strictness: we only consider fixed-rate energy computable from buckets (fail-closed).
  if (derived.planCalcStatus !== "COMPUTABLE") {
    return {
      status: "NOT_COMPUTABLE",
      reasonCode: derived.planCalcReasonCode,
      reason: "Rate structure is not supported by the bucket-based calculator v1 (fixed-rate-only).",
      details: {
        offerId: input.offerId,
        ratePlanId: input.ratePlanId,
        notes: inferred.notes,
        features: inferred.features,
      },
    };
  }

  const reqs = requiredBucketsForPlan({ features: inferred.features });
  const requiredBucketKeys = reqs.map((r) => r.key);

  return {
    status: "COMPUTABLE",
    requiredBucketKeys,
    notes: inferred.notes,
  };
}


