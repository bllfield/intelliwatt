import { usagePrisma } from "@/lib/db/usageClient";

export const GAPFILL_COMPARE_SNAPSHOT_VERSION = "gapfill_compare_snapshot_v1";

type GapfillCompareRunModel = {
  create: (args: any) => Promise<any>;
  update: (args: any) => Promise<any>;
  findUnique: (args: any) => Promise<any>;
};

function getCompareRunModel(): GapfillCompareRunModel | null {
  try {
    const model = (usagePrisma as any).gapfillCompareRunSnapshot;
    return model &&
      typeof model.create === "function" &&
      typeof model.update === "function" &&
      typeof model.findUnique === "function"
      ? model
      : null;
  } catch {
    return null;
  }
}

export async function createGapfillCompareRunStart(args: {
  houseId?: string | null;
  userId?: string | null;
  compareFreshMode: "selected_days" | "full_window";
  requestedInputHash?: string | null;
  artifactScenarioId?: string | null;
  requireExactArtifactMatch: boolean;
  artifactIdentitySource?: string | null;
  statusMeta?: Record<string, unknown> | null;
  /** Full normalized replay payload for async droplet execution. */
  queuedPayloadJson?: Record<string, unknown> | null;
  /** Default started; use queued for enqueue-only handoff. */
  initialStatus?: "started" | "queued";
  initialPhase?: string | null;
}): Promise<{
  ok: true;
  compareRunId: string;
  createdAt: string;
  updatedAt: string;
  status: "started" | "queued";
} | {
  ok: false;
  error: string;
  message: string;
}> {
  const model = getCompareRunModel();
  if (!model) {
    return {
      ok: false,
      error: "compare_run_persistence_unavailable",
      message: "Gapfill compare-run persistence model is unavailable.",
    };
  }
  try {
    const now = new Date();
    const initialStatus = args.initialStatus ?? "started";
    const row = await model.create({
      data: {
        status: initialStatus,
        phase: args.initialPhase ?? (initialStatus === "queued" ? "compare_async_queued" : "compare_core_started"),
        startedAt: now,
        houseId: args.houseId ?? null,
        userId: args.userId ?? null,
        compareFreshMode: args.compareFreshMode,
        requestedInputHash: args.requestedInputHash ?? null,
        artifactScenarioId: args.artifactScenarioId ?? null,
        requireExactArtifactMatch: args.requireExactArtifactMatch === true,
        artifactIdentitySource: args.artifactIdentitySource ?? null,
        snapshotReady: false,
        statusMetaJson: args.statusMeta ?? null,
        queuedPayloadJson: args.queuedPayloadJson ?? undefined,
      },
      select: {
        id: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return {
      ok: true,
      compareRunId: String(row.id),
      createdAt: new Date(row.createdAt).toISOString(),
      updatedAt: new Date(row.updatedAt).toISOString(),
      status: "started",
    };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "compare run start persistence failed";
    return {
      ok: false,
      error: "compare_run_start_persist_failed",
      message: msg,
    };
  }
}

export async function markGapfillCompareRunRunning(args: {
  compareRunId: string;
  phase: string;
  statusMeta?: Record<string, unknown> | null;
}): Promise<boolean> {
  const model = getCompareRunModel();
  if (!model) return false;
  try {
    await model.update({
      where: { id: args.compareRunId },
      data: {
        status: "running",
        phase: args.phase,
        statusMetaJson: args.statusMeta ?? undefined,
      },
    });
    return true;
  } catch {
    return false;
  }
}

export async function markGapfillCompareRunFailed(args: {
  compareRunId: string;
  phase: string;
  failureCode: string;
  failureMessage: string;
  statusMeta?: Record<string, unknown> | null;
}): Promise<boolean> {
  const model = getCompareRunModel();
  if (!model) return false;
  try {
    await model.update({
      where: { id: args.compareRunId },
      data: {
        status: "failed",
        phase: args.phase,
        finishedAt: new Date(),
        failureCode: args.failureCode,
        failureMessage: args.failureMessage,
        statusMetaJson: args.statusMeta ?? undefined,
        snapshotReady: false,
      },
    });
    return true;
  } catch {
    return false;
  }
}

export async function finalizeGapfillCompareRunSnapshot(args: {
  compareRunId: string;
  phase: string;
  snapshot: Record<string, unknown>;
  statusMeta?: Record<string, unknown> | null;
}): Promise<boolean> {
  const model = getCompareRunModel();
  if (!model) return false;
  try {
    await model.update({
      where: { id: args.compareRunId },
      data: {
        status: "succeeded",
        phase: args.phase,
        finishedAt: new Date(),
        snapshotReady: true,
        snapshotVersion: GAPFILL_COMPARE_SNAPSHOT_VERSION,
        snapshotPersistedAt: new Date(),
        snapshotJson: args.snapshot,
        statusMetaJson: args.statusMeta ?? undefined,
        failureCode: null,
        failureMessage: null,
      },
    });
    return true;
  } catch {
    return false;
  }
}

export async function getGapfillCompareRunSnapshotById(args: { compareRunId: string }): Promise<{
  ok: true;
  row: {
    id: string;
    createdAt: string;
    updatedAt: string;
    startedAt: string;
    finishedAt: string | null;
    status: string;
    phase: string | null;
    houseId: string | null;
    userId: string | null;
    compareFreshMode: string;
    requestedInputHash: string | null;
    artifactScenarioId: string | null;
    requireExactArtifactMatch: boolean;
    artifactIdentitySource: string | null;
    failureCode: string | null;
    failureMessage: string | null;
    snapshotReady: boolean;
    snapshotVersion: string | null;
    snapshotPersistedAt: string | null;
    snapshotJson: Record<string, unknown> | null;
    statusMetaJson: Record<string, unknown> | null;
    queuedPayloadJson: Record<string, unknown> | null;
  };
} | {
  ok: false;
  error: string;
  message: string;
}> {
  const model = getCompareRunModel();
  if (!model) {
    return {
      ok: false,
      error: "compare_run_persistence_unavailable",
      message: "Gapfill compare-run persistence model is unavailable.",
    };
  }
  try {
    const row = await model.findUnique({
      where: { id: args.compareRunId },
      select: {
        id: true,
        createdAt: true,
        updatedAt: true,
        startedAt: true,
        finishedAt: true,
        status: true,
        phase: true,
        houseId: true,
        userId: true,
        compareFreshMode: true,
        requestedInputHash: true,
        artifactScenarioId: true,
        requireExactArtifactMatch: true,
        artifactIdentitySource: true,
        failureCode: true,
        failureMessage: true,
        snapshotReady: true,
        snapshotVersion: true,
        snapshotPersistedAt: true,
        snapshotJson: true,
        statusMetaJson: true,
        queuedPayloadJson: true,
      },
    });
    if (!row) {
      return {
        ok: false,
        error: "compare_run_not_found",
        message: "No compare-run snapshot record exists for the provided compareRunId.",
      };
    }
    return {
      ok: true,
      row: {
        id: String(row.id),
        createdAt: new Date(row.createdAt).toISOString(),
        updatedAt: new Date(row.updatedAt).toISOString(),
        startedAt: new Date(row.startedAt).toISOString(),
        finishedAt: row.finishedAt ? new Date(row.finishedAt).toISOString() : null,
        status: String(row.status ?? ""),
        phase: row.phase != null ? String(row.phase) : null,
        houseId: row.houseId != null ? String(row.houseId) : null,
        userId: row.userId != null ? String(row.userId) : null,
        compareFreshMode: String(row.compareFreshMode ?? ""),
        requestedInputHash: row.requestedInputHash != null ? String(row.requestedInputHash) : null,
        artifactScenarioId: row.artifactScenarioId != null ? String(row.artifactScenarioId) : null,
        requireExactArtifactMatch: row.requireExactArtifactMatch === true,
        artifactIdentitySource: row.artifactIdentitySource != null ? String(row.artifactIdentitySource) : null,
        failureCode: row.failureCode != null ? String(row.failureCode) : null,
        failureMessage: row.failureMessage != null ? String(row.failureMessage) : null,
        snapshotReady: row.snapshotReady === true,
        snapshotVersion: row.snapshotVersion != null ? String(row.snapshotVersion) : null,
        snapshotPersistedAt: row.snapshotPersistedAt ? new Date(row.snapshotPersistedAt).toISOString() : null,
        snapshotJson: row.snapshotJson && typeof row.snapshotJson === "object" ? (row.snapshotJson as Record<string, unknown>) : null,
        statusMetaJson: row.statusMetaJson && typeof row.statusMetaJson === "object" ? (row.statusMetaJson as Record<string, unknown>) : null,
        queuedPayloadJson:
          row.queuedPayloadJson && typeof row.queuedPayloadJson === "object"
            ? (row.queuedPayloadJson as Record<string, unknown>)
            : null,
      },
    };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "compare run snapshot read failed";
    return {
      ok: false,
      error: "compare_run_read_failed",
      message: msg,
    };
  }
}
