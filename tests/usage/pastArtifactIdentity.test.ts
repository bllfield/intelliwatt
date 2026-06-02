import { beforeEach, describe, expect, it, vi } from "vitest";

const getIntervalDataFingerprint = vi.fn();
const getUsageShapeProfileIdentityForPast = vi.fn();
const computePastWeatherIdentity = vi.fn();
const getHouseAddressForUserHouse = vi.fn();
const computePastInputHash = vi.fn();

vi.mock("@/lib/usage/actualDatasetForHouse", () => ({
  getIntervalDataFingerprint: (...args: unknown[]) => getIntervalDataFingerprint(...args),
}));

vi.mock("@/modules/simulatedUsage/simulatePastUsageDataset", () => ({
  getUsageShapeProfileIdentityForPast: (...args: unknown[]) => getUsageShapeProfileIdentityForPast(...args),
}));

vi.mock("@/modules/weather/identity", () => ({
  computePastWeatherIdentity: (...args: unknown[]) => computePastWeatherIdentity(...args),
}));

vi.mock("@/modules/usageSimulator/repo", () => ({
  getHouseAddressForUserHouse: (...args: unknown[]) => getHouseAddressForUserHouse(...args),
}));

vi.mock("@/modules/usageSimulator/pastCache", () => ({
  PAST_ENGINE_VERSION: "production_past_stitched_v16",
  computePastInputHash: (...args: unknown[]) => computePastInputHash(...args),
}));

import {
  resolvePastArtifactIdentity,
  travelRangesFromPastBuildInputs,
} from "@/lib/usage/pastArtifactIdentity";

describe("resolvePastArtifactIdentity", () => {
  const buildInputs = {
    mode: "SMT_BASELINE",
    timezone: "America/Chicago",
    canonicalPeriods: [{ id: "canonical_usage_365_coverage", startDate: "2025-06-01", endDate: "2026-05-31" }],
    travelRanges: [{ startDate: "2025-06-27", endDate: "2025-07-11" }],
    snapshots: { actualSource: "GREEN_BUTTON" },
  };

  beforeEach(() => {
    getIntervalDataFingerprint.mockReset();
    getUsageShapeProfileIdentityForPast.mockReset();
    computePastWeatherIdentity.mockReset();
    getHouseAddressForUserHouse.mockReset();
    computePastInputHash.mockReset();

    getIntervalDataFingerprint.mockResolvedValue("fp-green");
    getUsageShapeProfileIdentityForPast.mockResolvedValue({
      usageShapeProfileId: "p1",
      usageShapeProfileVersion: "1",
      usageShapeProfileDerivedAt: "2026-01-01T00:00:00.000Z",
      usageShapeProfileSimHash: "shape",
    });
    computePastWeatherIdentity.mockResolvedValue("wx");
    getHouseAddressForUserHouse.mockResolvedValue({ id: "h1", esiid: "esiid-1" });
    computePastInputHash.mockReturnValue("canonical-hash");
  });

  it("uses canonical actual house and GREEN_BUTTON preferred source from snapshots", async () => {
    const identity = await resolvePastArtifactIdentity({
      userId: "u1",
      requestHouseId: "house-1",
      requestHouseEsiid: "esiid-1",
      buildInputs,
    });

    expect(identity?.inputHash).toBe("canonical-hash");
    expect(getIntervalDataFingerprint).toHaveBeenCalledWith(
      expect.objectContaining({
        houseId: "house-1",
        preferredSource: "GREEN_BUTTON",
        startDate: "2025-06-01",
        endDate: "2026-05-31",
      })
    );
    expect(computePastInputHash).toHaveBeenCalledWith(
      expect.objectContaining({
        windowStartUtc: "2025-06-01",
        windowEndUtc: "2026-05-31",
        travelRanges: [{ startDate: "2025-06-27", endDate: "2025-07-11" }],
      })
    );
  });

  it("matches travel range extraction used for hashing", () => {
    expect(travelRangesFromPastBuildInputs(buildInputs)).toEqual([
      { startDate: "2025-06-27", endDate: "2025-07-11" },
    ]);
  });
});
