import { beforeEach, describe, expect, it, vi } from "vitest";
import { SimulatorFingerprintStatus } from "@/.prisma/usage-client";
import { resolveSimFingerprint as resolveSimFingerprintBarrel } from "@/modules/usageSimulator/fingerprintBuilders";
import { resolveSimFingerprint, RESOLVED_SIM_FINGERPRINT_VERSION } from "@/modules/usageSimulator/resolveSimFingerprint";
import { FINGERPRINT_PIPELINE_EVENT } from "@/modules/usageSimulator/simObservability";

const getWh = vi.fn();
const getUs = vi.fn();

const { logPipeline } = vi.hoisted(() => ({
  logPipeline: vi.fn(),
}));

vi.mock("@/modules/usageSimulator/simObservability", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/modules/usageSimulator/simObservability")>();
  return { ...mod, logSimPipelineEvent: logPipeline };
});

vi.mock("@/modules/usageSimulator/fingerprintArtifactsRepo", () => ({
  getLatestWholeHomeFingerprintByHouseId: (...args: unknown[]) => getWh(...args),
  getLatestUsageFingerprintByHouseId: (...args: unknown[]) => getUs(...args),
}));

describe("resolveSimFingerprint (single shared resolver)", () => {
  beforeEach(() => {
    logPipeline.mockClear();
  });

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
    expect(r.underlyingSourceMix).toBe("blended");
    expect(r.manualTotalsConstraint).toBe("none");
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
    expect(r.underlyingSourceMix).toBe("usage_only");
    expect(r.usageBlendWeight).toBe(1);
  });

  it("reports insufficient_inputs when neither fingerprint is ready", async () => {
    getWh.mockResolvedValue({ id: "w", status: SimulatorFingerprintStatus.failed, sourceHash: "a" });
    getUs.mockResolvedValue({ id: "u", status: SimulatorFingerprintStatus.building, sourceHash: "b" });
    const r = await resolveSimFingerprint({
      houseId: "h1",
      mode: "MANUAL_TOTALS",
      manualUsagePayload: { mode: "MONTHLY", monthlyKwh: [{ month: "2026-01", kwh: 100 }] },
    });
    expect(r.blendMode).toBe("insufficient_inputs");
    expect(r.manualTotalsConstraint).toBe("monthly");
  });

  it("NEW_BUILD_ESTIMATE uses whole_home_only when whole-home fingerprint is ready", async () => {
    getWh.mockResolvedValue({ id: "wh-1", status: SimulatorFingerprintStatus.ready, sourceHash: "a" });
    getUs.mockResolvedValue(null);
    const r = await resolveSimFingerprint({ houseId: "h1", mode: "NEW_BUILD_ESTIMATE" });
    expect(r.blendMode).toBe("whole_home_only");
    expect(r.underlyingSourceMix).toBe("whole_home_only");
    expect(r.resolutionNotes.some((n) => n.includes("new_build"))).toBe(true);
  });

  it("MANUAL_TOTALS with monthly constraint uses constrained_monthly_totals when whole-home is ready", async () => {
    getWh.mockResolvedValue({ id: "wh-1", status: SimulatorFingerprintStatus.ready, sourceHash: "a" });
    getUs.mockResolvedValue({ id: "u", status: SimulatorFingerprintStatus.ready, sourceHash: "b" });
    const r = await resolveSimFingerprint({
      houseId: "h1",
      mode: "MANUAL_TOTALS",
      manualUsagePayload: { mode: "MONTHLY", monthlyKwh: [{ month: "2026-01", kwh: 100 }] },
    });
    expect(r.blendMode).toBe("constrained_monthly_totals");
    expect(r.manualTotalsConstraint).toBe("monthly");
    expect(r.underlyingSourceMix).toBe("blended");
  });

  it("MANUAL_TOTALS with annual constraint uses constrained_annual_total when whole-home is ready", async () => {
    getWh.mockResolvedValue({ id: "wh-1", status: SimulatorFingerprintStatus.ready, sourceHash: "a" });
    getUs.mockResolvedValue(null);
    const r = await resolveSimFingerprint({
      houseId: "h1",
      mode: "MANUAL_TOTALS",
      manualUsagePayload: { mode: "ANNUAL", annualKwh: 12000 },
    });
    expect(r.blendMode).toBe("constrained_annual_total");
    expect(r.manualTotalsConstraint).toBe("annual");
  });

  it("returns identical resolved outputs with or without correlationId (instrumentation-only)", async () => {
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
    const a = await resolveSimFingerprint({ houseId: "h1", mode: "SMT_BASELINE" });
    const b = await resolveSimFingerprint({
      houseId: "h1",
      mode: "SMT_BASELINE",
      correlationId: "44444444-4444-4444-8444-444444444444",
    });
    expect(a).toEqual(b);
  });

  it("emits resolution measurement events with correlationId, durationMs, and memoryRssMb", async () => {
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
    const cid = "00000000-0000-4000-8000-0000000000aa";
    await resolveSimFingerprint({
      houseId: "house-a",
      actualContextHouseId: "house-b",
      mode: "SMT_BASELINE",
      correlationId: cid,
    });
    expect(logPipeline).toHaveBeenCalled();
    const startEv = logPipeline.mock.calls.find(
      (c) => c[0] === FINGERPRINT_PIPELINE_EVENT.resolvedSimFingerprintResolutionStart
    );
    const okEv = logPipeline.mock.calls.find(
      (c) => c[0] === FINGERPRINT_PIPELINE_EVENT.resolvedSimFingerprintResolutionSuccess
    );
    expect(startEv?.[1]).toMatchObject({ correlationId: cid, houseId: "house-a" });
    expect(startEv?.[1]).toHaveProperty("memoryRssMb");
    expect(okEv?.[1]).toMatchObject({ correlationId: cid, blendMode: "blended" });
    expect(typeof (okEv?.[1] as { durationMs?: unknown })?.durationMs).toBe("number");
    expect((okEv?.[1] as { durationMs: number }).durationMs).toBeGreaterThanOrEqual(0);
    expect(okEv?.[1]).toHaveProperty("memoryRssMb");
  });
});
