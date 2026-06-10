import { prisma } from "@/lib/db";
import { localDateKeysInRange } from "@/lib/admin/gapfillLab";
import { sha256DigestBase64Url } from "@/lib/crypto/sha256Base64Url";
import { getActualUsageDatasetForHouse } from "@/lib/usage/actualDatasetForHouse";
import { resolveCanonicalUsage365CoverageWindow } from "@/lib/usage/canonicalMetadataWindow";
import {
  CANONICAL_PAST_VALIDATION_DAY_COUNT,
  CANONICAL_PAST_VALIDATION_SELECTION_MODE,
  PAST_VALIDATION_POLICY_REVISION,
  resolvePastValidationPolicy,
  type PastValidationPolicySurface,
  type ResolvedPastValidationPolicy,
} from "@/lib/usage/pastValidationPolicy";
import { travelRangesToExcludeDateKeys } from "@/modules/usageSimulator/build";
import {
  normalizeValidationSelectionMode,
  selectValidationDayKeys,
  type ValidationDaySelectionDiagnostics,
  type ValidationDaySelectionMode,
} from "@/modules/usageSimulator/validationSelection";

/** MG-2 global validation-day policy admin/preview layer (read-only; does not replace artifact stamps). */
export const VALIDATION_DAY_POLICY_LAYER = "global_validation_day_policy_v1";

export type ValidationDayPolicyOverrideSource = "code_defaults" | "env_override" | "request_preview";

export type ValidationDayPolicyConfig = {
  layer: typeof VALIDATION_DAY_POLICY_LAYER;
  policyRevision: string;
  surface: PastValidationPolicySurface;
  owner: ResolvedPastValidationPolicy["owner"];
  selectionMode: ValidationDaySelectionMode;
  validationDayCount: number;
  overrideSource: ValidationDayPolicyOverrideSource;
  envOverrideApplied: boolean;
};

export type ValidationDayPolicyPreviewDiagnostics = {
  houseId: string;
  userId: string;
  windowStart: string;
  windowEnd: string;
  timezone: string;
  candidateDateKeyCount: number;
  excludedTravelDateKeyCount: number;
  selectionDiagnostics: ValidationDaySelectionDiagnostics;
  localGapFillSelectorUsed: false;
  sharedPolicySelectorOwner: "selectValidationDayKeys";
};

export type ValidationDayPolicyPreviewResult = {
  ok: true;
  policyRevision: string;
  policyLayer: typeof VALIDATION_DAY_POLICY_LAYER;
  policyHash: string;
  policy: ValidationDayPolicyConfig;
  selectionMode: ValidationDaySelectionMode;
  validationDayCount: number;
  selectedValidationDateKeys: string[];
  diagnostics: ValidationDayPolicyPreviewDiagnostics;
  warnings: string[];
};

const DEFAULT_TIMEZONE = "America/Chicago";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function normalizeDateKey(value: unknown): string | null {
  const key = String(value ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(key) ? key : null;
}

function readEnvValidationDayPolicyOverride(): {
  selectionMode?: ValidationDaySelectionMode;
  validationDayCount?: number;
  surface?: PastValidationPolicySurface;
} | null {
  const raw = String(process.env.VALIDATION_DAY_POLICY_OVERRIDE_JSON ?? "").trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const selectionMode = normalizeValidationSelectionMode(parsed.selectionMode);
    const validationDayCount =
      parsed.validationDayCount == null ? undefined : Math.floor(Number(parsed.validationDayCount));
    const surfaceRaw = String(parsed.surface ?? "").trim();
    const surface: PastValidationPolicySurface | undefined =
      surfaceRaw === "user_site" || surfaceRaw === "admin_lab" ? surfaceRaw : undefined;
    return {
      ...(selectionMode ? { selectionMode } : {}),
      ...(Number.isFinite(validationDayCount) ? { validationDayCount } : {}),
      ...(surface ? { surface } : {}),
    };
  } catch {
    return null;
  }
}

export function computeValidationDayPolicyHash(config: ValidationDayPolicyConfig): string {
  return sha256DigestBase64Url(
    JSON.stringify({
      layer: config.layer,
      policyRevision: config.policyRevision,
      surface: config.surface,
      owner: config.owner,
      selectionMode: config.selectionMode,
      validationDayCount: config.validationDayCount,
      overrideSource: config.overrideSource,
    }),
    22
  );
}

