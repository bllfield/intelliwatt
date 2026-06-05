import { isGreenButtonBackedDatasetMeta } from "@/lib/time/greenButtonPersistedIntervalConvert";
import { resolveGreenButtonPastValidationOnlyDateKeysAtRead } from "@/lib/usage/greenButtonPastValidationCandidates";
import {
  isGreenButtonPastValidationCompareContext,
  mergeGreenButtonValidationActualDailyRecords,
} from "@/lib/usage/greenButtonPastValidationCompareTruth";
import {
  attachValidationCompareProjection,
  buildValidationCompareProjectionFromDatasets,
  buildValidationCompareProjectionSidecar,
  CompareTruthIncompleteError,
  type ValidationCompareProjectionSidecar,
} from "@/lib/usage/validationCompareProjection";
import { sageActualDailyKwhByDateFromRows } from "@/lib/usage/sageActualDailyTruth";

export type PastSimActualSource = "SMT" | "GREEN_BUTTON";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** Whether a dataset row (meta or summary) is Green Button actual usage. */
export function isGreenButtonUsageDataset(dataset: unknown): boolean {
  const rec = asRecord(dataset);
  if (!rec) return false;
  if (isGreenButtonBackedDatasetMeta(asRecord(rec.meta))) return true;
  const summarySource = String(asRecord(rec.summary)?.source ?? "").trim().toUpperCase();
  return summarySource === "GREEN_BUTTON";
}

/** Preferred actual source for validation compare (GB Past must not fall back to SMT). */
export function resolvePastSimPreferredActualSource(args: {
  preferredActualSource?: PastSimActualSource | null;
  dataset?: unknown;
  buildInputs?: Record<string, unknown> | null;
}): PastSimActualSource | null {
  if (args.preferredActualSource === "SMT" || args.preferredActualSource === "GREEN_BUTTON") {
    return args.preferredActualSource;
  }
  const meta = asRecord(asRecord(args.dataset)?.meta);
  const lockbox = asRecord(meta?.lockboxRunContext);
  const lockboxPreferred = lockbox?.preferredActualSource;
  if (lockboxPreferred === "SMT" || lockboxPreferred === "GREEN_BUTTON") {
    return lockboxPreferred;
  }
  const metaActual = meta?.actualSource;
  if (metaActual === "SMT" || metaActual === "GREEN_BUTTON") return metaActual;
  const snapshots = asRecord(args.buildInputs)?.snapshots;
  const snapshotSource = asRecord(snapshots)?.actualSource;
  if (snapshotSource === "SMT" || snapshotSource === "GREEN_BUTTON") return snapshotSource;
  if (isGreenButtonUsageDataset(args.dataset)) return "GREEN_BUTTON";
  return null;
}

/**
 * Whether sage/actualDataset daily rows may fill validation compare gaps on read.
 * SMT Past: always allowed (unchanged). Green Button Past: only when sage is also GB.
 */
export function pastValidationCompareMayUseActualDataset(args: {
  simulatedDataset: unknown;
  actualDataset: unknown;
}): boolean {
  if (!args.actualDataset) return false;
  const greenButtonPastSim = isGreenButtonUsageDataset(args.simulatedDataset);
  if (!greenButtonPastSim) return true;
  return isGreenButtonUsageDataset(args.actualDataset);
}

/** Green Button Past only: persisted validation actuals from GB intervals at build time. */
export function shouldUseGreenButtonPersistedValidationActualForCompare(
  meta: Record<string, unknown> | null | undefined
): boolean {
  return isGreenButtonBackedDatasetMeta(meta);
}

export function validationActualDailyKwhMapFromMeta(
  meta: Record<string, unknown> | null | undefined
): Map<string, number> {
  const raw = meta?.validationActualDailyKwhByDateLocal;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return new Map();
  const rows: Array<{ date: string; kwh: number }> = [];
  for (const [date, value] of Object.entries(raw as Record<string, unknown>)) {
    const kwh = Number(value);
    if (/^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(kwh)) rows.push({ date, kwh });
  }
  return sageActualDailyKwhByDateFromRows(rows);
}

