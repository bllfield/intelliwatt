import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const extractPath = path.join(root, "modules/usageSimulator/_extract_compare_block.txt");
const outPath = path.join(root, "modules/usageSimulator/gapfillCompareCorePipeline.ts");

let body = fs.readFileSync(extractPath, "utf8");

body = body.replace(/\bcompareRequestTruthForLifecycle\b/g, "state.compareRequestTruthForLifecycle");
body = body.replace(/\bartifactRequestTruthForLifecycle\b/g, "state.artifactRequestTruthForLifecycle");
body = body.replace(/\bcompareCoreTimingForLifecycle\b/g, "state.compareCoreTimingForLifecycle");

body = body.replace(/\breq\.signal\b/g, "abortSignal");

body = body.replace(/compareRunStart\.compareRunId/g, "__CRS__");
body = body.replace(/\bcompareRunId\b/g, "out.compareRunId");
body = body.replace(/__CRS__/g, "compareRunStart.compareRunId");

body = body.replace(/\bcompareRunStatus\b/g, "out.compareRunStatus");
body = body.replace(/\bcompareRunSnapshotReady\b/g, "out.compareRunSnapshotReady");
body = body.replace(/\bcompareRunTerminalState\b/g, "out.compareRunTerminalState");

// Fix broken object shorthand: { out.compareRunId, -> { compareRunId: out.compareRunId,
const shorthands = [
  ["{ out.compareRunId,", "{ compareRunId: out.compareRunId,"],
  ["{ out.compareRunStatus,", "{ compareRunStatus: out.compareRunStatus,"],
  ["{ out.compareRunSnapshotReady,", "{ compareRunSnapshotReady: out.compareRunSnapshotReady,"],
  [", out.compareRunId,", ", compareRunId: out.compareRunId,"],
  [", out.compareRunStatus,", ", compareRunStatus: out.compareRunStatus,"],
  ["\n      out.compareRunId,\n", "\n      compareRunId: out.compareRunId,\n"],
  ["\n        out.compareRunId,\n", "\n        compareRunId: out.compareRunId,\n"],
  ["\n          out.compareRunId,\n", "\n          compareRunId: out.compareRunId,\n"],
];
for (const [a, b] of shorthands) {
  body = body.split(a).join(b);
}