export function resolveActiveValidationDayPolicy(args?: {
  surface?: PastValidationPolicySurface;
  validationSelectionMode?: string | null;
  validationDayCount?: number | null;
  overrideSource?: ValidationDayPolicyOverrideSource;
}): ValidationDayPolicyConfig {
  const envOverride =
    args?.overrideSource === "code_defaults" ? null : readEnvValidationDayPolicyOverride();
  const surface = args?.surface ?? envOverride?.surface ?? "admin_lab";
  const resolved = resolvePastValidationPolicy({
    surface,
    validationSelectionMode:
      args?.validationSelectionMode ?? envOverride?.selectionMode ?? null,
    validationDayCount: args?.validationDayCount ?? envOverride?.validationDayCount ?? null,
  });
  const overrideSource =
    args?.overrideSource ??
    (envOverride &&
    (envOverride.selectionMode != null ||
      envOverride.validationDayCount != null ||
      envOverride.surface != null)
      ? "env_override"
      : "code_defaults");

  return {
    layer: VALIDATION_DAY_POLICY_LAYER,
    policyRevision: PAST_VALIDATION_POLICY_REVISION,
    surface,
    owner: resolved.owner,
    selectionMode: resolved.selectionMode,
    validationDayCount: resolved.validationDayCount,
    overrideSource,
    envOverrideApplied: Boolean(envOverride),
  };
}

export function getValidationDayPolicySnapshot(args?: {
  surface?: PastValidationPolicySurface;
}): {
  ok: true;
  policyRevision: string;
  policyLayer: typeof VALIDATION_DAY_POLICY_LAYER;
  policyHash: string;
  defaults: {
    selectionMode: ValidationDaySelectionMode;
    validationDayCount: number;
    surface: PastValidationPolicySurface;
  };
  activePolicy: ValidationDayPolicyConfig;
  envOverride: ReturnType<typeof readEnvValidationDayPolicyOverride>;
} {
  const defaultsPolicy = resolveActiveValidationDayPolicy({
    surface: args?.surface ?? "admin_lab",
    overrideSource: "code_defaults",
  });
  const activePolicy = resolveActiveValidationDayPolicy({ surface: args?.surface ?? "admin_lab" });
  return {
    ok: true,
    policyRevision: PAST_VALIDATION_POLICY_REVISION,
    policyLayer: VALIDATION_DAY_POLICY_LAYER,
    policyHash: computeValidationDayPolicyHash(activePolicy),
    defaults: {
      selectionMode: CANONICAL_PAST_VALIDATION_SELECTION_MODE,
      validationDayCount: CANONICAL_PAST_VALIDATION_DAY_COUNT,
      surface: args?.surface ?? "admin_lab",
    },
    activePolicy,
    envOverride: readEnvValidationDayPolicyOverride(),
  };
}

async function readTravelDateKeysForHouse(args: {
  userId: string;
  houseId: string;
  window: { startDate: string; endDate: string };
}): Promise<Set<string>> {
  const build = await prisma.usageSimulatorBuild
    .findFirst({
      where: { userId: args.userId, houseId: args.houseId },
      orderBy: { updatedAt: "desc" },
      select: { buildInputs: true },
    })
    .catch(() => null);
  const buildInputs = asRecord(build?.buildInputs);
  const travelRanges = Array.isArray(buildInputs.travelRanges)
    ? (buildInputs.travelRanges as Array<{ startDate?: string; endDate?: string }>)
        .map((range) => ({
          startDate: normalizeDateKey(range.startDate) ?? "",
          endDate: normalizeDateKey(range.endDate) ?? "",
        }))
        .filter((range) => range.startDate && range.endDate)
    : [];
  const keys = travelRanges.length ? travelRangesToExcludeDateKeys(travelRanges) : [];
  const bounded = keys.filter((key) => key >= args.window.startDate && key <= args.window.endDate);
  return new Set(bounded);
}

