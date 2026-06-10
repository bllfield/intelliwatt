import {
  normalizeValidationSelectionMode,
  type ValidationDaySelectionMode,
} from "@/modules/onePathSim/usageSimulator/validationSelection";

export type PastValidationPolicySurface = "user_site" | "admin_lab";

export type ValidationPolicyOwner = "userValidationPolicy" | "adminValidationPolicy";

/** Canonical auto-pick mode for Past (Corrected) compare days — SMT and Green Button share this. */
export const CANONICAL_PAST_VALIDATION_SELECTION_MODE: ValidationDaySelectionMode =
  "stratified_weather_balanced";

/** Canonical scored compare-day count for Past (Corrected) when callers do not override. */
export const CANONICAL_PAST_VALIDATION_DAY_COUNT = 14;

/** Bumped when shared user/One Path validation selection policy changes. */
export const PAST_VALIDATION_POLICY_REVISION = "unified_past_validation_stratified_14_v4";

export type ResolvedPastValidationPolicy = {
  owner: ValidationPolicyOwner;
  selectionMode: ValidationDaySelectionMode;
  validationDayCount: number;
};

export function normalizePastValidationDayCount(value: number | null | undefined): number {
  const normalized = Math.floor(Number(value) || CANONICAL_PAST_VALIDATION_DAY_COUNT);
  return Math.max(1, Math.min(365, normalized));
}

export function resolveCanonicalPastValidationSelectionMode(): ValidationDaySelectionMode {
  return CANONICAL_PAST_VALIDATION_SELECTION_MODE;
}

export function resolveCanonicalPastValidationDayCount(value?: number | null): number {
  return normalizePastValidationDayCount(value);
}

/** Shared Past validation policy (interval SMT and Green Button Past — not SMT-only). */
export function resolvePastValidationPolicy(args: {
  surface: PastValidationPolicySurface;
  /** @deprecated Per-run overrides ignored — use resolveActiveValidationDayPolicy (MG-2). */
  validationSelectionMode?: string | null;
  /** @deprecated Per-run overrides ignored — use resolveActiveValidationDayPolicy (MG-2). */
  validationDayCount?: number | null;
}): ResolvedPastValidationPolicy {
  const owner: ValidationPolicyOwner =
    args.surface === "admin_lab" ? "adminValidationPolicy" : "userValidationPolicy";
  return {
    owner,
    selectionMode: resolveCanonicalPastValidationSelectionMode(),
    validationDayCount: resolveCanonicalPastValidationDayCount(null),
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
  const policy = resolvePastValidationPolicy({
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
}): ResolvedPastValidationPolicy {
  return resolvePastValidationPolicy({
    surface: "user_site",
    validationSelectionMode: args.validationSelectionMode ?? args.defaultSelectionMode ?? null,
    validationDayCount: args.validationDayCount,
  });
}

export function resolveAdminValidationPolicy(args: {
  selectionMode?: ValidationDaySelectionMode | string | null;
  validationDayCount?: number | null;
}): ResolvedPastValidationPolicy {
  return resolvePastValidationPolicy({
    surface: "admin_lab",
    validationSelectionMode: args.selectionMode ?? null,
    validationDayCount: args.validationDayCount,
  });
}

function seasonFromDateKey(dateKey: string): "winter" | "summer" | "shoulder" {
  const mm = dateKey.slice(5, 7);
  if (mm === "12" || mm === "01" || mm === "02") return "winter";
  if (mm === "06" || mm === "07" || mm === "08") return "summer";
  return "shoulder";
}

function localDayOfWeekFromDateKey(dateKey: string, timezone: string): number {
  try {
    const d = new Date(`${dateKey}T12:00:00.000Z`);
    if (!Number.isFinite(d.getTime())) return 0;
    const short = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, weekday: "short" }).format(d);
    const map: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    return map[short] ?? 0;
  } catch {
    return 0;
  }
}

function calendarDaysInclusive(startDate: string, endDate: string): number {
  const start = new Date(`${startDate}T12:00:00.000Z`).getTime();
  const end = new Date(`${endDate}T12:00:00.000Z`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, Math.round((end - start) / 86_400_000)) + 1;
}

/**
 * True when stored validation keys look like a recent tail cluster (legacy "last N days"
 * picks) rather than stratified season/weekday/weekend spread across the coverage year.
 */
export function storedValidationKeysLookLikeRecentTailCluster(args: {
  storedValidationDateKeysLocal: readonly string[];
  coverageEndDate?: string | null;
}): boolean {
  const keys = Array.from(
    new Set(
      (args.storedValidationDateKeysLocal ?? [])
        .map((dk) => String(dk ?? "").slice(0, 10))
        .filter((dk) => /^\d{4}-\d{2}-\d{2}$/.test(dk))
    )
  ).sort();
  if (keys.length < 8) return false;

  const first = keys[0]!;
  const last = keys[keys.length - 1]!;
  const spanDays = calendarDaysInclusive(first, last);
  if (spanDays > 24) return false;

  const coverageEnd = String(args.coverageEndDate ?? "").slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(coverageEnd)) {
    const gapToEnd = calendarDaysInclusive(last, coverageEnd);
    if (gapToEnd > 21) return false;
  }

  return spanDays <= 24;
}

/**
 * True when auto-picked keys cluster at the start of a few season-month buckets
 * (legacy stratified round-robin across overlapping season/weekday buckets).
 */
