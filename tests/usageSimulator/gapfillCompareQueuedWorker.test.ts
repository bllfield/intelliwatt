import { beforeEach, describe, expect, it, vi } from "vitest";
import { GAPFILL_COMPARE_QUEUED_PAYLOAD_VERSION } from "@/modules/usageSimulator/gapfillCompareQueuedPayload";

const mockGetSnapshot = vi.fn();
const mockMarkFailed = vi.fn();
const mockPipeline = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
    houseAddress: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

vi.mock("@/modules/usageSimulator/compareRunSnapshot", () => ({
  getGapfillCompareRunSnapshotById: (...args: unknown[]) => mockGetSnapshot(...args),
  markGapfillCompareRunFailed: (...args: unknown[]) => mockMarkFailed(...args),
}));

vi.mock("@/modules/usageSimulator/profileDisplay", () => ({
  loadDisplayProfilesForHouse: vi.fn().mockResolvedValue({
    homeProfile: {},
    applianceProfile: {},
  }),
}));

vi.mock("@/modules/usageSimulator/gapfillCompareCorePipeline", () => ({
  runGapfillCompareCorePipeline: (...args: unknown[]) => mockPipeline(...args),
}));

import { prisma } from "@/lib/db";
import { buildSnapshotReaderBase } from "@/app/api/admin/tools/gapfill-lab/gapfillLabRouteHelpers";
import {
  runGapfillCompareQueuedWorker,
  WorkerFailurePersisted,
} from "@/modules/usageSimulator/gapfillCompareQueuedWorker";

const queuedPayload = {
  version: GAPFILL_COMPARE_QUEUED_PAYLOAD_VERSION,
  userId: "user-1",
  houseId: "house-1",
  timezone: "America/Chicago",
  canonicalWindow: { startDate: "2024-01-01", endDate: "2024-12-31" },
  canonicalMonths: [] as string[],
  canonicalWindowHelper: "helper",
  esiid: null as string | null,
  testDateKeysLocal: ["2024-06-15"],
  testRanges: [] as Array<{ startDate: string; endDate: string }>,
  testRangesUsed: [] as Array<{ startDate: string; endDate: string }>,
  testSelectionMode: "random_days" as const,
  testDaysRequested: null as number | null,
  testDaysSelected: 1,
  seedUsed: null as string | null,
  testMode: "gapfill",
  candidateDaysAfterModeFilterCount: null as number | null,
  candidateWindowStart: null as string | null,
  candidateWindowEnd: null as string | null,
  excludedFromTest_travelCount: 0,
  travelRangesFromDb: [] as Array<{ startDate: string; endDate: string }>,
  includeDiagnostics: false,
  includeFullReportText: false,
  rebuildArtifact: false,
  requestedArtifactInputHash: null as string | null,
  requestedArtifactScenarioId: null as string | null,
  requireExactArtifactMatch: false,
  artifactIdentitySource: null as string | null,
  heavyOnlyCompactResponse: false,
  requestedCompareRunId: null as string | null,
  minDayCoveragePct: 0,
};

function baseRow(overrides: Record<string, unknown> = {}) {
  return {
    snapshotReady: false,
    status: "queued",
    phase: "compare_async_queued",
    queuedPayloadJson: queuedPayload,
    failureCode: null,
    failureMessage: null,
    ...overrides,
  };
}

describe("runGapfillCompareQueuedWorker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSnapshot.mockResolvedValue({ ok: true, row: baseRow() });
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: "user-1",
      email: "user@example.com",
    } as any);
    vi.mocked(prisma.houseAddress.findFirst).mockResolvedValue({
      id: "house-1",
      userId: "user-1",
      archivedAt: null,
    } as any);
    vi.mocked(prisma.houseAddress.findMany).mockResolvedValue([
      {
        id: "house-1",
        esiid: null,
        addressLine1: "1 Main",
        addressCity: "Austin",
        addressState: "TX",
        createdAt: new Date(),
      },
    ] as any);
    mockMarkFailed.mockResolvedValue(true);
  });

  it("persists failure when pipeline returns JSON with ok:false (worker used to ignore this)", async () => {
    mockPipeline.mockResolvedValue(
      new Response(JSON.stringify({ ok: false, error: "shared_compare_failed", message: "boom" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      })
    );
    await expect(runGapfillCompareQueuedWorker("run-1")).rejects.toBeInstanceOf(WorkerFailurePersisted);
    expect(mockMarkFailed).toHaveBeenCalledTimes(1);
    expect(mockMarkFailed).toHaveBeenCalledWith(
      expect.objectContaining({
        compareRunId: "run-1",
        phase: "compare_core_pipeline_error_response",
        failureCode: "shared_compare_failed",
        failureMessage: "boom",
      })
    );
  });

  it("does not double-mark when error is no_actual_data (pipeline already persisted)", async () => {
    mockPipeline.mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: false,
          error: "no_actual_data",
          message: "No actual interval data for the test date window.",
        }),
        { status: 400, headers: { "content-type": "application/json" } }
      )
    );
    await expect(runGapfillCompareQueuedWorker("run-2")).rejects.toBeInstanceOf(WorkerFailurePersisted);
    expect(mockMarkFailed).not.toHaveBeenCalled();
  });

  it("marks GAPFILL_COMPARE_WORKER_EXCEPTION on unexpected throw (not WorkerFailurePersisted)", async () => {
    mockPipeline.mockRejectedValue(new Error("unexpected"));
    await expect(runGapfillCompareQueuedWorker("run-3")).rejects.toThrow("unexpected");
    expect(mockMarkFailed).toHaveBeenCalledWith(
      expect.objectContaining({
        compareRunId: "run-3",
        phase: "compare_worker_exception",
        failureCode: "GAPFILL_COMPARE_WORKER_EXCEPTION",
        failureMessage: "unexpected",
      })
    );
  });
});

describe("compare_run_poll snapshot base (failed rows)", () => {
  it("exposes compareRunStatus failed so UI is not stuck reading queued-only", () => {
    const base = buildSnapshotReaderBase({
      compareRunId: "cr-1",
      row: {
        status: "failed",
        phase: "compare_worker_exception",
        compareFreshMode: "selected_days",
        requestedInputHash: null,
        artifactScenarioId: null,
        requireExactArtifactMatch: false,
        artifactIdentitySource: null,
        failureCode: "GAPFILL_COMPARE_WORKER_EXCEPTION",
        failureMessage: "worker error",
        snapshotReady: false,
        snapshotVersion: null,
        snapshotPersistedAt: null,
        snapshotJson: null,
        statusMetaJson: { dropletWorker: true },
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
        startedAt: new Date(0).toISOString(),
        finishedAt: null,
      },
    });
    expect(base.compareRunStatus).toBe("failed");
    expect(base.compareRunSnapshotReady).toBe(false);
  });
});
