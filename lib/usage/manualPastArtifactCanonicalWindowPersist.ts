import {
  isCanonicalManualPastArtifact,
  projectManualPastDatasetToCanonicalWindow,
  resolveManualPastUsageInputMode,
} from "@/lib/usage/persistManualPastArtifactCanonicalWindow";

export const MANUAL_CANONICAL_ARTIFACT_WINDOW_PERSIST_ENV = "MANUAL_CANONICAL_ARTIFACT_WINDOW_PERSIST";

export function isManualCanonicalArtifactWindowPersistEnabled(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return String(env[MANUAL_CANONICAL_ARTIFACT_WINDOW_PERSIST_ENV] ?? "").trim() === "1";
}

export function resolveManualPastPersistUsageInputMode(args: {
  simMode: string;
  manualUsagePayload?: unknown;
  buildInputs?: unknown;
  dataset?: unknown;
}): "MANUAL_MONTHLY" | "MANUAL_ANNUAL" | null {
  if (String(args.simMode ?? "").trim() !== "MANUAL_TOTALS") {
    return null;
  }

  const payloadMode = String((args.manualUsagePayload as { mode?: unknown } | null | undefined)?.mode ?? "")
    .trim()
    .toUpperCase();
  if (payloadMode === "ANNUAL") return "MANUAL_ANNUAL";
  if (payloadMode === "MONTHLY") return "MANUAL_MONTHLY";

  const buildInputs = (args.buildInputs ?? null) as {
    usageInputMode?: unknown;
    gapfillUsageInputMode?: unknown;
    lockboxInput?: { mode?: unknown; usageInputMode?: unknown };
  } | null;
  const buildInputMode = String(
    buildInputs?.gapfillUsageInputMode ?? buildInputs?.usageInputMode ?? buildInputs?.lockboxInput?.usageInputMode ?? ""
  )
    .trim()
    .toUpperCase();
  if (buildInputMode.includes("ANNUAL")) return "MANUAL_ANNUAL";
  if (buildInputMode.includes("MONTHLY")) return "MANUAL_MONTHLY";

  const fromDataset = resolveManualPastUsageInputMode(args.dataset, null);
  if (fromDataset) return fromDataset;

  return "MANUAL_MONTHLY";
}

export function shouldProjectManualPastDatasetAtPersist(args: {
  simMode: string;
  manualUsagePayload?: unknown;
  buildInputs?: unknown;
  dataset?: unknown;
  env?: NodeJS.ProcessEnv;
}): boolean {
  if (!isManualCanonicalArtifactWindowPersistEnabled(args.env)) return false;
  return resolveManualPastPersistUsageInputMode(args) != null;
}

export function extractPersistIntervals15(
  dataset: unknown
): Array<{ timestamp: string; kwh: number }> {
  return (Array.isArray((dataset as any)?.series?.intervals15) ? (dataset as any).series.intervals15 : [])
    .map((row: { timestamp?: string; kwh?: number; consumption_kwh?: number }) => ({
      timestamp: String(row?.timestamp ?? ""),
      kwh: Number(row?.kwh ?? row?.consumption_kwh) || 0,
    }))
    .filter((row: { timestamp: string; kwh: number }) => row.timestamp.length > 0);
}

export function prepareManualPastDatasetForArtifactPersist(args: {
  dataset: any;
  simMode: string;
  scenarioKey: string;
  manualUsagePayload?: unknown;
  buildInputs?: unknown;
  now?: Date;
  applyLegacyCanonicalCoverageMetadata: () => void;
}): {
  dataset: any;
  projected: boolean;
  persistWindowStartDate: string | null;
  persistWindowEndDate: string | null;
} {
  const usageInputMode = resolveManualPastPersistUsageInputMode({
    simMode: args.simMode,
    manualUsagePayload: args.manualUsagePayload,
    buildInputs: args.buildInputs,
    dataset: args.dataset,
  });

  if (
    !shouldProjectManualPastDatasetAtPersist({
      simMode: args.simMode,
      manualUsagePayload: args.manualUsagePayload,
      buildInputs: args.buildInputs,
      dataset: args.dataset,
    })
  ) {
    if (args.scenarioKey !== "BASELINE") {
      args.applyLegacyCanonicalCoverageMetadata();
    }
    return {
      dataset: args.dataset,
      projected: false,
      persistWindowStartDate: null,
      persistWindowEndDate: null,
    };
  }

  let dataset = args.dataset;
  if (!isCanonicalManualPastArtifact(dataset)) {
    dataset = projectManualPastDatasetToCanonicalWindow(dataset, {
      usageInputMode: usageInputMode ?? undefined,
      now: args.now,
    });
  }

  const coverageStart = String(dataset?.meta?.coverageStart ?? dataset?.summary?.start ?? "").slice(0, 10);
  const coverageEnd = String(dataset?.meta?.coverageEnd ?? dataset?.summary?.end ?? "").slice(0, 10);

  return {
    dataset,
    projected: true,
    persistWindowStartDate: /^\d{4}-\d{2}-\d{2}$/.test(coverageStart) ? coverageStart : null,
    persistWindowEndDate: /^\d{4}-\d{2}-\d{2}$/.test(coverageEnd) ? coverageEnd : null,
  };
}
