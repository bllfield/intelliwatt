/** Pure SMT ledger meta helpers (safe for client/admin UI bundles). */

export const SMT_DAY_LEDGER_STATUS = {
  COMPLETE: "COMPLETE",
  PENDING_SMT: "PENDING_SMT",
  INCOMPLETE_METER: "INCOMPLETE_METER",
} as const;

export function smtPendingIntervalDateKeysFromMeta(
  meta: Record<string, unknown> | null | undefined
): Set<string> {
  const pending = new Set<string>();
  const keys = Array.isArray(meta?.smtPendingIntervalDateKeys) ? meta.smtPendingIntervalDateKeys : [];
  for (const value of keys) {
    const dateKey = String(value ?? "").slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) pending.add(dateKey);
  }
  const byDate =
    meta?.smtDayLedgerStatusByDate &&
    typeof meta.smtDayLedgerStatusByDate === "object" &&
    !Array.isArray(meta.smtDayLedgerStatusByDate)
      ? (meta.smtDayLedgerStatusByDate as Record<string, unknown>)
      : null;
  if (byDate) {
    for (const [dateKey, status] of Object.entries(byDate)) {
      if (String(status ?? "").trim().toUpperCase() === SMT_DAY_LEDGER_STATUS.PENDING_SMT) {
        pending.add(dateKey.slice(0, 10));
      }
    }
  }
  return pending;
}
