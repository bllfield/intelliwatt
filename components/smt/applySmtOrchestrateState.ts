export type SmtOrchestrateUiPhase = "ready" | "ingest_complete" | "processing" | "waiting";

export function smtOrchestrateCoverageSuffix(payload: any): string {
  const coverage = payload?.usage?.coverage ?? payload?.coverage;
  if (coverage?.start && coverage?.end) {
    return ` Current coverage: ${String(coverage.start).slice(0, 10)} – ${String(coverage.end).slice(0, 10)} (${coverage.days ?? "?"} day(s)).`;
  }
  return "";
}

/** Maps orchestrate (or usage/status-shaped) payload to a UI phase. */
export function resolveSmtOrchestrateUiPhase(payload: any): SmtOrchestrateUiPhase | null {
  if (!payload?.ok) return null;

  const ready = payload?.usage?.ready === true || payload?.ready === true || payload.phase === "ready";
  if (ready) return "ready";

  const ingestComplete =
    payload.phase === "ingest_complete" ||
    payload?.usage?.ingestComplete === true ||
    payload?.usage?.userStage === "ingest_complete" ||
    payload?.userStage === "ingest_complete" ||
    payload?.ingestComplete === true ||
    payload.status === "ingest_complete";
  if (ingestComplete) return "ingest_complete";

  const processing =
    payload.phase === "active_waiting_usage" ||
    payload?.usage?.status === "processing" ||
    payload.status === "processing" ||
    (Number(payload?.usage?.rawFiles ?? payload?.rawFiles ?? 0) > 0 && !ready);
  if (processing) return "processing";

  if (payload.phase === "pending" || payload?.usage?.status === "pending" || payload.status === "pending") {
    return "waiting";
  }

  return null;
}
