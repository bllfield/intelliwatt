import { beforeEach, describe, expect, it, vi } from "vitest";

const getLatestUsageShapeProfile = vi.fn();

vi.mock("@/modules/usageShapeProfile/repo", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    getLatestUsageShapeProfile: (...args: any[]) => getLatestUsageShapeProfile(...args),
  };
});

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
    expect(out.usageShapeProfileId).toBe("p1");
    expect(out.usageShapeProfileVersion).toBe("7");
    expect(out.usageShapeProfileDerivedAt).toBe("2026-03-12T00:00:00.000Z");
    expect(typeof out.usageShapeProfileSimHash).toBe("string");
    expect((out.usageShapeProfileSimHash ?? "").length).toBeGreaterThan(0);
  });

  it("returns null fields when profile is missing", async () => {
    getLatestUsageShapeProfile.mockResolvedValue(null);
    const out = await getUsageShapeProfileIdentityForPast("h1");
    expect(out).toEqual({
      usageShapeProfileId: null,
      usageShapeProfileVersion: null,
      usageShapeProfileDerivedAt: null,
      usageShapeProfileSimHash: null,
    });
  });

  it("changes sim hash when profile content changes", async () => {
    getLatestUsageShapeProfile.mockResolvedValueOnce({
      id: "p1",
      version: 7,
      derivedAt: "2026-03-12T00:00:00.000Z",
      avgKwhPerDayWeekdayByMonth: [1, 2, 3],
      avgKwhPerDayWeekendByMonth: [1, 2, 3],
    });
    getLatestUsageShapeProfile.mockResolvedValueOnce({
      id: "p1",
      version: 7,
      derivedAt: "2026-03-12T00:00:00.000Z",
      avgKwhPerDayWeekdayByMonth: [9, 2, 3],
      avgKwhPerDayWeekendByMonth: [1, 2, 3],
    });

    const a = await getUsageShapeProfileIdentityForPast("h1");
    const b = await getUsageShapeProfileIdentityForPast("h1");
    expect(a.usageShapeProfileSimHash).not.toBeNull();
    expect(b.usageShapeProfileSimHash).not.toBeNull();
    expect(a.usageShapeProfileSimHash).not.toBe(b.usageShapeProfileSimHash);
  });
});

