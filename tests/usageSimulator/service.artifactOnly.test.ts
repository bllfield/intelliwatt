import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildPastSimulatedBaselineV1 } from "@/modules/simulatedUsage/engine";
import { dateKeyFromTimestamp, getDayGridTimestamps } from "@/modules/usageSimulator/pastStitchedCurve";

vi.mock("server-only", () => ({}));

const scenarioFindFirst = vi.fn();
const usageSimulatorBuildFindUnique = vi.fn();
const getHouseAddressForUserHouse = vi.fn();
const computePastInputHash = vi.fn();
const getCachedPastDataset = vi.fn();
const getLatestCachedPastDatasetByScenario = vi.fn();
const saveCachedPastDataset = vi.fn();
const simulatePastUsageDataset = vi.fn();
const simulatePastSelectedDaysShared = vi.fn();
const encodeIntervalsV1 = vi.fn();
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
  saveCachedPastDataset: (...args: any[]) => saveCachedPastDataset(...args),
  PAST_ENGINE_VERSION: "production_past_stitched_v2",
}));

vi.mock("@/modules/usageSimulator/intervalCodec", () => ({
  encodeIntervalsV1: (...args: any[]) => encodeIntervalsV1(...args),
  decodeIntervalsV1: (...args: any[]) => decodeIntervalsV1(...args),
  INTERVAL_CODEC_V1: "v1_delta_varint",
}));

