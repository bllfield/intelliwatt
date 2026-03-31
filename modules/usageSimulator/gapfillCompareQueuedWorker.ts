import {
  getGapfillCompareRunSnapshotById,
  markGapfillCompareRunFailed,
} from "@/modules/usageSimulator/compareRunSnapshot";
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
 * Droplet compare replay is retired for Phase 4. GapFill compare now runs only through the
 * inline canonical recalc + persisted-artifact read path, so any stale queued compare is
 * failed explicitly instead of reviving the legacy pre-DB compare pipeline.
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
  await markGapfillCompareRunFailed({
    compareRunId,
    phase: "compare_worker_queued_path_retired",
    failureCode: "GAPFILL_COMPARE_QUEUED_PATH_RETIRED",
    failureMessage: [
      "Queued GapFill compare was retired in Phase 4.",
      "Run GapFill compare through the inline canonical recalc/read path so compare truth comes only from persisted lockbox artifacts.",
      `queuedPayloadVersion=${p.version}`,
    ].join(" "),
    statusMeta: {
      route: "gapfill_compare_queued_worker",
      dropletWorker: true,
      retiredBecause: "phase4_gapfill_thin",
    },
  });
  throw new WorkerFailurePersisted();
}

