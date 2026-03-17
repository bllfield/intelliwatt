import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const scenarioFindFirst = vi.fn();
const getHouseAddressForUserHouse = vi.fn();
const getLatestCachedPastDatasetByScenario = vi.fn();
const simulatePastUsageDataset = vi.fn();
const decodeIntervalsV1 = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    usageSimulatorScenario: {
      findFirst: (...args: any[]) => scenarioFindFirst(...args),
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
  computePastInputHash: vi.fn(),
  getCachedPastDataset: vi.fn(),
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
  getUsageShapeProfileIdentityForPast: vi.fn(),
}));

import { buildGapfillCompareSimShared, getSimulatedUsageForHouseScenario } from "@/modules/usageSimulator/service";

describe("getSimulatedUsageForHouseScenario artifact_only", () => {
  beforeEach(() => {
    scenarioFindFirst.mockReset();
    getHouseAddressForUserHouse.mockReset();
    getLatestCachedPastDatasetByScenario.mockReset();
    simulatePastUsageDataset.mockReset();
    decodeIntervalsV1.mockReset();

    getHouseAddressForUserHouse.mockResolvedValue({ id: "h1", esiid: "1044" });
    scenarioFindFirst.mockResolvedValue({ id: "gapfill_lab", name: "Past (Corrected)" });
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
    getHouseAddressForUserHouse.mockReset();
    getLatestCachedPastDatasetByScenario.mockReset();
    simulatePastUsageDataset.mockReset();
    decodeIntervalsV1.mockReset();

    getHouseAddressForUserHouse.mockResolvedValue({ id: "h1", esiid: "1044" });
    scenarioFindFirst.mockResolvedValue({ id: "gapfill_lab", name: "Past (Corrected)" });
    decodeIntervalsV1.mockReturnValue(oneDayIntervals96(0.25));
  });

  it("does not use ACTUAL-labeled artifact days for simulated scoring intervals", async () => {
    getLatestCachedPastDatasetByScenario.mockResolvedValue({
      inputHash: "hash-actual-days",
      updatedAt: new Date("2026-03-12T00:00:00.000Z"),
      datasetJson: {
        summary: { source: "SIMULATED", intervalsCount: 2, totalKwh: 0.75, start: "2026-01-01", end: "2026-01-01" },
        meta: { curveShapingVersion: "shared_curve_v2" },
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
      travelSimulatedDateKeysLocal: new Set<string>(),
      rebuildArtifact: false,
    });

    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.artifactIntervals.length).toBeGreaterThan(0);
      expect(out.simulatedTestIntervals.length).toBe(0);
      expect(out.scoringSimulatedSource).toBe("shared_artifact_simulated_intervals15");
      expect(out.scoringUsedSharedArtifact).toBe(true);
    }
  });

  it("uses artifact simulated intervals when test day is SIMULATED-labeled", async () => {
    getLatestCachedPastDatasetByScenario.mockResolvedValue({
      inputHash: "hash-sim-days",
      updatedAt: new Date("2026-03-12T00:00:00.000Z"),
      datasetJson: {
        summary: { source: "SIMULATED", intervalsCount: 2, totalKwh: 0.75, start: "2026-01-01", end: "2026-01-01" },
        meta: { curveShapingVersion: "shared_curve_v2" },
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
    getLatestCachedPastDatasetByScenario.mockResolvedValue({
      inputHash: "hash-meta-owned-day",
      updatedAt: new Date("2026-03-12T00:00:00.000Z"),
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
      expect(out.scoringExcludedSource).toBe("artifact_meta_excludedDateKeysFingerprint");
      expect(out.simulatedTestIntervals.length).toBe(72);
      expect(out.scoredTestDaysMissingSimulatedOwnershipCount).toBe(0);
    }
  });
});

