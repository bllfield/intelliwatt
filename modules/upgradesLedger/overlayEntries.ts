/**
 * Build ordered LedgerOverlayEntry[] for Past/Future overlay.
 * Timeline ordering uses scenario events; only ledger rows with status ACTIVE and matching scenarioId (or linked via scenarioEventId) are included.
 */

import type { LedgerOverlayEntry } from "@/modules/usageScenario/types";
import { getV1DeltaFromLedgerRow } from "@/modules/upgradesLedger/impact";
import type { LedgerRow } from "@/modules/upgradesLedger/repo";

export type ScenarioEventForOverlay = {
  id: string;
  effectiveMonth: string;
  payloadJson?: { ledgerId?: string; effectiveEndDate?: string } | null;
};

function toYearMonth(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  const s = typeof d === "string" ? d.trim().slice(0, 7) : null;
  if (s && /^\d{4}-\d{2}$/.test(s)) return s;
  if (d instanceof Date && Number.isFinite(d.getTime())) return d.toISOString().slice(0, 7);
  return null;
}

/**
 * Build overlay entries in timeline order (scenario events first; then any unlinked ACTIVE rows by effectiveDate).
 * Only includes ledger rows that are ACTIVE and match scenarioId; prefers scenarioEventId linkage when present.
 */
export function buildOrderedLedgerEntriesForOverlay(
  events: ScenarioEventForOverlay[],
  ledgerRows: LedgerRow[]
): LedgerOverlayEntry[] {
  const byId = new Map(ledgerRows.map((r) => [r.id, r]));
  const byScenarioEventId = new Map<string, LedgerRow>();
  for (const r of ledgerRows) {
    if (r.scenarioEventId) byScenarioEventId.set(r.scenarioEventId, r);
  }

  const used = new Set<string>();
  const entries: LedgerOverlayEntry[] = [];

  for (const ev of events) {
    const ledgerId = ev.payloadJson?.ledgerId != null ? String(ev.payloadJson.ledgerId).trim() : null;
    const row =
      (ledgerId && byId.get(ledgerId)) ||
      (ev.id && byScenarioEventId.get(ev.id)) ||
      (ledgerId ? byId.get(ledgerId) : null);
    if (!row || used.has(row.id)) continue;
    used.add(row.id);

    const effectiveMonth = ev.effectiveMonth?.trim() || toYearMonth(row.effectiveDate) || "";
    if (!effectiveMonth || !/^\d{4}-\d{2}$/.test(effectiveMonth)) continue;

    const effectiveEndDate =
      ev.payloadJson?.effectiveEndDate != null && String(ev.payloadJson.effectiveEndDate).trim() !== ""
        ? String(ev.payloadJson.effectiveEndDate).trim().slice(0, 10)
        : row.effectiveEndDate
          ? (typeof row.effectiveEndDate === "string"
              ? row.effectiveEndDate
              : row.effectiveEndDate.toISOString?.().slice(0, 10) ?? null)
          : null;

    const delta = getV1DeltaFromLedgerRow(row);
    const hasDelta =
      (delta.monthlyDeltaKwh != null && Number.isFinite(delta.monthlyDeltaKwh)) ||
      (delta.annualDeltaKwh != null && Number.isFinite(delta.annualDeltaKwh));
    if (!hasDelta) continue;

    entries.push({
      effectiveMonth,
      effectiveEndDate,
      delta,
    });
  }

  const remaining = ledgerRows.filter((r) => !used.has(r.id));
  remaining.sort((a, b) => {
    const ta = a.effectiveDate?.getTime() ?? 0;
    const tb = b.effectiveDate?.getTime() ?? 0;
    return ta - tb || a.id.localeCompare(b.id);
  });
  for (const row of remaining) {
    const effectiveMonth = toYearMonth(row.effectiveDate) || "";
    if (!effectiveMonth) continue;
    const effectiveEndDate = row.effectiveEndDate
      ? (typeof row.effectiveEndDate === "string"
          ? row.effectiveEndDate
          : (row.effectiveEndDate as Date).toISOString?.())?.slice(0, 10) ?? null
      : null;
    const delta = getV1DeltaFromLedgerRow(row);
    const hasDelta =
      (delta.monthlyDeltaKwh != null && Number.isFinite(delta.monthlyDeltaKwh)) ||
      (delta.annualDeltaKwh != null && Number.isFinite(delta.annualDeltaKwh));
    if (!hasDelta) continue;

    entries.push({
      effectiveMonth,
      effectiveEndDate,
      delta,
    });
  }

  return entries;
}