vi.mock("@/modules/simulatedUsage/simulatePastUsageDataset", () => ({
  simulatePastUsageDataset: (...args: any[]) => simulatePastUsageDataset(...args),
  simulatePastSelectedDaysShared: (...args: any[]) => simulatePastSelectedDaysShared(...args),
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
    saveCachedPastDataset.mockReset();
    simulatePastUsageDataset.mockReset();
    simulatePastSelectedDaysShared.mockReset();
    encodeIntervalsV1.mockReset();
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
    encodeIntervalsV1.mockReturnValue({ bytes: Buffer.from("00", "hex") });
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

  it("allow_rebuild persists canonical excluded fingerprint metadata on saved shared artifact", async () => {
    usageSimulatorBuildFindUnique.mockResolvedValueOnce({
      buildInputs: {
        mode: "SMT_BASELINE",
        canonicalMonths: ["2026-01"],
        timezone: "America/Chicago",
        travelRanges: [{ startDate: "2026-01-01", endDate: "2026-01-01" }],
      },
    });
    getCachedPastDataset.mockResolvedValueOnce(null);
    simulatePastUsageDataset.mockResolvedValueOnce({
      dataset: {
        summary: { source: "SIMULATED", intervalsCount: 2, totalKwh: 0.75, start: "2026-01-01", end: "2026-01-01" },
        meta: { curveShapingVersion: "shared_curve_v2" },
        daily: [{ date: "2026-01-01", kwh: 0.75, source: "SIMULATED" }],
        monthly: [{ month: "2026-01", kwh: 0.75 }],
        series: {
          intervals15: [
            { timestamp: "2026-01-01T00:00:00.000Z", kwh: 0.25 },
            { timestamp: "2026-01-01T00:15:00.000Z", kwh: 0.5 },
          ],
        },
      },
      error: null,
    });

    const out = await getSimulatedUsageForHouseScenario({
      userId: "u1",
      houseId: "h1",
      scenarioId: "past-s1",
      readMode: "allow_rebuild",
    });

    expect(out.ok).toBe(true);
    expect(saveCachedPastDataset).toHaveBeenCalledTimes(1);
    const saved = saveCachedPastDataset.mock.calls[0]?.[0] ?? {};
    const savedMeta = ((saved as any).datasetJson?.meta ?? {}) as Record<string, unknown>;
    expect(typeof savedMeta.excludedDateKeysFingerprint).toBe("string");
    expect(typeof savedMeta.excludedDateKeysCount).toBe("number");
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
    saveCachedPastDataset.mockReset();
    simulatePastUsageDataset.mockReset();
    encodeIntervalsV1.mockReset();
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
    encodeIntervalsV1.mockReturnValue({ bytes: Buffer.from("00", "hex") });
    decodeIntervalsV1.mockReturnValue(oneDayIntervals96(0.25));
    simulatePastSelectedDaysShared.mockResolvedValue({
      simulatedIntervals: oneDayIntervals96(24 / 72),
      simulatedDayResults: [],
      pastDayCounts: {},
      weatherSourceSummary: "actual_only",
      weatherKindUsed: "ACTUAL_LAST_YEAR",
    });
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
      rebuildArtifact: false,
      includeFreshCompareCalc: false,
    });

    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.status).toBe(409);
      expect((out.body as any)?.error).toBe("artifact_missing_rebuild_required");
    }
  });

  it("falls back to latest scenario artifact when exact hash misses after rebuild and ownership scope matches", async () => {
    getCachedPastDataset.mockResolvedValue(null);
    getLatestCachedPastDatasetByScenario.mockResolvedValue({
      inputHash: "hash-latest-scenario",
      updatedAt: new Date("2026-03-12T00:00:00.000Z"),
      datasetJson: {
        summary: { source: "SIMULATED", intervalsCount: 96, totalKwh: 24, start: "2026-01-01", end: "2026-01-01" },
        meta: {
          curveShapingVersion: "shared_curve_v2",
          excludedDateKeysFingerprint: "",
        },
        daily: [{ date: "2026-01-01", kwh: 24, source: "SIMULATED" }],
        monthly: [{ month: "2026-01", kwh: 24 }],
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
      rebuildArtifact: false,
      includeFreshCompareCalc: false,
    });

    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.simulatedTestIntervals.length).toBeGreaterThan(0);
      expect((out.modelAssumptions as any)?.artifactSourceMode).toBe("latest_by_scenario_fallback");
      expect(typeof (out.modelAssumptions as any)?.requestedInputHash).toBe("string");
      expect((out.modelAssumptions as any)?.artifactInputHashUsed).toBe("hash-latest-scenario");
      expect((out.modelAssumptions as any)?.requestedInputHash).not.toBe("hash-latest-scenario");
      expect((out.modelAssumptions as any)?.artifactHashMatch).toBe(false);
    }
  });

  it("clears exact-hash artifact source mode after auto-rebuilding from incompatible fallback", async () => {
    const rebuiltIntervals = oneDayIntervals96(0.25);
    getCachedPastDataset
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        inputHash: "hash-rebuilt-readback",
        updatedAt: new Date("2026-03-12T00:00:00.000Z"),
        datasetJson: {
          summary: {
            source: "SIMULATED",
            intervalsCount: 96,
            totalKwh: 24,
            start: "2026-01-01",
            end: "2026-01-01",
          },
          meta: {
            curveShapingVersion: "shared_curve_v2",
            excludedDateKeysFingerprint: "",
          },
          daily: [{ date: "2026-01-01", kwh: 24, source: "SIMULATED" }],
          monthly: [{ month: "2026-01", kwh: 24 }],
          series: {},
        },
        intervalsCodec: "v1_delta_varint",
        intervalsCompressed: Buffer.from("00", "hex"),
      });
    getLatestCachedPastDatasetByScenario.mockResolvedValue({
      inputHash: "hash-incompatible-latest",
      updatedAt: new Date("2026-03-12T00:00:00.000Z"),
      datasetJson: {
        summary: { source: "SIMULATED", intervalsCount: 96, totalKwh: 24, start: "2026-01-01", end: "2026-01-01" },
        meta: {
          curveShapingVersion: "shared_curve_v2",
          excludedDateKeysFingerprint: "2026-01-02",
        },
        daily: [{ date: "2026-01-01", kwh: 24, source: "SIMULATED" }],
        monthly: [{ month: "2026-01", kwh: 24 }],
        series: {},
      },
      intervalsCodec: "v1_delta_varint",
      intervalsCompressed: Buffer.from("00", "hex"),
    });
    simulatePastUsageDataset.mockResolvedValue({
      dataset: {
        summary: { source: "SIMULATED", intervalsCount: 96, totalKwh: 24, start: "2026-01-01", end: "2026-01-01" },
        meta: { curveShapingVersion: "shared_curve_v2", excludedDateKeysFingerprint: "" },
        daily: [{ date: "2026-01-01", kwh: 24, source: "SIMULATED" }],
        monthly: [{ month: "2026-01", kwh: 24 }],
        series: { intervals15: rebuiltIntervals },
      },
      error: null,
    });

    const out = await buildGapfillCompareSimShared({
      userId: "u1",
      houseId: "h1",
      timezone: "America/Chicago",
      canonicalWindow: { startDate: "2026-01-01", endDate: "2026-01-01" },
      testDateKeysLocal: new Set<string>(["2026-01-01"]),
      rebuildArtifact: false,
      autoEnsureArtifact: true,
      includeFreshCompareCalc: false,
    });

    expect(out.ok).toBe(true);
    if (out.ok) {
      expect((out.modelAssumptions as any)?.artifactSource).toBe("rebuild");
      expect((out.modelAssumptions as any)?.artifactSourceMode).toBeUndefined();
      expect((out.modelAssumptions as any)?.artifactSourceNote).toBeUndefined();
    }
  });

  it("autoEnsure rebuild persists canonical excluded fingerprint metadata in saved artifact", async () => {
    usageSimulatorBuildFindUnique.mockResolvedValueOnce({
      buildInputs: {
        mode: "SMT_BASELINE",
        canonicalMonths: ["2026-01"],
        timezone: "America/Chicago",
        travelRanges: [{ startDate: "2026-01-01", endDate: "2026-01-01" }],
      },
    });
    const rebuiltIntervals = oneDayIntervals96(0.25);
    getCachedPastDataset
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        inputHash: "hash-rebuilt-readback",
        updatedAt: new Date("2026-03-12T00:00:00.000Z"),
        datasetJson: {
          summary: {
            source: "SIMULATED",
            intervalsCount: 96,
            totalKwh: 24,
            start: "2026-01-01",
            end: "2026-01-01",
          },
          meta: {
            curveShapingVersion: "shared_curve_v2",
            excludedDateKeysFingerprint: "2026-01-01",
            excludedDateKeysCount: 1,
          },
          daily: [{ date: "2026-01-01", kwh: 24, source: "SIMULATED" }],
          monthly: [{ month: "2026-01", kwh: 24 }],
          series: {},
        },
        intervalsCodec: "v1_delta_varint",
        intervalsCompressed: Buffer.from("00", "hex"),
      });
    getLatestCachedPastDatasetByScenario.mockResolvedValueOnce(null);
    simulatePastUsageDataset.mockResolvedValueOnce({
      dataset: {
        summary: { source: "SIMULATED", intervalsCount: 96, totalKwh: 24, start: "2026-01-01", end: "2026-01-01" },
        meta: { curveShapingVersion: "shared_curve_v2" },
        daily: [{ date: "2026-01-01", kwh: 24, source: "SIMULATED" }],
        monthly: [{ month: "2026-01", kwh: 24 }],
        series: { intervals15: rebuiltIntervals },
      },
      error: null,
    });

    const out = await buildGapfillCompareSimShared({
      userId: "u1",
      houseId: "h1",
      timezone: "America/Chicago",
      canonicalWindow: { startDate: "2026-01-01", endDate: "2026-01-01" },
      testDateKeysLocal: new Set<string>(["2026-01-01"]),
      rebuildArtifact: false,
      autoEnsureArtifact: true,
      includeFreshCompareCalc: false,
    });

    expect(out.ok).toBe(true);
    expect(saveCachedPastDataset).toHaveBeenCalledTimes(1);
    const saved = saveCachedPastDataset.mock.calls[0]?.[0] ?? {};
    const savedMeta = ((saved as any).datasetJson?.meta ?? {}) as Record<string, unknown>;
    expect(savedMeta.excludedDateKeysFingerprint).toBe("2026-01-01");
    expect(savedMeta.excludedDateKeysCount).toBe(1);
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
      rebuildArtifact: false,
      includeFreshCompareCalc: false,
    });

    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.simulatedTestIntervals.length).toBe(72);
      expect(out.artifactUsesTestDaysInIdentity).toBe(false);
    }
  });

  it("ignores out-of-window excluded fingerprint residue after canonical normalization", async () => {
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
      rebuildArtifact: false,
      includeFreshCompareCalc: false,
    });

    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.simulatedTestIntervals.length).toBe(72);
    }
  });

  it("returns scope mismatch when in-window excluded fingerprint conflicts with shared travel scope", async () => {
    getCachedPastDataset.mockResolvedValue({
      inputHash: "hash-in-window-excluded-mismatch",
      datasetJson: {
        summary: { source: "SIMULATED", intervalsCount: 2, totalKwh: 0.75, start: "2026-01-01", end: "2026-01-01" },
        meta: {
          curveShapingVersion: "shared_curve_v2",
          // In-window day that conflicts with current shared build travel scope ([] in beforeEach).
          excludedDateKeysFingerprint: "2026-01-01",
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
      rebuildArtifact: false,
      includeFreshCompareCalc: false,
    });

    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.status).toBe(409);
      expect((out.body as any)?.error).toBe("artifact_scope_mismatch_rebuild_required");
    }
  });

  it("uses selected-day shared intervals for scoring by default", async () => {
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
      rebuildArtifact: false,
      includeFreshCompareCalc: false,
    });

    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.simulatedTestIntervals.length).toBe(72);
      expect(out.scoringSimulatedSource).toBe("shared_selected_days_simulated_intervals15");
      expect(out.compareCalculationScope).toBe("selected_days_shared_path_only");
      expect(out.compareSimSource).toBe("shared_selected_days_calc");
      expect(out.simulatedTestIntervals.every((p) => p.kwh === 24 / 72)).toBe(true);
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
      rebuildArtifact: false,
      includeFreshCompareCalc: false,
    });

    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.scoringExcludedSource).toBe("shared_past_travel_vacant_excludedDateKeysFingerprint");
      expect(out.simulatedTestIntervals.length).toBe(72);
      expect(out.scoredTestDaysMissingSimulatedOwnershipCount).toBe(0);
    }
  });

  it("returns scoring timezone/window metadata from the same selection source as simulated intervals", async () => {
    getCachedPastDataset.mockResolvedValue({
      inputHash: "hash-selection-meta",
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
      rebuildArtifact: false,
      includeFreshCompareCalc: false,
    });

    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.timezoneUsedForScoring).toBe("America/Chicago");
      expect(out.windowUsedForScoring).toEqual(out.sharedCoverageWindow);
      expect(out.scoringTestDateKeysLocal).toBeInstanceOf(Set);
      expect(out.scoringTestDateKeysLocal.has("2026-01-01")).toBe(true);
    }
  });

  it("returns explicit rebuild failure when rebuilt artifact cannot be read back by hash", async () => {
    getCachedPastDataset
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    simulatePastUsageDataset.mockResolvedValue({
      dataset: {
        summary: { source: "SIMULATED", intervalsCount: 96, totalKwh: 24, start: "2026-01-01", end: "2026-01-01" },
        meta: { curveShapingVersion: "shared_curve_v2", excludedDateKeysFingerprint: "" },
        daily: [{ date: "2026-01-01", kwh: 24, source: "SIMULATED" }],
        monthly: [{ month: "2026-01", kwh: 24 }],
        series: { intervals15: oneDayIntervals96(0.25) },
      },
      error: null,
    });

    const out = await buildGapfillCompareSimShared({
      userId: "u1",
      houseId: "h1",
      timezone: "America/Chicago",
      canonicalWindow: { startDate: "2026-01-01", endDate: "2026-01-01" },
      testDateKeysLocal: new Set<string>(["2026-01-01"]),
      rebuildArtifact: true,
      includeFreshCompareCalc: false,
    });

    expect(saveCachedPastDataset).toHaveBeenCalledTimes(1);
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.status).toBe(500);
      expect((out.body as any)?.error).toBe("artifact_persist_verify_failed");
    }
  });

  it("uses restored dataset daily/monthly rows as canonical display output when present", async () => {
    usageSimulatorBuildFindUnique.mockResolvedValueOnce({
      buildInputs: {
        mode: "SMT_BASELINE",
        canonicalMonths: ["2026-01"],
        timezone: "America/Chicago",
        travelRanges: [{ startDate: "2026-01-01", endDate: "2026-01-01" }],
      },
    });
    getCachedPastDataset.mockResolvedValue({
      inputHash: "hash-display-canonical",
      datasetJson: {
        summary: { source: "SIMULATED", intervalsCount: 96, totalKwh: 9.99, start: "2026-01-01", end: "2026-01-01" },
        meta: {
          curveShapingVersion: "shared_curve_v2",
          excludedDateKeysFingerprint: "2026-01-01",
        },
        daily: [{ date: "2026-01-01", kwh: 9.99, source: "ACTUAL" }],
        monthly: [
          { month: "2025-12", kwh: 111.11 },
          { month: "2026-01", kwh: 333.33 },
        ],
        insights: {
          stitchedMonth: {
            mode: "PRIOR_YEAR_TAIL",
            yearMonth: "2026-01",
            haveDaysThrough: 31,
            missingDaysFrom: 0,
            missingDaysTo: 0,
            borrowedFromYearMonth: "2025-01",
            completenessRule: "test",
          },
        },
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
      rebuildArtifact: false,
      includeFreshCompareCalc: false,
    });

    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.simulatedChartDaily).toEqual([
        { date: "2026-01-01", simKwh: 9.99, source: "SIMULATED" },
      ]);
      expect(out.simulatedChartMonthly).toEqual([{ month: "2026-01", kwh: 333.33 }]);
      expect(out.simulatedChartMonthly.find((m) => m.month === "2025-12")).toBeUndefined();
      expect(out.simulatedChartStitchedMonth?.yearMonth).toBe("2026-01");
      expect((out.modelAssumptions as any)?.gapfillDisplayDailySource).toBe("dataset.daily");
      expect((out.modelAssumptions as any)?.gapfillDisplayMonthlySource).toBe("dataset.monthly");
    }
  });

  it("falls back to interval rebucketing only when restored daily/monthly rows are unavailable", async () => {
    getCachedPastDataset.mockResolvedValue({
      inputHash: "hash-display-fallback",
      datasetJson: {
        summary: { source: "SIMULATED", intervalsCount: 96, totalKwh: 0.75, start: "2026-01-01", end: "2026-01-01" },
        meta: {
          curveShapingVersion: "shared_curve_v2",
          excludedDateKeysFingerprint: "",
        },
        daily: [],
        monthly: [],
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
      rebuildArtifact: false,
      includeFreshCompareCalc: false,
    });

    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.simulatedChartDaily.length).toBeGreaterThan(0);
      expect(out.simulatedChartMonthly.length).toBeGreaterThan(0);
      expect((out.modelAssumptions as any)?.gapfillDisplayDailySource).toBe("interval_rebucket_fallback");
      expect((out.modelAssumptions as any)?.gapfillDisplayMonthlySource).toBe("interval_rebucket_fallback");
    }
  });

  it("uses fresh shared calc intervals for scoring and exposes parity proof metadata", async () => {
    getCachedPastDataset.mockResolvedValue({
      inputHash: "hash-fresh-compare",
      datasetJson: {
        summary: { source: "SIMULATED", intervalsCount: 96, totalKwh: 24, start: "2026-01-01", end: "2026-01-01" },
        meta: {
          curveShapingVersion: "shared_curve_v2",
          excludedDateKeysFingerprint: "",
          weatherSourceSummary: "actual_only",
        },
        daily: [{ date: "2026-01-01", kwh: 24, source: "SIMULATED" }],
        monthly: [{ month: "2026-01", kwh: 24 }],
        series: {},
      },
      intervalsCodec: "v1_delta_varint",
      intervalsCompressed: Buffer.from("00", "hex"),
    });
    simulatePastUsageDataset.mockResolvedValue({
      dataset: {
        summary: { source: "SIMULATED", intervalsCount: 96, totalKwh: 24, start: "2026-01-01", end: "2026-01-01" },
        meta: { weatherSourceSummary: "actual_only" },
        daily: [{ date: "2026-01-01", kwh: 24, source: "SIMULATED" }],
        monthly: [{ month: "2026-01", kwh: 24 }],
        series: { intervals15: oneDayIntervals96(24 / 72) },
      },
      simulatedDayResults: [],
      actualWxByDateKey: new Map(),
    });

    const out = await buildGapfillCompareSimShared({
      userId: "u1",
      houseId: "h1",
      timezone: "America/Chicago",
      canonicalWindow: { startDate: "2026-01-01", endDate: "2026-01-01" },
      testDateKeysLocal: new Set<string>(["2026-01-01"]),
      rebuildArtifact: false,
      includeFreshCompareCalc: true,
    });

    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.scoringSimulatedSource).toBe("shared_fresh_simulated_intervals15");
      expect(out.compareSimSource).toBe("shared_fresh_calc");
      expect(out.compareCalculationScope).toBe("full_window_shared_path_then_scored_day_filter");
      expect(out.comparePulledFromSharedArtifactOnly).toBe(false);
      expect(out.compareSharedCalcPath).toContain("getPastSimulatedDatasetForHouse");
      expect(out.displayVsFreshParityForScoredDays?.matches).toBe(true);
      expect(out.displayVsFreshParityForScoredDays?.mismatchCount).toBe(0);
      expect(out.displayVsFreshParityForScoredDays?.scope).toBe("scored_test_days_local");
      expect(out.displayVsFreshParityForScoredDays?.granularity).toBe("daily_kwh_rounded_2dp");
      expect(out.weatherBasisUsed).toBe("actual_only");
    }
  });

  it("returns deterministic fresh compare outputs across repeated calls with identical inputs", async () => {
    getCachedPastDataset.mockResolvedValue({
      inputHash: "hash-fresh-repeat",
      datasetJson: {
        summary: { source: "SIMULATED", intervalsCount: 96, totalKwh: 24, start: "2026-01-01", end: "2026-01-01" },
        meta: { curveShapingVersion: "shared_curve_v2", excludedDateKeysFingerprint: "", weatherSourceSummary: "actual_only" },
        daily: [{ date: "2026-01-01", kwh: 24, source: "SIMULATED" }],
        monthly: [{ month: "2026-01", kwh: 24 }],
        series: {},
      },
      intervalsCodec: "v1_delta_varint",
      intervalsCompressed: Buffer.from("00", "hex"),
    });
    simulatePastUsageDataset.mockResolvedValue({
      dataset: {
        summary: { source: "SIMULATED", intervalsCount: 96, totalKwh: 24, start: "2026-01-01", end: "2026-01-01" },
        meta: { weatherSourceSummary: "actual_only" },
        daily: [{ date: "2026-01-01", kwh: 24, source: "SIMULATED" }],
        monthly: [{ month: "2026-01", kwh: 24 }],
        series: { intervals15: oneDayIntervals96(24 / 72) },
      },
      simulatedDayResults: [],
      actualWxByDateKey: new Map(),
    });
    const commonArgs = {
      userId: "u1",
      houseId: "h1",
      timezone: "America/Chicago",
      canonicalWindow: { startDate: "2026-01-01", endDate: "2026-01-01" },
      testDateKeysLocal: new Set<string>(["2026-01-01"]),
      rebuildArtifact: false,
      includeFreshCompareCalc: true,
    } as const;

    const outA = await buildGapfillCompareSimShared(commonArgs);
    const outB = await buildGapfillCompareSimShared(commonArgs);
    expect(outA.ok).toBe(true);
    expect(outB.ok).toBe(true);
    if (outA.ok && outB.ok) {
      expect(outA.simulatedTestIntervals).toEqual(outB.simulatedTestIntervals);
      expect(outA.displayVsFreshParityForScoredDays).toEqual(outB.displayVsFreshParityForScoredDays);
      expect(outA.compareCalculationScope).toBe("full_window_shared_path_then_scored_day_filter");
      expect(outB.compareCalculationScope).toBe("full_window_shared_path_then_scored_day_filter");
    }
  });

  it("surfaces parity mismatches when display artifact rows diverge from fresh shared-path scoring days", async () => {
    getCachedPastDataset.mockResolvedValue({
      inputHash: "hash-fresh-parity-mismatch",
      datasetJson: {
        summary: { source: "SIMULATED", intervalsCount: 96, totalKwh: 99, start: "2026-01-01", end: "2026-01-01" },
        meta: { curveShapingVersion: "shared_curve_v2", excludedDateKeysFingerprint: "", weatherSourceSummary: "actual_only" },
        daily: [{ date: "2026-01-01", kwh: 99, source: "SIMULATED" }],
        monthly: [{ month: "2026-01", kwh: 99 }],
        series: {},
      },
      intervalsCodec: "v1_delta_varint",
      intervalsCompressed: Buffer.from("00", "hex"),
    });
    simulatePastUsageDataset.mockResolvedValue({
      dataset: {
        summary: { source: "SIMULATED", intervalsCount: 96, totalKwh: 24, start: "2026-01-01", end: "2026-01-01" },
        meta: { weatherSourceSummary: "actual_only" },
        daily: [{ date: "2026-01-01", kwh: 24, source: "SIMULATED" }],
        monthly: [{ month: "2026-01", kwh: 24 }],
        series: { intervals15: oneDayIntervals96(24 / 72) },
      },
      simulatedDayResults: [],
      actualWxByDateKey: new Map(),
    });

    const out = await buildGapfillCompareSimShared({
      userId: "u1",
      houseId: "h1",
      timezone: "America/Chicago",
      canonicalWindow: { startDate: "2026-01-01", endDate: "2026-01-01" },
      testDateKeysLocal: new Set<string>(["2026-01-01"]),
      rebuildArtifact: false,
      includeFreshCompareCalc: true,
    });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.displayVsFreshParityForScoredDays?.matches).toBe(false);
      expect(out.displayVsFreshParityForScoredDays?.mismatchCount).toBe(1);
      expect(out.displayVsFreshParityForScoredDays?.mismatchSampleDates).toEqual(["2026-01-01"]);
    }
  });

  it("keeps scored-day simulated value aligned between selected-days default and heavy full-window mode", async () => {
    getCachedPastDataset.mockResolvedValue({
      inputHash: "hash-selected-vs-heavy",
      datasetJson: {
        summary: { source: "SIMULATED", intervalsCount: 96, totalKwh: 24, start: "2026-01-01", end: "2026-01-01" },
        meta: {
          curveShapingVersion: "shared_curve_v2",
          excludedDateKeysFingerprint: "",
          weatherSourceSummary: "actual_only",
        },
        daily: [{ date: "2026-01-01", kwh: 24, source: "SIMULATED" }],
        monthly: [{ month: "2026-01", kwh: 24 }],
        series: {},
      },
      intervalsCodec: "v1_delta_varint",
      intervalsCompressed: Buffer.from("00", "hex"),
    });
    decodeIntervalsV1.mockReturnValue(oneDayIntervals96(24 / 72));
    simulatePastSelectedDaysShared.mockResolvedValue({
      simulatedIntervals: oneDayIntervals96(24 / 72),
      simulatedDayResults: [],
      pastDayCounts: {},
      weatherSourceSummary: "actual_only",
      weatherKindUsed: "ACTUAL_LAST_YEAR",
    });
    simulatePastUsageDataset.mockResolvedValue({
      dataset: {
        summary: { source: "SIMULATED", intervalsCount: 96, totalKwh: 24, start: "2026-01-01", end: "2026-01-01" },
        meta: { weatherSourceSummary: "actual_only" },
        daily: [{ date: "2026-01-01", kwh: 24, source: "SIMULATED" }],
        monthly: [{ month: "2026-01", kwh: 24 }],
        series: { intervals15: oneDayIntervals96(24 / 72) },
      },
      simulatedDayResults: [],
      actualWxByDateKey: new Map(),
    });

    const sharedArgs = {
      userId: "u1",
      houseId: "h1",
      timezone: "America/Chicago",
      canonicalWindow: { startDate: "2026-01-01", endDate: "2026-01-01" },
      testDateKeysLocal: new Set<string>(["2026-01-01"]),
      rebuildArtifact: false,
    } as const;

    const selectedOut = await buildGapfillCompareSimShared({
      ...sharedArgs,
      compareFreshMode: "selected_days",
      includeFreshCompareCalc: false,
    });
    const heavyOut = await buildGapfillCompareSimShared({
      ...sharedArgs,
      compareFreshMode: "full_window",
      includeFreshCompareCalc: true,
    });

    expect(selectedOut.ok).toBe(true);
    expect(heavyOut.ok).toBe(true);
    if (selectedOut.ok && heavyOut.ok) {
      const selectedDayKwh = selectedOut.simulatedTestIntervals.reduce((s, p) => s + (Number(p.kwh) || 0), 0);
      const heavyDayKwh = heavyOut.simulatedTestIntervals.reduce((s, p) => s + (Number(p.kwh) || 0), 0);
      expect(Math.round(selectedDayKwh * 100) / 100).toBe(Math.round(heavyDayKwh * 100) / 100);
    }
  });
});

