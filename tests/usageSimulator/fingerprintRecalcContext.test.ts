import { beforeEach, describe, expect, it, vi } from "vitest";

const evalWholeMock = vi.fn();
const evalUsageMock = vi.fn();
const resolveMock = vi.fn();

vi.mock("@/modules/usageSimulator/fingerprintArtifactPolicy", () => ({
  evaluateWholeHomeFingerprintPolicy: (...args: unknown[]) => evalWholeMock(...args),
  evaluateUsageFingerprintPolicy: (...args: unknown[]) => evalUsageMock(...args),
}));

vi.mock("@/modules/usageSimulator/resolveSimFingerprint", () => ({
  resolveSimFingerprint: (...args: unknown[]) => resolveMock(...args),
}));

describe("fingerprint recalc context reuse", () => {
  beforeEach(() => {
    evalWholeMock.mockReset();
    evalUsageMock.mockReset();
    resolveMock.mockReset();
  });

  it("memoizes whole-home and usage policy evaluations within one context", async () => {
    evalWholeMock.mockResolvedValue({
      currentArtifact: null,
      prepared: { sourceHash: "wh", payloadJson: {} },
      decision: {
        action: "reuse",
        reason: "ready_source_hash_match",
        currentStatus: "ready",
        currentSourceHash: "wh",
        expectedSourceHash: "wh",
        staleReason: null,
      },
    });
    evalUsageMock.mockResolvedValue({
      currentArtifact: null,
      prepared: {
        sourceHash: "uf",
        intervalDataFingerprint: "i",
        weatherIdentity: "w",
        payloadJson: {
          version: "usage_fp_v1",
          window: { startDate: "2025-01-01", endDate: "2025-12-31" },
          intervalDataFingerprint: "i",
          weatherIdentity: "w",
          summary: { note: "x" },
        },
      },
      decision: {
        action: "reuse",
        reason: "ready_source_hash_match",
        currentStatus: "ready",
        currentSourceHash: "uf",
        expectedSourceHash: "uf",
        staleReason: null,
      },
    });
    const { createFingerprintRecalcContext } = await import(
      "@/modules/usageSimulator/fingerprintRecalcContext"
    );
    const ctx = createFingerprintRecalcContext({
      houseId: "h1",
      actualContextHouseId: "h1",
      esiid: "e1",
      homeProfile: {},
      applianceProfile: {},
      mode: "SMT_BASELINE",
      actualOk: true,
      windowStart: "2025-01-01",
      windowEnd: "2025-12-31",
    });
    await ctx.getWholeHomePolicy();
    await ctx.getWholeHomePolicy();
    await ctx.getUsagePolicy();
    await ctx.getUsagePolicy();
    expect(evalWholeMock).toHaveBeenCalledTimes(1);
    expect(evalUsageMock).toHaveBeenCalledTimes(1);
  });

  it("memoizes resolved fingerprint assembly per mode/manual payload key", async () => {
    resolveMock.mockResolvedValue({ resolvedHash: "r1", blendMode: "blended" });
    const { createFingerprintRecalcContext } = await import(
      "@/modules/usageSimulator/fingerprintRecalcContext"
    );
    const ctx = createFingerprintRecalcContext({
      houseId: "h1",
      actualContextHouseId: "h1",
      esiid: "e1",
      homeProfile: {},
      applianceProfile: {},
      mode: "SMT_BASELINE",
      actualOk: true,
      windowStart: "2025-01-01",
      windowEnd: "2025-12-31",
    });
    await ctx.resolveResolvedFingerprint({ manualUsagePayload: null });
    await ctx.resolveResolvedFingerprint({ manualUsagePayload: null });
    expect(resolveMock).toHaveBeenCalledTimes(1);
  });
});