const header = `import { NextRequest, NextResponse } from "next/server";
import { getActualIntervalsForRange } from "@/lib/usage/actualDatasetForHouse";
import {
  buildGapfillCompareSimShared,
  type GapfillCompareBuildPhase,
  type GapfillScoredDayParityAvailability,
  type GapfillScoredDayParityDisplayValueKind,
  type GapfillScoredDayParityReasonCode,
} from "@/modules/usageSimulator/service";
import {
  createGapfillCompareRunStart,
  finalizeGapfillCompareRunSnapshot,
  markGapfillCompareRunFailed,
  markGapfillCompareRunRunning,
} from "@/modules/usageSimulator/compareRunSnapshot";
import { IntervalSeriesKind } from "@/modules/usageSimulator/kinds";
import {
  classifySimulationFailure,
  recordSimulationDataAlert,
} from "@/modules/usageSimulator/simulationDataAlerts";
import { SOURCE_OF_DAY_SIMULATION_CORE } from "@/modules/simulatedUsage/pastDaySimulator";
import {
  shiftIsoDateUtc,
  markCompareCoreStep,
  finalizeCompareCoreTiming,
  buildHeavyTiming,
  buildSelectedDaysCoreResponseModelAssumptions,
  withTimeout,
  withRequestAbort,
  attachAbortForwarders,
  normalizeRouteError,
  safeRatio,
  bucketHourBlock,
  classifyTemperatureBand,
  classifyWeatherRegime,
  topCounts,
  getLocalHourMinuteInTimezone,
  round2,
  sortedSample,
  buildFullReport,
  ROUTE_COMPARE_SHARED_TIMEOUT_MS,
  ROUTE_COMPARE_REPORT_TIMEOUT_MS,
  startCompareCoreTiming,
  type CompareCoreStepKey,
} from "@/app/api/admin/tools/gapfill-lab/gapfillLabRouteHelpers";
import {
  canonicalIntervalKey,
  computeGapFillMetrics,
  dateKeyInTimezone,
  mergeDateKeysToRanges,
} from "@/lib/admin/gapfillLab";

export type GapfillComparePipelineState = {
  compareRequestTruthForLifecycle: Record<string, unknown> | null;
  artifactRequestTruthForLifecycle: Record<string, unknown> | null;
  compareCoreTimingForLifecycle: ReturnType<typeof startCompareCoreTiming> | null;
};

export type GapfillCompareRunOut = {
  compareRunId: string | null;
  compareRunStatus: "started" | "running" | "succeeded" | "failed" | "queued" | null;
  compareRunSnapshotReady: boolean;
  compareRunTerminalState: boolean;
};

export type GapfillCompareCorePipelineArgs = {
  abortSignal?: AbortSignal;
  resumeExistingCompareRunId?: string | null;
  state: GapfillComparePipelineState;
  /** Mutated for POST handler outer scope / catch. */
  out: GapfillCompareRunOut;
  user: { id: string; email: string };
  house: Record<string, unknown> & {
    id: string;
    addressLine1?: string | null;
    addressCity?: string | null;
    addressState?: string | null;
    esiid?: string | null;
  };
  houses: Array<Record<string, unknown>>;
  esiid: string | null;
  timezone: string;
  canonicalWindow: { startDate: string; endDate: string };
  canonicalMonths: string[];
  canonicalWindowHelper: string;
  homeProfile: unknown;
  applianceProfile: unknown;
  testDateKeysLocal: Set<string>;
  candidateIntervalsForTesting: Array<{ timestamp: string; kwh: number }> | null;
  testRanges: Array<{ startDate: string; endDate: string }>;
  testRangesUsed: Array<{ startDate: string; endDate: string }>;
  testSelectionMode: "manual_ranges" | "random_days";
  testDaysRequested: number | null;
  testDaysSelected: number;
  seedUsed: string | null;
  testMode: string;
  candidateDaysAfterModeFilterCount: number | null;
  candidateWindowStart: string | null;
  candidateWindowEnd: string | null;
  excludedFromTest_travelCount: number;
  travelRangesFromDb: Array<{ startDate: string; endDate: string }>;
  travelDateKeysLocal: Set<string>;
  guardrailExcludedDateKeysLocal: Set<string>;
  overlapLocal: Set<string>;
  compareCoreTiming: ReturnType<typeof startCompareCoreTiming>;
  includeDiagnostics: boolean;
  includeFullReportText: boolean;
  rebuildArtifact: boolean;
  requestedArtifactInputHash: string | null;
  requestedArtifactScenarioId: string | null;
  requireExactArtifactMatch: boolean;
  artifactIdentitySource: string | null;
  heavyOnlyCompactResponse: boolean;
  requestedCompareRunId: string | null;
};

export async function runGapfillCompareCorePipeline(
  args: GapfillCompareCorePipelineArgs
): Promise<NextResponse> {
  const {
    abortSignal,
    resumeExistingCompareRunId,
    state,
    out,
    user,
    house,
    houses,
    esiid,
    timezone,
    canonicalWindow,
    canonicalMonths,
    canonicalWindowHelper,
    homeProfile,
    applianceProfile,
    testDateKeysLocal,
    candidateIntervalsForTesting,
    testRanges,
    testRangesUsed,
    testSelectionMode,
    testDaysRequested,
    testDaysSelected,
    seedUsed,
    testMode,
    candidateDaysAfterModeFilterCount,
    candidateWindowStart,
    candidateWindowEnd,
    excludedFromTest_travelCount,
    travelRangesFromDb,
    travelDateKeysLocal,
    guardrailExcludedDateKeysLocal,
    overlapLocal,
    compareCoreTiming,
    includeDiagnostics,
    includeFullReportText,
    rebuildArtifact,
    requestedArtifactInputHash,
    requestedArtifactScenarioId,
    requireExactArtifactMatch,
    artifactIdentitySource,
    heavyOnlyCompactResponse,
    requestedCompareRunId,
  } = args;

  if (resumeExistingCompareRunId) {
    out.compareRunId = resumeExistingCompareRunId;
    out.compareRunStatus = "running";
  }

`;

fs.writeFileSync(outPath, `${header}${body}\n}\n`, "utf8");
console.log("Wrote", outPath);
