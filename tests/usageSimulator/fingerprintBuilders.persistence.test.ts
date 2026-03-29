import { beforeEach, describe, expect, it, vi } from "vitest";
import { SimulatorFingerprintStatus } from "@/.prisma/usage-client";
import { FINGERPRINT_PIPELINE_EVENT } from "@/modules/usageSimulator/simObservability";

const upsertMock = vi.fn();

const { logPipeline } = vi.hoisted(() => ({
  logPipeline: vi.fn(),
}));

vi.mock("@/modules/usageSimulator/simObservability", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/modules/usageSimulator/simObservability")>();
  return { ...mod, logSimPipelineEvent: logPipeline };
});
const getLatestWholeMock = vi.fn();
const getLatestUsageMock = vi.fn();

vi.mock("@/modules/usageSimulator/fingerprintArtifactsRepo", () => ({
  upsertWholeHomeFingerprintArtifact: (...args: unknown[]) => upsertMock(...args),
  upsertUsageFingerprintArtifact: (...args: unknown[]) => upsertMock(...args),
  getLatestWholeHomeFingerprintByHouseId: (...args: unknown[]) => getLatestWholeMock(...args),
  getLatestUsageFingerprintByHouseId: (...args: unknown[]) => getLatestUsageMock(...args),
}));

vi.mock("@/lib/usage/actualDatasetForHouse", () => ({
  getIntervalDataFingerprint: vi.fn(),
}));

vi.mock("@/modules/weather/identity", () => ({
  computePastWeatherIdentity: vi.fn().mockResolvedValue("weather-id-1"),
}));

describe("buildAndPersistWholeHomeFingerprint persistence", () => {
  beforeEach(() => {
    upsertMock.mockReset();
    getLatestWholeMock.mockResolvedValue(null);
    logPipeline.mockClear();
  });

  it("writes building then ready with honest provenance", async () => {
    const { buildAndPersistWholeHomeFingerprint } = await import("@/modules/usageSimulator/wholeHomeFingerprintBuilder");
    const cid = "11111111-1111-4111-8111-111111111111";
    const out = await buildAndPersistWholeHomeFingerprint({
      houseId: "h1",
      homeProfile: { squareFeet: 1800, fuelConfiguration: "mixed" },
      applianceProfile: { fuelConfiguration: "mixed", appliances: [] },
      correlationId: cid,
    });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.sourceHash.length).toBeGreaterThan(20);
    expect(upsertMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(upsertMock.mock.calls[0]?.[0].status).toBe(SimulatorFingerprintStatus.building);
    const readyCall = upsertMock.mock.calls.find((c) => c[0]?.status === SimulatorFingerprintStatus.ready);
    expect(readyCall?.[0].builtAt).toBeInstanceOf(Date);
    expect(readyCall?.[0].staleReason).toBeNull();
    const payload = readyCall?.[0]?.payloadJson as Record<string, unknown> | undefined;
    expect(payload?.cohortPrior).toBeDefined();
    expect((payload?.cohortPrior as { cohortPriorVersion?: string })?.cohortPriorVersion).toBeDefined();
    expect(payload?.cohortProvenance).toMatchObject({ incorporated: true });
    const startEv = logPipeline.mock.calls.find(
      (c) => c[0] === FINGERPRINT_PIPELINE_EVENT.wholeHomeFingerprintBuildStart
    );
    const okEv = logPipeline.mock.calls.find(
      (c) => c[0] === FINGERPRINT_PIPELINE_EVENT.wholeHomeFingerprintBuildSuccess
    );
    expect(startEv?.[1]).toMatchObject({ correlationId: cid, houseId: "h1" });
    expect(okEv?.[1]).toMatchObject({ correlationId: cid, houseId: "h1" });
    expect(typeof (okEv?.[1] as { durationMs?: unknown })?.durationMs).toBe("number");
    expect(okEv?.[1]).toHaveProperty("memoryRssMb");
  });
});

describe("buildAndPersistUsageFingerprint failure honesty", () => {
  beforeEach(() => {
    upsertMock.mockReset();
    getLatestUsageMock.mockResolvedValue(null);
    logPipeline.mockClear();
  });

  it("records failed when interval fingerprint is unavailable", async () => {
    const { getIntervalDataFingerprint } = await import("@/lib/usage/actualDatasetForHouse");
    vi.mocked(getIntervalDataFingerprint).mockResolvedValueOnce("");
    const { buildAndPersistUsageFingerprint } = await import("@/modules/usageSimulator/usageFingerprintBuilder");
    const out = await buildAndPersistUsageFingerprint({
      houseId: "h2",
      esiid: "e1",
      startDate: "2025-01-01",
      endDate: "2025-01-31",
    });
    expect(out.ok).toBe(false);
    const failedCall = upsertMock.mock.calls.find((c) => c[0]?.status === SimulatorFingerprintStatus.failed);
    expect(failedCall?.[0].staleReason).toBe("interval_fingerprint_unavailable");
    const failEv = logPipeline.mock.calls.find(
      (c) => c[0] === FINGERPRINT_PIPELINE_EVENT.usageFingerprintBuildFailure
    );
    expect(failEv?.[1]).toMatchObject({ houseId: "h2", failureCode: "interval_fingerprint_unavailable" });
    expect(typeof (failEv?.[1] as { durationMs?: unknown })?.durationMs).toBe("number");
  });
});
