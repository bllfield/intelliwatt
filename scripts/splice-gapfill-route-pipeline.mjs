import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const routePath = path.join(root, "app/api/admin/tools/gapfill-lab/route.ts");

const lines = fs.readFileSync(routePath, "utf8").split(/\r?\n/);
const before = lines.slice(0, 825).join("\n");
const after = lines.slice(2793).join("\n");

const block = `
  const pipelineState: import("@/modules/usageSimulator/gapfillCompareCorePipeline").GapfillComparePipelineState = {
    compareRequestTruthForLifecycle: null,
    artifactRequestTruthForLifecycle: null,
    compareCoreTimingForLifecycle: null,
  };
  const pipelineOut: import("@/modules/usageSimulator/gapfillCompareCorePipeline").GapfillCompareRunOut = {
    compareRunId: null,
    compareRunStatus: null,
    compareRunSnapshotReady: false,
    compareRunTerminalState: false,
  };
  const response = await runGapfillCompareCorePipeline({
    abortSignal: req.signal,
    resumeExistingCompareRunId: null,
    state: pipelineState,
    out: pipelineOut,
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
  });
  compareRunId = pipelineOut.compareRunId;
  compareRunStatus = pipelineOut.compareRunStatus;
  compareRunSnapshotReady = pipelineOut.compareRunSnapshotReady;
  compareRunTerminalState = pipelineOut.compareRunTerminalState;
  compareRequestTruthForLifecycle = pipelineState.compareRequestTruthForLifecycle;
  artifactRequestTruthForLifecycle = pipelineState.artifactRequestTruthForLifecycle;
  compareCoreTimingForLifecycle = pipelineState.compareCoreTimingForLifecycle;
  return response;
`;

fs.writeFileSync(routePath, `${before}\n${block}\n${after}`, "utf8");
console.log("Spliced route.ts pipeline call");
