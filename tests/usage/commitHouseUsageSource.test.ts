import { beforeEach, describe, expect, it, vi } from "vitest";

const houseAddressFindFirst = vi.fn();
const houseAddressUpdate = vi.fn();
const clearGreenButtonUsageForHouse = vi.fn();
const clearSmtUsageForHouse = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    houseAddress: {
      findFirst: (...args: unknown[]) => houseAddressFindFirst(...args),
      update: (...args: unknown[]) => houseAddressUpdate(...args),
    },
  },
}));

vi.mock("@/lib/usage/greenButtonHouseCleanup", () => ({
  clearGreenButtonUsageForHouse: (...args: unknown[]) => clearGreenButtonUsageForHouse(...args),
}));

vi.mock("@/lib/usage/smtHouseCleanup", () => ({
  clearSmtUsageForHouse: (...args: unknown[]) => clearSmtUsageForHouse(...args),
}));

describe("commitHouseUsageSource", () => {
  beforeEach(() => {
    vi.resetModules();
    houseAddressFindFirst.mockReset();
    houseAddressUpdate.mockReset();
    clearGreenButtonUsageForHouse.mockReset();
    clearSmtUsageForHouse.mockReset();
    houseAddressFindFirst.mockResolvedValue({ id: "house-1", esiid: "esiid-1" });
    houseAddressUpdate.mockResolvedValue({});
  });

  it("clears Green Button and persists SMT when user selects SMT", async () => {
    const { commitHouseUsageSource } = await import("@/lib/usage/commitHouseUsageSource");
    await commitHouseUsageSource({
      userId: "user-1",
      houseId: "house-1",
      source: "SMT",
    });

    expect(clearGreenButtonUsageForHouse).toHaveBeenCalledWith("house-1");
    expect(clearSmtUsageForHouse).not.toHaveBeenCalled();
    expect(houseAddressUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "house-1" },
        data: expect.objectContaining({ committedUsageSource: "SMT" }),
      }),
    );
  });

  it("clears SMT and persists GREEN_BUTTON when user selects Green Button", async () => {
    const { commitHouseUsageSource } = await import("@/lib/usage/commitHouseUsageSource");
    await commitHouseUsageSource({
      userId: "user-1",
      houseId: "house-1",
      source: "GREEN_BUTTON",
      esiid: "esiid-1",
    });

    expect(clearSmtUsageForHouse).toHaveBeenCalledWith({ houseId: "house-1", esiid: "esiid-1" });
    expect(clearGreenButtonUsageForHouse).not.toHaveBeenCalled();
    expect(houseAddressUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ committedUsageSource: "GREEN_BUTTON" }),
      }),
    );
  });
});
