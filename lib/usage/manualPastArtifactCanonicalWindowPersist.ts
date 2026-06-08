import {
  isCanonicalManualPastArtifact,
  MANUAL_CANONICAL_ARTIFACT_WINDOW_VERSION,
  projectManualPastDatasetToCanonicalWindow,
  resolveManualPastUsageInputMode,
} from "@/lib/usage/persistManualPastArtifactCanonicalWindow";

export const MANUAL_CANONICAL_ARTIFACT_WINDOW_PERSIST_ENV = "MANUAL_CANONICAL_ARTIFACT_WINDOW_PERSIST";

export type ManualCanonicalArtifactWindowPersistServiceTree = "usageSimulator" | "onePathSim";

export type ManualCanonicalArtifactWindowPersistAudit = {
  enabled: true;
  hookVersion: typeof MANUAL_CANONICAL_ARTIFACT_WINDOW_VERSION;
  serviceTree: ManualCanonicalArtifactWindowPersistServiceTree;
  callerLabel: string;
  usageMode: "MANUAL_MONTHLY" | "MANUAL_ANNUAL";
  runType: string;
  beforeCoverageStart: string | null;
  beforeCoverageEnd: string | null;
  afterCoverageStart: string | null;
  afterCoverageEnd: string | null;
  projectedAt: string;
  source: "persist_hook";
};

function readDatasetCoverageDates(dataset: unknown): { start: string | null; end: string | null } {
  const start = String((dataset as any)?.meta?.coverageStart ?? (dataset as any)?.summary?.start ?? "").slice(0, 10);
  const end = String((dataset as any)?.meta?.coverageEnd ?? (dataset as any)?.summary?.end ?? "").slice(0, 10);
  return {
    start: /^\d{4}-\d{2}-\d{2}$/.test(start) ? start : null,
    end: /^\d{4}-\d{2}-\d{2}$/.test(end) ? end : null,
  };
}

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
  serviceTree?: ManualCanonicalArtifactWindowPersistServiceTree | null;
  callerLabel?: string | null;
  runType?: string | null;
  applyLegacyCanonicalCoverageMetadata: () => void;
}): {
  dataset: any;
  projected: boolean;
  persistWindowStartDate: string | null;
  persistWindowEndDate: string | null;
  persistAudit: ManualCanonicalArtifactWindowPersistAudit | null;
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
      persistAudit: null,
    };
  }

  const beforeCoverage = readDatasetCoverageDates(args.dataset);
  let dataset = args.dataset;
  let projected = isCanonicalManualPastArtifact(dataset);
  if (!projected) {
    dataset = projectManualPastDatasetToCanonicalWindow(dataset, {
      usageInputMode: usageInputMode ?? undefined,
      now: args.now,
    });
    projected = isCanonicalManualPastArtifact(dataset);
  }

  const afterCoverage = readDatasetCoverageDates(dataset);
  const persistAudit: ManualCanonicalArtifactWindowPersistAudit = {
    enabled: true,
    hookVersion: MANUAL_CANONICAL_ARTIFACT_WINDOW_VERSION,
    serviceTree: args.serviceTree ?? "usageSimulator",
    callerLabel: String(args.callerLabel ?? "unknown").trim() || "unknown",
    usageMode: usageInputMode ?? "MANUAL_MONTHLY",
    runType: String(args.runType ?? "recalc").trim() || "recalc",
    beforeCoverageStart: beforeCoverage.start,
    beforeCoverageEnd: beforeCoverage.end,
    afterCoverageStart: afterCoverage.start,
    afterCoverageEnd: afterCoverage.end,
    projectedAt: new Date().toISOString(),
    source: "persist_hook",
  };
  dataset = {
    ...dataset,
    meta: {
      ...(dataset?.meta ?? {}),
      manualCanonicalArtifactWindowPersistAudit: persistAudit,
    },
  };

  return {
    dataset,
    projected,
    persistWindowStartDate: afterCoverage.start,
    persistWindowEndDate: afterCoverage.end,
    persistAudit,
  };
}
