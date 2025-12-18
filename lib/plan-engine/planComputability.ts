import { CORE_MONTHLY_BUCKETS } from "@/lib/plan-engine/usageBuckets";
import { requiredBucketsForPlan } from "@/lib/plan-engine/requiredBucketsForPlan";

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

function tryExtractFixedRepCentsPerKwh(rateStructure: unknown): number | null {
  if (!isObject(rateStructure)) return null;

  // Fail-closed if any tiering/TOU constructs are present.
  if (hasNonEmptyArray((rateStructure as any).usageTiers)) return null;
  if (hasNonEmptyArray((rateStructure as any).tiers)) return null;
  if (hasNonEmptyArray((rateStructure as any).timeOfUseTiers)) return null;

  const rsType =
    typeof (rateStructure as any).type === "string" ? String((rateStructure as any).type).trim().toUpperCase() : null;
  if (rsType && rsType !== "FIXED" && rsType !== "FIXED_RATE" && rsType !== "FLAT" && rsType !== "SINGLE_RATE") {
    // Unknown type: be conservative.
    return null;
  }

  return (
    numOrNull((rateStructure as any).energyRateCents) ??
    numOrNull((rateStructure as any).energyChargeCentsPerKwh) ??
    numOrNull((rateStructure as any).defaultRateCentsPerKwh)
  );
}

export function inferSupportedFeaturesFromTemplate(input: {
  rateStructure: unknown;
}): { features: SupportedPlanFeatures; notes: string[] } {
  const notes: string[] = [];

  const fixedCents = tryExtractFixedRepCentsPerKwh(input.rateStructure);
  const supportsFixedEnergyRate = fixedCents != null;
  if (!supportsFixedEnergyRate) {
    notes.push("Could not confidently extract a single fixed REP ¢/kWh rate from rateStructure (fail-closed).");
  }

  // Conservative: treat any detected TOU/tier arrays as unsupported by the bucket calculator layer (for now).
  const supportsTouEnergy = false;
  const supportsTieredEnergy = false;

  if (isObject(input.rateStructure)) {
    if (hasNonEmptyArray((input.rateStructure as any).timeOfUseTiers)) {
      notes.push("Detected timeOfUseTiers; TOU bucket calculation is not enabled in v1 (conservative).");
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

  // v1 strictness: we only consider fixed-rate energy computable from buckets (fail-closed).
  if (!inferred.features.supportsFixedEnergyRate) {
    return {
      status: "NOT_COMPUTABLE",
      reasonCode: "UNSUPPORTED_RATE_STRUCTURE",
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

  const coreKeys = new Set(CORE_MONTHLY_BUCKETS.map((b) => b.key));
  const missingFromCore = requiredBucketKeys.filter((k) => !coreKeys.has(k));

  if (inferred.features.supportsTouEnergy && missingFromCore.length > 0) {
    return {
      status: "NOT_COMPUTABLE",
      reasonCode: "MISSING_BUCKETS",
      reason: "Required usage buckets are not in the CORE bucket set yet.",
      requiredBucketKeys,
      details: {
        missingBucketKeys: missingFromCore,
        notes: inferred.notes,
        features: inferred.features,
      },
    };
  }

  return {
    status: "COMPUTABLE",
    requiredBucketKeys,
    notes: inferred.notes,
  };
}


