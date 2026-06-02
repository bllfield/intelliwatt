import {
  attachValidationCompareProjection,
  buildValidationCompareProjectionFromDatasets,
  buildValidationCompareProjectionSidecar,
  CompareTruthIncompleteError,
  type ValidationCompareProjectionSidecar,
} from "@/lib/usage/validationCompareProjection";

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
  const mergedKeys = existingKeys.length > 0 ? existingKeys : fromBuild.length > 0 ? fromBuild : fromEngine;
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
  mergeActualDailyKwh(
    prevMeta.validationActualDailyKwhByDateLocal as Record<string, unknown> | undefined
  );
  mergeActualDailyKwh(buildActualDaily);
  mergeActualDailyKwh(engineActualDaily);

  const keys = validationOnlyDateKeysFromMeta(prevMeta);
  if (args.actualDataset && keys.length > 0) {
    const actualByDate = dailyKwhByDateFromDataset(args.actualDataset);
    for (const dk of keys) {
      if (persistedActual[dk] == null && actualByDate.has(dk)) {
        persistedActual[dk] = actualByDate.get(dk) as number;
      }
    }
  }
  if (Object.keys(persistedActual).length > 0) {
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

  if (args.actualDataset && args.displayDataset) {
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