export function storedValidationKeysLookLikeSeasonMonthEdgeCluster(args: {
  storedValidationDateKeysLocal: readonly string[];
}): boolean {
  const keys = Array.from(
    new Set(
      (args.storedValidationDateKeysLocal ?? [])
        .map((dk) => String(dk ?? "").slice(0, 10))
        .filter((dk) => /^\d{4}-\d{2}-\d{2}$/.test(dk))
    )
  ).sort();
  if (keys.length < 6) return false;

  const groups = new Map<string, string[]>();
  for (const dk of keys) {
    const bucketKey = `${seasonFromDateKey(dk)}:${dk.slice(0, 7)}`;
    if (!groups.has(bucketKey)) groups.set(bucketKey, []);
    groups.get(bucketKey)!.push(dk);
  }

  let clusteredMonthGroups = 0;
  let keysInClusteredGroups = 0;
  for (const groupKeys of Array.from(groups.values())) {
    if (groupKeys.length < 3) continue;
    const sorted = [...groupKeys].sort();
    const spanDays = calendarDaysInclusive(sorted[0]!, sorted[sorted.length - 1]!);
    if (spanDays <= 12) {
      clusteredMonthGroups += 1;
      keysInClusteredGroups += groupKeys.length;
    }
  }

  return clusteredMonthGroups >= 2 && keysInClusteredGroups >= Math.ceil(keys.length * 0.5);
}

/**
 * True when auto-picked validation keys lack minimum weekday/weekend and season spread
 * expected from stratified_weather_balanced selection.
 */
export function storedValidationKeysLackCanonicalSpread(args: {
  storedValidationDateKeysLocal: readonly string[];
  timezone?: string | null;
}): boolean {
  const keys = Array.from(
    new Set(
      (args.storedValidationDateKeysLocal ?? [])
        .map((dk) => String(dk ?? "").slice(0, 10))
        .filter((dk) => /^\d{4}-\d{2}-\d{2}$/.test(dk))
    )
  );
  if (keys.length < 4) return true;

  const timezone = String(args.timezone ?? "America/Chicago").trim() || "America/Chicago";
  const seasons = new Set<"winter" | "summer" | "shoulder">();
  let weekday = false;
  let weekend = false;
  for (const dk of keys) {
    seasons.add(seasonFromDateKey(dk));
    const dow = localDayOfWeekFromDateKey(dk, timezone);
    if (dow === 0 || dow === 6) weekend = true;
    else weekday = true;
  }
  if (!weekday || !weekend) return true;
  if (seasons.size < 2) return true;
  return false;
}

/**
 * True when a persisted Past (Corrected) build should re-run auto validation-day selection
 * (missing keys, legacy random_simple picks, or drift from canonical mode/count).
 * Applies to SMT interval Past and Green Button Past. Manual date picks are left untouched.
 */
export function shouldReconcilePastValidationSelection(args: {
  storedSelectionMode?: string | null;
  storedValidationKeyCount: number;
  storedValidationDateKeysLocal?: readonly string[];
  storedPastValidationPolicyRevision?: string | null;
  timezone?: string | null;
  coverageEndDate?: string | null;
}): boolean {
  const canonical = resolvePastValidationPolicy({ surface: "user_site" });
  const storedMode = normalizeValidationSelectionMode(args.storedSelectionMode);
  const keyCount = Math.max(0, Math.floor(Number(args.storedValidationKeyCount) || 0));
  const storedKeys = args.storedValidationDateKeysLocal ?? [];
  const storedRevision = String(args.storedPastValidationPolicyRevision ?? "").trim();

  if (keyCount === 0) return true;
  if (storedRevision && storedRevision !== PAST_VALIDATION_POLICY_REVISION) return true;
  if (storedMode === "manual") return keyCount !== canonical.validationDayCount;
  if (storedMode === "random_simple") return true;
  if (storedMode !== canonical.selectionMode) return true;
  if (keyCount !== canonical.validationDayCount) return true;
  if (storedKeys.length === 0) return false;
  if (
    storedMode === canonical.selectionMode &&
    storedValidationKeysLookLikeRecentTailCluster({
      storedValidationDateKeysLocal: storedKeys,
      coverageEndDate: args.coverageEndDate,
    })
  ) {
    return true;
  }
  if (
    storedMode === canonical.selectionMode &&
    storedValidationKeysLackCanonicalSpread({
      storedValidationDateKeysLocal: storedKeys,
      timezone: args.timezone,
    })
  ) {
    return true;
  }
  if (
    storedMode === canonical.selectionMode &&
    storedValidationKeysLookLikeSeasonMonthEdgeCluster({
      storedValidationDateKeysLocal: storedKeys,
    })
  ) {
    return true;
  }
  return false;
}

/** @deprecated Use CANONICAL_PAST_VALIDATION_SELECTION_MODE. */
export const CANONICAL_PAST_SMT_VALIDATION_SELECTION_MODE = CANONICAL_PAST_VALIDATION_SELECTION_MODE;
/** @deprecated Use CANONICAL_PAST_VALIDATION_DAY_COUNT. */
export const CANONICAL_PAST_SMT_VALIDATION_DAY_COUNT = CANONICAL_PAST_VALIDATION_DAY_COUNT;
/** @deprecated Use ResolvedPastValidationPolicy. */
export type ResolvedPastSmtValidationPolicy = ResolvedPastValidationPolicy;
/** @deprecated Use resolvePastValidationPolicy. */
export const resolvePastSmtValidationPolicy = resolvePastValidationPolicy;
/** @deprecated Use shouldReconcilePastValidationSelection. */
export const shouldReconcilePastSmtValidationSelection = shouldReconcilePastValidationSelection;