function dailyKwhByDateFromDataset(dataset: unknown): Map<string, number> {
  const byDate = new Map<string, number>();
  const daily = (dataset as { daily?: unknown })?.daily;
  for (const row of Array.isArray(daily) ? daily : []) {
    const dateKey = String((row as { date?: unknown })?.date ?? "").slice(0, 10);
    const kwh = Number((row as { kwh?: unknown })?.kwh);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || !Number.isFinite(kwh)) continue;
    byDate.set(dateKey, kwh);
  }
  return byDate;
}

function validationOnlyDateKeysFromMeta(meta: Record<string, unknown> | null | undefined): string[] {
  const rawKeys = Array.isArray(meta?.validationOnlyDateKeysLocal)
    ? (meta.validationOnlyDateKeysLocal as unknown[])
    : [];
  return rawKeys
    .map((v) => String(v ?? "").slice(0, 10))
    .filter((dk) => /^\d{4}-\d{2}-\d{2}$/.test(dk));
}

/**
 * Merge build-input validation keys and sage/actual daily totals before attach (shared read path).
 */
function validationKeysFromRecord(record: Record<string, unknown> | null | undefined): string[] {
  if (!record) return [];
  const raw = Array.isArray(record.validationOnlyDateKeysLocal)
    ? (record.validationOnlyDateKeysLocal as unknown[])
    : [];
  return raw
    .map((v) => String(v ?? "").slice(0, 10))
    .filter((dk) => /^\d{4}-\d{2}-\d{2}$/.test(dk));
}

export function enrichPastDatasetValidationCompareMetaForRead(args: {
  dataset: any;
  buildInputs?: Record<string, unknown> | null;
  engineInput?: Record<string, unknown> | null;
  actualDataset?: any | null;
}): any {
  const dataset = args.dataset;
  if (!dataset || typeof dataset !== "object") return dataset;
  const prevMeta =
    dataset.meta && typeof dataset.meta === "object"
      ? ({ ...(dataset.meta as Record<string, unknown>) } as Record<string, unknown>)
      : {};

  const fromBuild = validationKeysFromRecord(
    args.buildInputs && typeof args.buildInputs === "object" ? args.buildInputs : null
  );
  const fromEngine = validationKeysFromRecord(
    args.engineInput && typeof args.engineInput === "object" ? args.engineInput : null
  );
  const existingKeys = validationOnlyDateKeysFromMeta(prevMeta);
  let mergedKeys = existingKeys.length > 0 ? existingKeys : fromBuild.length > 0 ? fromBuild : fromEngine;
  if (mergedKeys.length === 0 && isGreenButtonBackedDatasetMeta(prevMeta)) {
    mergedKeys = resolveGreenButtonPastValidationOnlyDateKeysAtRead({
      existingKeys: mergedKeys,
      meta: prevMeta,
      buildInputs: args.buildInputs ?? null,
      engineInput: args.engineInput ?? null,
      houseId:
        typeof prevMeta.actualContextHouseId === "string"
          ? prevMeta.actualContextHouseId
          : typeof args.buildInputs?.actualContextHouseId === "string"
            ? (args.buildInputs.actualContextHouseId as string)
            : undefined,
      timezone: typeof prevMeta.timezone === "string" ? prevMeta.timezone : undefined,
    });
  }
  if (mergedKeys.length > 0 && existingKeys.length === 0) {
    prevMeta.validationOnlyDateKeysLocal = mergedKeys;
  }

  const buildActualDaily =
    args.buildInputs && typeof args.buildInputs === "object"
      ? ((args.buildInputs as { validationActualDailyKwhByDateLocal?: Record<string, unknown> })
          .validationActualDailyKwhByDateLocal as Record<string, unknown> | undefined)
      : undefined;
  const engineActualDaily =
    args.engineInput && typeof args.engineInput === "object"
      ? ((args.engineInput as { validationActualDailyKwhByDateLocal?: Record<string, unknown> })
          .validationActualDailyKwhByDateLocal as Record<string, unknown> | undefined)
      : undefined;
  const persistedActual: Record<string, number> = {};
  const mergeActualDailyKwh = (source: Record<string, unknown> | undefined) => {
    if (!source || typeof source !== "object") return;
    for (const [dk, raw] of Object.entries(source)) {
      const kwh = Number(raw);
      if (/^\d{4}-\d{2}-\d{2}$/.test(dk) && Number.isFinite(kwh)) persistedActual[dk] = kwh;
    }
  };
  if (isGreenButtonPastValidationCompareContext(prevMeta)) {
    const mergedGbActual = mergeGreenButtonValidationActualDailyRecords(
      prevMeta.validationActualDailyKwhByDateLocal as Record<string, unknown> | undefined,
      buildActualDaily,
      engineActualDaily
    );
    if (Object.keys(mergedGbActual).length > 0) {
      prevMeta.validationActualDailyKwhByDateLocal = mergedGbActual;
    }
  } else {
    mergeActualDailyKwh(
      prevMeta.validationActualDailyKwhByDateLocal as Record<string, unknown> | undefined
    );
    mergeActualDailyKwh(buildActualDaily);
    mergeActualDailyKwh(engineActualDaily);
  }

  const keys = validationOnlyDateKeysFromMeta(prevMeta);
  if (
    keys.length > 0 &&
    pastValidationCompareMayUseActualDataset({
      simulatedDataset: dataset,
      actualDataset: args.actualDataset,
    })
  ) {
    const actualByDate = dailyKwhByDateFromDataset(args.actualDataset);
    for (const dk of keys) {
      if (persistedActual[dk] == null && actualByDate.has(dk)) {
        persistedActual[dk] = actualByDate.get(dk) as number;
      }
    }
  }
  if (!isGreenButtonPastValidationCompareContext(prevMeta) && Object.keys(persistedActual).length > 0) {
    prevMeta.validationActualDailyKwhByDateLocal = persistedActual;
  }

  return { ...dataset, meta: prevMeta };
}

