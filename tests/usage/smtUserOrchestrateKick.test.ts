import { beforeEach, describe, expect, it, vi } from "vitest";

const { requestSmtBackfillForAuthorizationMock, prismaMock } = vi.hoisted(() => ({
  requestSmtBackfillForAuthorizationMock: vi.fn(),
  prismaMock: {
    smtAuthorization: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("@/lib/db", () => ({
  prisma: prismaMock,
}));

vi.mock("@/lib/smt/agreements", () => ({
  getRollingBackfillRange: () => ({
    startDate: new Date("2025-05-20T00:00:00.000Z"),
    endDate: new Date("2026-05-20T00:00:00.000Z"),
  }),
  requestSmtBackfillForAuthorization: requestSmtBackfillForAuthorizationMock,
}));

vi.mock("@/lib/usage/smtWindowStatus", () => ({
  resolveSmtPersistedCoverageSpan: vi.fn().mockResolvedValue(null),
}));

import { kickSmtUserDelivery } from "@/lib/usage/smtUserOrchestrateKick";

describe("kickSmtUserDelivery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.smtAuthorization.findFirst.mockResolvedValue({
      id: "auth-1",
      esiid: "esiid-1",
      meterNumber: "meter-1",
    });
    prismaMock.smtAuthorization.update.mockResolvedValue({});
    requestSmtBackfillForAuthorizationMock.mockResolvedValue({ ok: true, message: "ok" });
  });

  it("no-ops when usage is already ready", async () => {
    const result = await kickSmtUserDelivery({
      userId: "user-1",
      houseId: "house-1",
      authorizationId: "auth-1",
      esiid: "esiid-1",
      authorizationStatus: "ACTIVE",
      usageReady: true,
      intervalCount: 1000,
      smtBackfillRequestedAt: new Date(),
    });
    expect(result.kicked).toBe(false);
    expect(result.reason).toBe("ready");
    expect(requestSmtBackfillForAuthorizationMock).not.toHaveBeenCalled();
  });

  it("requests backfill once when history is not ready and no prior request", async () => {
    const result = await kickSmtUserDelivery({
      userId: "user-1",
      houseId: "house-1",
      authorizationId: "auth-1",
      esiid: "esiid-1",
      authorizationStatus: "ACTIVE",
      usageReady: false,
      intervalCount: 0,
      smtBackfillRequestedAt: null,
    });
    expect(result.kicked).toBe(true);
    expect(result.reason).toBe("backfill_requested");
    expect(requestSmtBackfillForAuthorizationMock).toHaveBeenCalledTimes(1);
  });

  it("does not re-request backfill when intervals already exist", async () => {
    const result = await kickSmtUserDelivery({
      userId: "user-1",
      houseId: "house-1",
      authorizationId: "auth-1",
      esiid: "esiid-1",
      authorizationStatus: "ACTIVE",
      usageReady: false,
      intervalCount: 12000,
      smtBackfillRequestedAt: new Date(),
    });
    expect(result.kicked).toBe(false);
    expect(result.reason).toBe("nothing_to_do");
    expect(requestSmtBackfillForAuthorizationMock).not.toHaveBeenCalled();
  });
});
