import { describe, expect, it, vi } from "vitest";
import { SimulatorFingerprintStatus } from "@/.prisma/usage-client";
import { resolveSimFingerprint as resolveSimFingerprintBarrel } from "@/modules/usageSimulator/fingerprintBuilders";
import { resolveSimFingerprint, RESOLVED_SIM_FINGERPRINT_VERSION } from "@/modules/usageSimulator/resolveSimFingerprint";

const getWh = vi.fn();
const getUs = vi.fn();

vi.mock("@/modules/usageSimulator/fingerprintArtifactsRepo", () => ({
  getLatestWholeHomeFingerprintByHouseId: (...args: unknown[]) => getWh(...args),
  getLatestUsageFingerprintByHouseId: (...args: unknown[]) => getUs(...args),
}));

describe("resolveSimFingerprint (single shared resolver)", () => {
  it("exposes the same function from the module and fingerprintBuilders barrel (no duplicate resolver)", () => {
    expect(resolveSimFingerprintBarrel).toBe(resolveSimFingerprint);
  });

  it("uses whole-home house id and usage actual-context house id for lookups", async () => {
    getWh.mockResolvedValue({
      id: "wh-1",
      status: SimulatorFingerprintStatus.ready,
      sourceHash: "h1",
    });
    getUs.mockResolvedValue({
      id: "us-1",
      status: SimulatorFingerprintStatus.ready,
      sourceHash: "h2",
    });
    const r = await resolveSimFingerprint({
      houseId: "house-a",
      actualContextHouseId: "house-b",
      mode: "SMT_BASELINE",
    });
    expect(getWh).toHaveBeenCalledWith("house-a");
    expect(getUs).toHaveBeenCalledWith("house-b");
    expect(r.wholeHomeHouseId).toBe("house-a");
    expect(r.usageFingerprintHouseId).toBe("house-b");
    expect(r.blendMode).toBe("blended");
    expect(r.usageBlendWeight).toBe(0.5);
    expect(r.resolvedHash.length).toBeGreaterThan(20);
    expect(r.resolverVersion).toBe(RESOLVED_SIM_FINGERPRINT_VERSION);
  });

  it("defaults usage fingerprint house to scenario house when actual context omitted", async () => {
    getWh.mockResolvedValue(null);
    getUs.mockResolvedValue({
      id: "us-1",
      status: SimulatorFingerprintStatus.ready,
      sourceHash: "u",
    });
    await resolveSimFingerprint({ houseId: "h1", mode: "SMT_BASELINE" });
    expect(getUs).toHaveBeenCalledWith("h1");
  });

  it("selects usage_only when only usage is ready", async () => {
    getWh.mockResolvedValue({ id: "w", status: SimulatorFingerprintStatus.stale, sourceHash: "a" });
    getUs.mockResolvedValue({ id: "u", status: SimulatorFingerprintStatus.ready, sourceHash: "b" });
    const r = await resolveSimFingerprint({ houseId: "h1", mode: "SMT_BASELINE" });
    expect(r.blendMode).toBe("usage_only");
    expect(r.usageBlendWeight).toBe(1);
  });

  it("reports insufficient_inputs when neither fingerprint is ready", async () => {
    getWh.mockResolvedValue({ id: "w", status: SimulatorFingerprintStatus.failed, sourceHash: "a" });
    getUs.mockResolvedValue({ id: "u", status: SimulatorFingerprintStatus.building, sourceHash: "b" });
    const r = await resolveSimFingerprint({ houseId: "h1", mode: "MANUAL_TOTALS" });
    expect(r.blendMode).toBe("insufficient_inputs");
  });
});