async function resolveCandidateDateKeys(args: {
  houseId: string;
  userId: string;
  esiid: string | null;
  window: { startDate: string; endDate: string };
  timezone: string;
}): Promise<string[]> {
  const actual = await getActualUsageDatasetForHouse(args.houseId, args.esiid, {
    userId: args.userId,
    skipFullYearIntervalFetch: true,
    skipLightweightInsightRecompute: true,
  }).catch(() => ({ dataset: null }));

  const fromDaily = Array.isArray(actual?.dataset?.daily)
    ? actual!.dataset!.daily
        .map((row) => normalizeDateKey(row.date))
        .filter((key): key is string => Boolean(key))
        .filter((key) => key >= args.window.startDate && key <= args.window.endDate)
    : [];

  if (fromDaily.length > 0) {
    return Array.from(new Set(fromDaily)).sort();
  }

  return localDateKeysInRange(args.window.startDate, args.window.endDate, args.timezone);
}

export async function previewGlobalValidationDaySelection(args: {
  houseId: string;
  userId: string;
  esiid?: string | null;
  sourceHouseId?: string | null;
  window?: { startDate: string; endDate: string } | null;
  validationDayCount?: number | null;
  mode?: string | null;
  surface?: PastValidationPolicySurface;
}): Promise<ValidationDayPolicyPreviewResult> {
  const houseId = String(args.sourceHouseId ?? args.houseId ?? "").trim();
  const userId = String(args.userId ?? "").trim();
  const window = args.window ?? resolveCanonicalUsage365CoverageWindow();
  const timezone = DEFAULT_TIMEZONE;
  const warnings: string[] = [];

  if (!houseId || !userId) {
    throw new Error("houseId and userId are required.");
  }

  const house = await prisma.houseAddress
    .findFirst({
      where: { id: houseId, userId, archivedAt: null },
      select: { id: true, esiid: true },
    })
    .catch(() => null);

  if (!house?.id) {
    warnings.push("House not found; preview uses calendar window candidates only.");
  }

  const effectiveEsiid = args.esiid ?? house?.esiid ?? null;
  const policy = resolveActiveValidationDayPolicy({
    surface: args.surface ?? "admin_lab",
    validationSelectionMode: args.mode ?? null,
    validationDayCount: args.validationDayCount ?? null,
    overrideSource: args.mode != null || args.validationDayCount != null ? "request_preview" : undefined,
  });

  const explicitMode = normalizeValidationSelectionMode(args.mode);
  if (args.mode && !explicitMode) {
    warnings.push(`Unknown mode "${args.mode}" ignored; using policy selectionMode ${policy.selectionMode}.`);
  }

  const candidateDateKeys = house?.id
    ? await resolveCandidateDateKeys({
        houseId,
        userId,
        esiid: effectiveEsiid,
        window,
        timezone,
      })
    : localDateKeysInRange(window.startDate, window.endDate, timezone);

  const travelDateKeysSet = house?.id
    ? await readTravelDateKeysForHouse({ userId, houseId, window })
    : new Set<string>();

  if (candidateDateKeys.length === 0) {
    warnings.push("No candidate date keys available for the requested window.");
  }

  const selection = selectValidationDayKeys({
    mode: policy.selectionMode,
    targetCount: policy.validationDayCount,
    candidateDateKeys,
    travelDateKeysSet,
    timezone,
    seed: `${houseId}-${window.endDate}-${policy.policyRevision}`,
  });

  return {
    ok: true,
    policyRevision: policy.policyRevision,
    policyLayer: VALIDATION_DAY_POLICY_LAYER,
    policyHash: computeValidationDayPolicyHash(policy),
    policy,
    selectionMode: policy.selectionMode,
    validationDayCount: policy.validationDayCount,
    selectedValidationDateKeys: selection.selectedDateKeys,
    diagnostics: {
      houseId,
      userId,
      windowStart: window.startDate,
      windowEnd: window.endDate,
      timezone,
      candidateDateKeyCount: candidateDateKeys.length,
      excludedTravelDateKeyCount: travelDateKeysSet.size,
      selectionDiagnostics: selection.diagnostics,
      localGapFillSelectorUsed: false,
      sharedPolicySelectorOwner: "selectValidationDayKeys",
    },
    warnings,
  };
}
