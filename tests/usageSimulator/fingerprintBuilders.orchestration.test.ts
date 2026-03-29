import { describe, expect, it, vi } from "vitest";

const mockWhole = vi.fn();
const mockUsage = vi.fn();
const mockEvalWholePolicy = vi.fn();
const mockEvalUsagePolicy = vi.fn();

vi.mock("@/modules/usageSimulator/wholeHomeFingerprintBuilder", async () => {
  const real = await vi.importActual<typeof import("@/modules/usageSimulator/wholeHomeFingerprintBuilder")>(
    "@/modules/usageSimulator/wholeHomeFingerprintBuilder"
  );
  return {
    ...real,
    buildAndPersistWholeHomeFingerprint: mockWhole,
  };
});

vi.mock("@/modules/usageSimulator/usageFingerprintBuilder", async () => {
  const real = await vi.importActual<typeof import("@/modules/usageSimulator/usageFingerprintBuilder")>(
    "@/modules/usageSimulator/usageFingerprintBuilder"
  );
  return {
    ...real,
    buildAndPersistUsageFingerprint: mockUsage,
  };
});

vi.mock("@/modules/usageSimulator/fingerprintArtifactPolicy", () => ({
  evaluateWholeHomeFingerprintPolicy: (...args: unknown[]) => mockEvalWholePolicy(...args),
  evaluateUsageFingerprintPolicy: (...args: unknown[]) => mockEvalUsagePolicy(...args),
}));

describe("ensureSimulatorFingerprintsForRecalc uses shared builders only", () => {
  it("calls the same builder entrypoints for SMT_BASELINE with actual data", async () => {
    mockWhole.mockReset();
    mockUsage.mockReset();
    mockEvalWholePolicy.mockReset();
    mockEvalUsagePolicy.mockReset();
    mockWhole.mockResolvedValue({ ok: true, sourceHash: "wh" });
    mockUsage.mockResolvedValue({ ok: true, sourceHash: "uf" });
    mockEvalWholePolicy.mockResolvedValue({
      currentArtifact: null,
      prepared: { sourceHash: "wh_expected", payloadJson: { version: "v", features: {} } },
      decision: {
        action: "rebuild",
        reason: "artifact_missing",
        currentStatus: null,
        currentSourceHash: null,
        expectedSourceHash: "wh_expected",
        staleReason: "artifact_missing",
      },
    });
    mockEvalUsagePolicy.mockResolvedValue({
      currentArtifact: null,
      prepared: {
        sourceHash: "uf_expected",
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
        action: "rebuild",
        reason: "artifact_missing",
        currentStatus: null,
        currentSourceHash: null,
        expectedSourceHash: "uf_expected",
        staleReason: "artifact_missing",
      },
    });
    const { ensureSimulatorFingerprintsForRecalc } = await import("@/modules/usageSimulator/fingerprintOrchestration");
    await ensureSimulatorFingerprintsForRecalc({
      houseId: "h1",
      actualContextHouseId: "h1",
      esiid: "e",
      homeProfile: {},
      applianceProfile: { fuelConfiguration: "x", appliances: [] },
      mode: "SMT_BASELINE",
      actualOk: true,
      windowStart: "2025-01-01",
      windowEnd: "2025-12-31",
    });
    expect(mockEvalWholePolicy).toHaveBeenCalledTimes(1);
    expect(mockEvalUsagePolicy).toHaveBeenCalledTimes(1);
    expect(mockWhole).toHaveBeenCalledTimes(1);
    expect(mockUsage).toHaveBeenCalledTimes(1);
    expect(mockWhole.mock.calls[0]?.[0]?.prepared?.sourceHash).toBe("wh_expected");
    expect(mockUsage.mock.calls[0]?.[0]?.prepared?.sourceHash).toBe("uf_expected");
  });

  it("skips usage fingerprint when not SMT_BASELINE", async () => {
    mockWhole.mockReset();
    mockUsage.mockReset();
    mockEvalWholePolicy.mockReset();
    mockEvalUsagePolicy.mockReset();
    mockWhole.mockResolvedValue({ ok: true, sourceHash: "wh" });
    mockEvalWholePolicy.mockResolvedValue({
      currentArtifact: null,
      prepared: { sourceHash: "wh_expected", payloadJson: { version: "v", features: {} } },
      decision: {
        action: "rebuild",
        reason: "artifact_missing",
        currentStatus: null,
        currentSourceHash: null,
        expectedSourceHash: "wh_expected",
        staleReason: "artifact_missing",
      },
    });
    const { ensureSimulatorFingerprintsForRecalc } = await import("@/modules/usageSimulator/fingerprintOrchestration");
    await ensureSimulatorFingerprintsForRecalc({
      houseId: "h1",
      actualContextHouseId: "h1",
      esiid: null,
      homeProfile: {},
      applianceProfile: { fuelConfiguration: "x", appliances: [] },
      mode: "MANUAL_TOTALS",
      actualOk: true,
      windowStart: "2025-01-01",
      windowEnd: "2025-12-31",
    });
    expect(mockEvalWholePolicy).toHaveBeenCalledTimes(1);
    expect(mockEvalUsagePolicy).not.toHaveBeenCalled();
    expect(mockWhole).toHaveBeenCalledTimes(1);
    expect(mockUsage).not.toHaveBeenCalled();
  });

  it("reuses ready matching artifacts and skips both builders", async () => {
    mockWhole.mockReset();
    mockUsage.mockReset();
    mockEvalWholePolicy.mockReset();
    mockEvalUsagePolicy.mockReset();
    mockEvalWholePolicy.mockResolvedValue({
      currentArtifact: { status: "ready", sourceHash: "same_wh" },
      prepared: { sourceHash: "same_wh", payloadJson: { version: "v", features: {} } },
      decision: {
        action: "reuse",
        reason: "ready_source_hash_match",
        currentStatus: "ready",
        currentSourceHash: "same_wh",
        expectedSourceHash: "same_wh",
        staleReason: null,
      },
    });
    mockEvalUsagePolicy.mockResolvedValue({
      currentArtifact: { status: "ready", sourceHash: "same_uf" },
      prepared: {
        sourceHash: "same_uf",
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
        currentSourceHash: "same_uf",
        expectedSourceHash: "same_uf",
        staleReason: null,
      },
    });
    const { ensureSimulatorFingerprintsForRecalc } = await import("@/modules/usageSimulator/fingerprintOrchestration");
    await ensureSimulatorFingerprintsForRecalc({
      houseId: "h1",
      actualContextHouseId: "h1",
      esiid: "e",
      homeProfile: {},
      applianceProfile: { fuelConfiguration: "x", appliances: [] },
      mode: "SMT_BASELINE",
      actualOk: true,
      windowStart: "2025-01-01",
      windowEnd: "2025-12-31",
    });
    expect(mockEvalWholePolicy).toHaveBeenCalledTimes(1);
    expect(mockEvalUsagePolicy).toHaveBeenCalledTimes(1);
    expect(mockWhole).not.toHaveBeenCalled();
    expect(mockUsage).not.toHaveBeenCalled();
  });
});
