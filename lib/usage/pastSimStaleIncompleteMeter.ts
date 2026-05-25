/**
 * Past Sim can persist SIMULATED_INCOMPLETE_METER on DST fall-back days (96 SMT rows, ledger lag).
 * Stale cached artifacts replay those labels via reconcileRestoredPastDatasetFromDecodedIntervals.
 * Use live SMT window completeness (same as Usage) to drop stale incomplete-meter ownership.
 */

import type { DailyRowWithSource } from "@/lib/usage/sageActualDailyTruth";
import { loadSmtWindowDayStatus } from "@/lib/usage/smtWindowStatus";

const INCOMPLETE_METER_DETAIL = "SIMULATED_INCOMPLETE_METER";

function asDateKey(value: unknown): string | null {
  const text = String(value ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function round2(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

/** Date keys labeled incomplete-meter in persisted Past meta. */
export function incompleteMeterDateKeysFromPastMeta(meta: unknown): string[] {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return [];
  const byDetail = (meta as Record<string, unknown>).simulatedSourceDetailByDate;
  if (!byDetail || typeof byDetail !== "object" || Array.isArray(byDetail)) return [];
  const out: string[] = [];
  for (const [rawKey, rawDetail] of Object.entries(byDetail as Record<string, unknown>)) {
    if (String(rawDetail ?? "").trim() !== INCOMPLETE_METER_DETAIL) continue;
    const dk = asDateKey(rawKey);
    if (dk) out.push(dk);
  }
  return out;
}

/** SMT calendar days that are slot-complete per smtWindowStatus (DST-aware). */
export async function smtSlotCompleteDateKeysForEsiid(args: {
  esiid: string;
  dateKeys: Iterable<string>;
}): Promise<Set<string>> {
  const esiid = String(args.esiid ?? "").trim();
  const dateKeys = Array.from(
    new Set(
      Array.from(args.dateKeys)
        .map((dk) => asDateKey(dk))
        .filter((dk): dk is string => Boolean(dk))
    )
  );
  if (!esiid || dateKeys.length === 0) return new Set();

  const status = await loadSmtWindowDayStatus({ esiid, dateKeys }).catch(() => null);
  if (!status) return new Set();

  const out = new Set<string>();
  for (const dateKey of dateKeys) {
    if (status.byDate[dateKey]?.isComplete === true) out.add(dateKey);
  }
  return out;
}

export function pruneStaleIncompleteMeterFromPastDatasetMeta(
  meta: Record<string, unknown>,
  slotCompleteDateKeys: ReadonlySet<string>
): void {
  if (!slotCompleteDateKeys.size) return;

  const byDetail = meta.simulatedSourceDetailByDate;
  if (byDetail && typeof byDetail === "object" && !Array.isArray(byDetail)) {
    for (const dk of slotCompleteDateKeys) {
      if (String((byDetail as Record<string, unknown>)[dk] ?? "").trim() === INCOMPLETE_METER_DETAIL) {
        delete (byDetail as Record<string, unknown>)[dk];
      }
    }
  }

  const canonicalKey = "canonicalArtifactSimulatedDayTotalsByDate";
  const canonical = meta[canonicalKey];
  if (canonical && typeof canonical === "object" && !Array.isArray(canonical)) {
    for (const dk of slotCompleteDateKeys) {
      delete (canonical as Record<string, unknown>)[dk];
    }
  }
}

/** Remove stale incomplete-meter days from simulated membership used by cache restore. */
export function filterSimulatedDateKeysWithoutStaleIncompleteMeter(args: {
  simulatedDateKeys: Set<string>;
  staleIncompleteMeterDateKeys: ReadonlySet<string>;
  slotCompleteDateKeys: ReadonlySet<string>;
}): Set<string> {
  const out = new Set(args.simulatedDateKeys);
  if (!args.slotCompleteDateKeys.size || !args.staleIncompleteMeterDateKeys.size) return out;
  for (const dk of args.staleIncompleteMeterDateKeys) {
    if (args.slotCompleteDateKeys.has(dk)) out.delete(dk);
  }
  return out;
}

/** Live SMT completeness for persisted incomplete-meter days (DST fall-back safe). */
export async function resolveStaleIncompleteMeterSlotCompleteDateKeys(args: {
  esiid: string | null | undefined;
  meta: unknown;
}): Promise<Set<string>> {
  const esiid = String(args.esiid ?? "").trim();
  if (!esiid) return new Set();
  const stale = incompleteMeterDateKeysFromPastMeta(args.meta);
  if (!stale.length) return new Set();
  return smtSlotCompleteDateKeysForEsiid({ esiid, dateKeys: stale });
}

/**
 * Display: relabel stale SIMULATED_INCOMPLETE_METER rows to ACTUAL when live SMT says slot-complete.
 * Applies sage daily kWh when provided (Usage/baseline truth).
 */
export function applyPastSimDisplayTruthOverlay<T extends DailyRowWithSource>(
  rows: T[],
  args: {
    sageByDate?: Map<string, number>;
    smtSlotCompleteDateKeys?: ReadonlySet<string>;
  }
): T[] {
  const sageByDate = args.sageByDate ?? new Map<string, number>();
  const slotComplete = args.smtSlotCompleteDateKeys ?? new Set<string>();
  if (!sageByDate.size && !slotComplete.size) return rows;

  return rows.map((row) => {
    const date = asDateKey(row.date);
    if (!date) return row;
    const detail = String(row.sourceDetail ?? "").trim();
    const isStaleIncompleteMeter =
      detail === INCOMPLETE_METER_DETAIL && slotComplete.has(date);
    if (!isStaleIncompleteMeter) {
      if (String(row.source ?? "").toUpperCase() !== "ACTUAL") return row;
      const sageKwh = sageByDate.get(date);
      if (sageKwh === undefined) return row;
      return { ...row, kwh: round2(sageKwh) };
    }
    const sageKwh = sageByDate.get(date);
    return {
      ...row,
      kwh: sageKwh !== undefined ? round2(sageKwh) : row.kwh,
      source: "ACTUAL" as const,
      sourceDetail: "ACTUAL" as const,
    };
  });
}
