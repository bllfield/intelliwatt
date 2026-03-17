import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const buildFindUnique = vi.fn();
const getHouseAddressForUserHouse = vi.fn();
const computePastInputHash = vi.fn();
const getCachedPastDataset = vi.fn();
const getLatestCachedPastDatasetByScenario = vi.fn();
const getIntervalDataFingerprint = vi.fn();
const getUsageShapeProfileIdentityForPast = vi.fn();
const computePastWeatherIdentity = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    usageSimulatorBuild: {
      findUnique: (...args: any[]) => buildFindUnique(...args),
    },
  },
}));

vi.mock("@/modules/usageSimulator/repo", () => ({
  getHouseAddressForUserHouse: (...args: any[]) => getHouseAddressForUserHouse(...args),
  normalizeScenarioKey: (v: string | null | undefined) => (v ? String(v) : "BASELINE"),
  listHouseAddressesForUser: vi.fn(),
  upsertSimulatorBuild: vi.fn(),
}));

vi.mock("@/modules/usageSimulator/pastCache", () => ({
  computePastInputHash: (...args: any[]) => computePastInputHash(...args),
  getCachedPastDataset: (...args: any[]) => getCachedPastDataset(...args),
  getLatestCachedPastDatasetByScenario: (...args: any[]) => getLatestCachedPastDatasetByScenario(...args),
  saveCachedPastDataset: vi.fn(),
  PAST_ENGINE_VERSION: "production_past_stitched_v2",
}));

vi.mock("@/lib/usage/actualDatasetForHouse", () => ({
  getActualUsageDatasetForHouse: vi.fn(),
  getIntervalDataFingerprint: (...args: any[]) => getIntervalDataFingerprint(...args),
}));

vi.mock("@/modules/simulatedUsage/simulatePastUsageDataset", () => ({
  simulatePastUsageDataset: vi.fn(),
  getUsageShapeProfileIdentityForPast: (...args: any[]) => getUsageShapeProfileIdentityForPast(...args),
}));

vi.mock("@/modules/weather/identity", () => ({
  computePastWeatherIdentity: (...args: any[]) => computePastWeatherIdentity(...args),
}));

vi.mock("@/modules/usageSimulator/intervalCodec", () => ({
  encodeIntervalsV1: vi.fn(),
  decodeIntervalsV1: vi.fn(() => [{ timestamp: "2026-01-01T00:00:00.000Z", kwh: 0.5 }]),
  INTERVAL_CODEC_V1: "v1_delta_varint",
}));

import { getSimulatedUsageForHouseScenario } from "@/modules/usageSimulator/service";

describe("getSimulatedUsageForHouseScenario artifact identity matching", () => {
  beforeEach(() => {
    buildFindUnique.mockReset();
    getHouseAddressForUserHouse.mockReset();
    computePastInputHash.mockReset();
    getCachedPastDataset.mockReset();
    getLatestCachedPastDatasetByScenario.mockReset();
    getIntervalDataFingerprint.mockReset();
    getUsageShapeProfileIdentityForPast.mockReset();
    computePastWeatherIdentity.mockReset();

    getHouseAddressForUserHouse.mockResolvedValue({ id: "h1", esiid: "1044" });
    buildFindUnique.mockResolvedValue({
      buildInputs: {
        mode: "SMT_BASELINE",
        canonicalMonths: ["2026-01"],
        timezone: "America/Chicago",
        travelRanges: [],
      },
    });
    getIntervalDataFingerprint.mockResolvedValue("interval-fp");
    getUsageShapeProfileIdentityForPast.mockResolvedValue({
      usageShapeProfileId: "profile_1",
      usageShapeProfileVersion: "1",
      usageShapeProfileDerivedAt: "2026-01-01T00:00:00.000Z",
      usageShapeProfileSimHash: "shape-hash",
    });
    computePastWeatherIdentity.mockResolvedValue("weather-hash");
    computePastInputHash.mockReturnValue("expected-hash");
  });

  it("returns artifact with exact_hash_match diagnostics when exact identity hash matches", async () => {
    getCachedPastDataset.mockResolvedValue({
      datasetJson: { summary: { source: "SIMULATED" }, series: {} },
      intervalsCodec: "v1_delta_varint",
      intervalsCompressed: Buffer.from("00", "hex"),
    });

    const out = await getSimulatedUsageForHouseScenario({
      userId: "u1",
      houseId: "h1",
      scenarioId: "past_scenario_1",
      readMode: "artifact_only",
    });

    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.dataset?.meta?.artifactReadMode).toBe("artifact_only");
      expect(out.dataset?.meta?.artifactInputHash).toBe("expected-hash");
      expect(out.dataset?.meta?.artifactSourceMode).toBe("exact_hash_match");
      expect(out.dataset?.meta?.requestedInputHash).toBe("expected-hash");
      expect(out.dataset?.meta?.artifactInputHashUsed).toBe("expected-hash");
      expect(out.dataset?.meta?.artifactHashMatch).toBe(true);
      expect(out.dataset?.meta?.artifactScenarioId).toBe("past_scenario_1");
      expect(Array.isArray(out.dataset?.series?.intervals15)).toBe(true);
    }
    expect(getLatestCachedPastDatasetByScenario).not.toHaveBeenCalled();
  });

  it("returns artifact with latest_by_scenario_fallback diagnostics when latest cached is used", async () => {
    getCachedPastDataset.mockResolvedValue(null);
    const updatedAt = new Date("2026-01-02T00:00:00.000Z");
    getLatestCachedPastDatasetByScenario.mockResolvedValue({
      inputHash: "old-hash",
      updatedAt,
      datasetJson: { summary: { start: "2026-01-01", end: "2026-01-31" }, series: {} },
      intervalsCodec: "v1_delta_varint",
      intervalsCompressed: Buffer.from("00", "hex"),
    });

    const out = await getSimulatedUsageForHouseScenario({
      userId: "u1",
      houseId: "h1",
      scenarioId: "past_scenario_1",
      readMode: "artifact_only",
    });

    expect(out.ok).toBe(true);
    if (out.ok) {
      const meta = out.dataset?.meta ?? {};
      expect(meta.artifactReadMode).toBe("artifact_only");
      expect(meta.artifactInputHash).toBe("old-hash");
      expect(meta.requestedInputHash).toBe("expected-hash");
      expect(meta.artifactInputHashUsed).toBe("old-hash");
      expect(meta.artifactHashMatch).toBe(false);
      expect(meta.artifactSourceMode).toBe("latest_by_scenario_fallback");
      expect(meta.artifactScenarioId).toBe("past_scenario_1");
      expect(meta.artifactUpdatedAt).toBe(updatedAt.toISOString());
      expect(typeof meta.artifactSourceNote).toBe("string");
      expect(Array.isArray(out.dataset?.series?.intervals15)).toBe(true);
    }
    expect(getCachedPastDataset).toHaveBeenCalledWith({
      houseId: "h1",
      scenarioId: "past_scenario_1",
      inputHash: "expected-hash",
    });
    expect(getLatestCachedPastDatasetByScenario).toHaveBeenCalledWith({
      houseId: "h1",
      scenarioId: "past_scenario_1",
    });
  });
});

