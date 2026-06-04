import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const getOnePathLabTestHomeLink = vi.fn();
const getHouseAddressForUserHouse = vi.fn();

vi.mock("@/modules/usageSimulator/labTestHomeLink", () => ({
  getOnePathLabTestHomeLink: (...args: unknown[]) => getOnePathLabTestHomeLink(...args),
}));

vi.mock("@/modules/onePathSim/usageSimulator/repo", () => ({
  getHouseAddressForUserHouse: (...args: unknown[]) => getHouseAddressForUserHouse(...args),
}));

import { resolvePastSimEsiidForHouse } from "@/lib/usage/resolvePastSimEsiidForHouse";

describe("resolvePastSimEsiidForHouse", () => {
  beforeEach(() => {
    getOnePathLabTestHomeLink.mockReset();
    getHouseAddressForUserHouse.mockReset();
  });

  it("returns house ESIID when present", async () => {
    const esiid = await resolvePastSimEsiidForHouse({
      userId: "owner-1",
      houseId: "house-a",
      houseEsiid: "10400511114390001",
    });
    expect(esiid).toBe("10400511114390001");
    expect(getOnePathLabTestHomeLink).not.toHaveBeenCalled();
  });

  it("falls back to linked source house ESIID for One Path test home", async () => {
    getOnePathLabTestHomeLink.mockResolvedValue({
      testHomeHouseId: "test-home",
      sourceUserId: "user-src",
      sourceHouseId: "house-src",
    });
    getHouseAddressForUserHouse.mockResolvedValue({ esiid: "10400511114390002" });

    const esiid = await resolvePastSimEsiidForHouse({
      userId: "owner-1",
      houseId: "test-home",
      houseEsiid: null,
    });
    expect(esiid).toBe("10400511114390002");
    expect(getHouseAddressForUserHouse).toHaveBeenCalledWith({
      userId: "user-src",
      houseId: "house-src",
    });
  });

  it("uses parity lock source house when lab link is absent", async () => {
    getOnePathLabTestHomeLink.mockResolvedValue(null);
    getHouseAddressForUserHouse.mockResolvedValue({ esiid: "10400511114390003" });

    const esiid = await resolvePastSimEsiidForHouse({
      userId: "owner-1",
      houseId: "test-home",
      houseEsiid: null,
      buildInputs: {
        onePathUserSiteParity: {
          sourceUserId: "u1",
          sourceHouseId: "h1",
          sourceScenarioId: "s1",
          testScenarioId: "t1",
          parityInputHash: "hash",
          parityBuildInputsSnapshotHash: "snap",
          syncedAt: "2026-05-20T00:00:00.000Z",
        },
      },
    });
    expect(esiid).toBe("10400511114390003");
  });
});
