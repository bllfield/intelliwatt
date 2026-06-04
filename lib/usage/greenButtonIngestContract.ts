/**
 * Green Button interval ingest contract.
 *
 * All normalization, overlap allocation, vendor slot repair, and Chicago 15-minute
 * bucketing run only in `runGreenButtonUsagePipeline` before `GreenButtonInterval` rows
 * are written. Downstream code must read persisted rows and project through
 * `loadPersistedGreenButtonIntervals` — never re-run slot repair on read.
 */

/** Bump when ingest semantics change (forces re-upload / rehydrate from raw). */
export const GREEN_BUTTON_INTERVAL_INGEST_VERSION = 1;

export type GreenButtonUploadParseSummary = {
  format?: string;
  totalRawReadings?: number;
  normalizedIntervals?: number;
  totalKwh?: number;
  appliedWindowDays?: number;
  coverageStartDateKey?: string;
  coverageEndDateKey?: string;
  warnings?: string[];
  /** Present when written by `runGreenButtonUsagePipeline` after 2026-05 ingest unification. */
  intervalIngestVersion?: number;
};

export function parseGreenButtonUploadParseSummary(
  parseMessage: string | null | undefined
): GreenButtonUploadParseSummary | null {
  if (!parseMessage || typeof parseMessage !== "string") return null;
  const trimmed = parseMessage.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(trimmed) as GreenButtonUploadParseSummary;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export function isGreenButtonIntervalIngestCurrent(
  parseMessage: string | null | undefined
): boolean {
  const summary = parseGreenButtonUploadParseSummary(parseMessage);
  if (!summary) return false;
  return summary.intervalIngestVersion === GREEN_BUTTON_INTERVAL_INGEST_VERSION;
}
