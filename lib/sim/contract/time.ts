/**
 * Sim Platform Contract — time/timestamp helpers.
 * Canonical timestamps are joinable by exact string equality (tsIso).
 */

/** Canonical timestamp key for joining datasets and overlays (UTC ISO string). */
export function canonicalIntervalKey(tsIso: string): string {
  try {
    const d = new Date(String(tsIso).trim());
    return Number.isFinite(d.getTime()) ? d.toISOString() : String(tsIso).trim();
  } catch {
    return String(tsIso).trim();
  }
}
