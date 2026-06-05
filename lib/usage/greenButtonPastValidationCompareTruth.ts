import { isGreenButtonBackedDatasetMeta } from "@/lib/time/greenButtonPersistedIntervalConvert";
import { getActualDailyKwhForLocalDateKeys } from "@/lib/usage/actualDatasetForHouse";
import { buildGreenButtonActualDailyKwhByHomeDateKey } from "@/lib/usage/greenButtonPastValidationCandidates";
import { readGreenButtonSourceDateByTargetDateFromMeta } from "@/lib/usage/greenButtonShiftedDisplay";

function round2(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function asDateKey(value: unknown): string | null {
  const text = String(value ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

export function isGreenButtonPastValidationCompareContext(meta: Record<string, unknown> | null | undefined): boolean {
  if (!meta) return false;
  if (isGreenButtonBackedDatasetMeta(meta)) return true;
  return meta.actualSource === "GREEN_BUTTON";
}

/** Merge persisted GB validation actual maps (artifact, buildInputs, engine). */
export function mergeGreenButtonValidationActualDailyRecords(
  ...sources: Array<Record<string, unknown> | null | undefined>
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const source of sources) {
    if (!source || typeof source !== "object" || Array.isArray(source)) continue;
    for (const [dk, raw] of Object.entries(source)) {
      if (!asDateKey(dk)) continue;
      const kwh = Number(raw);
      if (Number.isFinite(kwh)) out[dk] = round2(kwh);
    }
  }
  return out;
}

/** Map year-shifted target validation days to source-day interval totals when direct target sums are absent. */
export function applyGreenButtonShiftedTargetActualTotals(args: {
  actualByDate: Record<string, number>;
  sourceDateByTargetDate?: Record<string, string> | null;
  validationKeys: readonly string[];
}): Record<string, number> {
  const out = { ...args.actualByDate };
  const shiftMap = args.sourceDateByTargetDate ?? {};
  for (const target of args.validationKeys) {
    const targetKey = asDateKey(target);
    if (!targetKey || out[targetKey] != null) continue;
    const sourceKey = asDateKey(shiftMap[targetKey]);
    if (!sourceKey || sourceKey === targetKey) continue;
    const sourceKwh = out[sourceKey];
    if (sourceKwh == null || !Number.isFinite(Number(sourceKwh))) continue;
    out[targetKey] = round2(Number(sourceKwh));
  }
  return out;
}

/** Keep only validation keys that have finite interval-backed actual totals. */
export function alignGreenButtonValidationKeysToResolvableActualTruth(args: {
  validationKeys: readonly string[];
  actualByDate: Record<string, number>;
}): { validationKeys: string[]; actualByDate: Record<string, number> } {
  const keys: string[] = [];
  const actualByDate: Record<string, number> = {};
  for (const raw of args.validationKeys) {
    const dk = asDateKey(raw);
    if (!dk) continue;
    const kwh = args.actualByDate[dk];
    if (kwh == null || !Number.isFinite(Number(kwh))) continue;
    keys.push(dk);
    actualByDate[dk] = round2(Number(kwh));
  }
  return { validationKeys: keys.sort(), actualByDate };
}

export function finalizeGreenButtonValidationCompareTruthSync(args: {
  validationKeys: readonly string[];
  existingActual?: Record<string, number> | null;
  intervals: ReadonlyArray<{ timestamp: string; kwh: number; homeDateKey?: string }>;
  timezone: string;
  sourceDateByTargetDate?: Record<string, string> | null;
}): { validationKeys: string[]; actualByDate: Record<string, number> } {
  const keys = Array.from(
    new Set(
      args.validationKeys
        .map((dk) => asDateKey(dk))
        .filter((dk): dk is string => Boolean(dk))
    )
  ).sort();
  if (keys.length === 0) return { validationKeys: [], actualByDate: {} };

  const fromIntervals = buildGreenButtonActualDailyKwhByHomeDateKey({
    intervals: args.intervals,
    dateKeysLocal: keys,
    timezone: args.timezone,
    sourceDateByTargetDate: args.sourceDateByTargetDate ?? undefined,
  });
  let merged = mergeGreenButtonValidationActualDailyRecords(args.existingActual, fromIntervals);
  merged = applyGreenButtonShiftedTargetActualTotals({
    actualByDate: merged,
    sourceDateByTargetDate: args.sourceDateByTargetDate,
    validationKeys: keys,
  });
  return alignGreenButtonValidationKeysToResolvableActualTruth({
    validationKeys: keys,
    actualByDate: merged,
  });
}

function validationKeysFromMeta(meta: Record<string, unknown>): string[] {
  const raw = Array.isArray(meta.validationOnlyDateKeysLocal) ? meta.validationOnlyDateKeysLocal : [];
  return raw
    .map((v) => asDateKey(v))
    .filter((dk): dk is string => Boolean(dk));
}

function resolveGreenButtonSourceDateByTargetDate(
  meta: Record<string, unknown>,
  buildInputs?: Record<string, unknown> | null
): Record<string, string> {
  const fromMeta = readGreenButtonSourceDateByTargetDateFromMeta(meta);
  if (Object.keys(fromMeta).length > 0) return fromMeta;
  const fromBuild = readGreenButtonSourceDateByTargetDateFromMeta(buildInputs ?? null);
  return fromBuild;
}

/**
 * Green Button Past read: merge validation keys/actuals and backfill missing actual totals from persisted GB intervals.
 */
export async function ensureGreenButtonValidationCompareMetaForRead(args: {
  dataset: { meta?: Record<string, unknown> } & Record<string, unknown>;
  buildInputs?: Record<string, unknown> | null;
  houseId: string;
  esiid: string | null;
}): Promise<void> {
  const prevMeta =
    args.dataset.meta && typeof args.dataset.meta === "object"
      ? ({ ...args.dataset.meta } as Record<string, unknown>)
      : null;
  if (!prevMeta || !isGreenButtonPastValidationCompareContext(prevMeta)) return;

  const buildActualSource =
    args.buildInputs &&
    typeof args.buildInputs === "object" &&
    args.buildInputs.snapshots &&
    typeof args.buildInputs.snapshots === "object" &&
    (args.buildInputs.snapshots as { actualSource?: unknown }).actualSource === "GREEN_BUTTON"
      ? "GREEN_BUTTON"
      : null;
  if (!isGreenButtonPastValidationCompareContext(prevMeta) && buildActualSource !== "GREEN_BUTTON") return;

  const fromBuildKeys = Array.isArray(args.buildInputs?.validationOnlyDateKeysLocal)
    ? (args.buildInputs!.validationOnlyDateKeysLocal as unknown[])
        .map((v) => asDateKey(v))
        .filter((dk): dk is string => Boolean(dk))
    : [];
  const fromMetaKeys = validationKeysFromMeta(prevMeta);
  let validationKeys =
    fromBuildKeys.length > 0 && (fromMetaKeys.length === 0 || buildActualSource === "GREEN_BUTTON")
      ? fromBuildKeys
      : fromMetaKeys;
  validationKeys = Array.from(new Set(validationKeys)).sort();
  if (validationKeys.length === 0) return;

  const buildActual =
    args.buildInputs && typeof args.buildInputs === "object"
      ? (args.buildInputs.validationActualDailyKwhByDateLocal as Record<string, unknown> | undefined)
      : undefined;
  let actualByDate = mergeGreenButtonValidationActualDailyRecords(
    prevMeta.validationActualDailyKwhByDateLocal as Record<string, unknown> | undefined,
    buildActual
  );
  const sourceDateByTargetDate = resolveGreenButtonSourceDateByTargetDate(prevMeta, args.buildInputs ?? null);
  actualByDate = applyGreenButtonShiftedTargetActualTotals({
    actualByDate,
    sourceDateByTargetDate,
    validationKeys,
  });

  const missingKeys = validationKeys.filter((dk) => actualByDate[dk] == null);
  if (missingKeys.length > 0) {
    const actualContextHouseId = String(prevMeta.actualContextHouseId ?? args.houseId).trim() || args.houseId;
    const persistedSourceEsiid = String(
      prevMeta.actualSourceEsiid ??
        (args.buildInputs as { lockboxInput?: { sourceContext?: { sourceEsiid?: string } } } | undefined)?.lockboxInput
          ?.sourceContext?.sourceEsiid ??
        ""
    ).trim();
    const fetched = await getActualDailyKwhForLocalDateKeys({
      houseId: actualContextHouseId,
      esiid: persistedSourceEsiid || args.esiid,
      dateKeysLocal: missingKeys,
      preferredSource: "GREEN_BUTTON",
    });
    for (const [dk, kwh] of Array.from(fetched.entries())) {
      if (Number.isFinite(kwh)) actualByDate[dk] = round2(kwh);
    }
    actualByDate = applyGreenButtonShiftedTargetActualTotals({
      actualByDate,
      sourceDateByTargetDate,
      validationKeys,
    });
  }

  const aligned = alignGreenButtonValidationKeysToResolvableActualTruth({
    validationKeys,
    actualByDate,
  });
  prevMeta.validationOnlyDateKeysLocal = aligned.validationKeys;
  if (aligned.validationKeys.length > 0) {
    prevMeta.validationActualDailyKwhByDateLocal = aligned.actualByDate;
  }
  args.dataset.meta = prevMeta;
}
