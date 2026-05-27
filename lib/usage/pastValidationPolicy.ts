import {
  normalizeValidationSelectionMode,
  type ValidationDaySelectionMode,
} from "@/modules/onePathSim/usageSimulator/validationSelection";

export type PastValidationPolicySurface = "user_site" | "admin_lab";

export type ValidationPolicyOwner = "userValidationPolicy" | "adminValidationPolicy";

/** Canonical Past SMT auto-pick mode for user site and One Path admin lab. */
export const CANONICAL_PAST_SMT_VALIDATION_SELECTION_MODE: ValidationDaySelectionMode =
  "stratified_weather_balanced";

/** Canonical Past SMT validation-day count when callers do not override. */
export const CANONICAL_PAST_SMT_VALIDATION_DAY_COUNT = 14;

/** Bumped when shared user/One Path validation selection policy changes. */
export const PAST_VALIDATION_POLICY_REVISION = "unified_stratified_14_v1";

export type ResolvedPastSmtValidationPolicy = {
  owner: ValidationPolicyOwner;
  selectionMode: ValidationDaySelectionMode;
  validationDayCount: number;
};

export function normalizePastValidationDayCount(value: number | null | undefined): number {
  const normalized = Math.floor(Number(value) || CANONICAL_PAST_SMT_VALIDATION_DAY_COUNT);
  return Math.max(1, Math.min(365, normalized));
}

export function resolveCanonicalPastValidationSelectionMode(): ValidationDaySelectionMode {
  return CANONICAL_PAST_SMT_VALIDATION_SELECTION_MODE;
}

export function resolveCanonicalPastValidationDayCount(value?: number | null): number {
  return normalizePastValidationDayCount(value);
}

export function resolvePastSmtValidationPolicy(args: {
  surface: PastValidationPolicySurface;
  validationSelectionMode?: string | null;
  validationDayCount?: number | null;
}): ResolvedPastSmtValidationPolicy {
  const owner: ValidationPolicyOwner =
    args.surface === "admin_lab" ? "adminValidationPolicy" : "userValidationPolicy";
  const explicitMode = normalizeValidationSelectionMode(args.validationSelectionMode);
  return {
    owner,
    selectionMode: explicitMode ?? resolveCanonicalPastValidationSelectionMode(),
    validationDayCount: resolveCanonicalPastValidationDayCount(args.validationDayCount),
  };
}

export function resolvePastValidationEngineInput(args: {
  surface: PastValidationPolicySurface;
  validationSelectionMode?: string | null;
  validationDayCount?: number | null;
  validationOnlyDateKeysLocal?: string[];
}): {
  validationSelectionMode: ValidationDaySelectionMode;
  validationDayCount: number;
} {
  const hasExplicitKeys = (args.validationOnlyDateKeysLocal ?? []).some((value) =>
    /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? "").slice(0, 10))
  );
  if (hasExplicitKeys) {
    return {
      validationSelectionMode:
        normalizeValidationSelectionMode(args.validationSelectionMode) ?? "manual",
      validationDayCount: resolveCanonicalPastValidationDayCount(args.validationDayCount),
    };
  }
  const policy = resolvePastSmtValidationPolicy({
    surface: args.surface,
    validationSelectionMode: args.validationSelectionMode,
    validationDayCount: args.validationDayCount,
  });
  return {
    validationSelectionMode: policy.selectionMode,
    validationDayCount: policy.validationDayCount,
  };
}

export function resolveUserValidationPolicy(args: {
  /** @deprecated Prefer validationSelectionMode; canonical mode applies when omitted. */
  defaultSelectionMode?: ValidationDaySelectionMode | null;
  validationSelectionMode?: string | null;
  validationDayCount?: number | null;
}): ResolvedPastSmtValidationPolicy {
  return resolvePastSmtValidationPolicy({
    surface: "user_site",
    validationSelectionMode: args.validationSelectionMode ?? args.defaultSelectionMode ?? null,
    validationDayCount: args.validationDayCount,
  });
}

export function resolveAdminValidationPolicy(args: {
  selectionMode?: ValidationDaySelectionMode | string | null;
  validationDayCount?: number | null;
}): ResolvedPastSmtValidationPolicy {
  return resolvePastSmtValidationPolicy({
    surface: "admin_lab",
    validationSelectionMode: args.selectionMode ?? null,
    validationDayCount: args.validationDayCount,
  });
}

/**
 * True when a persisted Past SMT build should re-run auto validation-day selection
 * (missing keys, legacy random_simple picks, or drift from canonical mode/count).
 * Manual date picks are left untouched.
 */
export function shouldReconcilePastSmtValidationSelection(args: {
  storedSelectionMode?: string | null;
  storedValidationKeyCount: number;
}): boolean {
  const canonical = resolvePastSmtValidationPolicy({ surface: "user_site" });
  const storedMode = normalizeValidationSelectionMode(args.storedSelectionMode);
  const keyCount = Math.max(0, Math.floor(Number(args.storedValidationKeyCount) || 0));

  if (keyCount === 0) return true;
  if (storedMode === "manual") return false;
  if (storedMode === "random_simple") return true;
  if (storedMode !== canonical.selectionMode) return true;
  if (keyCount !== canonical.validationDayCount) return true;
  return false;
}
