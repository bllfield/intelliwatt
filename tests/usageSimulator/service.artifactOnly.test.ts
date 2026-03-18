import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const scenarioFindFirst = vi.fn();
const usageSimulatorBuildFindUnique = vi.fn();
const getHouseAddressForUserHouse = vi.fn();
const computePastInputHash = vi.fn();
const getCachedPastDataset = vi.fn();
const getLatestCachedPastDatasetByScenario = vi.fn();
const simulatePastUsageDataset = vi.fn();
const decodeIntervalsV1 = vi.fn();
const getIntervalDataFingerprint = vi.fn();
const computePastWeatherIdentity = vi.fn();
const getUsageShapeProfileIdentityForPast = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    usageSimulatorScenario: {
      findFirst: (...args: any[]) => scenarioFindFirst(...args),
    },
    usageSimulatorBuild: {
      findUnique: (...args: any[]) => usageSimulatorBuildFindUnique(...args),
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

vi.mock("@/modules/usageSimulator/intervalCodec", () => ({
  encodeIntervalsV1: vi.fn(),
  decodeIntervalsV1: (...args: any[]) => decodeIntervalsV1(...args),
  INTERVAL_CODEC_V1: "v1_delta_varint",
}));

vi.mock("@/modules/simulatedUsage/simulatePastUsageDataset", () => ({
  simulatePastUsageDataset: (...args: any[]) => simulatePastUsageDataset(...args),
  getUsageShapeProfileIdentityForPast: (...args: any[]) => getUsageShapeProfileIdentityForPast(...args),
}));

vi.mock("@/lib/usage/actualDatasetForHouse", () => ({
  getActualUsageDatasetForHouse: vi.fn(),
  getIntervalDataFingerprint: (...args: any[]) => getIntervalDataFingerprint(...args),
}));

vi.mock("@/modules/weather/identity", () => ({
  computePastWeatherIdentity: (...args: any[]) => computePastWeatherIdentity(...args),
}));

import { buildGapfillCompareSimShared, getSimulatedUsageForHouseScenario } from "@/modules/usageSimulator/service";

describe("getSimulatedUsageForHouseScenario artifact_only", () => {
  beforeEach(() => {
    scenarioFindFirst.mockReset();
    usageSimulatorBuildFindUnique.mockReset();
    getHouseAddressForUserHouse.mockReset();
    computePastInputHash.mockReset();
    getCachedPastDataset.mockReset();
    getLatestCachedPastDatasetByScenario.mockReset();
    simulatePastUsageDataset.mockReset();
    decodeIntervalsV1.mockReset();
    getIntervalDataFingerprint.mockReset();
    computePastWeatherIdentity.mockReset();
    getUsageShapeProfileIdentityForPast.mockReset();

    getHouseAddressForUserHouse.mockResolvedValue({ id: "h1", esiid: "1044" });
    scenarioFindFirst.mockResolvedValue({ id: "gapfill_lab", name: "Past (Corrected)" });
    usageSimulatorBuildFindUnique.mockResolvedValue({
      buildInputs: {
        mode: "SMT_BASELINE",
        canonicalMonths: ["2026-01"],
        timezone: "America/Chicago",
        travelRanges: [],
      },
    });
    computePastInputHash.mockReturnValue("hash-past-expected");
    getIntervalDataFingerprint.mockResolvedValue("fp-a");
    computePastWeatherIdentity.mockResolvedValue("wx-a");
    getUsageShapeProfileIdentityForPast.mockResolvedValue({
      usageShapeProfileId: "shape-1",
      usageShapeProfileVersion: "1",
      usageShapeProfileDerivedAt: "2026-01-01T00:00:00.000Z",
      usageShapeProfileSimHash: "shape-hash-1",
    });
    decodeIntervalsV1.mockReturnValue([
      { timestamp: "2026-01-01T00:00:00.000Z", kwh: 0.25 },
      { timestamp: "2026-01-01T00:15:00.000Z", kwh: 0.5 },
    ]);
  });

  it("returns ARTIFACT_MISSING instead of rebuilding when cache artifact is missing", async () => {
    getLatestCachedPastDatasetByScenario.mockResolvedValue(null);

    const out = await getSimulatedUsageForHouseScenario({
      userId: "u1",
      houseId: "h1",
      scenarioId: "gapfill_lab",
      readMode: "artifact_only",
    });

    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe("ARTIFACT_MISSING");
    expect(simulatePastUsageDataset).not.toHaveBeenCalled();
  });

  it("returns artifact dataset when persisted cache exists and does not rebuild", async () => {
    getLatestCachedPastDatasetByScenario.mockResolvedValue({
      inputHash: "hash1",
      updatedAt: new Date("2026-03-12T00:00:00.000Z"),
      datasetJson: {
        summary: { source: "SIMULATED", intervalsCount: 2, totalKwh: 0.75, start: "2026-01-01", end: "2026-01-01", latest: "2026-01-01" },
        series: {},
      },
      intervalsCodec: "v1_delta_varint",
      intervalsCompressed: Buffer.from("00", "hex"),
    });

    const out = await getSimulatedUsageForHouseScenario({
      userId: "u1",
      houseId: "h1",
      scenarioId: "gapfill_lab",
      readMode: "artifact_only",
    });

    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.dataset?.meta?.artifactReadMode).toBe("artifact_only");
      expect(Array.isArray(out.dataset?.series?.intervals15)).toBe(true);
    }
    expect(simulatePastUsageDataset).not.toHaveBeenCalled();
  });

  it("re-derives restored summary total from decoded cached intervals", async () => {
    getLatestCachedPastDatasetByScenario.mockResolvedValue({
      inputHash: "hash3",
      updatedAt: new Date("2026-03-12T00:00:00.000Z"),
      datasetJson: {
        summary: {
          source: "SIMULATED",
          intervalsCount: 2,
          totalKwh: 9999.99,
          start: "2026-01-01",
          end: "2026-01-01",
          latest: "2026-01-01",
        },
        totals: { importKwh: 9999.99, netKwh: 9999.99 },
        series: {},
      },
      intervalsCodec: "v1_delta_varint",
      intervalsCompressed: Buffer.from("00", "hex"),
    });

    const out = await getSimulatedUsageForHouseScenario({
      userId: "u1",
      houseId: "h1",
      scenarioId: "gapfill_lab",
      readMode: "artifact_only",
    });

    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.dataset?.summary?.totalKwh).toBe(0.75);
      expect(out.dataset?.totals?.importKwh).toBe(0.75);
      expect(out.dataset?.totals?.netKwh).toBe(0.75);
    }
  });

  it("artifact_only does not require usageSimulatorScenario row for cache-backed scenarios", async () => {
    scenarioFindFirst.mockResolvedValue(null);
    getLatestCachedPastDatasetByScenario.mockResolvedValue({
      inputHash: "hash2",
      updatedAt: new Date("2026-03-12T00:00:00.000Z"),
      datasetJson: {
        summary: { source: "SIMULATED", intervalsCount: 2, totalKwh: 0.75, start: "2026-01-01", end: "2026-01-01", latest: "2026-01-01" },
        series: {},
      },
      intervalsCodec: "v1_delta_varint",
      intervalsCompressed: Buffer.from("00", "hex"),
    });

    const out = await getSimulatedUsageForHouseScenario({
      userId: "u1",
      houseId: "h1",
      scenarioId: "gapfill_lab",
      readMode: "artifact_only",
    });

    expect(out.ok).toBe(true);
    expect(scenarioFindFirst).not.toHaveBeenCalled();
    expect(simulatePastUsageDataset).not.toHaveBeenCalled();
  });

  it("artifact_only fallback ignores legacy compare metadata when shared travel fingerprint matches", async () => {
    scenarioFindFirst.mockResolvedValue({ id: "past-s1", name: "Past (Corrected)" });
    usageSimulatorBuildFindUnique.mockResolvedValue({
      buildInputs: {
        mode: "SMT_BASELINE",
        canonicalMonths: ["2026-01"],
        timezone: "America/Chicago",
        travelRanges: [{ startDate: "2026-01-01", endDate: "2026-01-01" }],
      },
    });
    computePastInputHash.mockReturnValue("hash-exact-miss");
    getCachedPastDataset.mockResolvedValue(null);
    getLatestCachedPastDatasetByScenario.mockResolvedValue({
      inputHash: "hash-compare-artifact",
      updatedAt: new Date("2026-03-12T00:00:00.000Z"),
      datasetJson: {
        summary: { source: "SIMULATED", intervalsCount: 2, totalKwh: 0.75, start: "2026-01-01", end: "2026-01-01" },
        meta: {
          artifactScope: "gapfill_compare",
          excludedDateKeysFingerprint: "2026-01-01",
          compareMaskDateKeysFingerprint: "2026-01-01,2026-01-02",
        },
        series: {},
      },
      intervalsCodec: "v1_delta_varint",
      intervalsCompressed: Buffer.from("00", "hex"),
    });

    const out = await getSimulatedUsageForHouseScenario({
      userId: "u1",
      houseId: "h1",
      scenarioId: "past-s1",
      readMode: "artifact_only",
    });

    expect(out.ok).toBe(true);
    expect(simulatePastUsageDataset).not.toHaveBeenCalled();
  });
});

