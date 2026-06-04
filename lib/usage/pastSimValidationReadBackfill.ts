import { resolveCanonicalUsage365CoverageWindow } from "@/lib/usage/canonicalMetadataWindow";
import { shouldReconcilePastSmtValidationSelection } from "@/lib/usage/pastValidationPolicy";

export const WORKSPACE_PAST_SCENARIO_NAME = "Past (Corrected)";

export function pastScenarioNameFromBuildInputs(
  buildInputs: Record<string, unknown> | null | undefined
): string {
  const snapshots = buildInputs?.snapshots;
  if (!snapshots || typeof snapshots !== "object" || Array.isArray(snapshots)) return "";
  return String((snapshots as { scenario?: { name?: unknown } }).scenario?.name ?? "").trim();
}

export function preferredActualSourceFromPastBuildInputs(
  buildInputs: Record<string, unknown> | null | undefined
): "SMT" | "GREEN_BUTTON" | null {
  if (!buildInputs) return null;
  const snapshots = buildInputs.snapshots;
  const snapshotSource =
    snapshots && typeof snapshots === "object" && !Array.isArray(snapshots)
      ? (snapshots as { actualSource?: unknown }).actualSource
      : null;
  if (snapshotSource === "SMT" || snapshotSource === "GREEN_BUTTON") return snapshotSource;
  const lockbox = buildInputs.lockboxRunContext;
  const lockboxSource =
    lockbox && typeof lockbox === "object" && !Array.isArray(lockbox)
      ? (lockbox as { preferredActualSource?: unknown }).preferredActualSource
      : null;
  if (lockboxSource === "SMT" || lockboxSource === "GREEN_BUTTON") return lockboxSource;
  return null;
}

/** Shared gate for Past validation-day backfill on read (user site + One Path artifact_only). */
export function isPastScenarioValidationBackfillEligible(args: {
  scenarioId: string | null;
  buildInputs: Record<string, unknown>;
  storedValidationKeyCount: number;
  storedSelectionMode?: string | null;
}): boolean {
  if (!args.scenarioId) return false;
  if (pastScenarioNameFromBuildInputs(args.buildInputs) !== WORKSPACE_PAST_SCENARIO_NAME) return false;
  const buildMode = String(args.buildInputs.mode ?? "");
  const preferred = preferredActualSourceFromPastBuildInputs(args.buildInputs);
  if (buildMode !== "SMT_BASELINE" && preferred !== "GREEN_BUTTON") return false;
  const storedValidationDateKeysLocal = Array.isArray(args.buildInputs.validationOnlyDateKeysLocal)
    ? ((args.buildInputs.validationOnlyDateKeysLocal as unknown[])
        .map((v) => String(v ?? "").slice(0, 10))
        .filter((dk) => /^\d{4}-\d{2}-\d{2}$/.test(dk)) as string[])
    : [];
  const coverage = resolveCanonicalUsage365CoverageWindow();
  return shouldReconcilePastSmtValidationSelection({
    storedSelectionMode: args.storedSelectionMode ?? null,
    storedValidationKeyCount: args.storedValidationKeyCount,
    storedValidationDateKeysLocal,
    timezone: String(args.buildInputs.timezone ?? "America/Chicago"),
    coverageEndDate: coverage.endDate,
  });
}
