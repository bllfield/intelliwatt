import { sageActualDailyKwhByDate } from "@/lib/usage/sageActualDailyTruth";
import { projectBaselineFromCanonicalDataset } from "@/lib/usage/validationCompareProjection";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function validationOnlyDateKeysFromMeta(meta: Record<string, unknown>): string[] {
  const raw = Array.isArray(meta.validationOnlyDateKeysLocal) ? meta.validationOnlyDateKeysLocal : [];
  return raw
    .map((value) => String(value ?? "").slice(0, 10))
    .filter((dk) => /^\d{4}-\d{2}-\d{2}$/.test(dk));
}

export function resolveValidationActualDailyByDateForPastDisplay(args: {
  dataset: Record<string, unknown>;
  sageActualDataset?: Record<string, unknown> | null;
}): Map<string, number> {
  const meta = asRecord(args.dataset.meta);
  const validationKeys = validationOnlyDateKeysFromMeta(meta);
  const out = new Map<string, number>();
  if (validationKeys.length === 0) return out;

  const persisted = asRecord(meta.validationActualDailyKwhByDateLocal);
  for (const dateKey of validationKeys) {
    const raw = persisted[dateKey];
    const kwh = Number(raw);
    if (Number.isFinite(kwh)) out.set(dateKey, Math.round(kwh * 100) / 100);
  }

  const sageByDate = sageActualDailyKwhByDate(args.sageActualDataset);
  for (const dateKey of validationKeys) {
    if (out.has(dateKey)) continue;
    const sageKwh = sageByDate.get(dateKey);
    if (sageKwh !== undefined && Number.isFinite(sageKwh)) {
      out.set(dateKey, Math.round(sageKwh * 100) / 100);
    }
  }

  return out;
}

function mergeProjectedPastDatasetInPlace(
  target: Record<string, unknown>,
  projected: Record<string, unknown>
): void {
  target.daily = projected.daily;
  target.monthly = projected.monthly;
  if (projected.summary != null) target.summary = projected.summary;
  if (projected.totals != null) target.totals = projected.totals;
  const projectedSeries = asRecord(projected.series);
  const targetSeries = asRecord(target.series);
  target.series = {
    ...targetSeries,
    ...(Object.keys(projectedSeries).length > 0 ? projectedSeries : {}),
  };
  const projectedInsights = asRecord(projected.insights);
  if (Object.keys(projectedInsights).length > 0) {
    target.insights = {
      ...asRecord(target.insights),
      ...projectedInsights,
    };
  }
  target.meta = {
    ...asRecord(target.meta),
    ...asRecord(projected.meta),
  };
}

/**
 * User-facing Past totals/charts use ACTUAL kWh on validation/test days.
 * Modeled sim for those days remains in compare sidecars / canonicalArtifactSimulatedDayTotalsByDate.
 */
export function applyPastSimValidationBaselineProjectionToDataset(args: {
  dataset: Record<string, unknown>;
  sageActualDataset?: Record<string, unknown> | null;
  actualDailyByDate?: Map<string, number> | null;
}): boolean {
  const meta = asRecord(args.dataset.meta);
  if (meta.datasetKind !== "SIMULATED" || meta.baselinePassthrough === true) return false;

  const validationKeys = validationOnlyDateKeysFromMeta(meta);
  if (validationKeys.length === 0) return false;

  const actualDailyByDate =
    args.actualDailyByDate && args.actualDailyByDate.size > 0
      ? args.actualDailyByDate
      : resolveValidationActualDailyByDateForPastDisplay(args);
  if (actualDailyByDate.size === 0) return false;

  const timezone = String(meta.timezone ?? "America/Chicago");
  const projected = projectBaselineFromCanonicalDataset(
    args.dataset,
    timezone,
    actualDailyByDate
  ) as Record<string, unknown>;
  mergeProjectedPastDatasetInPlace(args.dataset, projected);
  return true;
}

export type PastSimCanonicalOwnershipAudit = {
  travelVacantSimulatedDateCount: number;
  validationTestSimulatedDateCount: number;
  validationTestActualInCanonicalDateCount: number;
  validationTestDeltaKwh: number | null;
  canonicalPastIncludesValidationTestSimulation: boolean;
  sourceOwner: string;
};

function isTravelVacantSimulatedDailyRow(row: Record<string, unknown>): boolean {
  const detail = String(row.sourceDetail ?? "").trim().toUpperCase();
  const source = String(row.source ?? "").trim().toUpperCase();
  return (
    detail.includes("TRAVEL") ||
    detail.includes("VACANT") ||
    (source.startsWith("SIMULATED") && detail.includes("SIMULATED"))
  );
}

function isValidationTestDailyRow(row: Record<string, unknown>, validationKeys: Set<string>): boolean {
  const dateKey = String(row.date ?? "").slice(0, 10);
  if (validationKeys.has(dateKey)) return true;
  const detail = String(row.sourceDetail ?? "").trim().toUpperCase();
  return detail.includes("VALIDATION") || detail.includes("TEST_DAY");
}

export function computePastSimCanonicalOwnershipAudit(args: {
  dataset: unknown;
  compareMetrics?: Record<string, unknown> | null;
}): PastSimCanonicalOwnershipAudit {
  const dataset = asRecord(args.dataset);
  const meta = asRecord(dataset.meta);
  const validationKeys = new Set(validationOnlyDateKeysFromMeta(meta));
  const daily = Array.isArray(dataset.daily) ? (dataset.daily as Array<Record<string, unknown>>) : [];

  let travelVacantSimulatedDateCount = 0;
  let validationTestActualInCanonicalDateCount = 0;
  let validationTestSimulatedInCanonicalDateCount = 0;

  for (const row of daily) {
    const dateKey = String(row.date ?? "").slice(0, 10);
    if (isTravelVacantSimulatedDailyRow(row)) travelVacantSimulatedDateCount += 1;
    if (!isValidationTestDailyRow(row, validationKeys)) continue;
    const source = String(row.source ?? "").trim().toUpperCase();
    if (source === "ACTUAL" || String(row.sourceDetail ?? "").includes("ACTUAL_VALIDATION")) {
      validationTestActualInCanonicalDateCount += 1;
    } else {
      validationTestSimulatedInCanonicalDateCount += 1;
    }
  }

  const compareMetrics = asRecord(args.compareMetrics);
  const deltaKwhMasked = Number(compareMetrics.deltaKwhMasked);
  const validationTestDeltaKwh = Number.isFinite(deltaKwhMasked) ? Math.round(deltaKwhMasked * 100) / 100 : null;

  return {
    travelVacantSimulatedDateCount,
    validationTestSimulatedDateCount: validationKeys.size,
    validationTestActualInCanonicalDateCount,
    validationTestDeltaKwh,
    canonicalPastIncludesValidationTestSimulation: validationTestSimulatedInCanonicalDateCount > 0,
    sourceOwner: "projectBaselineFromCanonicalDataset",
  };
}
