import { requiredBucketsForPlan, requiredBucketsForRateStructure } from "@/lib/plan-engine/requiredBucketsForPlan";
import { extractFixedRepEnergyCentsPerKwh } from "@/lib/plan-engine/calculatePlanCostForUsage";
import { extractDeterministicTouSchedule } from "@/lib/plan-engine/touPeriods";
import { detectIndexedOrVariable } from "@/lib/plan-engine/indexedPricing";
import { extractDeterministicTierSchedule } from "@/lib/plan-engine/tieredPricing";
import { extractDeterministicBillCredits } from "@/lib/plan-engine/billCredits";
import { extractDeterministicMinimumRules } from "@/lib/plan-engine/minimumRules";
import { bucketDefsFromBucketKeys } from "@/lib/plan-engine/usageBuckets";
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
  supportsWeekendSplitEnergy: boolean;
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

  // Detect "Free Weekends" style templates (weekday all-day vs weekend all-day).
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
      const startHour = numOrNull(p?.startHour);
      const endHour = numOrNull(p?.endHour);
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
      const startHour = numOrNull(p?.startHour);
      const endHour = numOrNull(p?.endHour);
      const days = Array.isArray(p?.daysOfWeek) ? (p.daysOfWeek as number[]) : null;
      return startHour === 0 && endHour === 24 && Array.isArray(days) && days.length === 2 && days.includes(0) && days.includes(6);
    });

    return hasWeekdayAllDay && hasWeekendAllDay;
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
      supportsWeekendSplitEnergy,
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

  const hasTouAssumptionEvidence = (assumptionsUsed: any): boolean => {
    if (!assumptionsUsed || typeof assumptionsUsed !== "object") return false;
    const a = assumptionsUsed as any;
    const hasPct = typeof a?.nightUsagePercent === "number" && Number.isFinite(a.nightUsagePercent);
    const hasWindow =
      (typeof a?.nightStartHour === "number" && Number.isFinite(a.nightStartHour)) ||
      (typeof a?.nightEndHour === "number" && Number.isFinite(a.nightEndHour)) ||
      (typeof a?.dayStartHour === "number" && Number.isFinite(a.dayStartHour)) ||
      (typeof a?.dayEndHour === "number" && Number.isFinite(a.dayEndHour));
    return hasPct || hasWindow;
  };

  const inferred = inferSupportedFeaturesFromTemplate({ rateStructure: rs });
  const fixed = extractFixedRepEnergyCentsPerKwh(rs);
  const credits = extractDeterministicBillCredits(rs);
  const minimum = extractDeterministicMinimumRules({ rateStructure: rs });

  const out = (() => {
    // IMPORTANT: Determine deterministic TOU schedules BEFORE considering "fixed rate" extraction.
    // Many TOU templates also have an `energyRateCents` field populated (often off-peak), which can cause
    // extractFixedRepEnergyCentsPerKwh() to return a value and incorrectly route TOU plans through the FIXED branch.
    // That is what produced SUSPECT_TOU_EVIDENCE_IN_VALIDATION for otherwise-valid EVConnect-like plans.
    const tou2 = extractDeterministicTouSchedule(rs);
    if (tou2.schedule) {
      if (!credits.ok && credits.reason !== "NO_CREDITS") {
        const reqs = requiredBucketsForRateStructure({ rateStructure: rs });
        return {
          planCalcVersion,
          planCalcStatus: "NOT_COMPUTABLE" as const,
          planCalcReasonCode: credits.reason,
          requiredBucketKeys: reqs.map((r) => r.key),
          supportedFeatures: {
            ...inferred.features,
            supportsTouEnergy: true,
            supportsCredits: true,
            notes: [...(inferred.notes ?? []), ...(tou2.notes ?? []), ...(credits.notes ?? [])],
          },
        };
      }

      const reqs = requiredBucketsForRateStructure({ rateStructure: rs });
      if (credits.ok && Array.isArray(credits.credits?.rules) && credits.credits.rules.length > 0) {
        return {
          planCalcVersion,
          planCalcStatus: "COMPUTABLE" as const,
          planCalcReasonCode: "TOU_PLUS_CREDITS_OK",
          requiredBucketKeys: reqs.map((r) => r.key),
          supportedFeatures: {
            ...inferred.features,
            supportsTouEnergy: true,
            supportsCredits: true,
            notes: [...(inferred.notes ?? []), ...(tou2.notes ?? []), ...(credits.credits?.notes ?? [])],
          },
        };
      }
      return {
        planCalcVersion,
        planCalcStatus: "COMPUTABLE" as const,
        planCalcReasonCode: "TOU_OK",
        requiredBucketKeys: reqs.map((r) => r.key),
        supportedFeatures: { ...inferred.features, supportsTouEnergy: true, notes: [...inferred.notes, ...(tou2.notes ?? [])] },
      };
    }

    if (fixed != null) {
      if (minimum.ok) {
        return {
          planCalcVersion,
          planCalcStatus: "COMPUTABLE" as const,
          planCalcReasonCode: "FIXED_PLUS_MINIMUM_RULES_OK",
          requiredBucketKeys: ["kwh.m.all.total"],
          supportedFeatures: {
            ...inferred.features,
            supportsMinUsageFees: true,
            notes: [...(inferred.notes ?? []), ...(minimum.minimum?.notes ?? [])],
          },
        };
      }
      if (!minimum.ok && minimum.reason !== "NO_MIN_RULES") {
        return {
          planCalcVersion,
          planCalcStatus: "NOT_COMPUTABLE" as const,
          planCalcReasonCode: minimum.reason,
          requiredBucketKeys: ["kwh.m.all.total"],
          supportedFeatures: {
            ...inferred.features,
            supportsMinUsageFees: true,
            notes: [...(inferred.notes ?? []), ...(minimum.notes ?? [])],
          },
        };
      }

      if (credits.ok) {
        return {
          planCalcVersion,
          planCalcStatus: "COMPUTABLE" as const,
          planCalcReasonCode: "FIXED_PLUS_BILL_CREDITS_OK",
          requiredBucketKeys: ["kwh.m.all.total"],
          supportedFeatures: {
            ...inferred.features,
            supportsCredits: true,
            notes: [...(inferred.notes ?? []), ...(credits.credits?.notes ?? [])],
          },
        };
      }
      if (!credits.ok && credits.reason !== "NO_CREDITS") {
        return {
          planCalcVersion,
          planCalcStatus: "NOT_COMPUTABLE" as const,
          planCalcReasonCode: credits.reason,
          requiredBucketKeys: ["kwh.m.all.total"],
          supportedFeatures: {
            ...inferred.features,
            supportsCredits: true,
            notes: [...(inferred.notes ?? []), ...(credits.notes ?? [])],
          },
        };
      }

      // SAFETY: If the template's own modeled proof says this is TOU-like (requires a usage split),
      // never mark it as a simple fixed-rate computable plan.
      const assumptionsUsed = (rs as any)?.__eflAvgPriceValidation?.assumptionsUsed ?? null;
      if (hasTouAssumptionEvidence(assumptionsUsed)) {
        return {
          planCalcVersion,
          planCalcStatus: "NOT_COMPUTABLE" as const,
          planCalcReasonCode: "SUSPECT_TOU_EVIDENCE_IN_VALIDATION",
          requiredBucketKeys: ["kwh.m.all.total"],
          supportedFeatures: {
            ...inferred.features,
            supportsTouEnergy: true,
            notes: [
              ...(inferred.notes ?? []),
              "Guardrail: modeled EFL validation assumptions indicate TOU-like usage split, so this template cannot be treated as a simple fixed-rate plan.",
            ],
          },
        };
      }
      return {
        planCalcVersion,
        planCalcStatus: "COMPUTABLE" as const,
        planCalcReasonCode: "FIXED_RATE_OK",
        requiredBucketKeys: ["kwh.m.all.total"],
        supportedFeatures: { ...inferred.features, notes: inferred.notes },
      };
    }

    const indexed = detectIndexedOrVariable(rs);
    if (indexed.isIndexed) {
      return {
        planCalcVersion,
        // Indexed/variable pricing is supported in APPROX mode using EFL anchors (engine handles this).
        planCalcStatus: "COMPUTABLE" as const,
        planCalcReasonCode: "INDEXED_APPROXIMATE_OK",
        requiredBucketKeys: ["kwh.m.all.total"],
        supportedFeatures: {
          ...inferred.features,
          supportsFixedEnergyRate: false,
          supportsTouEnergy: false,
          notes: [
            ...(inferred.notes ?? []),
            ...(indexed.notes ?? []),
            "Indexed/variable pricing is not deterministically computable without an explicit approximation mode.",
          ],
        },
      };
    }

    const tiered = extractDeterministicTierSchedule(rs);
    if (tiered.ok) {
      // Tiered + deterministic bill credits (Phase 1) is supported in non-dashboard flows.
      // Treat NO_CREDITS as "no credits present" (tiered-only), and propagate unsupported credit reasons.
      if (credits.ok && Array.isArray(credits.credits?.rules) && credits.credits.rules.length > 0) {
        return {
          planCalcVersion,
          planCalcStatus: "COMPUTABLE" as const,
          planCalcReasonCode: "TIERED_PLUS_CREDITS_OK",
          requiredBucketKeys: ["kwh.m.all.total"],
          supportedFeatures: {
            ...inferred.features,
            supportsTieredEnergy: true,
            supportsCredits: true,
            notes: [...(inferred.notes ?? []), ...(tiered.schedule.notes ?? []), ...(credits.credits?.notes ?? [])],
          },
        };
      }
      if (!credits.ok && credits.reason !== "NO_CREDITS") {
        return {
          planCalcVersion,
          planCalcStatus: "NOT_COMPUTABLE" as const,
          planCalcReasonCode: credits.reason,
          requiredBucketKeys: ["kwh.m.all.total"],
          supportedFeatures: {
            ...inferred.features,
            supportsTieredEnergy: true,
            supportsCredits: true,
            notes: [...(inferred.notes ?? []), ...(tiered.schedule.notes ?? []), ...(credits.notes ?? [])],
          },
        };
      }
      return {
        planCalcVersion,
        planCalcStatus: "COMPUTABLE" as const,
        planCalcReasonCode: "TIERED_OK",
        requiredBucketKeys: ["kwh.m.all.total"],
        supportedFeatures: {
          ...inferred.features,
          supportsTieredEnergy: true,
          notes: [...(inferred.notes ?? []), ...(tiered.schedule.notes ?? [])],
        },
      };
    } else if (
      tiered.reason === "UNSUPPORTED_COMBINED_STRUCTURES" ||
      tiered.reason === "UNSUPPORTED_TIER_SHAPE" ||
      tiered.reason === "UNSUPPORTED_TIER_VARIATION"
    ) {
      return {
        planCalcVersion,
        planCalcStatus: "NOT_COMPUTABLE" as const,
        planCalcReasonCode: tiered.reason,
        requiredBucketKeys: ["kwh.m.all.total"],
        supportedFeatures: {
          ...inferred.features,
          supportsTieredEnergy: true,
          notes: [...(inferred.notes ?? []), ...(tiered.notes ?? [])],
        },
      };
    }

    if (minimum.ok) {
      return {
        planCalcVersion,
        planCalcStatus: "NOT_COMPUTABLE" as const,
        planCalcReasonCode: "MINIMUM_RULES_REQUIRES_USAGE_BUCKETS",
        requiredBucketKeys: ["kwh.m.all.total"],
        supportedFeatures: {
          ...inferred.features,
          supportsMinUsageFees: true,
          notes: [...(inferred.notes ?? []), ...(minimum.minimum?.notes ?? [])],
        },
      };
    } else if (!minimum.ok && minimum.reason !== "NO_MIN_RULES") {
      return {
        planCalcVersion,
        planCalcStatus: "NOT_COMPUTABLE" as const,
        planCalcReasonCode: minimum.reason,
        requiredBucketKeys: ["kwh.m.all.total"],
        supportedFeatures: {
          ...inferred.features,
          supportsMinUsageFees: true,
          notes: [...(inferred.notes ?? []), ...(minimum.notes ?? [])],
        },
      };
    }

    if (credits.ok) {
      return {
        planCalcVersion,
        planCalcStatus: "NOT_COMPUTABLE" as const,
        planCalcReasonCode: "BILL_CREDITS_REQUIRES_USAGE_BUCKETS",
        requiredBucketKeys: ["kwh.m.all.total"],
        supportedFeatures: {
          ...inferred.features,
          supportsCredits: true,
          notes: [...(inferred.notes ?? []), ...(credits.credits?.notes ?? [])],
        },
      };
    } else if (!credits.ok && credits.reason !== "NO_CREDITS") {
      return {
        planCalcVersion,
        planCalcStatus: "NOT_COMPUTABLE" as const,
        planCalcReasonCode: credits.reason,
        requiredBucketKeys: ["kwh.m.all.total"],
        supportedFeatures: {
          ...inferred.features,
          supportsCredits: true,
          notes: [...(inferred.notes ?? []), ...(credits.notes ?? [])],
        },
      };
    }

    if (inferred.features.supportsTouEnergy) {
      const reasonCode = (tou2 as any)?.reasonCode ? String((tou2 as any).reasonCode) : "UNSUPPORTED_RATE_STRUCTURE";
      return {
        planCalcVersion,
        planCalcStatus: "NOT_COMPUTABLE" as const,
        planCalcReasonCode: reasonCode,
        requiredBucketKeys: ["kwh.m.all.total"],
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

  // IMPORTANT:
  // Validate requiredBucketKeys against the monthly bucket-key grammar.
  // If a template emits an invalid bucket key, that's a TEMPLATE defect (not home-specific) and should be queued.
  try {
    bucketDefsFromBucketKeys(Array.isArray(out.requiredBucketKeys) ? out.requiredBucketKeys : []);
  } catch (e: any) {
    const msg = e?.message ? String(e.message) : String(e);
    return {
      planCalcVersion,
      planCalcStatus: "NOT_COMPUTABLE",
      planCalcReasonCode: "UNSUPPORTED_BUCKET_KEY",
      requiredBucketKeys: Array.isArray(out.requiredBucketKeys) ? out.requiredBucketKeys : [],
      supportedFeatures: {
        ...(out.supportedFeatures ?? {}),
        notes: [
          ...((out.supportedFeatures as any)?.notes ?? []),
          `Invalid required bucket key(s): ${msg}`,
        ],
      },
    };
  }

  // Side-effect only (best-effort): ensure usage bucket definitions exist in the registry table.
  // This must not change status logic; failures here are typically infrastructure/transient.
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

  if (derived.planCalcStatus !== "COMPUTABLE") {
    return {
      status: "NOT_COMPUTABLE",
      reasonCode: derived.planCalcReasonCode,
      reason: "Rate structure is not supported by the plan engine.",
      details: {
        offerId: input.offerId,
        ratePlanId: input.ratePlanId,
        notes: inferred.notes,
        features: inferred.features,
      },
    };
  }

  // Use authoritative required buckets derived from the rateStructure.
  const requiredBucketKeys = Array.isArray(derived.requiredBucketKeys) ? derived.requiredBucketKeys : ["kwh.m.all.total"];

  return {
    status: "COMPUTABLE",
    requiredBucketKeys,
    notes: inferred.notes,
  };
}


