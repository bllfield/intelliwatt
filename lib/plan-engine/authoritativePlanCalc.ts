import {
  computePlanCalcTemplateFingerprint,
  derivePlanCalcRequirementsFromTemplate,
} from "@/lib/plan-engine/planComputability";

type StoredPlanCalcInputs = {
  planCalcStatus?: string | null;
  planCalcReasonCode?: string | null;
  requiredBucketKeys?: unknown;
  supportedFeatures?: unknown;
};

export function getStoredPlanCalcTemplateFingerprint(
  supportedFeatures: unknown,
): string | null {
  const fingerprint = (supportedFeatures as any)?.__planCalcTemplateFingerprint;
  return typeof fingerprint === "string" && fingerprint.trim() ? fingerprint.trim() : null;
}

export function selectAuthoritativePlanCalc(args: {
  rateStructure: any | null | undefined;
  stored?: StoredPlanCalcInputs | null;
}) {
  const derived = derivePlanCalcRequirementsFromTemplate({
    rateStructure: args.rateStructure ?? null,
  });
  const currentFingerprint = computePlanCalcTemplateFingerprint(args.rateStructure ?? null);
  const storedStatus =
    typeof args.stored?.planCalcStatus === "string"
      ? String(args.stored.planCalcStatus).trim().toUpperCase()
      : null;
  const storedReason =
    typeof args.stored?.planCalcReasonCode === "string"
      ? String(args.stored.planCalcReasonCode).trim()
      : null;
  const storedRequiredBucketKeys = Array.isArray(args.stored?.requiredBucketKeys)
    ? (args.stored?.requiredBucketKeys as any[])
        .map((key) => String(key ?? "").trim())
        .filter(Boolean)
    : [];
  const storedFingerprint = getStoredPlanCalcTemplateFingerprint(
    args.stored?.supportedFeatures,
  );
  const hasStoredAuthoritativeStatus =
    storedStatus === "COMPUTABLE" || storedStatus === "NOT_COMPUTABLE";
  const fingerprintChanged = Boolean(
    hasStoredAuthoritativeStatus &&
      currentFingerprint &&
      storedFingerprint &&
      currentFingerprint !== storedFingerprint,
  );
  const useStored = hasStoredAuthoritativeStatus && !fingerprintChanged;

  return {
    source: useStored ? ("stored" as const) : ("derived" as const),
    fingerprintChanged,
    templateFingerprint: currentFingerprint,
    storedTemplateFingerprint: storedFingerprint,
    derived,
    planCalcStatus: useStored ? storedStatus : derived.planCalcStatus,
    planCalcReasonCode: useStored
      ? storedReason || "UNKNOWN"
      : derived.planCalcReasonCode,
    requiredBucketKeys: useStored
      ? storedRequiredBucketKeys.length > 0
        ? storedRequiredBucketKeys
        : derived.requiredBucketKeys
      : derived.requiredBucketKeys,
    supportedFeatures:
      useStored && args.stored?.supportedFeatures && typeof args.stored.supportedFeatures === "object"
        ? (args.stored.supportedFeatures as Record<string, unknown>)
        : derived.supportedFeatures,
  };
}
