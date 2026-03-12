import { beforeEach, describe, expect, it, vi } from "vitest";

const getLatestUsageShapeProfile = vi.fn();

vi.mock("@/modules/usageShapeProfile/repo", () => ({
  getLatestUsageShapeProfile: (...args: any[]) => getLatestUsageShapeProfile(...args),
}));

import { getUsageShapeProfileIdentityForPast } from "@/modules/simulatedUsage/simulatePastUsageDataset";

describe("getUsageShapeProfileIdentityForPast", () => {
  beforeEach(() => {
    getLatestUsageShapeProfile.mockReset();
  });

  it("returns id/version/derivedAt when profile exists", async () => {
    getLatestUsageShapeProfile.mockResolvedValue({
      id: "p1",
      version: 7,
      derivedAt: "2026-03-12T00:00:00.000Z",
    });

    const out = await getUsageShapeProfileIdentityForPast("h1");
    expect(out).toEqual({
      usageShapeProfileId: "p1",
      usageShapeProfileVersion: "7",
      usageShapeProfileDerivedAt: "2026-03-12T00:00:00.000Z",
    });
  });

  it("returns null fields when profile is missing", async () => {
    getLatestUsageShapeProfile.mockResolvedValue(null);
    const out = await getUsageShapeProfileIdentityForPast("h1");
    expect(out).toEqual({
      usageShapeProfileId: null,
      usageShapeProfileVersion: null,
      usageShapeProfileDerivedAt: null,
    });
  });
});

