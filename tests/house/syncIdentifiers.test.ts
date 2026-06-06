import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const prisma = {
  houseAddress: {
    findFirst: vi.fn(),
    update: vi.fn(),
  },
};

vi.mock("@/lib/db", () => ({ prisma }));

describe("syncHouseIdentifiersFromAuthorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("skips assign when esiid is already on a sibling house for the same user", async () => {
    prisma.houseAddress.findFirst
      .mockResolvedValueOnce({ id: "house-b", userId: "user-1", esiid: null })
      .mockResolvedValueOnce({ id: "house-a", userId: "user-1" });

    const { syncHouseIdentifiersFromAuthorization } = await import("@/lib/house/syncIdentifiers");
    await syncHouseIdentifiersFromAuthorization({
      houseAddressId: "house-b",
      esiid: "10400511114390001",
    });

    expect(prisma.houseAddress.update).not.toHaveBeenCalled();
  });

  it("assigns esiid when no conflicting house exists", async () => {
    prisma.houseAddress.findFirst
      .mockResolvedValueOnce({ id: "house-b", userId: "user-1", esiid: null })
      .mockResolvedValueOnce(null);

    const { syncHouseIdentifiersFromAuthorization } = await import("@/lib/house/syncIdentifiers");
    await syncHouseIdentifiersFromAuthorization({
      houseAddressId: "house-b",
      esiid: "10400511114390001",
    });

    expect(prisma.houseAddress.update).toHaveBeenCalledWith({
      where: { id: "house-b" },
      data: { esiid: "10400511114390001" },
    });
  });

  it("swallows esiid unique constraint races without throwing", async () => {
    const uniqueError = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "test",
      meta: { target: ["esiid"] },
    });
    prisma.houseAddress.findFirst
      .mockResolvedValueOnce({ id: "house-b", userId: "user-1", esiid: null })
      .mockResolvedValueOnce(null);
    prisma.houseAddress.update.mockRejectedValueOnce(uniqueError);

    const { syncHouseIdentifiersFromAuthorization } = await import("@/lib/house/syncIdentifiers");
    await expect(
      syncHouseIdentifiersFromAuthorization({
        houseAddressId: "house-b",
        esiid: "10400511114390001",
      })
    ).resolves.toBeUndefined();
  });

  it("no-ops when target house already has the esiid", async () => {
    prisma.houseAddress.findFirst.mockResolvedValueOnce({
      id: "house-a",
      userId: "user-1",
      esiid: "10400511114390001",
    });

    const { syncHouseIdentifiersFromAuthorization } = await import("@/lib/house/syncIdentifiers");
    await syncHouseIdentifiersFromAuthorization({
      houseAddressId: "house-a",
      esiid: "10400511114390001",
    });

    expect(prisma.houseAddress.findFirst).toHaveBeenCalledOnce();
    expect(prisma.houseAddress.update).not.toHaveBeenCalled();
  });
});
