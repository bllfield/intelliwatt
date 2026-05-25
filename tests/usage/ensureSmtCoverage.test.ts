import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  requestUsageRefreshForUserHouseMock,
  requestTargetedSmtIntervalBackfillForHouseMock,
  runDeferredPendingSmtDayRepairsMock,
  reconcileSmtIntervalDayLedgerMock,
  loadSmtWindowDayStatusMock,
  resolveSmtPersistedCoverageSpanMock,
  waitForSmtDateCoverageMock,
  waitForSmtTailCoverageMock,
} = vi.hoisted(() => ({
  requestUsageRefreshForUserHouseMock: vi.fn(),
  requestTargetedSmtIntervalBackfillForHouseMock: vi.fn(),
  runDeferredPendingSmtDayRepairsMock: vi.fn(),
  reconcileSmtIntervalDayLedgerMock: vi.fn(),
  loadSmtWindowDayStatusMock: vi.fn(),
  resolveSmtPersistedCoverageSpanMock: vi.fn(),
  waitForSmtDateCoverageMock: vi.fn(),
  waitForSmtTailCoverageMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    houseAddress: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock("@/lib/usage/userUsageRefresh", () => ({
  requestUsageRefreshForUserHouse: requestUsageRefreshForUserHouseMock,
}));

vi.mock("@/lib/usage/smtIncompleteMeterBackfill", () => ({
  requestTargetedSmtIntervalBackfillForHouse: requestTargetedSmtIntervalBackfillForHouseMock,
}));

vi.mock("@/lib/usage/smtDayCoverageLedger", () => ({
  runDeferredPendingSmtDayRepairs: runDeferredPendingSmtDayRepairsMock,
  reconcileSmtIntervalDayLedger: reconcileSmtIntervalDayLedgerMock,
}));

vi.mock("@/lib/usage/smtWindowStatus", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/usage/smtWindowStatus")>();
  return {
    ...actual,
    loadSmtWindowDayStatus: loadSmtWindowDayStatusMock,
    resolveSmtPersistedCoverageSpan: resolveSmtPersistedCoverageSpanMock,
  };
});

vi.mock("@/lib/usage/smtTailCoverage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/usage/smtTailCoverage")>();
  return {
    ...actual,
    waitForSmtDateCoverage: waitForSmtDateCoverageMock,
    waitForSmtTailCoverage: waitForSmtTailCoverageMock,
  };
});

import { prisma } from "@/lib/db";
import {
  clearEnsureSmtCoverageSessionThrottleForTests,
  ensureSmtCoverageForHouse,
} from "@/lib/usage/ensureSmtCoverage";

const findHouseMock = vi.mocked(prisma.houseAddress.findFirst);

function windowStatus(overrides?: Partial<ReturnType<typeof loadSmtWindowDayStatusMock>>) {
  return {
    window: { startDate: "2025-04-16", endDate: "2026-04-14" },
    dateKeys: ["2026-04-12", "2026-04-14"],
    byDate: {
      "2026-04-12": {
        dateKey: "2026-04-12",
        slotCount: 40,
        missingSlots: [],
        ledgerStatus: null,
        isComplete: false,
      },
      "2026-04-14": {
        dateKey: "2026-04-14",
        slotCount: 96,
        missingSlots: [],
        ledgerStatus: "COMPLETE",
        isComplete: true,
      },
    },
    completeDateKeys: ["2026-04-14"],
    incompleteDateKeys: ["2026-04-12"],
    pendingDateKeys: [],
    incompleteMeterDateKeys: [],
    canonicalEndDayComplete: true,
    ready: false,
    ...overrides,
  };
}

