/** User-facing SMT ingest lifecycle (dashboard refresh / orchestrate polling). */
export type SmtUserProcessingStage = "pending" | "ingesting" | "ingest_complete" | "ready";

const INGEST_COMPLETE_COMPLETENESS = 0.99;

/**
 * Distinguishes active normalization from "intervals are in; done processing" so the UI
 * does not stay on "Processing SMT Data…" when coverage is already ~100%.
 */
export function resolveSmtUserProcessingStage(args: {
  intervalCount: number;
  rawCount: number;
  windowReady: boolean;
  completenessRatio: number;
  /** Persisted interval span (Chicago date keys), not canonical-window day count. */
  coverageDays?: number;
}): SmtUserProcessingStage {
  const intervalCount = Math.max(0, Math.trunc(args.intervalCount));
  const rawCount = Math.max(0, Math.trunc(args.rawCount));
  const coverageDays = Math.max(0, Math.trunc(args.coverageDays ?? 0));
  const completenessRatio = Number.isFinite(args.completenessRatio)
    ? Math.min(1, Math.max(0, args.completenessRatio))
    : 0;

  if (args.windowReady && rawCount === 0) return "ready";
  if (intervalCount === 0 && rawCount === 0) return "pending";
  if (intervalCount === 0 && rawCount > 0) return "ingesting";

  const completenessHigh = completenessRatio >= INGEST_COMPLETE_COMPLETENESS;
  const substantialUsage = coverageDays >= 30;
  const usageLooksComplete =
    completenessHigh || rawCount === 0 || (substantialUsage && completenessRatio >= 0.9);

  if (usageLooksComplete) {
    return args.windowReady && rawCount === 0 ? "ready" : "ingest_complete";
  }
  if (rawCount > 0) return "ingesting";
  return "ingest_complete";
}

export function isSmtUserIngestComplete(stage: SmtUserProcessingStage): boolean {
  return stage === "ingest_complete" || stage === "ready";
}
