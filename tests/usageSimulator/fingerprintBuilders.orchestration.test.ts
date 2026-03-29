import { describe, expect, it, vi } from "vitest";

const mockWhole = vi.fn();
const mockUsage = vi.fn();

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

describe("ensureSimulatorFingerprintsForRecalc uses shared builders only", () => {
  it("calls the same builder entrypoints for SMT_BASELINE with actual data", async () => {
    mockWhole.mockReset();
    mockUsage.mockReset();
    mockWhole.mockResolvedValue({ ok: true, sourceHash: "wh" });
    mockUsage.mockResolvedValue({ ok: true, sourceHash: "uf" });
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
    expect(mockWhole).toHaveBeenCalledTimes(1);
    expect(mockUsage).toHaveBeenCalledTimes(1);
  });

  it("skips usage fingerprint when not SMT_BASELINE", async () => {
    mockWhole.mockReset();
    mockUsage.mockReset();
    mockWhole.mockResolvedValue({ ok: true, sourceHash: "wh" });
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
    expect(mockWhole).toHaveBeenCalledTimes(1);
    expect(mockUsage).not.toHaveBeenCalled();
  });
});
