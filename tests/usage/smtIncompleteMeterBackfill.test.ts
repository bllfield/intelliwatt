import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaHouseFindFirst = vi.fn();
const prismaAuthFindMany = vi.fn();
const prismaAuthUpdate = vi.fn();
const pickBestSmtAuthorization = vi.fn();
const requestSmtBackfillForAuthorization = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    houseAddress: { findFirst: (...args: any[]) => prismaHouseFindFirst(...args) },
    smtAuthorization: {
      findMany: (...args: any[]) => prismaAuthFindMany(...args),
      update: (...args: any[]) => prismaAuthUpdate(...args),
    },
  },
}));

vi.mock("@/lib/smt/authorizationSelection", () => ({
  pickBestSmtAuthorization: (...args: any[]) => pickBestSmtAuthorization(...args),
}));

vi.mock("@/lib/smt/agreements", () => ({
  requestSmtBackfillForAuthorization: (...args: any[]) => requestSmtBackfillForAuthorization(...args),
}));

describe("requestTargetedSmtIntervalBackfillForHouse", () => {
  beforeEach(() => {
    vi.resetModules();
    prismaHouseFindFirst.mockReset();
    prismaAuthFindMany.mockReset();
    prismaAuthUpdate.mockReset();
    prismaAuthUpdate.mockResolvedValue({});
    pickBestSmtAuthorization.mockReset();
    requestSmtBackfillForAuthorization.mockReset();
    delete process.env.SMT_INTERVAL_BACKFILL_ENABLED;
  });

  it("skips when interval backfill is disabled", async () => {
    process.env.SMT_INTERVAL_BACKFILL_ENABLED = "false";
    const { requestTargetedSmtIntervalBackfillForHouse } = await import(
      "@/lib/usage/smtIncompleteMeterBackfill"
    );
    const result = await requestTargetedSmtIntervalBackfillForHouse({
      houseId: "house-1",
      dateKeys: ["2026-05-16", "2026-05-17"],
    });
    expect(result).toEqual({ ok: false, skipped: "interval_backfill_disabled" });
    expect(prismaHouseFindFirst).not.toHaveBeenCalled();
  });

  it("requests backfill for the min/max date window when enabled", async () => {
    process.env.SMT_INTERVAL_BACKFILL_ENABLED = "true";
    prismaHouseFindFirst.mockResolvedValue({ id: "house-1", esiid: "12345678901234567" });
    prismaAuthFindMany.mockResolvedValue([{ id: "auth-1", esiid: "12345678901234567", smtStatus: "active" }]);
    pickBestSmtAuthorization.mockReturnValue({
      id: "auth-1",
      esiid: "12345678901234567",
      meterNumber: "m1",
      smtStatus: "active",
    });
    requestSmtBackfillForAuthorization.mockResolvedValue({ ok: true, message: "queued" });

    const { requestTargetedSmtIntervalBackfillForHouse } = await import(
      "@/lib/usage/smtIncompleteMeterBackfill"
    );
    const result = await requestTargetedSmtIntervalBackfillForHouse({
      houseId: "house-1",
      dateKeys: ["2026-05-17", "2026-05-16"],
    });

    expect(result.ok).toBe(true);
    expect(result.startDateKey).toBe("2026-05-16");
    expect(result.endDateKey).toBe("2026-05-17");
    expect(requestSmtBackfillForAuthorization).toHaveBeenCalledWith(
      expect.objectContaining({
        authorizationId: "auth-1",
        startDate: new Date("2026-05-16T00:00:00.000Z"),
        endDate: new Date("2026-05-17T23:59:59.999Z"),
      })
    );
  });
});
