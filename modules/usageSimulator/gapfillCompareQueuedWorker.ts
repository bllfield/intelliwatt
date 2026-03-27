import { prisma } from "@/lib/db";
import { loadDisplayProfilesForHouse } from "@/modules/usageSimulator/profileDisplay";
import { localDateKeysInRange } from "@/lib/admin/gapfillLab";
import { setIntersect } from "@/app/api/admin/tools/gapfill-lab/gapfillLabRouteHelpers";
import { getGapfillCompareRunSnapshotById } from "@/modules/usageSimulator/compareRunSnapshot";
import { startCompareCoreTiming } from "@/app/api/admin/tools/gapfill-lab/gapfillLabRouteHelpers";
import {
  runGapfillCompareCorePipeline,
  type GapfillComparePipelineState,
  type GapfillCompareRunOut,
} from "@/modules/usageSimulator/gapfillCompareCorePipeline";
import type { GapfillCompareQueuedPayloadV1 } from "@/modules/usageSimulator/gapfillCompareQueuedPayload";
import { GAPFILL_COMPARE_QUEUED_PAYLOAD_VERSION } from "@/modules/usageSimulator/gapfillCompareQueuedPayload";

/**
 * Droplet worker entry: replay queued compare using persisted payload + shared pipeline only.
 */
export async function runGapfillCompareQueuedWorker(compareRunId: string): Promise<void> {
  const read = await getGapfillCompareRunSnapshotById({ compareRunId });
  if (!read.ok) {
    throw new Error(read.message ?? "compare run read failed");
  }
  const row = read.row;
  if (row.snapshotReady) {
    return;
  }
  if (row.status === "succeeded" || row.status === "failed") {
    return;
  }
  const raw = row.queuedPayloadJson;
  if (!raw || typeof raw !== "object") {
    throw new Error("compare_run_missing_queued_payload");
  }
  const p = raw as GapfillCompareQueuedPayloadV1;
  if (p.version !== GAPFILL_COMPARE_QUEUED_PAYLOAD_VERSION) {
    throw new Error("compare_run_queued_payload_version_unsupported");
  }

  const user = await prisma.user.findUnique({
    where: { id: p.userId },
    select: { id: true, email: true },
  });
  if (!user) throw new Error("user_not_found");

  const house = await prisma.houseAddress.findFirst({
    where: { id: p.houseId, userId: p.userId, archivedAt: null },
  });
  if (!house) throw new Error("house_not_found");

  const houses = await prisma.houseAddress.findMany({
    where: { userId: p.userId, archivedAt: null },
    orderBy: { updatedAt: "desc" },
    select: { id: true, esiid: true, addressLine1: true, addressCity: true, addressState: true, createdAt: true },
  });

  const { homeProfile, applianceProfile } = await loadDisplayProfilesForHouse({
    userId: user.id,
    houseId: house.id,
  });

  const travelDateKeysLocal = new Set<string>(
    p.travelRangesFromDb.flatMap((r) => localDateKeysInRange(r.startDate, r.endDate, p.timezone))
  );
  const testDateKeysLocal = new Set<string>(p.testDateKeysLocal);
  const guardrailExcludedDateKeysLocal = new Set<string>([...travelDateKeysLocal, ...testDateKeysLocal]);
  const overlapLocal = setIntersect(travelDateKeysLocal, testDateKeysLocal);
  if (overlapLocal.size > 0) {
    throw new Error("test_overlaps_travel_replay");
  }

  const compareCoreTiming = startCompareCoreTiming();
  const pipelineState: GapfillComparePipelineState = {
    compareRequestTruthForLifecycle: null,
    artifactRequestTruthForLifecycle: null,
    compareCoreTimingForLifecycle: null,
  };
  const pipelineOut: GapfillCompareRunOut = {
    compareRunId: null,
    compareRunStatus: null,
    compareRunSnapshotReady: false,
    compareRunTerminalState: false,
  };

  await runGapfillCompareCorePipeline({
    abortSignal: undefined,
    resumeExistingCompareRunId: compareRunId,
    state: pipelineState,
    out: pipelineOut,
    user,
    house: house as Record<string, unknown> & {
      id: string;
      addressLine1?: string | null;
      addressCity?: string | null;
      addressState?: string | null;
      esiid?: string | null;
    },
    houses: houses as Array<Record<string, unknown>>,
    esiid: p.esiid,
    timezone: p.timezone,
    canonicalWindow: p.canonicalWindow,
    canonicalMonths: p.canonicalMonths,
    canonicalWindowHelper: p.canonicalWindowHelper,
    homeProfile,
    applianceProfile,
    testDateKeysLocal,
    candidateIntervalsForTesting: null,
    testRanges: p.testRanges,
    testRangesUsed: p.testRangesUsed,
    testSelectionMode: p.testSelectionMode,
    testDaysRequested: p.testDaysRequested,
    testDaysSelected: p.testDaysSelected,
    seedUsed: p.seedUsed,
    testMode: p.testMode,
    candidateDaysAfterModeFilterCount: p.candidateDaysAfterModeFilterCount,
    candidateWindowStart: p.candidateWindowStart,
    candidateWindowEnd: p.candidateWindowEnd,
    excludedFromTest_travelCount: p.excludedFromTest_travelCount,
    travelRangesFromDb: p.travelRangesFromDb,
    travelDateKeysLocal,
    guardrailExcludedDateKeysLocal,
    overlapLocal,
    compareCoreTiming,
    includeDiagnostics: p.includeDiagnostics,
    includeFullReportText: p.includeFullReportText,
    rebuildArtifact: p.rebuildArtifact,
    requestedArtifactInputHash: p.requestedArtifactInputHash,
    requestedArtifactScenarioId: p.requestedArtifactScenarioId,
    requireExactArtifactMatch: p.requireExactArtifactMatch,
    artifactIdentitySource: p.artifactIdentitySource,
    heavyOnlyCompactResponse: p.heavyOnlyCompactResponse,
    requestedCompareRunId: p.requestedCompareRunId,
    minDayCoveragePct: p.minDayCoveragePct,
  });
}
