/** Persisted modeled kWh for validation/test days (compare truth survives ACTUAL stitch + GB trusted prune). */
export const VALIDATION_CANONICAL_SIMULATED_DAY_TOTALS_META_KEY =
  "validationCanonicalSimulatedDayTotalsByDateLocal";

export function mergeValidationCanonicalSimulatedTotalsIntoCompareSource(
  simSrc: Record<string, number>,
  meta: Record<string, unknown> | null | undefined,
  validationOnlyDateKeysLocal: string[]
): void {
  const raw = meta?.[VALIDATION_CANONICAL_SIMULATED_DAY_TOTALS_META_KEY];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
  for (const dk of validationOnlyDateKeysLocal) {
    if (Number.isFinite(Number(simSrc[dk]))) continue;
    const kwh = Number((raw as Record<string, number>)[dk]);
    if (Number.isFinite(kwh)) simSrc[dk] = kwh;
  }
}
