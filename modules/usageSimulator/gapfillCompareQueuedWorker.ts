import { prisma } from "@/lib/db";
import { loadDisplayProfilesForHouse } from "@/modules/usageSimulator/profileDisplay";
import { localDateKeysInRange } from "@/lib/admin/gapfillLab";
import { setIntersect } from "@/app/api/admin/tools/gapfill-lab/gapfillLabRouteHelpers";
import {
  getGapfillCompareRunSnapshotById,
  markGapfillCompareRunFailed,
} from "@/modules/usageSimulator/compareRunSnapshot";
import { startCompareCoreTiming } from "@/app/api/admin/tools/gapfill-lab/gapfillLabRouteHelpers";
import {
  runGapfillCompareCorePipeline,
  type GapfillComparePipelineState,
  type GapfillCompareRunOut,
} from "@/modules/usageSimulator/gapfillCompareCorePipeline";
import type { GapfillCompareQueuedPayloadV1 } from "@/modules/usageSimulator/gapfillCompareQueuedPayload";
import { GAPFILL_COMPARE_QUEUED_PAYLOAD_VERSION } from "@/modules/usageSimulator/gapfillCompareQueuedPayload";

/** Thrown after failure has been persisted to GapfillCompareRunSnapshot (avoid duplicate marks). */
export class WorkerFailurePersisted extends Error {
  constructor() {
    super("gapfill_compare_worker_failure_persisted");
    this.name = "WorkerFailurePersisted";
  }
}

/**
 * Droplet worker entry: replay queued compare using persisted payload + shared pipeline only.
 */
export async function runGapfillCompareQueuedWorker(compareRunId: string): Promise<void> {
  try {
    await runGapfillCompareQueuedWorkerImpl(compareRunId);
  } catch (err) {
    if (err instanceof WorkerFailurePersisted) {
      throw err;
    }
    const message = err instanceof Error ? err.message : String(err);
    await markGapfillCompareRunFailed({
      compareRunId,
      phase: "compare_worker_exception",
      failureCode: "GAPFILL_COMPARE_WORKER_EXCEPTION",
      failureMessage: message.slice(0, 2000),
      statusMeta: {
        route: "gapfill_compare_queued_worker",
        dropletWorker: true,
      },
    });
    throw err;
  }
}

async function runGapfillCompareQueuedWorkerImpl(compareRunId: string): Promise<void> {
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
  const guardrailExcludedDateKeysLocal = new Set<string>([
    ...Array.from(travelDateKeysLocal),
    ...Array.from(testDateKeysLocal),
  ]);
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

  const pipelineResponse = await runGapfillCompareCorePipeline({
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

  const rawText = await pipelineResponse.text();
  let parsed: unknown = null;
  try {
    parsed = rawText ? JSON.parse(rawText) : null;
  } catch {
    parsed = null;
  }
  const payloadOk =
    pipelineResponse.ok &&
    parsed &&
    typeof parsed === "object" &&
    (parsed as { ok?: unknown }).ok !== false;
  if (!payloadOk) {
    const errCode =
      parsed && typeof parsed === "object" && typeof (parsed as { error?: unknown }).error === "string"
        ? String((parsed as { error: string }).error)
        : `http_${pipelineResponse.status}`;
    const errMsg =
      parsed && typeof parsed === "object" && typeof (parsed as { message?: unknown }).message === "string"
        ? String((parsed as { message: string }).message)
        : rawText.slice(0, 500);
    // `no_actual_data` is already persisted in the pipeline for droplet resume; avoid overwriting.
    if (errCode !== "no_actual_data") {
      await markGapfillCompareRunFailed({
        compareRunId,
        phase: "compare_core_pipeline_error_response",
        failureCode: errCode.slice(0, 120),
        failureMessage: errMsg.slice(0, 2000),
        statusMeta: {
          route: "gapfill_compare_queued_worker",
          dropletWorker: true,
          httpStatus: pipelineResponse.status,
        },
      });
    }
    throw new WorkerFailurePersisted();
  }
}

