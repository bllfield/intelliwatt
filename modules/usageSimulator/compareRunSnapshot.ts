import { usagePrisma } from "@/lib/db/usageClient";

export const GAPFILL_COMPARE_SNAPSHOT_VERSION = "gapfill_compare_snapshot_v1";

type GapfillCompareRunModel = {
  create: (args: any) => Promise<any>;
  update: (args: any) => Promise<any>;
};

function getCompareRunModel(): GapfillCompareRunModel | null {
  try {
    const model = (usagePrisma as any).gapfillCompareRunSnapshot;
    return model &&
      typeof model.create === "function" &&
      typeof model.update === "function"
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
}): Promise<{
  ok: true;
  compareRunId: string;
  createdAt: string;
  updatedAt: string;
  status: "started";
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
    const row = await model.create({
      data: {
        status: "started",
        phase: "compare_core_started",
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
