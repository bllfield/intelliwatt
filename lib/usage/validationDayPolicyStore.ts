import { getFlag, setFlag } from "@/lib/flags";
import {
  normalizePastValidationDayCount,
  type PastValidationPolicySurface,
} from "@/lib/usage/pastValidationPolicy";
import {
  normalizeValidationSelectionMode,
  type ValidationDaySelectionMode,
} from "@/modules/usageSimulator/validationSelection";

export const VALIDATION_DAY_POLICY_FLAG_KEY = "validation_day_policy.v1";
export const VALIDATION_DAY_POLICY_SAVE_CONFIRMATION = "APPLY";

export type StoredValidationDayPolicy = {
  selectionMode: ValidationDaySelectionMode;
  validationDayCount: number;
  surface: PastValidationPolicySurface;
  updatedAt: string;
  updatedBy: string | null;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function parseStoredValidationDayPolicy(raw: string | null | undefined): StoredValidationDayPolicy | null {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return null;
  try {
    const parsed = asRecord(JSON.parse(trimmed));
    const selectionMode = normalizeValidationSelectionMode(parsed.selectionMode);
    if (!selectionMode) return null;
    const validationDayCount = normalizePastValidationDayCount(
      parsed.validationDayCount == null ? null : Number(parsed.validationDayCount)
    );
    const surfaceRaw = String(parsed.surface ?? "admin_lab").trim();
    const surface: PastValidationPolicySurface = surfaceRaw === "user_site" ? "user_site" : "admin_lab";
    return {
      selectionMode,
      validationDayCount,
      surface,
      updatedAt: String(parsed.updatedAt ?? "").trim() || new Date(0).toISOString(),
      updatedBy: String(parsed.updatedBy ?? "").trim() || null,
    };
  } catch {
    return null;
  }
}

export async function readStoredValidationDayPolicyOverride(): Promise<StoredValidationDayPolicy | null> {
  const raw = await getFlag(VALIDATION_DAY_POLICY_FLAG_KEY);
  return parseStoredValidationDayPolicy(raw);
}

export async function saveStoredValidationDayPolicy(args: {
  selectionMode: ValidationDaySelectionMode;
  validationDayCount: number;
  surface?: PastValidationPolicySurface;
  updatedBy?: string | null;
}): Promise<StoredValidationDayPolicy> {
  const stored: StoredValidationDayPolicy = {
    selectionMode: args.selectionMode,
    validationDayCount: normalizePastValidationDayCount(args.validationDayCount),
    surface: args.surface === "user_site" ? "user_site" : "admin_lab",
    updatedAt: new Date().toISOString(),
    updatedBy: args.updatedBy ?? null,
  };
  await setFlag(VALIDATION_DAY_POLICY_FLAG_KEY, JSON.stringify(stored));
  return stored;
}

export async function clearStoredValidationDayPolicy(): Promise<void> {
  await setFlag(VALIDATION_DAY_POLICY_FLAG_KEY, "");
}
