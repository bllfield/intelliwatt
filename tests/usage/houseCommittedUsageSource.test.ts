import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const houseAddressFindFirst = vi.fn();
const smtAuthorizationFindMany = vi.fn();
const greenButtonUploadFindFirst = vi.fn();
const getLatestUsableRawGreenButtonIdForHouse = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    houseAddress: {
      findFirst: (...args: unknown[]) => houseAddressFindFirst(...args),
    },
    smtAuthorization: {
      findMany: (...args: unknown[]) => smtAuthorizationFindMany(...args),
    },
    greenButtonUpload: {
      findFirst: (...args: unknown[]) => greenButtonUploadFindFirst(...args),
    },
  },
}));

vi.mock("@/modules/realUsageAdapter/greenButton", () => ({
  getLatestUsableRawGreenButtonIdForHouse: (...args: unknown[]) =>
    getLatestUsableRawGreenButtonIdForHouse(...args),
}));

describe("resolveHouseCommittedUsageSource", () => {
  beforeEach(() => {
    vi.resetModules();
    houseAddressFindFirst.mockReset();
    smtAuthorizationFindMany.mockReset();
    greenButtonUploadFindFirst.mockReset();
    getLatestUsableRawGreenButtonIdForHouse.mockReset();
    greenButtonUploadFindFirst.mockResolvedValue(null);
    smtAuthorizationFindMany.mockResolvedValue([]);
    getLatestUsableRawGreenButtonIdForHouse.mockResolvedValue(null);
  });

  it("returns the stored HouseAddress.committedUsageSource when set", async () => {
    houseAddressFindFirst.mockResolvedValue({ committedUsageSource: "GREEN_BUTTON" });

    const { resolveHouseCommittedUsageSource } = await import("@/lib/usage/houseCommittedUsageSource");
    const source = await resolveHouseCommittedUsageSource({
      houseId: "house-1",
      userId: "user-1",
    });

    expect(source).toBe("GREEN_BUTTON");
    expect(smtAuthorizationFindMany).not.toHaveBeenCalled();
  });

  it("infers Green Button for legacy homes with an active upload and intervals", async () => {
    houseAddressFindFirst.mockResolvedValue({ committedUsageSource: null });
    greenButtonUploadFindFirst.mockResolvedValue({
      parseStatus: "complete",
      createdAt: new Date(),
    });
    getLatestUsableRawGreenButtonIdForHouse.mockResolvedValue("raw-1");

    const { resolveHouseCommittedUsageSource } = await import("@/lib/usage/houseCommittedUsageSource");
    const source = await resolveHouseCommittedUsageSource({
      houseId: "house-1",
      userId: "user-1",
    });

    expect(source).toBe("GREEN_BUTTON");
  });

  it("infers SMT for legacy homes with active authorization and no stored source", async () => {
    houseAddressFindFirst.mockResolvedValue({ committedUsageSource: null });
    smtAuthorizationFindMany.mockResolvedValue([
      { smtStatus: "ACTIVE", authorizationEndDate: null },
    ]);

    const { resolveHouseCommittedUsageSource } = await import("@/lib/usage/houseCommittedUsageSource");
    const source = await resolveHouseCommittedUsageSource({
      houseId: "house-1",
      userId: "user-1",
      esiid: "esiid-1",
    });

    expect(source).toBe("SMT");
  });
});
