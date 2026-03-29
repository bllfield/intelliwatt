import { beforeEach, describe, expect, it, vi } from "vitest";

const getWholeMock = vi.fn();
const getUsageMock = vi.fn();
const prepareWholeMock = vi.fn();
const prepareUsageMock = vi.fn();

vi.mock("@/modules/usageSimulator/fingerprintArtifactsRepo", () => ({
  getLatestWholeHomeFingerprintByHouseId: (...args: unknown[]) => getWholeMock(...args),
  getLatestUsageFingerprintByHouseId: (...args: unknown[]) => getUsageMock(...args),
}));

vi.mock("@/modules/usageSimulator/wholeHomeFingerprintBuilder", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/modules/usageSimulator/wholeHomeFingerprintBuilder")>();
  return {
    ...mod,
    prepareWholeHomeFingerprintBuild: (...args: unknown[]) => prepareWholeMock(...args),
  };
});

vi.mock("@/modules/usageSimulator/usageFingerprintBuilder", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/modules/usageSimulator/usageFingerprintBuilder")>();
  return {
    ...mod,
    prepareUsageFingerprintBuild: (...args: unknown[]) => prepareUsageMock(...args),
  };
});

describe("fingerprint artifact policy decisions", () => {
  beforeEach(() => {
    getWholeMock.mockReset();
    getUsageMock.mockReset();
    prepareWholeMock.mockReset();
    prepareUsageMock.mockReset();
  });

  it("reuses whole-home artifact when ready and sourceHash matches", async () => {
    const { WHOLE_HOME_FINGERPRINT_ALGORITHM_VERSION } = await import(
      "@/modules/usageSimulator/wholeHomeFingerprintBuilder"
    );
    getWholeMock.mockResolvedValue({
      status: "ready",
      algorithmVersion: WHOLE_HOME_FINGERPRINT_ALGORITHM_VERSION,
      sourceHash: "same",
      staleReason: null,
    });
    prepareWholeMock.mockReturnValue({
      sourceHash: "same",
      payloadJson: { version: "whole_home_fp_v1_with_cohort" },
    });
    const { evaluateWholeHomeFingerprintPolicy } = await import(
      "@/modules/usageSimulator/fingerprintArtifactPolicy"
    );
    const out = await evaluateWholeHomeFingerprintPolicy({
      houseId: "h1",
      homeProfile: {},
      applianceProfile: {},
    });
    expect(out.decision.action).toBe("reuse");
    expect(out.decision.reason).toBe("ready_source_hash_match");
  });

  it("rebuilds usage artifact when hash mismatches", async () => {
    getUsageMock.mockResolvedValue({
      status: "ready",
      algorithmVersion: "usage_fp_v1",
      sourceHash: "old",
      staleReason: null,
    });
    prepareUsageMock.mockResolvedValue({
      sourceHash: "new",
      intervalDataFingerprint: "i",
      weatherIdentity: "w",
      payloadJson: {
        version: "usage_fp_v1",
        window: { startDate: "2025-01-01", endDate: "2025-12-31" },
        intervalDataFingerprint: "i",
        weatherIdentity: "w",
        summary: { note: "n" },
      },
    });
    const { evaluateUsageFingerprintPolicy } = await import(
      "@/modules/usageSimulator/fingerprintArtifactPolicy"
    );
    const out = await evaluateUsageFingerprintPolicy({
      houseId: "h1",
      esiid: "e1",
      startDate: "2025-01-01",
      endDate: "2025-12-31",
    });
    expect(out.decision.action).toBe("rebuild");
    expect(out.decision.reason).toBe("source_hash_mismatch");
    expect(out.decision.staleReason).toBe("source_hash_mismatch");
  });
});