beforeEach(() => {
  clearEnsureSmtCoverageSessionThrottleForTests();
  findHouseMock.mockResolvedValue({ esiid: "esiid-1" } as never);
  resolveSmtPersistedCoverageSpanMock.mockResolvedValue({
    startDate: "2025-04-16",
    endDate: "2026-04-14",
  });
  loadSmtWindowDayStatusMock.mockResolvedValue(windowStatus());
  requestUsageRefreshForUserHouseMock.mockResolvedValue({ ok: true, homes: [], backfill: [] });
  requestTargetedSmtIntervalBackfillForHouseMock.mockResolvedValue({
    ok: true,
    dateKeys: ["2026-04-12"],
    startDateKey: "2026-04-12",
    endDateKey: "2026-04-12",
  });
  runDeferredPendingSmtDayRepairsMock.mockResolvedValue({
    attempted: false,
    eligibleDateKeys: [],
    pullDateKey: "2026-04-16",
    reconcile: { incompleteMeterDateKeys: [], pendingDateKeys: [], byDate: {}, canonicalEndDate: "2026-04-14" },
  });
  reconcileSmtIntervalDayLedgerMock.mockResolvedValue({
    incompleteMeterDateKeys: [],
    pendingDateKeys: [],
    byDate: {},
    canonicalEndDate: "2026-04-14",
    updatedDateKeys: [],
  });
  waitForSmtDateCoverageMock.mockResolvedValue({
    dateKeys: ["2026-04-12"],
    countsByDate: { "2026-04-12": 40 },
    missingSlotsByDate: { "2026-04-12": [95] },
    incompleteDateKeys: ["2026-04-12"],
    ready: false,
    timedOut: true,
    durationMs: 1000,
    attempts: 2,
  });
  waitForSmtTailCoverageMock.mockResolvedValue({
    tailReady: true,
    timedOut: false,
    durationMs: 500,
    attempts: 1,
    targetEndDate: "2026-04-14",
    incompleteTailDateKeys: [],
    tailCountsByDate: {},
    intervalCount: 100,
    coverageStartDate: "2025-04-16",
    coverageEndDate: "2026-04-14",
    coverageStartUtcDate: null,
    coverageEndUtcDate: null,
    tailStartDate: "2026-04-01",
    targetEndDayLedgerStatus: null,
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("ensureSmtCoverageForHouse", () => {
  it("skips heal when session was already healed", async () => {
    const first = await ensureSmtCoverageForHouse({
      userId: "user-1",
      houseId: "house-1",
      profile: "user_session",
      sessionKey: "sess-a",
    });
    expect(first.healed).toBe(true);

    const second = await ensureSmtCoverageForHouse({
      userId: "user-1",
      houseId: "house-1",
      profile: "user_session",
      sessionKey: "sess-a",
    });
    expect(second.healed).toBe(false);
    expect(second.skippedReason).toBe("session_throttle");
    expect(requestUsageRefreshForUserHouseMock).toHaveBeenCalledTimes(2);
  });

  it("heals again when force=true", async () => {
    await ensureSmtCoverageForHouse({
      userId: "user-1",
      houseId: "house-1",
      profile: "admin_sim",
      sessionKey: "sess-b",
    });
    await ensureSmtCoverageForHouse({
      userId: "user-1",
      houseId: "house-1",
      profile: "admin_sim",
      sessionKey: "sess-b",
      force: true,
    });
    expect(requestUsageRefreshForUserHouseMock).toHaveBeenCalledTimes(4);
  });

  it("targeted backfills incomplete days within persisted SMT span only", async () => {
    loadSmtWindowDayStatusMock.mockResolvedValue(
      windowStatus({
        incompleteDateKeys: ["2026-04-10", "2026-04-12"],
        incompleteMeterDateKeys: ["2026-04-12"],
        pendingDateKeys: ["2026-04-14"],
      })
    );
    const result = await ensureSmtCoverageForHouse({
      userId: "user-1",
      houseId: "house-1",
      profile: "sim_run",
      sessionKey: "run-1",
    });

    expect(result.healed).toBe(true);
    expect(requestTargetedSmtIntervalBackfillForHouseMock).toHaveBeenCalledWith({
      houseId: "house-1",
      dateKeys: ["2026-04-10", "2026-04-12", "2026-04-14"],
    });
    expect(runDeferredPendingSmtDayRepairsMock).toHaveBeenCalled();
    expect(waitForSmtDateCoverageMock).toHaveBeenCalled();
    expect(waitForSmtTailCoverageMock).toHaveBeenCalled();
  });

  it("still heals when only pre-span canonical days are incomplete but tail has not reached window end", async () => {
    resolveSmtPersistedCoverageSpanMock.mockResolvedValue({
      startDate: "2026-04-12",
      endDate: "2026-04-14",
    });
    loadSmtWindowDayStatusMock.mockResolvedValue(
      windowStatus({
        incompleteDateKeys: ["2026-04-10"],
        completeDateKeys: ["2026-04-14"],
        canonicalEndDayComplete: false,
        ready: false,
      })
    );

    const result = await ensureSmtCoverageForHouse({
      userId: "user-1",
      houseId: "house-1",
      profile: "user_session",
      sessionKey: "pre-span-tail-gap",
    });

    expect(result.healed).toBe(true);
    expect(requestTargetedSmtIntervalBackfillForHouseMock).not.toHaveBeenCalled();
    expect(requestUsageRefreshForUserHouseMock).toHaveBeenCalled();
    expect(waitForSmtTailCoverageMock).toHaveBeenCalled();
  });

  it("honors an explicit esiid when the house row has no meter id", async () => {
    findHouseMock.mockResolvedValue({ esiid: null } as never);
    const result = await ensureSmtCoverageForHouse({
      userId: "user-1",
      houseId: "lab-home-1",
      esiid: "esiid-from-source",
      profile: "admin_sim",
      sessionKey: "explicit-esiid",
      force: true,
    });

    expect(result.skippedReason).toBeUndefined();
    expect(result.healed).toBe(true);
    expect(loadSmtWindowDayStatusMock).toHaveBeenCalledWith(
      expect.objectContaining({ esiid: "esiid-from-source" })
    );
  });

  it("uses short waits for user_session profile", async () => {
    await ensureSmtCoverageForHouse({
      userId: "user-1",
      houseId: "house-1",
      profile: "user_session",
      sessionKey: "usage-page",
    });

    expect(waitForSmtTailCoverageMock).toHaveBeenCalledWith(
      expect.objectContaining({ timeoutMs: 8_000, exitEarlyWhenStalled: true })
    );
    expect(waitForSmtDateCoverageMock).toHaveBeenCalledWith(
      expect.objectContaining({ timeoutMs: 8_000 })
    );
  });
});
