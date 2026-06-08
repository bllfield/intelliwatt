import { createHash } from "crypto";

/** How validation donor pools exclude scored holdout days. */
export type ValidationHoldoutMode = "leave_one_out" | "strict_holdout";

export const DEFAULT_VALIDATION_HOLDOUT_MODE: ValidationHoldoutMode = "strict_holdout";

export type PastIntervalSourceType = "GREEN_BUTTON" | "SMT" | "INTERVAL" | string;

export type ValidationHoldoutAuditRow = {
  sourceType: PastIntervalSourceType;
  validationDate: string;
  validationHoldoutMode: ValidationHoldoutMode;
  targetDateExcludedFromDonors: boolean;
  targetDateExcludedFromShapePool: boolean;
  selectedDonorLocalDates: string[];
  selectedDonorContainsTargetDate: boolean;
  simulatedReasonCode: string | null;
  templateSelectionKind: string | null;
  shape96Hash: string | null;
};

export type ValidationHoldoutProofResult = {
  ok: boolean;
  violations: string[];
};

function asDateKey(value: unknown): string | null {
  const text = String(value ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

export function normalizeValidationHoldoutDateKeys(keys: Iterable<string> | null | undefined): Set<string> {
  const out = new Set<string>();
  if (!keys) return out;
  for (const key of Array.from(keys)) {
    const dk = asDateKey(key);
    if (dk) out.add(dk);
  }
  return out;
}

export function resolveValidationHoldoutMode(value: unknown): ValidationHoldoutMode {
  const mode = String(value ?? "").trim();
  if (mode === "leave_one_out") return "leave_one_out";
  return DEFAULT_VALIDATION_HOLDOUT_MODE;
}

/** Dates that must not appear in donor/shape pools when simulating a validation target day. */
export function resolveDonorExclusionDatesForValidationTarget(args: {
  validationDate: string;
  validationHoldoutDateKeys: ReadonlySet<string>;
  mode: ValidationHoldoutMode;
}): Set<string> {
  const target = asDateKey(args.validationDate);
  const excluded = new Set<string>();
  if (!target) return excluded;
  excluded.add(target);
  if (args.mode === "strict_holdout") {
    for (const dk of Array.from(args.validationHoldoutDateKeys)) {
      const normalized = asDateKey(dk);
      if (normalized) excluded.add(normalized);
    }
  }
  return excluded;
}

export function hashShape96(shape96: ReadonlyArray<number> | null | undefined): string | null {
  if (!Array.isArray(shape96) || shape96.length === 0) return null;
  return createHash("sha256")
    .update(JSON.stringify(shape96.map((v) => Number(v) || 0)), "utf8")
    .digest("base64url")
    .slice(0, 22);
}

export function isSameDayKeepRefTemplateForHoldout(args: {
  templateSelectionKind: string | null | undefined;
  simulatedReasonCode: string | null | undefined;
}): boolean {
  const kind = String(args.templateSelectionKind ?? "").trim();
  const reason = String(args.simulatedReasonCode ?? "").trim();
  return (
    kind === "validation_keep_ref_shared_day_template" ||
    reason === "TEST_MODELED_KEEP_REF" ||
    (kind.includes("keep_ref") && reason.includes("KEEP_REF"))
  );
}

export function simulatedReasonCopiesTargetActualForHoldout(simulatedReasonCode: string | null | undefined): boolean {
  return String(simulatedReasonCode ?? "").trim() === "TEST_MODELED_KEEP_REF";
}

export function buildValidationHoldoutAuditRow(args: {
  sourceType: PastIntervalSourceType;
  validationDate: string;
  validationHoldoutMode: ValidationHoldoutMode;
  selectedDonorLocalDates: string[] | null | undefined;
  simulatedReasonCode: string | null | undefined;
  templateSelectionKind: string | null | undefined;
  shape96Used?: ReadonlyArray<number> | null;
  targetDateExcludedFromDonors?: boolean;
  targetDateExcludedFromShapePool?: boolean;
}): ValidationHoldoutAuditRow {
  const validationDate = asDateKey(args.validationDate) ?? String(args.validationDate ?? "").slice(0, 10);
  const selectedDonorLocalDates = Array.isArray(args.selectedDonorLocalDates)
    ? args.selectedDonorLocalDates.map((dk) => String(dk ?? "").slice(0, 10)).filter((dk) => /^\d{4}-\d{2}-\d{2}$/.test(dk))
    : [];
  const selectedDonorContainsTargetDate = selectedDonorLocalDates.includes(validationDate);
  return {
    sourceType: args.sourceType,
    validationDate,
    validationHoldoutMode: args.validationHoldoutMode,
    targetDateExcludedFromDonors: args.targetDateExcludedFromDonors ?? true,
    targetDateExcludedFromShapePool: args.targetDateExcludedFromShapePool ?? true,
    selectedDonorLocalDates,
    selectedDonorContainsTargetDate,
    simulatedReasonCode: args.simulatedReasonCode ?? null,
    templateSelectionKind: args.templateSelectionKind ?? null,
    shape96Hash: hashShape96(args.shape96Used),
  };
}

export function assertValidationHoldoutProofGates(
  rows: ReadonlyArray<ValidationHoldoutAuditRow>
): ValidationHoldoutProofResult {
  const violations: string[] = [];
  for (const row of rows) {
    const prefix = `${row.validationDate}:`;
    if (row.selectedDonorContainsTargetDate) {
      violations.push(`${prefix} selectedDonorContainsTargetDate=true`);
    }
    if (row.selectedDonorLocalDates.includes(row.validationDate)) {
      violations.push(`${prefix} selectedDonorLocalDates includes validationDate`);
    }
    if (isSameDayKeepRefTemplateForHoldout(row)) {
      violations.push(`${prefix} templateSelectionKind uses same-day keep-ref for holdout scoring`);
    }
    if (simulatedReasonCopiesTargetActualForHoldout(row.simulatedReasonCode)) {
      violations.push(`${prefix} simulatedReasonCode copies target actual day into validation sim`);
    }
    if (!row.targetDateExcludedFromDonors) {
      violations.push(`${prefix} targetDateExcludedFromDonors is not true`);
    }
    if (!row.targetDateExcludedFromShapePool) {
      violations.push(`${prefix} targetDateExcludedFromShapePool is not true`);
    }
  }
  return { ok: violations.length === 0, violations };
}

/** Metric label for validation compare — only Holdout/Validation WAPE when proof gates pass. */
export function resolveValidationCompareMetricLabel(holdoutProofOk: boolean): "Reconstruction check" | "Validation WAPE" | "Holdout WAPE" {
  return holdoutProofOk ? "Holdout WAPE" : "Reconstruction check";
}

export function resolveValidationCompareMetricKind(
  holdoutProofOk: boolean
): "reconstruction_check" | "holdout_wape" {
  return holdoutProofOk ? "holdout_wape" : "reconstruction_check";
}

export function filterWeatherDonorSamplesForHoldout<T extends { localDate?: string }>(
  samples: ReadonlyArray<T> | null | undefined,
  excludeLocalDates: ReadonlySet<string>
): T[] {
  if (!Array.isArray(samples) || samples.length === 0 || excludeLocalDates.size === 0) {
    return Array.isArray(samples) ? [...samples] : [];
  }
  return samples.filter((sample) => {
    const dk = asDateKey(sample.localDate);
    return dk != null && !excludeLocalDates.has(dk);
  });
}

export function filterNeighborDayTotalsForHoldout<
  T extends { localDate?: string; dayOfMonth: number; dayKwh: number },
>(neighborDayTotals:
  | {
      weekdayByMonth?: Record<string, T[]> | null;
      weekendByMonth?: Record<string, T[]> | null;
    }
  | null
  | undefined,
excludeLocalDates: ReadonlySet<string>): {
  weekdayByMonth: Record<string, T[]>;
  weekendByMonth: Record<string, T[]>;
} {
  const filterBucket = (bucket: Record<string, T[]> | null | undefined) => {
    const out: Record<string, T[]> = {};
    for (const [monthKey, rows] of Object.entries(bucket ?? {})) {
      const kept = (rows ?? []).filter((row) => {
        const dk = asDateKey(row.localDate);
        return dk != null && !excludeLocalDates.has(dk);
      });
      if (kept.length > 0) out[monthKey] = kept;
    }
    return out;
  };
  return {
    weekdayByMonth: filterBucket(neighborDayTotals?.weekdayByMonth),
    weekendByMonth: filterBucket(neighborDayTotals?.weekendByMonth),
  };
}