describe("buildPastSimulatedBaselineV1 forced selected-day parity", () => {
  it("keeps present actual slots when a forced day is also incomplete", () => {
    const day1StartMs = new Date("2026-01-01T00:00:00.000Z").getTime();
    const day2StartMs = new Date("2026-01-02T00:00:00.000Z").getTime();
    const day1Grid = getDayGridTimestamps(day1StartMs);
    const day2Grid = getDayGridTimestamps(day2StartMs);

    const actualIntervals: Array<{ timestamp: string; kwh: number }> = [
      ...day1Grid.map((ts) => ({ timestamp: ts, kwh: 1 })),
      ...day2Grid.slice(0, 12).map((ts, idx) => ({ timestamp: ts, kwh: 3 + idx / 100 })),
    ];
    const actualByTs = new Map(actualIntervals.map((p) => [p.timestamp, p.kwh] as const));

    const out = buildPastSimulatedBaselineV1({
      actualIntervals,
      canonicalDayStartsMs: [day1StartMs, day2StartMs],
      excludedDateKeys: new Set<string>(),
      dateKeyFromTimestamp,
      getDayGridTimestamps,
      collectSimulatedDayResults: true,
      forceSimulateDateKeys: new Set<string>(["2026-01-02"]),
      emitAllIntervals: false,
    });

    expect(out.intervals.length).toBe(96);
    const simulatedDay2 = out.intervals.filter((p) => dateKeyFromTimestamp(p.timestamp) === "2026-01-02");
    expect(simulatedDay2.length).toBe(96);
    for (const ts of day2Grid.slice(0, 12)) {
      expect(simulatedDay2.find((p) => p.timestamp === ts)?.kwh).toBe(actualByTs.get(ts));
    }
  });

  it("matches full-window excluded-day intervals and fallback diagnostics", () => {
    const day1StartMs = new Date("2026-01-01T00:00:00.000Z").getTime();
    const day2StartMs = new Date("2026-01-02T00:00:00.000Z").getTime();
    const day3StartMs = new Date("2026-01-03T00:00:00.000Z").getTime();
    const day1Grid = getDayGridTimestamps(day1StartMs);
    const day2Grid = getDayGridTimestamps(day2StartMs);
    const day3Grid = getDayGridTimestamps(day3StartMs);

    const actualIntervals: Array<{ timestamp: string; kwh: number }> = [
      ...day1Grid.map((ts, idx) => ({ timestamp: ts, kwh: 0.5 + (idx % 8) * 0.02 })),
      ...day3Grid.map((ts, idx) => ({ timestamp: ts, kwh: 0.35 + (idx % 6) * 0.03 })),
    ];
    const targetDate = dateKeyFromTimestamp(day2Grid[0]!);
    const excludedDateKeys = new Set<string>([targetDate]);
    const commonArgs = {
      actualIntervals,
      canonicalDayStartsMs: [day1StartMs, day2StartMs, day3StartMs],
      excludedDateKeys,
      dateKeyFromTimestamp,
      getDayGridTimestamps,
      collectSimulatedDayResults: true,
      actualWxByDateKey: new Map<string, { tAvgF: number; tMinF: number; tMaxF: number; hdd65: number; cdd65: number }>([
        ["2026-01-01", { tAvgF: 42, tMinF: 33, tMaxF: 52, hdd65: 23, cdd65: 0 }],
        ["2026-01-02", { tAvgF: 41, tMinF: 31, tMaxF: 50, hdd65: 24, cdd65: 0 }],
        ["2026-01-03", { tAvgF: 45, tMinF: 35, tMaxF: 54, hdd65: 20, cdd65: 0 }],
      ]),
    };

    const fullWindow = buildPastSimulatedBaselineV1({
      ...commonArgs,
      emitAllIntervals: true,
    });
    const selectedDays = buildPastSimulatedBaselineV1({
      ...commonArgs,
      forceSimulateDateKeys: new Set<string>([targetDate]),
      emitAllIntervals: false,
    });

    const fullTargetIntervals = fullWindow.intervals.filter((p) => dateKeyFromTimestamp(p.timestamp) === targetDate);
    const selectedTargetIntervals = selectedDays.intervals.filter((p) => dateKeyFromTimestamp(p.timestamp) === targetDate);
    expect(selectedTargetIntervals.length).toBe(96);
    expect(fullTargetIntervals.length).toBe(96);
    expect(selectedTargetIntervals).toEqual(fullTargetIntervals);

    const fullTargetResult = fullWindow.dayResults.find((r) => String(r.localDate).slice(0, 10) === targetDate);
    const selectedTargetResult = selectedDays.dayResults.find((r) => String(r.localDate).slice(0, 10) === targetDate);
    expect(selectedTargetResult).toBeTruthy();
    expect(fullTargetResult).toBeTruthy();
    expect(selectedTargetResult?.fallbackLevel).toBe(fullTargetResult?.fallbackLevel);
    expect(selectedTargetResult?.targetDayKwhBeforeWeather).toBeCloseTo(fullTargetResult?.targetDayKwhBeforeWeather ?? 0, 9);
    expect(selectedTargetResult?.shapeVariantUsed).toBe(fullTargetResult?.shapeVariantUsed);
    expect(selectedTargetResult?.dayTypeUsed).toBe(fullTargetResult?.dayTypeUsed);
    expect(selectedTargetResult?.weatherRegimeUsed).toBe(fullTargetResult?.weatherRegimeUsed);
    expect(selectedTargetResult?.dayClassification).toBe(fullTargetResult?.dayClassification);
  });

  it("stays aligned with full-window in sparse reference-pool conditions", () => {
    const day1StartMs = new Date("2026-02-01T00:00:00.000Z").getTime();
    const day2StartMs = new Date("2026-02-02T00:00:00.000Z").getTime();
    const day3StartMs = new Date("2026-02-03T00:00:00.000Z").getTime();
    const day1Grid = getDayGridTimestamps(day1StartMs);
    const day2Grid = getDayGridTimestamps(day2StartMs);
    const day3Grid = getDayGridTimestamps(day3StartMs);

    const actualIntervals: Array<{ timestamp: string; kwh: number }> = [
      ...day1Grid.map((ts, idx) => ({ timestamp: ts, kwh: 0.6 + (idx % 12) * 0.015 })),
    ];
    const targetDate = dateKeyFromTimestamp(day2Grid[0]!);
    const excludedDateKeys = new Set<string>([targetDate, dateKeyFromTimestamp(day3Grid[0]!)]);
    const commonArgs = {
      actualIntervals,
      canonicalDayStartsMs: [day1StartMs, day2StartMs, day3StartMs],
      excludedDateKeys,
      dateKeyFromTimestamp,
      getDayGridTimestamps,
      collectSimulatedDayResults: true,
      actualWxByDateKey: new Map<string, { tAvgF: number; tMinF: number; tMaxF: number; hdd65: number; cdd65: number }>([
        ["2026-02-01", { tAvgF: 49, tMinF: 39, tMaxF: 58, hdd65: 16, cdd65: 0 }],
        ["2026-02-02", { tAvgF: 47, tMinF: 37, tMaxF: 56, hdd65: 18, cdd65: 0 }],
        ["2026-02-03", { tAvgF: 44, tMinF: 34, tMaxF: 53, hdd65: 21, cdd65: 0 }],
      ]),
    };

    const fullWindow = buildPastSimulatedBaselineV1({
      ...commonArgs,
      emitAllIntervals: true,
    });
    const selectedDays = buildPastSimulatedBaselineV1({
      ...commonArgs,
      forceSimulateDateKeys: new Set<string>([targetDate]),
      emitAllIntervals: false,
    });

    const fullTargetIntervals = fullWindow.intervals.filter((p) => dateKeyFromTimestamp(p.timestamp) === targetDate);
    const selectedTargetIntervals = selectedDays.intervals.filter((p) => dateKeyFromTimestamp(p.timestamp) === targetDate);
    expect(selectedTargetIntervals).toEqual(fullTargetIntervals);

    const fullTargetResult = fullWindow.dayResults.find((r) => String(r.localDate).slice(0, 10) === targetDate);
    const selectedTargetResult = selectedDays.dayResults.find((r) => String(r.localDate).slice(0, 10) === targetDate);
    expect(selectedTargetResult?.fallbackLevel).toBe(fullTargetResult?.fallbackLevel);
    expect(selectedTargetResult?.shapeVariantUsed).toBe(fullTargetResult?.shapeVariantUsed);
    expect(selectedTargetResult?.targetDayKwhBeforeWeather).toBeCloseTo(fullTargetResult?.targetDayKwhBeforeWeather ?? 0, 9);
  });

  it("is deterministic for repeated selected-day execution and diagnostics", () => {
    const day1StartMs = new Date("2026-03-01T00:00:00.000Z").getTime();
    const day2StartMs = new Date("2026-03-02T00:00:00.000Z").getTime();
    const day3StartMs = new Date("2026-03-03T00:00:00.000Z").getTime();
    const day1Grid = getDayGridTimestamps(day1StartMs);
    const day2Grid = getDayGridTimestamps(day2StartMs);
    const day3Grid = getDayGridTimestamps(day3StartMs);

    const actualIntervals: Array<{ timestamp: string; kwh: number }> = [
      ...day1Grid.map((ts, idx) => ({ timestamp: ts, kwh: 0.42 + (idx % 5) * 0.011 })),
      ...day3Grid.map((ts, idx) => ({ timestamp: ts, kwh: 0.37 + (idx % 7) * 0.009 })),
      ...day2Grid.slice(0, 8).map((ts, idx) => ({ timestamp: ts, kwh: 0.8 + idx * 0.01 })),
    ];
    const targetDate = dateKeyFromTimestamp(day2Grid[0]!);

    const run = () =>
      buildPastSimulatedBaselineV1({
        actualIntervals,
        canonicalDayStartsMs: [day1StartMs, day2StartMs, day3StartMs],
        excludedDateKeys: new Set<string>(),
        dateKeyFromTimestamp,
        getDayGridTimestamps,
        collectSimulatedDayResults: true,
        forceSimulateDateKeys: new Set<string>([targetDate]),
        emitAllIntervals: false,
        actualWxByDateKey: new Map<string, { tAvgF: number; tMinF: number; tMaxF: number; hdd65: number; cdd65: number }>([
          ["2026-03-01", { tAvgF: 61, tMinF: 50, tMaxF: 71, hdd65: 4, cdd65: 0 }],
          ["2026-03-02", { tAvgF: 64, tMinF: 53, tMaxF: 73, hdd65: 1, cdd65: 0 }],
          ["2026-03-03", { tAvgF: 66, tMinF: 55, tMaxF: 75, hdd65: 0, cdd65: 1 }],
        ]),
      });

    const first = run();
    const second = run();
    expect(first.intervals).toEqual(second.intervals);
    expect(first.dayResults).toEqual(second.dayResults);
  });
});

