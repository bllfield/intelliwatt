import { beforeEach, describe, expect, it, vi } from "vitest";
import { SimulatorFingerprintStatus } from "@/.prisma/usage-client";

const upsertWholeHome = vi.fn();
const upsertUsage = vi.fn();
const findUniqueWholeHome = vi.fn();
const findUniqueUsage = vi.fn();

vi.mock("@/lib/db/usageClient", () => ({
  usagePrisma: {
    wholeHomeFingerprint: { upsert: upsertWholeHome, findUnique: findUniqueWholeHome },
    usageFingerprint: { upsert: upsertUsage, findUnique: findUniqueUsage },
  },
}));

describe("fingerprintArtifactsRepo (usage DB)", () => {
  beforeEach(() => {
    upsertWholeHome.mockReset();
    upsertUsage.mockReset();
    findUniqueWholeHome.mockReset();
    findUniqueUsage.mockReset();
  });

  it("persists Section 13 fields on WholeHomeFingerprint upsert", async () => {
    upsertWholeHome.mockResolvedValue({ id: "wh1" });
    const { upsertWholeHomeFingerprintArtifact } = await import("@/modules/usageSimulator/fingerprintArtifactsRepo");
    await upsertWholeHomeFingerprintArtifact({
      houseId: "h1",
      status: SimulatorFingerprintStatus.ready,
      algorithmVersion: "wf-v0",
      sourceHash: "sha:abc",
      staleReason: null,
      builtAt: new Date("2026-01-01T00:00:00.000Z"),
      payloadJson: { cohort: "test" },
    });
    expect(upsertWholeHome).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { houseId: "h1" },
        create: expect.objectContaining({
          houseId: "h1",
          status: "ready",
          algorithmVersion: "wf-v0",
          sourceHash: "sha:abc",
          staleReason: null,
          payloadJson: { cohort: "test" },
        }),
        update: expect.objectContaining({
          status: "ready",
          sourceHash: "sha:abc",
        }),
      })
    );
  });

  it("persists stale + staleReason for UsageFingerprint", async () => {
    upsertUsage.mockResolvedValue({ id: "u1" });
    const { upsertUsageFingerprintArtifact } = await import("@/modules/usageSimulator/fingerprintArtifactsRepo");
    await upsertUsageFingerprintArtifact({
      houseId: "h2",
      status: SimulatorFingerprintStatus.stale,
      algorithmVersion: "uf-v0",
      sourceHash: "sha:dep",
      staleReason: "interval_hash_mismatch",
      builtAt: null,
      payloadJson: {},
    });
    expect(upsertUsage.mock.calls[0]?.[0].create.staleReason).toBe("interval_hash_mismatch");
    expect(upsertUsage.mock.calls[0]?.[0].create.status).toBe("stale");
  });

  it("read helpers target houseId unique lookup", async () => {
    findUniqueWholeHome.mockResolvedValue(null);
    findUniqueUsage.mockResolvedValue({ id: "x" });
    const { getLatestWholeHomeFingerprintByHouseId, getLatestUsageFingerprintByHouseId } = await import(
      "@/modules/usageSimulator/fingerprintArtifactsRepo"
    );
    await getLatestWholeHomeFingerprintByHouseId("h9");
    await getLatestUsageFingerprintByHouseId("h9");
    expect(findUniqueWholeHome).toHaveBeenCalledWith({ where: { houseId: "h9" } });
    expect(findUniqueUsage).toHaveBeenCalledWith({ where: { houseId: "h9" } });
  });
});