describe("buildGapfillCompareSimShared scoring interval sourcing", () => {
  function oneDayIntervals96(kwh = 0.25): Array<{ timestamp: string; kwh: number }> {
    const out: Array<{ timestamp: string; kwh: number }> = [];
    for (let i = 0; i < 96; i++) {
      const hh = String(Math.floor(i / 4)).padStart(2, "0");
      const mm = String((i % 4) * 15).padStart(2, "0");
      out.push({ timestamp: `2026-01-01T${hh}:${mm}:00.000Z`, kwh });
    }
    return out;
  }

  beforeEach(() => {
    scenarioFindFirst.mockReset();
    usageSimulatorBuildFindUnique.mockReset();
    getHouseAddressForUserHouse.mockReset();
    getCachedPastDataset.mockReset();
    getLatestCachedPastDatasetByScenario.mockReset();
    simulatePastUsageDataset.mockReset();
    decodeIntervalsV1.mockReset();
    getIntervalDataFingerprint.mockReset();
    computePastWeatherIdentity.mockReset();
    getUsageShapeProfileIdentityForPast.mockReset();

    getHouseAddressForUserHouse.mockResolvedValue({ id: "h1", esiid: "1044" });
    scenarioFindFirst.mockResolvedValue({ id: "gapfill_lab", name: "Past (Corrected)" });
    usageSimulatorBuildFindUnique.mockResolvedValue({
      buildInputs: {
        mode: "SMT_BASELINE",
        canonicalMonths: ["2026-01"],
        timezone: "America/Chicago",
        travelRanges: [],
      },
    });
    getIntervalDataFingerprint.mockResolvedValue("fp-a");
    computePastWeatherIdentity.mockResolvedValue("wx-a");
    getUsageShapeProfileIdentityForPast.mockResolvedValue({
      usageShapeProfileId: "shape-1",
      usageShapeProfileVersion: "1",
      usageShapeProfileDerivedAt: "2026-01-01T00:00:00.000Z",
      usageShapeProfileSimHash: "shape-hash-1",
    });
    decodeIntervalsV1.mockReturnValue(oneDayIntervals96(0.25));
  });

  it("returns rebuild-required when shared artifact is missing for the requested identity", async () => {
    getCachedPastDataset.mockResolvedValue(null);
    simulatePastUsageDataset.mockResolvedValue(null);

    const out = await buildGapfillCompareSimShared({
      userId: "u1",
      houseId: "h1",
      timezone: "America/Chicago",
      canonicalWindow: { startDate: "2026-01-01", endDate: "2026-01-01" },
      testDateKeysLocal: new Set<string>(["2026-01-01"]),
      travelSimulatedDateKeysLocal: new Set<string>(),
      rebuildArtifact: false,
    });

    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.status).toBe(409);
      expect((out.body as any)?.error).toBe("artifact_missing_rebuild_required");
    }
  });

  it("does not enforce legacy compare-mask metadata when shared ownership metadata is valid", async () => {
    getCachedPastDataset.mockResolvedValue({
      inputHash: "hash-actual-days",
      datasetJson: {
        summary: { source: "SIMULATED", intervalsCount: 2, totalKwh: 0.75, start: "2026-01-01", end: "2026-01-01" },
        meta: {
          curveShapingVersion: "shared_curve_v2",
          excludedDateKeysFingerprint: "",
          compareMaskDateKeysFingerprint: "2026-01-02",
        },
        daily: [{ date: "2026-01-01", source: "SIMULATED" }],
        series: {},
      },
      intervalsCodec: "v1_delta_varint",
      intervalsCompressed: Buffer.from("00", "hex"),
    });

    const out = await buildGapfillCompareSimShared({
      userId: "u1",
      houseId: "h1",
      timezone: "America/Chicago",
      canonicalWindow: { startDate: "2026-01-01", endDate: "2026-01-01" },
      testDateKeysLocal: new Set<string>(["2026-01-01"]),
      travelSimulatedDateKeysLocal: new Set<string>(),
      rebuildArtifact: false,
    });

    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.simulatedTestIntervals.length).toBe(72);
      expect(out.artifactUsesTestDaysInIdentity).toBe(false);
    }
  });

  it("detects original excluded fingerprint mismatch before canonical normalization", async () => {
    getCachedPastDataset.mockResolvedValue({
      inputHash: "hash-excluded-pre-normalize-mismatch",
      datasetJson: {
        summary: { source: "SIMULATED", intervalsCount: 2, totalKwh: 0.75, start: "2026-01-01", end: "2026-01-01" },
        meta: {
          curveShapingVersion: "shared_curve_v2",
          // Out-of-window travel fingerprint; canonical normalization would bound this away.
          excludedDateKeysFingerprint: "2024-01-01",
        },
        daily: [{ date: "2026-01-01", source: "SIMULATED" }],
        series: {},
      },
      intervalsCodec: "v1_delta_varint",
      intervalsCompressed: Buffer.from("00", "hex"),
    });

    const out = await buildGapfillCompareSimShared({
      userId: "u1",
      houseId: "h1",
      timezone: "America/Chicago",
      canonicalWindow: { startDate: "2026-01-01", endDate: "2026-01-01" },
      testDateKeysLocal: new Set<string>(["2026-01-01"]),
      travelSimulatedDateKeysLocal: new Set<string>(),
      rebuildArtifact: false,
    });

    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.status).toBe(409);
      expect((out.body as any)?.error).toBe("artifact_scope_mismatch_rebuild_required");
    }
  });

  it("uses artifact simulated intervals when test day is SIMULATED-labeled", async () => {
    getCachedPastDataset.mockResolvedValue({
      inputHash: "hash-sim-days",
      datasetJson: {
        summary: { source: "SIMULATED", intervalsCount: 2, totalKwh: 0.75, start: "2026-01-01", end: "2026-01-01" },
        meta: {
          curveShapingVersion: "shared_curve_v2",
          excludedDateKeysFingerprint: "",
        },
        daily: [{ date: "2026-01-01", source: "SIMULATED" }],
        series: {},
      },
      intervalsCodec: "v1_delta_varint",
      intervalsCompressed: Buffer.from("00", "hex"),
    });

    const out = await buildGapfillCompareSimShared({
      userId: "u1",
      houseId: "h1",
      timezone: "America/Chicago",
      canonicalWindow: { startDate: "2026-01-01", endDate: "2026-01-01" },
      testDateKeysLocal: new Set<string>(["2026-01-01"]),
      travelSimulatedDateKeysLocal: new Set<string>(),
      rebuildArtifact: false,
    });

    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.simulatedTestIntervals.length).toBe(72);
      expect(out.simulatedTestIntervals.every((p) => p.kwh === 0.25)).toBe(true);
    }
  });

  it("uses shared excludedDateKeys ownership from artifact metadata for scoring", async () => {
    usageSimulatorBuildFindUnique.mockResolvedValueOnce({
      buildInputs: {
        mode: "SMT_BASELINE",
        canonicalMonths: ["2026-01"],
        timezone: "America/Chicago",
        travelRanges: [{ startDate: "2026-01-01", endDate: "2026-01-01" }],
      },
    });
    getCachedPastDataset.mockResolvedValue({
      inputHash: "hash-meta-owned-day",
      datasetJson: {
        summary: { source: "SIMULATED", intervalsCount: 2, totalKwh: 0.75, start: "2026-01-01", end: "2026-01-01" },
        meta: {
          curveShapingVersion: "shared_curve_v2",
          excludedDateKeysFingerprint: "2026-01-01",
        },
        daily: [{ date: "2026-01-01", source: "ACTUAL" }],
        series: {},
      },
      intervalsCodec: "v1_delta_varint",
      intervalsCompressed: Buffer.from("00", "hex"),
    });

    const out = await buildGapfillCompareSimShared({
      userId: "u1",
      houseId: "h1",
      timezone: "America/Chicago",
      canonicalWindow: { startDate: "2026-01-01", endDate: "2026-01-01" },
      testDateKeysLocal: new Set<string>(["2026-01-01"]),
      travelSimulatedDateKeysLocal: new Set<string>(["2026-01-01"]),
      rebuildArtifact: false,
    });

    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.scoringExcludedSource).toBe("shared_past_travel_vacant_excludedDateKeysFingerprint");
      expect(out.simulatedTestIntervals.length).toBe(72);
      expect(out.scoredTestDaysMissingSimulatedOwnershipCount).toBe(0);
    }
  });
});