/**
 * Shared Past / One Path / Usage Simulator read: attach validation rows from artifact meta,
 * then fall back to dual-dataset compare when actual truth is available.
 */
export function resolveValidationCompareProjectionForRead(args: {
  dataset: any;
  actualDataset?: any | null;
  displayDataset?: any | null;
  buildInputs?: Record<string, unknown> | null;
  engineInput?: Record<string, unknown> | null;
}): ValidationCompareProjectionSidecar {
  let working = enrichPastDatasetValidationCompareMetaForRead({
    dataset: args.dataset,
    buildInputs: args.buildInputs ?? null,
    engineInput: args.engineInput ?? null,
    actualDataset: args.actualDataset ?? null,
  });

  const persistedRows = Array.isArray((working as { meta?: { validationCompareRows?: unknown } })?.meta?.validationCompareRows)
    ? ((working as { meta: { validationCompareRows: unknown[] } }).meta.validationCompareRows)
    : [];
  if (persistedRows.length > 0) {
    return buildValidationCompareProjectionSidecar(working);
  }

  try {
    const attached = attachValidationCompareProjection(working);
    const sidecar = buildValidationCompareProjectionSidecar(attached);
    if (sidecar.rows.length > 0) {
      return sidecar;
    }
    working = attached;
  } catch (error) {
    if (!(error instanceof CompareTruthIncompleteError)) {
      throw error;
    }
  }

  if (
    args.actualDataset &&
    args.displayDataset &&
    pastValidationCompareMayUseActualDataset({
      simulatedDataset: working,
      actualDataset: args.actualDataset,
    })
  ) {
    try {
      return buildValidationCompareProjectionFromDatasets({
        validationSourceDataset: working,
        actualDataset: args.actualDataset,
        simulatedDataset: args.displayDataset,
      });
    } catch (error) {
      if (error instanceof CompareTruthIncompleteError) {
        return buildValidationCompareProjectionSidecar(working);
      }
      throw error;
    }
  }

  return buildValidationCompareProjectionSidecar(working);
}
