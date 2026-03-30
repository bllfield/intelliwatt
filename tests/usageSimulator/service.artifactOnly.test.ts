import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildPastSimulatedBaselineV1 } from "@/modules/simulatedUsage/engine";
import { dateKeyFromTimestamp, getDayGridTimestamps } from "@/modules/usageSimulator/pastStitchedCurve";
import { resolveCanonicalUsage365CoverageWindow } from "@/modules/usageSimulator/metadataWindow";
import * as usageDatasetModule from "@/modules/usageSimulator/dataset";

vi.mock("server-only", () => ({}));

const { logPipeline } = vi.hoisted(() => ({
  logPipeline: vi.fn(),
}));

vi.mock("@/modules/usageSimulator/simObservability", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/modules/usageSimulator/simObservability")>();
  return { ...mod, logSimPipelineEvent: logPipeline };
});

const scenarioFindFirst = vi.fn();
const usageSimulatorBuildFindUnique = vi.fn();
const getHouseAddressForUserHouse = vi.fn();
const computePastInputHash = vi.fn();
const getCachedPastDataset = vi.fn();
const getLatestCachedPastDatasetByScenario = vi.fn();
const saveCachedPastDataset = vi.fn();
const simulatePastFullWindowShared = vi.fn();
const simulatePastUsageDataset = vi.fn();
const simulatePastSelectedDaysShared = vi.fn();
const loadWeatherForPastWindow = vi.fn();
const encodeIntervalsV1 = vi.fn();
const decodeIntervalsV1 = vi.fn();
const getIntervalDataFingerprint = vi.fn();
const computePastWeatherIdentity = vi.fn();
const getUsageShapeProfileIdentityForPast = vi.fn();
const ensureUsageShapeProfileForSharedSimulation = vi.fn();

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
  quantizeIntervalKwhForCodec: (kwh: number) => {
    const raw = Math.max(0, Number(kwh) || 0);
    return Math.round(raw * 1000) / 1000;
  },
  INTERVAL_CODEC_V1: "v1_delta_varint",
}));

vi.mock("@/modules/simulatedUsage/simulatePastUsageDataset", () => ({
  simulatePastFullWindowShared: (...args: any[]) => simulatePastFullWindowShared(...args),
  simulatePastUsageDataset: (...args: any[]) => simulatePastUsageDataset(...args),
  simulatePastSelectedDaysShared: (...args: any[]) => simulatePastSelectedDaysShared(...args),
  ensureUsageShapeProfileForSharedSimulation: (...args: any[]) =>
    ensureUsageShapeProfileForSharedSimulation(...args),
  getUsageShapeProfileIdentityForPast: (...args: any[]) => getUsageShapeProfileIdentityForPast(...args),
  loadWeatherForPastWindow: (...args: any[]) => loadWeatherForPastWindow(...args),
}));

vi.mock("@/lib/usage/actualDatasetForHouse", () => ({
  getActualUsageDatasetForHouse: vi.fn(),
  getIntervalDataFingerprint: (...args: any[]) => getIntervalDataFingerprint(...args),
}));

vi.mock("@/modules/weather/identity", () => ({
  computePastWeatherIdentity: (...args: any[]) => computePastWeatherIdentity(...args),
}));

import {
  buildGapfillCompareSimShared,
  emitRecalcPreIntervalStageEvent,
  getSimulatedUsageForHouseScenario,
  resolveSharedPastRecalcWindow,
  rebuildGapfillSharedPastArtifact,
  shouldWarmValidationSelectionPreload,
  type GapfillCompareBuildPhase,
} from "@/modules/usageSimulator/service";

describe("resolveSharedPastRecalcWindow", () => {
  it("uses SMT anchor window when available so selection and simulation can align", () => {
    const out = resolveSharedPastRecalcWindow({
      mode: "SMT_BASELINE",
      canonicalMonths: ["2025-03", "2026-02"],
      smtAnchorPeriods: [{ startDate: "2025-03-14", endDate: "2026-03-13" }],
    });
    expect(out).toMatchObject({
      startDate: "2025-03-14",
      endDate: "2026-03-13",
      source: "smt_anchor",
    });
  });

  it("falls back to canonical month range when no SMT anchor exists", () => {
    const out = resolveSharedPastRecalcWindow({
      mode: "SMT_BASELINE",
      canonicalMonths: ["2025-03", "2026-02"],
      smtAnchorPeriods: undefined,
    });
    expect(out).toMatchObject({
      startDate: "2025-03-01",
      endDate: "2026-02-28",
      source: "canonical_month_range",
    });
  });

  it("uses canonical coverage window for MANUAL_TOTALS (regression guard for window-lock rule)", () => {
    const canonicalCoverage = resolveCanonicalUsage365CoverageWindow();
    const out = resolveSharedPastRecalcWindow({
      mode: "MANUAL_TOTALS",
      canonicalMonths: ["2025-03", "2026-02"],
      smtAnchorPeriods: undefined,
    });
    expect(out).toMatchObject({
      startDate: canonicalCoverage.startDate,
      endDate: canonicalCoverage.endDate,
      source: "canonical_coverage_fallback",
    });
  });

  it("uses canonical coverage window for NEW_BUILD_ESTIMATE (regression guard for window-lock rule)", () => {
    const canonicalCoverage = resolveCanonicalUsage365CoverageWindow();
    const out = resolveSharedPastRecalcWindow({
      mode: "NEW_BUILD_ESTIMATE",
      canonicalMonths: ["2025-03", "2026-02"],
      smtAnchorPeriods: undefined,
    });
    expect(out).toMatchObject({
      startDate: canonicalCoverage.startDate,
      endDate: canonicalCoverage.endDate,
      source: "canonical_coverage_fallback",
    });
  });
});

describe("shouldWarmValidationSelectionPreload", () => {
  it("warms preload for Past SMT_BASELINE when validation keys are provided", () => {
    expect(
      shouldWarmValidationSelectionPreload({
        mode: "SMT_BASELINE",
        scenarioName: "Past (Corrected)",
        hasPreloadContext: true,
        hasValidationDateKeys: true,
        alreadyUsedSelectionPreload: false,
      })
    ).toBe(true);
  });

  it("does not warm preload when selection preload was already used", () => {
    expect(
      shouldWarmValidationSelectionPreload({
        mode: "SMT_BASELINE",
        scenarioName: "Past (Corrected)",
        hasPreloadContext: true,
        hasValidationDateKeys: true,
        alreadyUsedSelectionPreload: true,
      })
    ).toBe(false);
  });
});

describe("emitRecalcPreIntervalStageEvent", () => {
  it("emits structured pre-interval stage payload with admin source/test-home context", () => {
    emitRecalcPreIntervalStageEvent({
      event: "recalc_pre_interval_core_context_start",
      correlationId: "cid-1",
      houseId: "test-home-1",
      actualContextHouseId: "source-home-1",
      scenarioId: "s1",
      mode: "SMT_BASELINE",
      durationMs: 12,
    });
    const stage = logPipeline.mock.calls.find((c) => c[0] === "recalc_pre_interval_core_context_start");
    expect(stage?.[1]).toMatchObject({
      correlationId: "cid-1",
      houseId: "test-home-1",
      sourceHouseId: "source-home-1",
      testHomeId: "test-home-1",
      scenarioId: "s1",
      mode: "SMT_BASELINE",
      durationMs: 12,
      source: "recalcSimulatorBuildImpl",
    });
  });
});

describe("getSimulatedUsageForHouseScenario artifact_only", () => {
  beforeEach(() => {
    logPipeline.mockClear();
    scenarioFindFirst.mockReset();
    usageSimulatorBuildFindUnique.mockReset();
    getHouseAddressForUserHouse.mockReset();
    computePastInputHash.mockReset();
    getCachedPastDataset.mockReset();
    getLatestCachedPastDatasetByScenario.mockReset();
    saveCachedPastDataset.mockReset();
    simulatePastFullWindowShared.mockReset();
    simulatePastUsageDataset.mockReset();
    simulatePastSelectedDaysShared.mockReset();
    loadWeatherForPastWindow.mockReset();
    encodeIntervalsV1.mockReset();
    decodeIntervalsV1.mockReset();
    getIntervalDataFingerprint.mockReset();
    computePastWeatherIdentity.mockReset();
    getUsageShapeProfileIdentityForPast.mockReset();
    ensureUsageShapeProfileForSharedSimulation.mockReset();

    getHouseAddressForUserHouse.mockResolvedValue({ id: "h1", esiid: "1044" });
    scenarioFindFirst.mockResolvedValue({ id: "gapfill_lab", name: "Past (Corrected)" });
    usageSimulatorBuildFindUnique.mockResolvedValue({
      buildInputs: {
        mode: "SMT_BASELINE",
        canonicalMonths: ["2026-01"],
        timezone: "America/Chicago",
        travelRanges: [],
        validationOnlyDateKeysLocal: ["2026-01-01"],
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
    ensureUsageShapeProfileForSharedSimulation.mockResolvedValue({
      usageShapeProfileSnap: {
        weekdayAvgByMonthKey: { "2026-01": 1 },
        weekendAvgByMonthKey: { "2026-01": 1 },
      },
      usageShapeProfileDiag: {
        found: true,
        id: "shape-1",
        version: "1",
        derivedAt: "2026-01-01T00:00:00.000Z",
        windowStartUtc: "2026-01-01",
        windowEndUtc: "2026-01-31",
        profileMonthKeys: ["2026-01"],
        weekdayAvgLen: 1,
        weekendAvgLen: 1,
        canonicalMonths: ["2026-01"],
        canonicalMonthsLen: 1,
        inlineDerivedFromActual: false,
        reasonNotUsed: null,
        ensuredInFlow: false,
        ensureAttempted: false,
        ensuredReason: null,
        ensureFailedReason: null,
        ensuredProfileId: "shape-1",
        canonicalCoverageStartDate: "2025-03-23",
        canonicalCoverageEndDate: "2026-03-22",
      },
      profileAutoBuilt: false,
      error: null,
    });
    encodeIntervalsV1.mockReturnValue({ bytes: Buffer.from("00", "hex") });
    decodeIntervalsV1.mockReturnValue([
      { timestamp: "2026-01-01T00:00:00.000Z", kwh: 0.25 },
      { timestamp: "2026-01-01T00:15:00.000Z", kwh: 0.5 },
    ]);
    loadWeatherForPastWindow.mockImplementation(async ({ canonicalDateKeys }: any) => ({
      actualWxByDateKey: new Map(
        (canonicalDateKeys ?? []).map((dateKey: string) => [
          dateKey,
          { tAvgF: 50, tMinF: 40, tMaxF: 60, hdd65: 15, cdd65: 0, source: "OPEN_METEO" },
        ])
      ),
      normalWxByDateKey: new Map(),
      provenance: {
        weatherKindUsed: "ACTUAL_LAST_YEAR",
        weatherSourceSummary: "actual_only",
        weatherFallbackReason: null,
        weatherProviderName: "OPEN_METEO",
        weatherCoverageStart: canonicalDateKeys?.[0] ?? null,
        weatherCoverageEnd: canonicalDateKeys?.[(canonicalDateKeys?.length ?? 1) - 1] ?? null,
        weatherStubRowCount: 0,
        weatherActualRowCount: Array.isArray(canonicalDateKeys) ? canonicalDateKeys.length : 0,
      },
    }));
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

  it("emits compareProjection measurement events with correlationId, durationMs, and memoryRssMb (Slice 11)", async () => {
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

    const cid = "33333333-3333-4333-8333-333333333333";
    const out = await getSimulatedUsageForHouseScenario({
      userId: "u1",
      houseId: "h1",
      scenarioId: "gapfill_lab",
      readMode: "artifact_only",
      correlationId: cid,
    });

    expect(out.ok).toBe(true);
    const startEv = logPipeline.mock.calls.find((c) => c[0] === "compareProjection_start");
    const okEv = logPipeline.mock.calls.find((c) => c[0] === "compareProjection_success");
    expect(startEv?.[1]).toMatchObject({ correlationId: cid, houseId: "h1" });
    expect(okEv?.[1]).toMatchObject({ correlationId: cid });
    expect(typeof (okEv?.[1] as { durationMs?: unknown })?.durationMs).toBe("number");
    expect(okEv?.[1]).toHaveProperty("memoryRssMb");
  });

  it("preserves restored canonical summary totals instead of overwriting them from decoded intervals", async () => {
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
      expect(out.dataset?.summary?.totalKwh).toBe(9999.99);
      expect(out.dataset?.totals?.importKwh).toBe(9999.99);
      expect(out.dataset?.totals?.netKwh).toBe(9999.99);
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
        validationOnlyDateKeysLocal: ["2026-01-01"],
      },
    });
    getCachedPastDataset.mockResolvedValueOnce(null);
    simulatePastUsageDataset.mockResolvedValueOnce({
      dataset: {
        summary: { source: "SIMULATED", intervalsCount: 2, totalKwh: 0.75, start: "2026-01-01", end: "2026-01-01" },
        meta: {
          curveShapingVersion: "shared_curve_v2",
          canonicalArtifactSimulatedDayTotalsByDate: { "2026-01-01": 0.75 },
        },
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
    const savedCanonicalDayTotals =
      ((saved as any).datasetJson?.canonicalArtifactSimulatedDayTotalsByDate as Record<string, unknown> | undefined) ??
      (savedMeta.canonicalArtifactSimulatedDayTotalsByDate as Record<string, unknown> | undefined);
    expect(typeof savedMeta.excludedDateKeysFingerprint).toBe("string");
    expect(typeof savedMeta.excludedDateKeysCount).toBe("number");
    expect(savedCanonicalDayTotals).toEqual({
      "2026-01-01": 0.75,
    });
  });
});

describe("rebuildGapfillSharedPastArtifact exact handoff", () => {
  beforeEach(() => {
    scenarioFindFirst.mockReset();
    usageSimulatorBuildFindUnique.mockReset();
    getHouseAddressForUserHouse.mockReset();
    computePastInputHash.mockReset();
    getCachedPastDataset.mockReset();
    getLatestCachedPastDatasetByScenario.mockReset();
    saveCachedPastDataset.mockReset();
    simulatePastFullWindowShared.mockReset();
    simulatePastUsageDataset.mockReset();
    simulatePastSelectedDaysShared.mockReset();
    loadWeatherForPastWindow.mockReset();
    encodeIntervalsV1.mockReset();
    decodeIntervalsV1.mockReset();
    getIntervalDataFingerprint.mockReset();
    computePastWeatherIdentity.mockReset();
    getUsageShapeProfileIdentityForPast.mockReset();
    ensureUsageShapeProfileForSharedSimulation.mockReset();

    scenarioFindFirst.mockResolvedValue({ id: "past-s1", name: "Past (Corrected)" });
    getHouseAddressForUserHouse.mockResolvedValue({ id: "h1", esiid: "1044" });
    usageSimulatorBuildFindUnique.mockResolvedValue({
      buildInputs: {
        mode: "SMT_BASELINE",
        canonicalMonths: ["2026-01"],
        timezone: "America/Chicago",
        travelRanges: [{ startDate: "2026-01-01", endDate: "2026-01-02" }],
      },
    });
    computePastInputHash.mockReturnValue("hash-rebuilt-exact");
    getIntervalDataFingerprint.mockResolvedValue("fp-a");
    computePastWeatherIdentity.mockResolvedValue("wx-a");
    getUsageShapeProfileIdentityForPast.mockResolvedValue({
      usageShapeProfileId: "shape-1",
      usageShapeProfileVersion: "1",
      usageShapeProfileDerivedAt: "2026-01-01T00:00:00.000Z",
      usageShapeProfileSimHash: "shape-hash-1",
    });
    ensureUsageShapeProfileForSharedSimulation.mockResolvedValue({
      usageShapeProfileSnap: {
        weekdayAvgByMonthKey: { "2026-01": 1 },
        weekendAvgByMonthKey: { "2026-01": 1 },
      },
      usageShapeProfileDiag: {
        found: true,
        id: "shape-1",
        version: "1",
        derivedAt: "2026-01-01T00:00:00.000Z",
        windowStartUtc: "2026-01-01",
        windowEndUtc: "2026-01-31",
        profileMonthKeys: ["2026-01"],
        weekdayAvgLen: 1,
        weekendAvgLen: 1,
        canonicalMonths: ["2026-01"],
        canonicalMonthsLen: 1,
        inlineDerivedFromActual: false,
        reasonNotUsed: null,
        ensuredInFlow: false,
        ensureAttempted: false,
        ensuredReason: null,
        ensureFailedReason: null,
        ensuredProfileId: "shape-1",
        canonicalCoverageStartDate: "2025-03-23",
        canonicalCoverageEndDate: "2026-03-22",
      },
      profileAutoBuilt: false,
      error: null,
    });
    encodeIntervalsV1.mockReturnValue({ bytes: Buffer.from("00", "hex") });
    decodeIntervalsV1.mockReturnValue([
      { timestamp: "2026-03-14T00:00:00.000Z", kwh: 0.25 },
      { timestamp: "2026-03-14T00:15:00.000Z", kwh: 0.5 },
    ]);
  });

  it("ensures usage shape before resolving the exact artifact identity hash", async () => {
    const canonicalCoverage = resolveCanonicalUsage365CoverageWindow();
    const exactCached = {
      inputHash: "hash-rebuilt-exact",
      updatedAt: new Date("2026-03-18T00:00:00.000Z"),
      datasetJson: {
        summary: {
          source: "SIMULATED",
          intervalsCount: 2,
          totalKwh: 0.75,
          start: canonicalCoverage.startDate,
          end: canonicalCoverage.endDate,
        },
        meta: {
          curveShapingVersion: "shared_curve_v2",
          coverageStart: canonicalCoverage.startDate,
          coverageEnd: canonicalCoverage.endDate,
        },
        daily: [{ date: "2026-01-01", kwh: 0.5, source: "SIMULATED" }],
        monthly: [{ month: "2026-01", kwh: 0.75 }],
        series: {},
      },
      intervalsCodec: "v1_delta_varint",
      intervalsCompressed: Buffer.from("00", "hex"),
    };
    getCachedPastDataset.mockResolvedValueOnce(exactCached);

    await rebuildGapfillSharedPastArtifact({
      userId: "u1",
      houseId: "h1",
    });

    expect(ensureUsageShapeProfileForSharedSimulation).toHaveBeenCalledWith({
      userId: "u1",
      houseId: "h1",
      timezone: "America/Chicago",
      canonicalMonths: ["2026-01"],
    });
    expect(
      ensureUsageShapeProfileForSharedSimulation.mock.invocationCallOrder[0]
    ).toBeLessThan(getUsageShapeProfileIdentityForPast.mock.invocationCallOrder[0]);
    expect(getCachedPastDataset).toHaveBeenCalledWith({
      houseId: "h1",
      scenarioId: "past-s1",
      inputHash: "hash-rebuilt-exact",
    });
  });

  it("returns the exact rebuilt artifact identity instead of latest fallback identity", async () => {
    const canonicalCoverage = resolveCanonicalUsage365CoverageWindow();
    getCachedPastDataset
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        inputHash: "hash-rebuilt-exact",
        updatedAt: new Date("2026-03-18T00:00:00.000Z"),
        datasetJson: {
          summary: {
            source: "SIMULATED",
            intervalsCount: 2,
            totalKwh: 0.75,
            start: canonicalCoverage.startDate,
            end: canonicalCoverage.endDate,
          },
          meta: {
            curveShapingVersion: "shared_curve_v2",
            coverageStart: canonicalCoverage.startDate,
            coverageEnd: canonicalCoverage.endDate,
            canonicalArtifactSimulatedDayTotalsByDate: {
              "2026-01-01": 0.5,
              "2026-01-02": 0.25,
            },
          },
          daily: [{ date: "2026-01-01", kwh: 0.5, source: "SIMULATED" }],
          monthly: [{ month: "2026-01", kwh: 0.75 }],
          series: {},
          canonicalArtifactSimulatedDayTotalsByDate: {
            "2026-01-01": 0.5,
            "2026-01-02": 0.25,
          },
        },
        intervalsCodec: "v1_delta_varint",
        intervalsCompressed: Buffer.from("00", "hex"),
      });
    simulatePastUsageDataset.mockResolvedValue({
      dataset: {
        summary: {
          source: "SIMULATED",
          intervalsCount: 2,
          totalKwh: 0.75,
          start: canonicalCoverage.startDate,
          end: canonicalCoverage.endDate,
        },
        meta: {
          curveShapingVersion: "shared_curve_v2",
          coverageStart: canonicalCoverage.startDate,
          coverageEnd: canonicalCoverage.endDate,
          excludedDateKeysFingerprint: "2026-01-01,2026-01-02",
          excludedDateKeysCount: 2,
        },
        daily: [{ date: "2026-01-01", kwh: 99, source: "SIMULATED" }],
        monthly: [{ month: "2026-01", kwh: 77 }],
        series: {
          intervals15: [
            { timestamp: "2026-03-14T00:00:00.000Z", kwh: 0.25 },
            { timestamp: "2026-03-14T00:15:00.000Z", kwh: 0.5 },
          ],
        },
        usageBucketsByMonth: { "2026-01": { "kwh.m.all.total": 77 } },
      },
      meta: {
        curveShapingVersion: "shared_curve_v2",
      },
      pastDayCounts: {},
      shapeMonthsPresent: ["2026-01"],
      actualWxByDateKey: new Map(),
      stitchedCurve: null,
      simulatedDayResults: undefined,
    });

    const out = await rebuildGapfillSharedPastArtifact({
      userId: "u1",
      houseId: "h1",
    });

    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.rebuilt).toBe(true);
      expect(out.requestedInputHash).toBe("hash-rebuilt-exact");
      expect(out.artifactInputHashUsed).toBe("hash-rebuilt-exact");
      expect(out.artifactHashMatch).toBe(true);
      expect(out.artifactSourceMode).toBe("exact_hash_match");
    }
    expect(getCachedPastDataset).toHaveBeenNthCalledWith(2, {
      houseId: "h1",
      scenarioId: "past-s1",
      inputHash: "hash-rebuilt-exact",
    });
    expect(simulatePastUsageDataset).toHaveBeenCalledTimes(1);
    expect(saveCachedPastDataset).toHaveBeenCalledTimes(1);
    const savedAfterRebuild = saveCachedPastDataset.mock.calls[0]?.[0] ?? {};
    const savedMetaAfterRebuild = ((savedAfterRebuild as any).datasetJson?.meta ?? {}) as Record<string, unknown>;
    expect(savedMetaAfterRebuild.curveShapingVersion).toBe("shared_curve_v2");
    expect((savedAfterRebuild as any).datasetJson?.daily).toEqual([{ date: "2026-01-01", kwh: 99, source: "SIMULATED" }]);
    expect((savedAfterRebuild as any).datasetJson?.monthly).toEqual([{ month: "2026-01", kwh: 77 }]);
  });

  it("uses the exact cached artifact for artifact ensure when the persisted identity is already valid", async () => {
    const canonicalCoverage = resolveCanonicalUsage365CoverageWindow();
    const exactCached = {
      inputHash: "hash-rebuilt-exact",
      updatedAt: new Date("2026-03-18T00:00:00.000Z"),
      datasetJson: {
        summary: {
          source: "SIMULATED",
          intervalsCount: 2,
          totalKwh: 0.75,
          start: canonicalCoverage.startDate,
          end: canonicalCoverage.endDate,
        },
        meta: {
          curveShapingVersion: "shared_curve_v2",
          coverageStart: canonicalCoverage.startDate,
          coverageEnd: canonicalCoverage.endDate,
          canonicalArtifactSimulatedDayTotalsByDate: {
            "2026-01-01": 0.5,
            "2026-01-02": 0.25,
          },
        },
        daily: [{ date: "2026-01-01", kwh: 0.5, source: "SIMULATED" }],
        monthly: [{ month: "2026-01", kwh: 0.75 }],
        series: {},
        canonicalArtifactSimulatedDayTotalsByDate: {
          "2026-01-01": 0.5,
          "2026-01-02": 0.25,
        },
      },
      intervalsCodec: "v1_delta_varint",
      intervalsCompressed: Buffer.from("00", "hex"),
    };
    getCachedPastDataset
      .mockResolvedValueOnce(exactCached)
      .mockResolvedValueOnce(exactCached);

    const out = await rebuildGapfillSharedPastArtifact({
      userId: "u1",
      houseId: "h1",
    });

    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.rebuilt).toBe(false);
      expect(out.requestedInputHash).toBe("hash-rebuilt-exact");
      expect(out.artifactInputHashUsed).toBe("hash-rebuilt-exact");
      expect(out.artifactHashMatch).toBe(true);
      expect(out.artifactSourceMode).toBe("exact_hash_match");
    }
    expect(simulatePastUsageDataset).not.toHaveBeenCalled();
    expect(saveCachedPastDataset).not.toHaveBeenCalled();
    expect(getCachedPastDataset).toHaveBeenCalledTimes(1);
  });

  it("falls back to a forced rebuild when the exact cached artifact cannot be verified", async () => {
    const canonicalCoverage = resolveCanonicalUsage365CoverageWindow();
    const invalidCached = {
      inputHash: "hash-rebuilt-exact",
      updatedAt: new Date("2026-03-18T00:00:00.000Z"),
      datasetJson: {
        summary: {
          source: "SIMULATED",
          intervalsCount: 2,
          totalKwh: 0.75,
          start: "2026-01-01",
          end: "2026-01-02",
        },
        meta: {
          curveShapingVersion: "shared_curve_v2",
          coverageStart: "2026-01-01",
          coverageEnd: "2026-01-02",
        },
        daily: [{ date: "2026-01-01", kwh: 0.5, source: "SIMULATED" }],
        monthly: [{ month: "2026-01", kwh: 0.75 }],
        series: {},
      },
      intervalsCodec: "v1_delta_varint",
      intervalsCompressed: Buffer.from("00", "hex"),
    };
    const rebuiltPersisted = {
      inputHash: "hash-rebuilt-exact",
      updatedAt: new Date("2026-03-18T00:00:00.000Z"),
      datasetJson: {
        summary: {
          source: "SIMULATED",
          intervalsCount: 2,
          totalKwh: 0.75,
          start: canonicalCoverage.startDate,
          end: canonicalCoverage.endDate,
        },
        meta: {
          curveShapingVersion: "shared_curve_v2",
          coverageStart: canonicalCoverage.startDate,
          coverageEnd: canonicalCoverage.endDate,
          canonicalArtifactSimulatedDayTotalsByDate: {
            "2026-01-01": 0.5,
            "2026-01-02": 0.25,
          },
        },
        daily: [{ date: "2026-01-01", kwh: 0.5, source: "SIMULATED" }],
        monthly: [{ month: "2026-01", kwh: 0.75 }],
        series: {},
        canonicalArtifactSimulatedDayTotalsByDate: {
          "2026-01-01": 0.5,
          "2026-01-02": 0.25,
        },
      },
      intervalsCodec: "v1_delta_varint",
      intervalsCompressed: Buffer.from("00", "hex"),
    };
    getCachedPastDataset
      .mockResolvedValueOnce(invalidCached)
      .mockResolvedValueOnce(invalidCached)
      .mockResolvedValueOnce(rebuiltPersisted);
    simulatePastUsageDataset.mockResolvedValueOnce({
      dataset: {
        summary: {
          source: "SIMULATED",
          intervalsCount: 2,
          totalKwh: 0.75,
          start: canonicalCoverage.startDate,
          end: canonicalCoverage.endDate,
        },
        meta: {
          curveShapingVersion: "shared_curve_v2",
          coverageStart: canonicalCoverage.startDate,
          coverageEnd: canonicalCoverage.endDate,
          excludedDateKeysFingerprint: "2026-01-01,2026-01-02",
          excludedDateKeysCount: 2,
        },
        daily: [{ date: "2026-01-01", kwh: 0.5, source: "SIMULATED" }],
        monthly: [{ month: "2026-01", kwh: 0.75 }],
        series: {
          intervals15: [
            { timestamp: "2026-03-14T00:00:00.000Z", kwh: 0.25 },
            { timestamp: "2026-03-14T00:15:00.000Z", kwh: 0.5 },
          ],
        },
      },
      meta: {
        curveShapingVersion: "shared_curve_v2",
      },
      pastDayCounts: {},
      shapeMonthsPresent: ["2026-01"],
      actualWxByDateKey: new Map(),
      stitchedCurve: null,
      simulatedDayResults: undefined,
    });

    const out = await rebuildGapfillSharedPastArtifact({
      userId: "u1",
      houseId: "h1",
    });

    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.rebuilt).toBe(true);
      expect(out.requestedInputHash).toBe("hash-rebuilt-exact");
      expect(out.artifactInputHashUsed).toBe("hash-rebuilt-exact");
      expect(out.artifactHashMatch).toBe(true);
      expect(out.artifactSourceMode).toBe("exact_hash_match");
    }
    expect(simulatePastUsageDataset).toHaveBeenCalledTimes(1);
    expect(saveCachedPastDataset).toHaveBeenCalledTimes(1);
    const saved = saveCachedPastDataset.mock.calls[0]?.[0] ?? {};
    const savedMeta = ((saved as any).datasetJson?.meta ?? {}) as Record<string, unknown>;
    expect(savedMeta.excludedDateKeysCount).toBe(2);
    expect(savedMeta.excludedDateKeysFingerprint).toBe("2026-01-01,2026-01-02");
    expect(savedMeta.curveShapingVersion).toBe("shared_curve_v2");
    expect(getCachedPastDataset).toHaveBeenCalledTimes(3);
  });

  it("rebuilds when exact-hash artifact passes coverage verify but fails curve-shaping stale guard (aligns with compare_core)", async () => {
    const canonicalCoverage = resolveCanonicalUsage365CoverageWindow();
    const staleCurveExactCached = {
      inputHash: "hash-rebuilt-exact",
      updatedAt: new Date("2026-03-18T00:00:00.000Z"),
      datasetJson: {
        summary: {
          source: "SIMULATED",
          intervalsCount: 2,
          totalKwh: 0.75,
          start: canonicalCoverage.startDate,
          end: canonicalCoverage.endDate,
        },
        meta: {
          coverageStart: canonicalCoverage.startDate,
          coverageEnd: canonicalCoverage.endDate,
          canonicalArtifactSimulatedDayTotalsByDate: {
            "2026-01-01": 0.5,
            "2026-01-02": 0.25,
          },
        },
        daily: [{ date: "2026-01-01", kwh: 0.5, source: "SIMULATED" }],
        monthly: [{ month: "2026-01", kwh: 0.75 }],
        series: {},
        canonicalArtifactSimulatedDayTotalsByDate: {
          "2026-01-01": 0.5,
          "2026-01-02": 0.25,
        },
      },
      intervalsCodec: "v1_delta_varint",
      intervalsCompressed: Buffer.from("00", "hex"),
    };
    const rebuiltPersisted = {
      inputHash: "hash-rebuilt-exact",
      updatedAt: new Date("2026-03-18T00:00:00.000Z"),
      datasetJson: {
        summary: {
          source: "SIMULATED",
          intervalsCount: 2,
          totalKwh: 0.75,
          start: canonicalCoverage.startDate,
          end: canonicalCoverage.endDate,
        },
        meta: {
          curveShapingVersion: "shared_curve_v2",
          coverageStart: canonicalCoverage.startDate,
          coverageEnd: canonicalCoverage.endDate,
          canonicalArtifactSimulatedDayTotalsByDate: {
            "2026-01-01": 0.5,
            "2026-01-02": 0.25,
          },
        },
        daily: [{ date: "2026-01-01", kwh: 0.5, source: "SIMULATED" }],
        monthly: [{ month: "2026-01", kwh: 0.75 }],
        series: {},
        canonicalArtifactSimulatedDayTotalsByDate: {
          "2026-01-01": 0.5,
          "2026-01-02": 0.25,
        },
      },
      intervalsCodec: "v1_delta_varint",
      intervalsCompressed: Buffer.from("00", "hex"),
    };
    getCachedPastDataset
      .mockResolvedValueOnce(staleCurveExactCached)
      .mockResolvedValueOnce(rebuiltPersisted)
      .mockResolvedValueOnce(rebuiltPersisted);
    simulatePastUsageDataset.mockResolvedValueOnce({
      dataset: {
        summary: {
          source: "SIMULATED",
          intervalsCount: 2,
          totalKwh: 0.75,
          start: canonicalCoverage.startDate,
          end: canonicalCoverage.endDate,
        },
        meta: {
          curveShapingVersion: "shared_curve_v2",
          coverageStart: canonicalCoverage.startDate,
          coverageEnd: canonicalCoverage.endDate,
          excludedDateKeysFingerprint: "2026-01-01,2026-01-02",
          excludedDateKeysCount: 2,
        },
        daily: [{ date: "2026-01-01", kwh: 0.5, source: "SIMULATED" }],
        monthly: [{ month: "2026-01", kwh: 0.75 }],
        series: {
          intervals15: [
            { timestamp: "2026-03-14T00:00:00.000Z", kwh: 0.25 },
            { timestamp: "2026-03-14T00:15:00.000Z", kwh: 0.5 },
          ],
        },
      },
      meta: {
        curveShapingVersion: "shared_curve_v2",
      },
      pastDayCounts: {},
      shapeMonthsPresent: ["2026-01"],
      actualWxByDateKey: new Map(),
      stitchedCurve: null,
      simulatedDayResults: undefined,
    });

    const out = await rebuildGapfillSharedPastArtifact({
      userId: "u1",
      houseId: "h1",
    });

    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.rebuilt).toBe(true);
      expect(out.artifactSourceMode).toBe("exact_hash_match");
    }
    expect(simulatePastUsageDataset).toHaveBeenCalledTimes(1);
    expect(saveCachedPastDataset).toHaveBeenCalledTimes(1);
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
  function oneChicagoLocalDayIntervals96(localDate: string, kwh = 0.25): Array<{ timestamp: string; kwh: number }> {
    const out: Array<{ timestamp: string; kwh: number }> = [];
    const startMs = new Date(`${localDate}T06:00:00.000Z`).getTime();
    for (let i = 0; i < 96; i++) {
      out.push({ timestamp: new Date(startMs + i * 15 * 60 * 1000).toISOString(), kwh });
    }
    return out;
  }
  function localDateRangeIntervals96(
    startDate: string,
    endDate: string,
    kwh = 24 / 96
  ): Array<{ timestamp: string; kwh: number }> {
    const out: Array<{ timestamp: string; kwh: number }> = [];
    let cursor = new Date(`${startDate}T00:00:00.000Z`).getTime();
    const end = new Date(`${endDate}T00:00:00.000Z`).getTime();
    while (cursor <= end) {
      const localDate = new Date(cursor).toISOString().slice(0, 10);
      out.push(...oneChicagoLocalDayIntervals96(localDate, kwh));
      cursor += 24 * 60 * 60 * 1000;
    }
    return out;
  }
  function simulatedDayResultForLocalDay(localDate: string, totalKwh = 24) {
    return {
      localDate,
      intervals: oneChicagoLocalDayIntervals96(localDate, totalKwh / 96),
      intervalSumKwh: totalKwh,
      finalDayKwh: totalKwh,
    };
  }
  function simulatedDayResultFromIntervals(localDate: string, intervals: Array<{ timestamp: string; kwh: number }>) {
    const totalKwh = intervals.reduce((sum, row) => sum + (Number(row.kwh) || 0), 0);
    return {
      localDate,
      intervals,
      intervalSumKwh: totalKwh,
      finalDayKwh: totalKwh,
    };
  }
  function canonicalTotalsByLocalDateFromIntervals(
    intervals: Array<{ timestamp: string; kwh: number }>,
    timezone = "America/Chicago"
  ) {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const totals = new Map<string, number>();
    for (const row of intervals) {
      const localDate = formatter.format(new Date(String(row.timestamp ?? "")));
      totals.set(localDate, (totals.get(localDate) ?? 0) + (Number(row.kwh) || 0));
    }
    return Object.fromEntries(
      Array.from(totals.entries()).map(([date, total]) => [date, Math.round(total * 100) / 100] as const)
    );
  }

  beforeEach(() => {
    scenarioFindFirst.mockReset();
    usageSimulatorBuildFindUnique.mockReset();
    getHouseAddressForUserHouse.mockReset();
    computePastInputHash.mockReset();
    getCachedPastDataset.mockReset();
    getLatestCachedPastDatasetByScenario.mockReset();
    saveCachedPastDataset.mockReset();
    simulatePastFullWindowShared.mockReset();
    simulatePastUsageDataset.mockReset();
    loadWeatherForPastWindow.mockReset();
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
    computePastInputHash.mockReturnValue("hash-selected-default");
    getUsageShapeProfileIdentityForPast.mockResolvedValue({
      usageShapeProfileId: "shape-1",
      usageShapeProfileVersion: "1",
      usageShapeProfileDerivedAt: "2026-01-01T00:00:00.000Z",
      usageShapeProfileSimHash: "shape-hash-1",
    });
    encodeIntervalsV1.mockReturnValue({ bytes: Buffer.from("00", "hex") });
    decodeIntervalsV1.mockReturnValue(oneDayIntervals96(0.25));
    simulatePastSelectedDaysShared.mockResolvedValue({
      simulatedIntervals: oneChicagoLocalDayIntervals96("2026-01-01", 24 / 96),
      simulatedDayResults: [simulatedDayResultForLocalDay("2026-01-01")],
      canonicalSimulatedDayTotalsByDate: { "2026-01-01": 24 },
      pastDayCounts: {},
      weatherSourceSummary: "actual_only",
      weatherKindUsed: "ACTUAL_LAST_YEAR",
    });
    simulatePastFullWindowShared.mockImplementation(async ({ startDate, endDate }: any) => ({
      simulatedIntervals: localDateRangeIntervals96(String(startDate), String(endDate)),
      canonicalSimulatedDayTotalsByDate: canonicalTotalsByLocalDateFromIntervals(
        localDateRangeIntervals96(String(startDate), String(endDate))
      ),
      actualWxByDateKey: new Map<string, unknown>(),
      weatherSourceSummary: "actual_only",
      weatherKindUsed: "ACTUAL_LAST_YEAR",
      weatherProviderName: "OPEN_METEO",
      weatherFallbackReason: null,
    }));
    loadWeatherForPastWindow.mockImplementation(async ({ canonicalDateKeys }: any) => ({
      actualWxByDateKey: new Map(
        (canonicalDateKeys ?? []).map((dateKey: string) => [
          dateKey,
          { tAvgF: 50, tMinF: 40, tMaxF: 60, hdd65: 15, cdd65: 0, source: "OPEN_METEO" },
        ])
      ),
      normalWxByDateKey: new Map(),
      provenance: {
        weatherKindUsed: "ACTUAL_LAST_YEAR",
        weatherSourceSummary: "actual_only",
        weatherFallbackReason: null,
        weatherProviderName: "OPEN_METEO",
      },
    }));
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

  it("treats cached artifact missing curveShapingVersion as stale (curve-shaping guard)", async () => {
    getLatestCachedPastDatasetByScenario.mockResolvedValue({
      inputHash: "hash-exact-curve",
      updatedAt: new Date(),
      datasetJson: {
        summary: { source: "SIMULATED", intervalsCount: 96, totalKwh: 24, start: "2026-01-01", end: "2026-01-01" },
        meta: { excludedDateKeysFingerprint: "" },
        daily: [],
        monthly: [],
        series: {},
      },
      intervalsCodec: "v1_delta_varint",
      intervalsCompressed: Buffer.from("00", "hex"),
    });
    computePastInputHash.mockReturnValue("hash-exact-curve");
    getCachedPastDataset.mockResolvedValue({
      inputHash: "hash-exact-curve",
      updatedAt: new Date(),
      datasetJson: {
        summary: {
          source: "SIMULATED",
          intervalsCount: 96,
          totalKwh: 24,
          start: "2026-01-01",
          end: "2026-01-01",
        },
        meta: {
          excludedDateKeysFingerprint: "",
        },
        daily: [{ date: "2026-01-01", kwh: 24, source: "SIMULATED" }],
        monthly: [{ month: "2026-01", kwh: 24 }],
        series: {},
      },
      intervalsCodec: "v1_delta_varint",
      intervalsCompressed: Buffer.from("00", "hex"),
    });
    decodeIntervalsV1.mockReturnValue(oneDayIntervals96(0.25));

    const out = await buildGapfillCompareSimShared({
      userId: "u1",
      houseId: "h1",
      timezone: "America/Chicago",
      canonicalWindow: { startDate: "2026-01-01", endDate: "2026-01-01" },
      testDateKeysLocal: new Set<string>(["2026-01-01"]),
      rebuildArtifact: false,
      autoEnsureArtifact: false,
      compareFreshMode: "selected_days",
      includeFreshCompareCalc: false,
      selectedDaysLightweightArtifactRead: false,
      artifactExactInputHash: "hash-exact-curve",
      artifactExactScenarioId: "gapfill_lab",
      requireExactArtifactMatch: true,
    });

    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.status).toBe(409);
      expect((out.body as any)?.error).toBe("artifact_stale_rebuild_required");
      expect(String((out.body as any)?.message ?? "")).toContain("curve-shaping");
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
    const rebuiltIntervals = oneChicagoLocalDayIntervals96("2026-01-01", 24 / 96);
    getCachedPastDataset
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        inputHash: "hash-selected-default",
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
      expect((out.modelAssumptions as any)?.artifactSourceMode).toBe("exact_hash_match");
      expect((out.modelAssumptions as any)?.artifactInputHashUsed).toBe("hash-selected-default");
      expect((out.modelAssumptions as any)?.artifactInputHash).toBe("hash-selected-default");
      expect((out.modelAssumptions as any)?.artifactSourceNote).toBe(
        "Artifact source: exact identity match on Past input hash."
      );
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
    const rebuiltIntervals = oneChicagoLocalDayIntervals96("2026-01-01", 24 / 96);
    getCachedPastDataset
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        inputHash: "hash-selected-default",
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
        meta: {
          curveShapingVersion: "shared_curve_v2",
          canonicalArtifactSimulatedDayTotalsByDate: { "2026-01-01": 24 },
        },
        daily: [{ date: "2026-01-01", kwh: 99, source: "SIMULATED" }],
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
    const savedCanonicalDayTotals =
      ((saved as any).datasetJson?.canonicalArtifactSimulatedDayTotalsByDate as Record<string, unknown> | undefined) ??
      (savedMeta.canonicalArtifactSimulatedDayTotalsByDate as Record<string, unknown> | undefined);
    expect(savedMeta.excludedDateKeysFingerprint).toBe("2026-01-01");
    expect(savedMeta.excludedDateKeysCount).toBe(1);
    expect(savedCanonicalDayTotals).toEqual({
      "2026-01-01": 24,
    });
  });

  it("does not enforce legacy compare-mask metadata when shared ownership metadata is valid", async () => {
    getCachedPastDataset.mockResolvedValue({
      inputHash: "hash-selected-default",
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
      expect(out.simulatedTestIntervals.length).toBe(96);
      expect(out.artifactUsesTestDaysInIdentity).toBe(false);
    }
  });

  it("ignores out-of-window excluded fingerprint residue after canonical normalization", async () => {
    getCachedPastDataset.mockResolvedValue({
      inputHash: "hash-selected-default",
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
      expect(out.simulatedTestIntervals.length).toBe(96);
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
      inputHash: "hash-selected-default",
      datasetJson: {
        summary: { source: "SIMULATED", intervalsCount: 2, totalKwh: 0.75, start: "2026-01-01", end: "2026-01-01" },
        meta: {
          curveShapingVersion: "shared_curve_v2",
          excludedDateKeysFingerprint: "",
          canonicalArtifactSimulatedDayTotalsByDate: { "2026-01-01": 24 },
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
      expect(out.simulatedTestIntervals.length).toBe(96);
      expect(out.scoringSimulatedSource).toBe("shared_selected_days_simulated_intervals15");
      expect(out.compareCalculationScope).toBe("selected_days_shared_path_only");
      expect(out.compareSimSource).toBe("shared_selected_days_calc");
      expect(out.simulatedTestIntervals.every((p) => p.kwh === 24 / 96)).toBe(true);
      expect(out.displayVsFreshParityForScoredDays?.missingDisplaySimCount).toBe(0);
      expect(out.displayVsFreshParityForScoredDays?.comparableDateCount).toBe(1);
    }
  });

  it("reports shared-compare phase progression via onPhaseUpdate", async () => {
    getCachedPastDataset.mockResolvedValue({
      inputHash: "hash-selected-default",
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
    const phases: string[] = [];

    const out = await buildGapfillCompareSimShared({
      userId: "u1",
      houseId: "h1",
      timezone: "America/Chicago",
      canonicalWindow: { startDate: "2026-01-01", endDate: "2026-01-01" },
      testDateKeysLocal: new Set<string>(["2026-01-01"]),
      rebuildArtifact: false,
      includeFreshCompareCalc: false,
      onPhaseUpdate: (phase) => {
        phases.push(String(phase));
      },
    });

    expect(out.ok).toBe(true);
    expect(phases[0]).toBe("build_shared_compare_inputs_ready");
    expect(phases).toContain("build_shared_compare_weather_ready");
    expect(phases).toContain("build_shared_compare_sim_ready");
    expect(phases).toContain("build_shared_compare_scored_actual_rows_ready");
    expect(phases).toContain("build_shared_compare_scored_sim_rows_ready");
    expect(phases).toContain("build_shared_compare_scored_row_keys_ready");
    expect(phases).toContain("build_shared_compare_scored_row_alignment_ready");
    expect(phases).toContain("build_shared_compare_scored_row_merge_ready");
    expect(phases).toContain("build_shared_compare_scored_rows_ready");
    expect(phases).toContain("build_shared_compare_parity_ready");
    expect(phases).toContain("build_shared_compare_metrics_ready");
    expect(phases).toContain("build_shared_compare_response_ready");
    expect(phases[phases.length - 1]).toBe("build_shared_compare_finalize_start");
  });

  it("emits compact compare_core memory-reduced phase and skips monthly/chart materialization when diagnostics and full report are off", async () => {
    const compactArtifact = {
      inputHash: "hash-compact-core",
      datasetJson: {
        summary: { source: "SIMULATED", intervalsCount: 96, totalKwh: 24, start: "2026-01-01", end: "2026-01-01" },
        meta: {
          curveShapingVersion: "shared_curve_v2",
          excludedDateKeysFingerprint: "",
        },
        daily: [{ date: "2026-01-01", kwh: 24, source: "SIMULATED" }],
        monthly: [{ month: "2026-01", kwh: 9999 }],
        series: {},
      },
      intervalsCodec: "v1_delta_varint",
      intervalsCompressed: Buffer.from("00", "hex"),
    };
    getLatestCachedPastDatasetByScenario.mockResolvedValue(compactArtifact);
    getCachedPastDataset.mockResolvedValue(compactArtifact);
    decodeIntervalsV1.mockReturnValue(oneChicagoLocalDayIntervals96("2026-01-01", 24 / 96));

    const phases: string[] = [];
    let boundedCanonicalMetaLight: Record<string, unknown> | null = null;
    const out = await buildGapfillCompareSimShared({
      userId: "u1",
      houseId: "h1",
      timezone: "America/Chicago",
      canonicalWindow: { startDate: "2026-01-01", endDate: "2026-01-01" },
      testDateKeysLocal: new Set<string>(["2026-01-01"]),
      rebuildArtifact: false,
      compareFreshMode: "selected_days",
      includeFreshCompareCalc: false,
      selectedDaysLightweightArtifactRead: true,
      includeDiagnostics: false,
      includeFullReportText: false,
      onPhaseUpdate: (phase, meta) => {
        phases.push(String(phase));
        if (String(phase) === "build_shared_compare_compact_bounded_canonical_ready") {
          boundedCanonicalMetaLight = meta ?? null;
        }
      },
    });

    expect(out.ok).toBe(true);
    expect(boundedCanonicalMetaLight?.["usedIntervalBackedExactParityTruth"]).toBe(false);
    expect(Number(boundedCanonicalMetaLight?.["compactCanonicalUnionKeyCount"])).toBe(1);
    expect(Number(boundedCanonicalMetaLight?.["selectedDateKeyCount"])).toBe(1);
    expect(Number(boundedCanonicalMetaLight?.["parityDateKeyCount"])).toBe(0);
    expect(phases).toContain("build_shared_compare_compact_compare_core_memory_reduced");
    expect(phases).toContain("build_shared_compare_compact_bounded_canonical_ready");
    expect(phases).toContain("build_shared_compare_compact_post_scored_sim_ready");
    expect(phases).toContain("compact_pre_bounded_exact_parity_decode_done");
    expect(phases).toContain("compact_post_scored_rows_parity_start");
    expect(phases).toContain("compact_post_scored_rows_parity_rows_ready");
    expect(phases).toContain("compact_post_scored_rows_parity_truth_ready");
    expect(phases).toContain("compact_post_scored_rows_parity_done");
    expect(phases).toContain("compact_post_scored_rows_metrics_start");
    expect(phases).toContain("compact_post_scored_rows_metrics_done");
    expect(phases).toContain("compact_post_scored_rows_response_start");
    expect(phases.indexOf("compact_post_scored_rows_parity_start")).toBeLessThan(
      phases.indexOf("compact_post_scored_rows_parity_rows_ready")
    );
    expect(phases.indexOf("compact_post_scored_rows_parity_rows_ready")).toBeLessThan(
      phases.indexOf("compact_post_scored_rows_parity_truth_ready")
    );
    expect(phases.indexOf("compact_post_scored_rows_parity_truth_ready")).toBeLessThan(
      phases.indexOf("compact_post_scored_rows_parity_done")
    );
    expect(phases.indexOf("compact_post_scored_rows_parity_done")).toBeLessThan(
      phases.indexOf("build_shared_compare_compact_post_scored_sim_ready")
    );
    expect(phases.indexOf("compact_post_scored_rows_metrics_start")).toBeLessThan(
      phases.indexOf("build_shared_compare_parity_ready")
    );
    expect(phases.indexOf("build_shared_compare_metrics_ready")).toBeLessThan(
      phases.indexOf("compact_post_scored_rows_metrics_done")
    );
    expect(phases.indexOf("compact_post_scored_rows_metrics_done")).toBeLessThan(
      phases.indexOf("compact_post_scored_rows_response_start")
    );
    expect(phases.indexOf("build_shared_compare_scored_sim_rows_ready")).toBeLessThan(
      phases.indexOf("compact_pre_bounded_exact_parity_decode_start")
    );
    expect(phases.indexOf("compact_pre_bounded_merge_backfill_done")).toBeLessThan(
      phases.indexOf("build_shared_compare_compact_bounded_canonical_ready")
    );
    expect(phases.indexOf("build_shared_compare_compact_bounded_canonical_ready")).toBeLessThan(
      phases.indexOf("build_shared_compare_scored_row_keys_ready")
    );
    if (out.ok) {
      expect(out.simulatedChartMonthly.length).toBe(0);
      expect(out.simulatedChartStitchedMonth).toBeNull();
      expect((out.modelAssumptions as any)?.gapfillDisplayMonthlySource).toBe("compact_compare_core_skipped");
      expect(out.travelVacantParityTruth?.availability).toBeDefined();
      expect(Array.isArray(out.scoredDayWeatherRows)).toBe(true);
      expect((out.modelAssumptions as any)?.artifactSimulatedDayReferenceCount).toBeLessThanOrEqual(
        out.scoringTestDateKeysLocal.size + out.boundedTravelDateKeysLocal.size
      );
    }
  });

  it("compact bounded canonical phase reports small boundedCanonicalDateCount when meta contains many day keys", async () => {
    const bloatedMetaTotals: Record<string, number> = {};
    for (let i = 0; i < 365; i++) {
      const t = new Date(2026, 0, 1 + i);
      bloatedMetaTotals[t.toISOString().slice(0, 10)] = 1;
    }
    bloatedMetaTotals["2026-01-01"] = 24;
    const compactArtifact = {
      inputHash: "hash-bloated-meta",
      datasetJson: {
        summary: { source: "SIMULATED", intervalsCount: 96, totalKwh: 24, start: "2026-01-01", end: "2026-01-01" },
        meta: {
          curveShapingVersion: "shared_curve_v2",
          excludedDateKeysFingerprint: "",
          canonicalArtifactSimulatedDayTotalsByDate: bloatedMetaTotals,
        },
        daily: [{ date: "2026-01-01", kwh: 24, source: "SIMULATED" }],
        monthly: [{ month: "2026-01", kwh: 9999 }],
        series: {},
      },
      intervalsCodec: "v1_delta_varint",
      intervalsCompressed: Buffer.from("00", "hex"),
    };
    getLatestCachedPastDatasetByScenario.mockResolvedValue(compactArtifact);
    getCachedPastDataset.mockResolvedValue(compactArtifact);
    decodeIntervalsV1.mockReturnValue(oneChicagoLocalDayIntervals96("2026-01-01", 24 / 96));

    let boundedMeta: Record<string, unknown> | null = null;
    const out = await buildGapfillCompareSimShared({
      userId: "u1",
      houseId: "h1",
      timezone: "America/Chicago",
      canonicalWindow: { startDate: "2026-01-01", endDate: "2026-01-01" },
      testDateKeysLocal: new Set<string>(["2026-01-01"]),
      rebuildArtifact: false,
      compareFreshMode: "selected_days",
      includeFreshCompareCalc: false,
      selectedDaysLightweightArtifactRead: true,
      includeDiagnostics: false,
      includeFullReportText: false,
      onPhaseUpdate: (phase, meta) => {
        if (phase === "build_shared_compare_compact_bounded_canonical_ready") boundedMeta = meta ?? null;
      },
    });

    expect(out.ok).toBe(true);
    expect(boundedMeta).not.toBeNull();
    expect(Number((boundedMeta as any)?.boundedCanonicalDateCount)).toBeLessThanOrEqual(2);
    expect(Number((boundedMeta as any)?.selectedDateKeyCount)).toBe(1);
  });

  it("activates compact compare_core while exact travel parity keeps lightweight artifact read (requireExactArtifactMatch)", async () => {
    usageSimulatorBuildFindUnique.mockResolvedValueOnce({
      buildInputs: {
        mode: "SMT_BASELINE",
        canonicalMonths: ["2026-01"],
        timezone: "America/Chicago",
        travelRanges: [{ startDate: "2026-01-01", endDate: "2026-01-01" }],
      },
    });
    const artifact = {
      inputHash: "hash-selected-default",
      datasetJson: {
        summary: { source: "SIMULATED", intervalsCount: 96, totalKwh: 24, start: "2026-01-01", end: "2026-01-01" },
        meta: {
          curveShapingVersion: "shared_curve_v2",
          excludedDateKeysFingerprint: "2026-01-01",
          canonicalArtifactSimulatedDayTotalsByDate: { "2026-01-01": 24 },
        },
        daily: [{ date: "2026-01-01", kwh: 24, source: "SIMULATED" }],
        monthly: [{ month: "2026-01", kwh: 9999 }],
        series: {},
      },
      intervalsCodec: "v1_delta_varint",
      intervalsCompressed: Buffer.from("00", "hex"),
    };
    getCachedPastDataset.mockResolvedValue(artifact);
    decodeIntervalsV1.mockReturnValue(oneChicagoLocalDayIntervals96("2026-01-01", 24 / 96));
    const recomputeSpy = vi.spyOn(usageDatasetModule, "recomputePastAggregatesFromIntervals");
    recomputeSpy.mockImplementation(() => {
      throw new Error("compact selected-days restore should not recompute artifact aggregates");
    });

    const phases: string[] = [];
    const inputsReadyMeta = { value: null as Record<string, unknown> | null };
    let boundedCanonicalMeta: Record<string, unknown> | null = null;
    try {
      const out = await buildGapfillCompareSimShared({
        userId: "u1",
        houseId: "h1",
        timezone: "America/Chicago",
        canonicalWindow: { startDate: "2026-01-01", endDate: "2026-01-01" },
        testDateKeysLocal: new Set<string>(["2026-01-01"]),
        rebuildArtifact: false,
        compareFreshMode: "selected_days",
        includeFreshCompareCalc: false,
        selectedDaysLightweightArtifactRead: true,
        includeDiagnostics: false,
        includeFullReportText: false,
        artifactExactScenarioId: "gapfill_lab",
        artifactExactInputHash: "hash-selected-default",
        requireExactArtifactMatch: true,
        artifactIdentitySource: "same_run_artifact_ensure",
        onPhaseUpdate: (phase: GapfillCompareBuildPhase, meta?: Record<string, unknown>) => {
          phases.push(String(phase));
          if (phase === "build_shared_compare_inputs_ready") {
            inputsReadyMeta.value = meta ?? null;
          }
          if (String(phase) === "build_shared_compare_compact_bounded_canonical_ready") {
            boundedCanonicalMeta = meta ?? null;
          }
        },
      });

      expect(recomputeSpy).not.toHaveBeenCalled();
      expect(out.ok).toBe(true);
      expect(phases).toContain("build_shared_compare_compact_compare_core_memory_reduced");
      expect(phases).toContain("build_shared_compare_compact_bounded_canonical_ready");
      expect(phases).toContain("build_shared_compare_compact_post_scored_sim_ready");
      expect(phases.indexOf("compact_pre_bounded_merge_backfill_done")).toBeLessThan(
        phases.indexOf("build_shared_compare_compact_bounded_canonical_ready")
      );
      expect(phases.indexOf("build_shared_compare_compact_bounded_canonical_ready")).toBeLessThan(
        phases.indexOf("build_shared_compare_scored_row_keys_ready")
      );
      expect(boundedCanonicalMeta?.["usedIntervalBackedExactParityTruth"]).toBe(false);
      expect(Number(boundedCanonicalMeta?.["compactCanonicalUnionKeyCount"])).toBe(1);
      expect(Number(boundedCanonicalMeta?.["selectedDateKeyCount"])).toBe(1);
      expect(Number(boundedCanonicalMeta?.["parityDateKeyCount"])).toBe(1);
      expect(phases).toContain("compact_post_scored_rows_parity_start");
      expect(phases).toContain("compact_post_scored_rows_parity_rows_ready");
      expect(phases).toContain("compact_post_scored_rows_parity_truth_ready");
      expect(phases).toContain("compact_post_scored_rows_parity_done");
      expect(phases.indexOf("compact_post_scored_rows_parity_start")).toBeLessThan(
        phases.indexOf("compact_post_scored_rows_parity_rows_ready")
      );
      expect(phases.indexOf("compact_post_scored_rows_parity_rows_ready")).toBeLessThan(
        phases.indexOf("compact_post_scored_rows_parity_truth_ready")
      );
      expect(phases.indexOf("compact_post_scored_rows_parity_truth_ready")).toBeLessThan(
        phases.indexOf("compact_post_scored_rows_parity_done")
      );
      expect(phases.indexOf("build_shared_compare_scored_rows_ready")).toBeLessThan(
        phases.indexOf("compact_post_scored_rows_parity_start")
      );
      const inputsMeta = inputsReadyMeta.value;
      const gates = inputsMeta?.compactPathGates as Record<string, unknown> | undefined;
      expect(gates?.exactTravelParityRequiresIntervalBackedArtifactTruth).toBe(false);
      expect(gates?.useSelectedDaysLightweightArtifactRead).toBe(true);
      expect(inputsMeta?.compactPathEligible).toBe(true);
      if (out.ok) {
        expect(out.simulatedChartMonthly.length).toBe(0);
        expect((out.modelAssumptions as any)?.gapfillDisplayMonthlySource).toBe("compact_compare_core_skipped");
        expect(out.boundedTravelDateKeysLocal.has("2026-01-01")).toBe(true);
        expect(out.travelVacantParityTruth?.availability).toBeDefined();
        expect(out.travelVacantParityRows?.length).toBeGreaterThan(0);
        expect(out.travelVacantParityRows?.every((r) => r.parityMatch === true)).toBe(true);
        expect(out.travelVacantParityTruth?.reasonCode).toBe("TRAVEL_VACANT_PARITY_VALIDATED");
        expect(out.displayVsFreshParityForScoredDays?.missingDisplaySimCount).toBe(0);
        expect(out.displayVsFreshParityForScoredDays?.comparableDateCount).toBe(1);
      }
    } finally {
      recomputeSpy.mockRestore();
    }
  });

  it("abortSignal stops work after compact_post_scored_rows_parity_start (compare_core_build_aborted)", async () => {
    usageSimulatorBuildFindUnique.mockResolvedValueOnce({
      buildInputs: {
        mode: "SMT_BASELINE",
        canonicalMonths: ["2026-01"],
        timezone: "America/Chicago",
        travelRanges: [{ startDate: "2026-01-01", endDate: "2026-01-01" }],
      },
    });
    const artifact = {
      inputHash: "hash-selected-default",
      datasetJson: {
        summary: { source: "SIMULATED", intervalsCount: 96, totalKwh: 24, start: "2026-01-01", end: "2026-01-01" },
        meta: {
          curveShapingVersion: "shared_curve_v2",
          excludedDateKeysFingerprint: "2026-01-01",
          canonicalArtifactSimulatedDayTotalsByDate: { "2026-01-01": 24 },
        },
        daily: [{ date: "2026-01-01", kwh: 24, source: "SIMULATED" }],
        monthly: [{ month: "2026-01", kwh: 9999 }],
        series: {},
      },
      intervalsCodec: "v1_delta_varint",
      intervalsCompressed: Buffer.from("00", "hex"),
    };
    getCachedPastDataset.mockResolvedValue(artifact);
    decodeIntervalsV1.mockReturnValue(oneChicagoLocalDayIntervals96("2026-01-01", 24 / 96));

    const ac = new AbortController();
    let sawParityStart = false;
    await expect(
      buildGapfillCompareSimShared({
        userId: "u1",
        houseId: "h1",
        timezone: "America/Chicago",
        canonicalWindow: { startDate: "2026-01-01", endDate: "2026-01-01" },
        testDateKeysLocal: new Set<string>(["2026-01-01"]),
        rebuildArtifact: false,
        compareFreshMode: "selected_days",
        includeFreshCompareCalc: false,
        selectedDaysLightweightArtifactRead: true,
        includeDiagnostics: false,
        includeFullReportText: false,
        artifactExactScenarioId: "gapfill_lab",
        artifactExactInputHash: "hash-selected-default",
        requireExactArtifactMatch: true,
        artifactIdentitySource: "same_run_artifact_ensure",
        abortSignal: ac.signal,
        onPhaseUpdate: (phase) => {
          if (phase === "compact_post_scored_rows_parity_start") {
            sawParityStart = true;
            ac.abort();
          }
        },
      })
    ).rejects.toMatchObject({ code: "compare_core_build_aborted" });
    expect(sawParityStart).toBe(true);
  });

  it("reports weather phase metadata with the final loaded weather basis in selected-days mode", async () => {
    getCachedPastDataset.mockResolvedValue({
      inputHash: "hash-selected-default",
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
    simulatePastSelectedDaysShared.mockResolvedValue({
      simulatedIntervals: oneChicagoLocalDayIntervals96("2026-01-01", 24 / 96),
      simulatedDayResults: [],
      canonicalSimulatedDayTotalsByDate: { "2026-01-01": 24 },
      pastDayCounts: {},
      weatherSourceSummary: "stub_only",
      weatherKindUsed: "ACTUAL_LAST_YEAR",
    });
    loadWeatherForPastWindow.mockResolvedValue({
      actualWxByDateKey: new Map([
        ["2026-01-01", { tAvgF: 50, tMinF: 40, tMaxF: 60, hdd65: 15, cdd65: 0, source: "OPEN_METEO" }],
      ]),
      normalWxByDateKey: new Map(),
      provenance: {
        weatherKindUsed: "ACTUAL_LAST_YEAR",
        weatherSourceSummary: "mixed_actual_and_stub",
        weatherFallbackReason: "partial_coverage",
        weatherProviderName: "OPEN_METEO",
      },
    });
    const phaseUpdates: Array<{ phase: string; meta: Record<string, unknown> | null }> = [];

    const out = await buildGapfillCompareSimShared({
      userId: "u1",
      houseId: "h1",
      timezone: "America/Chicago",
      canonicalWindow: { startDate: "2026-01-01", endDate: "2026-01-01" },
      testDateKeysLocal: new Set<string>(["2026-01-01"]),
      rebuildArtifact: false,
      compareFreshMode: "selected_days",
      includeFreshCompareCalc: false,
      onPhaseUpdate: (phase, meta) => {
        phaseUpdates.push({ phase: String(phase), meta: (meta as Record<string, unknown> | undefined) ?? null });
      },
    });

    expect(out.ok).toBe(true);
    if (out.ok) {
      const weatherPhase = phaseUpdates.find((entry) => entry.phase === "build_shared_compare_weather_ready");
      expect(weatherPhase?.meta?.weatherBasisUsed).toBe("mixed_actual_and_stub");
      expect(out.weatherBasisUsed).toBe("mixed_actual_and_stub");
      expect(out.scoredDayWeatherRows?.[0]?.weatherBasisUsed).toBe("mixed_actual_and_stub");
    }
  });

  it("skips identity fingerprint/hash work for explicit selected-days lightweight artifact read", async () => {
    const computePastInputHashCallsBefore = computePastInputHash.mock.calls.length;
    getCachedPastDataset.mockResolvedValue({
      inputHash: "hash-latest-lightweight",
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
      compareFreshMode: "selected_days",
      includeFreshCompareCalc: false,
      selectedDaysLightweightArtifactRead: true,
      artifactExactScenarioId: "gapfill_lab",
      artifactExactInputHash: "hash-latest-lightweight",
      requireExactArtifactMatch: true,
      artifactIdentitySource: "same_run_artifact_ensure",
    });

    expect(out.ok).toBe(true);
    expect(getIntervalDataFingerprint).not.toHaveBeenCalled();
    expect(computePastWeatherIdentity).not.toHaveBeenCalled();
    expect(getUsageShapeProfileIdentityForPast).not.toHaveBeenCalled();
    expect(computePastInputHash.mock.calls.length).toBe(computePastInputHashCallsBefore);
    expect(getCachedPastDataset).toHaveBeenCalledWith({
      houseId: "h1",
      scenarioId: "gapfill_lab",
      inputHash: "hash-latest-lightweight",
    });
    expect(getLatestCachedPastDatasetByScenario).toHaveBeenCalledTimes(1);
    if (out.ok) {
      expect((out.modelAssumptions as any)?.requestedInputHash).toBe("hash-latest-lightweight");
      expect((out.modelAssumptions as any)?.artifactSourceMode).toBe("exact_hash_match");
      expect((out.modelAssumptions as any)?.artifactHashMatch).toBe(true);
      expect((out.modelAssumptions as any)?.artifactSameRunEnsureIdentity).toBe(true);
      expect((out.modelAssumptions as any)?.artifactFallbackOccurred).toBe(false);
    }
  });

  it("fails loudly instead of silently falling back when same-run exact lightweight artifact identity is missing", async () => {
    getCachedPastDataset.mockResolvedValueOnce(null);
    getLatestCachedPastDatasetByScenario.mockResolvedValueOnce({
      inputHash: "hash-stale-latest",
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
      compareFreshMode: "selected_days",
      includeFreshCompareCalc: false,
      selectedDaysLightweightArtifactRead: true,
      artifactExactScenarioId: "gapfill_lab",
      artifactExactInputHash: "hash-missing",
      requireExactArtifactMatch: true,
      artifactIdentitySource: "same_run_artifact_ensure",
    });

    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.status).toBe(409);
      expect((out.body as any)?.error).toBe("artifact_exact_identity_missing_rebuild_required");
      expect((out.body as any)?.requestedArtifactScenarioId).toBe("gapfill_lab");
      expect((out.body as any)?.requestedInputHash).toBe("hash-missing");
      expect((out.body as any)?.fallbackOccurred).toBe(false);
      expect((out.body as any)?.fallbackReason).toBe("requested_exact_identity_not_found");
    }
    expect(getLatestCachedPastDatasetByScenario).toHaveBeenCalledTimes(1);
  });

  it("fails invariant instead of returning exact-hash success with unresolved artifact identity", async () => {
    getCachedPastDataset.mockResolvedValueOnce({
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
      compareFreshMode: "selected_days",
      includeFreshCompareCalc: false,
      selectedDaysLightweightArtifactRead: true,
      artifactExactScenarioId: "gapfill_lab",
      artifactExactInputHash: "hash-invariant",
      requireExactArtifactMatch: true,
      artifactIdentitySource: "same_run_artifact_ensure",
    });

    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.status).toBe(409);
      expect((out.body as any)?.error).toBe("artifact_exact_identity_unresolved");
      expect((out.body as any)?.requestedInputHash).toBe("hash-invariant");
      expect((out.body as any)?.artifactInputHashUsed).toBeNull();
      expect((out.body as any)?.exactIdentityResolved).toBe(false);
    }
  });

  it("fails early with artifact handoff error when same-run exact compare resolves to fallback identity", async () => {
    usageSimulatorBuildFindUnique.mockResolvedValueOnce({
      buildInputs: {
        mode: "SMT_BASELINE",
        canonicalMonths: ["2026-01"],
        timezone: "America/Chicago",
        travelRanges: [{ startDate: "2026-01-01", endDate: "2026-01-01" }],
      },
    });
    getCachedPastDataset.mockResolvedValueOnce(null);
    getLatestCachedPastDatasetByScenario.mockResolvedValue({
      inputHash: "hash-fallback-latest",
      updatedAt: new Date("2026-03-12T00:00:00.000Z"),
      datasetJson: {
        summary: { source: "SIMULATED", intervalsCount: 96, totalKwh: 24, start: "2026-01-01", end: "2026-01-01" },
        meta: {
          curveShapingVersion: "shared_curve_v2",
          excludedDateKeysFingerprint: "2026-01-01",
          canonicalArtifactSimulatedDayTotalsByDate: { "2026-01-01": 24 },
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
      compareFreshMode: "full_window",
      includeFreshCompareCalc: false,
      artifactExactScenarioId: "gapfill_lab",
      artifactExactInputHash: "hash-requested-exact",
      requireExactArtifactMatch: true,
      artifactIdentitySource: "same_run_artifact_ensure",
    });

    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.status).toBe(409);
      expect((out.body as any)?.error).toBe("artifact_exact_identity_unresolved");
      expect((out.body as any)?.reasonCode).toBe("ARTIFACT_ENSURE_EXACT_HANDOFF_FAILED");
      expect((out.body as any)?.artifactSourceMode).toBe("latest_by_scenario_fallback");
      expect((out.body as any)?.artifactInputHashUsed).toBe("hash-fallback-latest");
    }
  });

  it("recomputes excluded fingerprint from current travel ranges during lightweight artifact reads", async () => {
    usageSimulatorBuildFindUnique.mockResolvedValueOnce({
      buildInputs: {
        mode: "SMT_BASELINE",
        canonicalMonths: ["2026-01"],
        timezone: "America/Chicago",
        travelRanges: [{ startDate: "2026-01-01", endDate: "2026-01-01" }],
      },
    });
    getLatestCachedPastDatasetByScenario.mockResolvedValue({
      inputHash: "hash-latest-lightweight-stale-meta",
      datasetJson: {
        summary: { source: "SIMULATED", intervalsCount: 2, totalKwh: 0.75, start: "2026-01-01", end: "2026-01-01" },
        meta: {
          curveShapingVersion: "shared_curve_v2",
          // stale ownership fingerprint from older travel range
          excludedDateKeysFingerprint: "2026-01-02",
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
      compareFreshMode: "selected_days",
      includeFreshCompareCalc: false,
      selectedDaysLightweightArtifactRead: true,
    });

    expect(out.ok).toBe(true);
    if (out.ok) {
      expect((out.modelAssumptions as any)?.excludedDateKeysFingerprint).toBe("2026-01-01");
      expect((out.modelAssumptions as any)?.excludedDateKeysCount).toBe(1);
      expect(out.boundedTravelDateKeysLocal.has("2026-01-01")).toBe(true);
    }
  });

  it("allows lightweight selected-days reads to proceed with incomplete artifact windows", async () => {
    // canonicalMonths in beforeEach yields expected full-month interval count (31 * 96),
    // while decode mock provides only a single day. Lightweight mode should still proceed.
    getLatestCachedPastDatasetByScenario.mockResolvedValue({
      inputHash: "hash-latest-lightweight-incomplete",
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
      compareFreshMode: "selected_days",
      includeFreshCompareCalc: false,
      selectedDaysLightweightArtifactRead: true,
    });

    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.compareCalculationScope).toBe("selected_days_shared_path_only");
      expect(out.scoringSimulatedSource).toBe("shared_selected_days_simulated_intervals15");
      expect(out.artifactIntervals).toEqual([]);
      expect(out.simulatedChartIntervals).toEqual([]);
      expect((out.modelAssumptions as any)?.intervalCount).toBe(0);
      expect((out.modelAssumptions as any)?.artifactStoredIntervalCount).toBe(2);
    }
    expect(decodeIntervalsV1).not.toHaveBeenCalled();
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
      inputHash: "hash-selected-default",
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
      expect(out.simulatedTestIntervals.length).toBe(96);
      expect(out.scoredTestDaysMissingSimulatedOwnershipCount).toBe(0);
    }
  });

  it("returns scoring timezone/window metadata from the same selection source as simulated intervals", async () => {
    getCachedPastDataset.mockResolvedValue({
      inputHash: "hash-selected-default",
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
    expect(simulatePastUsageDataset).toHaveBeenCalledWith(
      expect.objectContaining({ includeSimulatedDayResults: true })
    );
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.status).toBe(500);
      expect((out.body as any)?.error).toBe("artifact_persist_verify_failed");
    }
  });

  it("uses restored dataset daily/monthly rows as canonical display output when present", async () => {
    decodeIntervalsV1.mockReturnValueOnce(oneChicagoLocalDayIntervals96("2026-01-01", 24 / 96));
    usageSimulatorBuildFindUnique.mockResolvedValueOnce({
      buildInputs: {
        mode: "SMT_BASELINE",
        canonicalMonths: ["2026-01"],
        timezone: "America/Chicago",
        travelRanges: [{ startDate: "2026-01-01", endDate: "2026-01-01" }],
      },
    });
    getCachedPastDataset.mockResolvedValue({
      inputHash: "hash-selected-default",
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
      expect(out.simulatedChartIntervals.length).toBeGreaterThan(0);
      expect((out.modelAssumptions as any)?.intervalCount).toBe(out.simulatedChartIntervals.length);
      expect((out.modelAssumptions as any)?.artifactStoredIntervalCount).toBe(96);
      expect(out.simulatedChartMonthly).toEqual([{ month: "2026-01", kwh: 333.33 }]);
      expect(out.simulatedChartMonthly.find((m) => m.month === "2025-12")).toBeUndefined();
      expect(out.simulatedChartStitchedMonth?.yearMonth).toBe("2026-01");
      expect((out.modelAssumptions as any)?.gapfillDisplayDailySource).toBe("dataset.daily");
      expect((out.modelAssumptions as any)?.gapfillDisplayMonthlySource).toBe("dataset.monthly");
    }
  });

  it("falls back to interval rebucketing only when restored daily/monthly rows are unavailable", async () => {
    getCachedPastDataset.mockResolvedValue({
      inputHash: "hash-selected-default",
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
      inputHash: "hash-selected-default",
      datasetJson: {
        summary: { source: "SIMULATED", intervalsCount: 96, totalKwh: 24, start: "2026-01-01", end: "2026-01-01" },
        meta: {
          curveShapingVersion: "shared_curve_v2",
          excludedDateKeysFingerprint: "",
          weatherSourceSummary: "actual_only",
          canonicalArtifactSimulatedDayTotalsByDate: { "2026-01-01": 24 },
        },
        daily: [{ date: "2026-01-01", kwh: 24, source: "SIMULATED" }],
        monthly: [{ month: "2026-01", kwh: 24 }],
        series: {},
      },
      intervalsCodec: "v1_delta_varint",
      intervalsCompressed: Buffer.from("00", "hex"),
    });
    simulatePastFullWindowShared.mockResolvedValue({
      simulatedIntervals: oneChicagoLocalDayIntervals96("2026-01-01", 24 / 96),
      canonicalSimulatedDayTotalsByDate: { "2026-01-01": 24 },
      actualWxByDateKey: new Map(),
      weatherSourceSummary: "actual_only",
      weatherKindUsed: "ACTUAL_LAST_YEAR",
      weatherProviderName: "OPEN_METEO",
      weatherFallbackReason: null,
    });

    const out = await buildGapfillCompareSimShared({
      userId: "u1",
      houseId: "h1",
      timezone: "America/Chicago",
      canonicalWindow: { startDate: "2026-01-01", endDate: "2026-01-01" },
      testDateKeysLocal: new Set<string>(["2026-01-01"]),
      rebuildArtifact: false,
      compareFreshMode: "full_window",
      includeFreshCompareCalc: true,
    });

    expect(simulatePastFullWindowShared).toHaveBeenCalledWith(
      expect.objectContaining({
        buildPathKind: "lab_validation",
        emitAllIntervals: false,
      })
    );
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.scoringSimulatedSource).toBe("shared_fresh_simulated_intervals15");
      expect(out.compareSimSource).toBe("shared_fresh_calc");
      expect(out.compareCalculationScope).toBe("full_window_shared_path_then_scored_day_filter");
      expect(out.comparePulledFromSharedArtifactOnly).toBe(false);
      expect(out.compareSharedCalcPath).toContain("simulatePastFullWindowShared");
      expect(out.displayVsFreshParityForScoredDays?.matches).toBe(true);
      expect(out.displayVsFreshParityForScoredDays?.mismatchCount).toBe(0);
      expect(out.displayVsFreshParityForScoredDays?.missingDisplaySimCount).toBe(0);
      expect(out.displayVsFreshParityForScoredDays?.complete).toBe(true);
      expect(out.displayVsFreshParityForScoredDays?.scope).toBe("scored_test_days_local");
      expect(out.displayVsFreshParityForScoredDays?.granularity).toBe("daily_kwh_rounded_2dp");
      expect(out.weatherBasisUsed).toBe("actual_only");
    }
  });

  it("returns deterministic fresh compare outputs across repeated calls with identical inputs", async () => {
    getCachedPastDataset.mockResolvedValue({
      inputHash: "hash-selected-default",
      datasetJson: {
        summary: { source: "SIMULATED", intervalsCount: 96, totalKwh: 24, start: "2026-01-01", end: "2026-01-01" },
        meta: {
          curveShapingVersion: "shared_curve_v2",
          excludedDateKeysFingerprint: "",
          weatherSourceSummary: "actual_only",
          canonicalArtifactSimulatedDayTotalsByDate: { "2026-01-01": 24 },
        },
        daily: [{ date: "2026-01-01", kwh: 24, source: "SIMULATED" }],
        monthly: [{ month: "2026-01", kwh: 24 }],
        series: {},
      },
      intervalsCodec: "v1_delta_varint",
      intervalsCompressed: Buffer.from("00", "hex"),
    });
    simulatePastFullWindowShared.mockResolvedValue({
      simulatedIntervals: oneChicagoLocalDayIntervals96("2026-01-01", 24 / 96),
      canonicalSimulatedDayTotalsByDate: { "2026-01-01": 24 },
      actualWxByDateKey: new Map(),
      weatherSourceSummary: "actual_only",
      weatherKindUsed: "ACTUAL_LAST_YEAR",
      weatherProviderName: "OPEN_METEO",
      weatherFallbackReason: null,
    });
    const commonArgs = {
      userId: "u1",
      houseId: "h1",
      timezone: "America/Chicago",
      canonicalWindow: { startDate: "2026-01-01", endDate: "2026-01-01" },
      testDateKeysLocal: new Set<string>(["2026-01-01"]),
      rebuildArtifact: false,
      compareFreshMode: "full_window",
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
      inputHash: "hash-selected-default",
      datasetJson: {
        summary: { source: "SIMULATED", intervalsCount: 96, totalKwh: 99, start: "2026-01-01", end: "2026-01-01" },
        meta: {
          curveShapingVersion: "shared_curve_v2",
          excludedDateKeysFingerprint: "",
          weatherSourceSummary: "actual_only",
          canonicalArtifactSimulatedDayTotalsByDate: { "2026-01-01": 99 },
        },
        daily: [{ date: "2026-01-01", kwh: 99, source: "SIMULATED" }],
        monthly: [{ month: "2026-01", kwh: 99 }],
        series: {},
      },
      intervalsCodec: "v1_delta_varint",
      intervalsCompressed: Buffer.from("00", "hex"),
    });
    simulatePastFullWindowShared.mockResolvedValue({
      simulatedIntervals: oneChicagoLocalDayIntervals96("2026-01-01", 24 / 96),
      canonicalSimulatedDayTotalsByDate: { "2026-01-01": 24 },
      actualWxByDateKey: new Map(),
      weatherSourceSummary: "actual_only",
      weatherKindUsed: "ACTUAL_LAST_YEAR",
      weatherProviderName: "OPEN_METEO",
      weatherFallbackReason: null,
    });

    const out = await buildGapfillCompareSimShared({
      userId: "u1",
      houseId: "h1",
      timezone: "America/Chicago",
      canonicalWindow: { startDate: "2026-01-01", endDate: "2026-01-01" },
      testDateKeysLocal: new Set<string>(["2026-01-01"]),
      rebuildArtifact: false,
      compareFreshMode: "full_window",
      includeFreshCompareCalc: true,
    });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.displayVsFreshParityForScoredDays?.matches).toBe(false);
      expect(out.displayVsFreshParityForScoredDays?.mismatchCount).toBe(1);
      expect(out.displayVsFreshParityForScoredDays?.mismatchSampleDates).toEqual(["2026-01-01"]);
      expect(out.displayVsFreshParityForScoredDays?.missingDisplaySimCount).toBe(0);
      expect(out.displayVsFreshParityForScoredDays?.complete).toBe(false);
    }
  });

  it("reports full mismatch totals while capping mismatch samples at ten dates", async () => {
    const testDates = Array.from({ length: 12 }, (_, i) => `2026-01-${String(i + 1).padStart(2, "0")}`);
    getLatestCachedPastDatasetByScenario.mockResolvedValue({
      inputHash: "hash-selected-default",
      updatedAt: new Date("2026-01-20T00:00:00.000Z"),
      datasetJson: {
        summary: { source: "SIMULATED", intervalsCount: 96 * testDates.length, totalKwh: 99 * testDates.length, start: testDates[0], end: testDates[testDates.length - 1] },
        meta: {
          curveShapingVersion: "shared_curve_v2",
          excludedDateKeysFingerprint: "",
          weatherSourceSummary: "actual_only",
          canonicalArtifactSimulatedDayTotalsByDate: Object.fromEntries(testDates.map((date) => [date, 99])),
        },
        daily: testDates.map((date) => ({ date, kwh: 99, source: "SIMULATED" })),
        monthly: [{ month: "2026-01", kwh: 99 * testDates.length }],
        series: {},
      },
      intervalsCodec: "v1_delta_varint",
      intervalsCompressed: Buffer.from("00", "hex"),
    });
    simulatePastSelectedDaysShared.mockResolvedValue({
      simulatedIntervals: testDates.flatMap((date) => oneChicagoLocalDayIntervals96(date, 24 / 96)),
      simulatedDayResults: testDates.map((date) => simulatedDayResultForLocalDay(date)),
      canonicalSimulatedDayTotalsByDate: Object.fromEntries(testDates.map((date) => [date, 24])),
      pastDayCounts: {},
      weatherSourceSummary: "actual_only",
      weatherKindUsed: "ACTUAL_LAST_YEAR",
    });

    const out = await buildGapfillCompareSimShared({
      userId: "u1",
      houseId: "h1",
      timezone: "America/Chicago",
      canonicalWindow: { startDate: testDates[0], endDate: testDates[testDates.length - 1] },
      testDateKeysLocal: new Set<string>(testDates),
      rebuildArtifact: false,
      compareFreshMode: "selected_days",
      includeFreshCompareCalc: false,
      selectedDaysLightweightArtifactRead: true,
    });

    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.displayVsFreshParityForScoredDays?.matches).toBe(false);
      expect(out.displayVsFreshParityForScoredDays?.mismatchCount).toBe(12);
      expect(out.displayVsFreshParityForScoredDays?.mismatchSampleDates).toHaveLength(10);
      expect(out.displayVsFreshParityForScoredDays?.mismatchSampleDates).toEqual(testDates.slice(0, 10));
      expect(out.displayVsFreshParityForScoredDays?.missingDisplaySimCount).toBe(0);
      expect(out.displayVsFreshParityForScoredDays?.comparableDateCount).toBe(12);
      expect(out.displayVsFreshParityForScoredDays?.complete).toBe(false);
    }
  });

  it("marks scored days missing canonical artifact simulated-day totals as missing_expected_reference", async () => {
    getCachedPastDataset.mockResolvedValue({
      inputHash: "hash-selected-default",
      datasetJson: {
        summary: { source: "SIMULATED", intervalsCount: 96, totalKwh: 24, start: "2026-01-01", end: "2026-01-01" },
        meta: { curveShapingVersion: "shared_curve_v2", excludedDateKeysFingerprint: "", weatherSourceSummary: "actual_only" },
        daily: [{ date: "2026-01-01", kwh: 24, source: "ACTUAL" }],
        monthly: [{ month: "2026-01", kwh: 24 }],
        series: {},
      },
      intervalsCodec: "v1_delta_varint",
      intervalsCompressed: Buffer.from("00", "hex"),
    });
    simulatePastSelectedDaysShared.mockResolvedValue({
      simulatedIntervals: oneChicagoLocalDayIntervals96("2026-01-01", 24 / 96),
      simulatedDayResults: [simulatedDayResultForLocalDay("2026-01-01")],
      canonicalSimulatedDayTotalsByDate: { "2026-01-01": 24 },
      pastDayCounts: {},
      weatherSourceSummary: "actual_only",
      weatherKindUsed: "ACTUAL_LAST_YEAR",
    });

    const out = await buildGapfillCompareSimShared({
      userId: "u1",
      houseId: "h1",
      timezone: "America/Chicago",
      canonicalWindow: { startDate: "2026-01-01", endDate: "2026-01-01" },
      testDateKeysLocal: new Set<string>(["2026-01-01"]),
      rebuildArtifact: false,
      compareFreshMode: "selected_days",
      includeFreshCompareCalc: false,
    });

    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.displayVsFreshParityForScoredDays?.matches).toBeNull();
      expect(out.displayVsFreshParityForScoredDays?.mismatchCount).toBe(0);
      expect(out.displayVsFreshParityForScoredDays?.missingDisplaySimCount).toBe(1);
      expect(out.displayVsFreshParityForScoredDays?.missingDisplaySimSampleDates).toEqual(["2026-01-01"]);
      expect(out.displayVsFreshParityForScoredDays?.comparableDateCount).toBe(0);
      expect(out.displayVsFreshParityForScoredDays?.complete).toBeNull();
      expect(out.displayVsFreshParityForScoredDays?.availability).toBe("missing_expected_reference");
      expect(out.displayVsFreshParityForScoredDays?.reasonCode).toBe("ARTIFACT_SIMULATED_REFERENCE_MISSING");
      expect(out.displayVsFreshParityForScoredDays?.parityDisplaySourceUsed).toBe("canonical_artifact_simulated_day_totals");
      expect(out.artifactSimulatedDayReferenceSource).toBe("canonical_artifact_simulated_day_totals");
      expect(out.displayVsFreshParityForScoredDays?.parityDisplayValueKind).toBe("missing_display_sim_reference");
      expect(out.displayVsFreshParityForScoredDays?.comparisonBasis).toBe(
        "artifact_simulated_display_rows_vs_compare_selected_days_fresh_calc"
      );
    }
  });

  it("fails shared compare with explicit reason when simulated day localDate disagrees with interval-derived keys", async () => {
    getCachedPastDataset.mockResolvedValue({
      inputHash: "hash-selected-default",
      datasetJson: {
        summary: { source: "SIMULATED", intervalsCount: 96, totalKwh: 24, start: "2026-01-01", end: "2026-01-01" },
        meta: {
          curveShapingVersion: "shared_curve_v2",
          excludedDateKeysFingerprint: "",
          weatherSourceSummary: "actual_only",
          canonicalArtifactSimulatedDayTotalsByDate: { "2026-01-01": 24 },
        },
        daily: [{ date: "2026-01-01", kwh: 24, source: "SIMULATED" }],
        monthly: [{ month: "2026-01", kwh: 24 }],
        series: {},
      },
      intervalsCodec: "v1_delta_varint",
      intervalsCompressed: Buffer.from("00", "hex"),
    });
    const invariantViolations = [{ localDate: "2026-01-01", intervalDerivedDateKeys: ["2026-01-02"] as string[] }];
    simulatePastSelectedDaysShared.mockResolvedValue({
      simulatedIntervals: null,
      error: "simulated_day_local_date_interval_invariant_violation",
      invariantViolations,
    });

    const out = await buildGapfillCompareSimShared({
      userId: "u1",
      houseId: "h1",
      timezone: "America/Chicago",
      canonicalWindow: { startDate: "2026-01-01", endDate: "2026-01-01" },
      testDateKeysLocal: new Set<string>(["2026-01-01"]),
      rebuildArtifact: false,
      compareFreshMode: "selected_days",
      includeFreshCompareCalc: false,
    });

    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.status).toBe(500);
      expect((out.body as { error?: string }).error).toBe("fresh_compare_simulation_failed");
      expect((out.body as { reasonCode?: string }).reasonCode).toBe(
        "SIMULATED_DAY_LOCAL_DATE_INTERVAL_INVARIANT_VIOLATION"
      );
      expect((out.body as { invariantViolations?: unknown }).invariantViolations).toEqual(invariantViolations);
    }
  });

  it("uses stored canonical artifact simulated-day totals for lightweight parity without decoding intervals", async () => {
    getLatestCachedPastDatasetByScenario.mockResolvedValue({
      inputHash: "hash-selected-default",
      updatedAt: new Date("2026-01-20T00:00:00.000Z"),
      datasetJson: {
        summary: { source: "SIMULATED", intervalsCount: 96, totalKwh: 24, start: "2026-01-01", end: "2026-01-01" },
        meta: {
          curveShapingVersion: "shared_curve_v2",
          excludedDateKeysFingerprint: "",
          weatherSourceSummary: "actual_only",
          canonicalArtifactSimulatedDayTotalsByDate: { "2026-01-01": 24 },
        },
        daily: [{ date: "2026-01-01", kwh: 99, source: "ACTUAL" }],
        monthly: [{ month: "2026-01", kwh: 24 }],
        series: {},
      },
      intervalsCodec: "v1_delta_varint",
      intervalsCompressed: Buffer.from("00", "hex"),
    });
    simulatePastSelectedDaysShared.mockResolvedValue({
      simulatedIntervals: oneChicagoLocalDayIntervals96("2026-01-01", 24 / 96),
      simulatedDayResults: [simulatedDayResultForLocalDay("2026-01-01")],
      canonicalSimulatedDayTotalsByDate: { "2026-01-01": 24 },
      pastDayCounts: {},
      weatherSourceSummary: "actual_only",
      weatherKindUsed: "ACTUAL_LAST_YEAR",
    });

    const out = await buildGapfillCompareSimShared({
      userId: "u1",
      houseId: "h1",
      timezone: "America/Chicago",
      canonicalWindow: { startDate: "2026-01-01", endDate: "2026-01-01" },
      testDateKeysLocal: new Set<string>(["2026-01-01"]),
      rebuildArtifact: false,
      compareFreshMode: "selected_days",
      includeFreshCompareCalc: false,
      selectedDaysLightweightArtifactRead: true,
    });

    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(decodeIntervalsV1).not.toHaveBeenCalled();
      expect(out.displayVsFreshParityForScoredDays?.matches).toBe(true);
      expect(out.displayVsFreshParityForScoredDays?.mismatchCount).toBe(0);
      expect(out.displayVsFreshParityForScoredDays?.missingDisplaySimCount).toBe(0);
      expect(out.scoredDayWeatherTruth?.availability).toBe("available");
      expect(out.scoredDayWeatherRows).toEqual([
        expect.objectContaining({
          localDate: "2026-01-01",
          avgTempF: 50,
          minTempF: 40,
          maxTempF: 60,
          hdd65: 15,
          cdd65: 0,
          weatherBasisUsed: "actual_only",
        }),
      ]);
      expect(out.displayVsFreshParityForScoredDays?.parityDisplaySourceUsed).toBe(
        "canonical_artifact_simulated_day_totals"
      );
      expect(out.artifactSimulatedDayReferenceSource).toBe("canonical_artifact_simulated_day_totals");
      expect(out.artifactSimulatedDayReferenceRows).toEqual([{ date: "2026-01-01", simKwh: 24 }]);
    }
  });

  it("scopes lightweight selected-days display and artifact reference rows to scored days only", async () => {
    const allDates = Array.from({ length: 31 }, (_, i) => `2026-01-${String(i + 1).padStart(2, "0")}`);
    const selectedDates = ["2026-01-05", "2026-01-20"];
    getCachedPastDataset.mockResolvedValue(null);
    getLatestCachedPastDatasetByScenario.mockResolvedValue({
      inputHash: "hash-selected-default",
      updatedAt: new Date("2026-01-31T00:00:00.000Z"),
      datasetJson: {
        summary: {
          source: "SIMULATED",
          intervalsCount: 96 * allDates.length,
          totalKwh: 24 * allDates.length,
          start: allDates[0],
          end: allDates[allDates.length - 1],
        },
        meta: {
          curveShapingVersion: "shared_curve_v2",
          excludedDateKeysFingerprint: "",
          weatherSourceSummary: "actual_only",
          canonicalArtifactSimulatedDayTotalsByDate: Object.fromEntries(allDates.map((date) => [date, 24])),
          weatherApiData: allDates.map((date) => ({
            dateKey: date,
            kind: "actual",
            tAvgF: 50,
            tMinF: 40,
            tMaxF: 60,
            hdd65: 15,
            cdd65: 0,
            source: "weather",
          })),
          simulatedDayDiagnosticsSample: allDates.map((date) => ({
            localDate: date,
            targetDayKwhBeforeWeather: 24,
            weatherAdjustedDayKwh: 24,
            dayTypeUsed: "weekday",
            shapeVariantUsed: "shared",
            finalDayKwh: 24,
            intervalSumKwh: 24,
            fallbackLevel: null,
          })),
        },
        daily: allDates.map((date) => ({ date, kwh: 24, source: "SIMULATED" })),
        monthly: [{ month: "2026-01", kwh: 24 * allDates.length }],
        series: {},
      },
      intervalsCodec: "v1_delta_varint",
      intervalsCompressed: Buffer.from("00", "hex"),
    });
    simulatePastSelectedDaysShared.mockResolvedValue({
      simulatedIntervals: selectedDates.flatMap((date) => oneChicagoLocalDayIntervals96(date, 24 / 96)),
      simulatedDayResults: selectedDates.map((date) => simulatedDayResultForLocalDay(date)),
      canonicalSimulatedDayTotalsByDate: Object.fromEntries(selectedDates.map((date) => [date, 24])),
      pastDayCounts: {},
      weatherSourceSummary: "actual_only",
      weatherKindUsed: "ACTUAL_LAST_YEAR",
    });

    const out = await buildGapfillCompareSimShared({
      userId: "u1",
      houseId: "h1",
      timezone: "America/Chicago",
      canonicalWindow: { startDate: "2026-01-01", endDate: "2026-01-31" },
      testDateKeysLocal: new Set<string>(selectedDates),
      rebuildArtifact: false,
      autoEnsureArtifact: false,
      compareFreshMode: "selected_days",
      includeFreshCompareCalc: false,
      selectedDaysLightweightArtifactRead: true,
    });

    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.simulatedChartDaily.map((row) => row.date)).toEqual(selectedDates);
      expect(out.artifactSimulatedDayReferenceRows?.map((row) => row.date)).toEqual(selectedDates);
      expect(out.scoredDayWeatherRows?.map((row) => row.localDate)).toEqual(selectedDates);
      expect(out.scoredDayWeatherRows?.every((row) => row.weatherBasisUsed === "actual_only")).toBe(true);
      expect(out.scoredDayWeatherTruth).toMatchObject({
        availability: "available",
        scoredDateCount: 2,
        weatherRowCount: 2,
        missingDateCount: 0,
      });
      expect(out.simulatedChartMonthly).toEqual([{ month: "2026-01", kwh: 744 }]);
      expect((out as any).selectedDaysRequestedCount ?? (out.modelAssumptions as any)?.selectedDaysRequestedCount).toBe(2);
      expect((out as any).selectedDaysScoredCount ?? (out.modelAssumptions as any)?.selectedDaysScoredCount).toBe(2);
      expect((out as any).freshSimIntervalCountSelectedDays ?? (out.modelAssumptions as any)?.freshSimIntervalCountSelectedDays).toBe(192);
      expect((out as any).artifactReferenceDayCountUsed ?? (out.modelAssumptions as any)?.artifactReferenceDayCountUsed).toBe(2);
      expect((out.modelAssumptions as any)?.weatherApiData?.map((row: any) => row.dateKey)).toEqual(selectedDates);
      expect((out.modelAssumptions as any)?.simulatedDayDiagnosticsSample?.map((row: any) => row.localDate)).toEqual(selectedDates);
      expect(simulatePastUsageDataset).not.toHaveBeenCalled();
    }
  });

  it("executes DB travel/vacant dates through shared selected-days compare for canonical parity validation", async () => {
    usageSimulatorBuildFindUnique.mockResolvedValueOnce({
      buildInputs: {
        mode: "SMT_BASELINE",
        canonicalMonths: ["2026-01"],
        timezone: "America/Chicago",
        travelRanges: [{ startDate: "2026-01-03", endDate: "2026-01-04" }],
      },
    });
    getLatestCachedPastDatasetByScenario.mockResolvedValue({
      inputHash: "hash-selected-default",
      updatedAt: new Date("2026-01-20T00:00:00.000Z"),
      datasetJson: {
        summary: {
          source: "SIMULATED",
          intervalsCount: 96 * 5,
          totalKwh: 24 * 5,
          start: "2026-01-01",
          end: "2026-01-05",
        },
        meta: {
          curveShapingVersion: "shared_curve_v2",
          excludedDateKeysFingerprint: "2026-01-03,2026-01-04",
          weatherSourceSummary: "actual_only",
          canonicalArtifactSimulatedDayTotalsByDate: {
            "2026-01-03": 24,
            "2026-01-04": 24,
          },
        },
        daily: [
          { date: "2026-01-01", kwh: 24, source: "ACTUAL" },
          { date: "2026-01-03", kwh: 24, source: "SIMULATED" },
          { date: "2026-01-04", kwh: 24, source: "SIMULATED" },
        ],
        monthly: [{ month: "2026-01", kwh: 120 }],
        series: {},
      },
      intervalsCodec: "v1_delta_varint",
      intervalsCompressed: Buffer.from("00", "hex"),
    });
    simulatePastSelectedDaysShared.mockImplementation(async ({
      selectedDateKeysLocal,
      forceModeledOutputKeepReferencePoolDateKeysLocal,
    }: any) => {
      const selected = Array.from((selectedDateKeysLocal ?? []) as string[]).sort();
      const keepRefLocals = forceModeledOutputKeepReferencePoolDateKeysLocal
        ? Array.from(forceModeledOutputKeepReferencePoolDateKeysLocal as Set<string>).sort()
        : [];
      return {
        simulatedIntervals: selected.flatMap((date) => oneChicagoLocalDayIntervals96(date, 24 / 96)),
        simulatedDayResults: selected.map((date) => simulatedDayResultForLocalDay(date)),
        canonicalSimulatedDayTotalsByDate: Object.fromEntries(selected.map((date) => [date, 24])),
        pastDayCounts: {},
        weatherSourceSummary: "actual_only",
        weatherKindUsed: "ACTUAL_LAST_YEAR",
        gapfillForceModeledKeepRefLocalDateKeys: keepRefLocals.length > 0 ? keepRefLocals : undefined,
        gapfillForceModeledKeepRefUtcKeyCount: keepRefLocals.length > 0 ? keepRefLocals.length : undefined,
      };
    });

    const selectedDaysCallsBefore = simulatePastSelectedDaysShared.mock.calls.length;
    const fullWindowCallsBeforeTravelParity = simulatePastFullWindowShared.mock.calls.length;

    const out = await buildGapfillCompareSimShared({
      userId: "u1",
      houseId: "h1",
      timezone: "America/Chicago",
      canonicalWindow: { startDate: "2026-01-01", endDate: "2026-01-05" },
      testDateKeysLocal: new Set<string>(["2026-01-01"]),
      rebuildArtifact: false,
      compareFreshMode: "selected_days",
      includeFreshCompareCalc: false,
      selectedDaysLightweightArtifactRead: true,
    });

    expect(out.ok).toBe(true);
    if (out.ok) {
      const selectedDaysCalls = simulatePastSelectedDaysShared.mock.calls.slice(selectedDaysCallsBefore);
      expect(selectedDaysCalls).toHaveLength(1);
      expect(simulatePastFullWindowShared.mock.calls.slice(fullWindowCallsBeforeTravelParity)).toHaveLength(0);
      const sharedCallDateKeys = Array.from(
        (((selectedDaysCalls[0] ?? [])[0] as any)?.selectedDateKeysLocal ?? []) as string[]
      ).sort();
      expect(sharedCallDateKeys).toEqual(["2026-01-01", "2026-01-03", "2026-01-04"]);
      const firstSelectedArgs = (selectedDaysCalls[0] ?? [])[0] as {
        forceModeledOutputKeepReferencePoolDateKeysLocal?: Set<string>;
      };
      expect(firstSelectedArgs?.forceModeledOutputKeepReferencePoolDateKeysLocal).toEqual(
        new Set<string>(["2026-01-01"])
      );
      expect(out.gapfillScoringDiagnostics?.run?.scoringMode).toBe("modeled_scored_days");
      expect(out.gapfillScoringDiagnostics?.run?.oneUnionRunUsed).toBe(true);
      expect(out.gapfillScoringDiagnostics?.scoredDays?.[0]?.compareOutputSource).toBe("MODELED_SIM");
      expect(out.gapfillScoringDiagnostics?.scoredDays?.[0]?.wasMeterPassthroughPrevented).toBe(true);
      expect(out.compareSharedCalcPath).toContain("slice_test_days_and_parity_days_from_same_union_run");
      expect(out.travelVacantParityTruth).toMatchObject({
        availability: "validated",
        requestedDateCount: 2,
        validatedDateCount: 2,
        mismatchCount: 0,
        missingArtifactReferenceCount: 0,
        missingFreshCompareCount: 0,
        exactProofSatisfied: true,
      });
      expect(out.travelVacantParityRows).toEqual([
        expect.objectContaining({
          localDate: "2026-01-03",
          artifactCanonicalSimDayKwh: 24,
          freshSharedDayCalcKwh: 24,
          parityMatch: true,
        }),
        expect.objectContaining({
          localDate: "2026-01-04",
          artifactCanonicalSimDayKwh: 24,
          freshSharedDayCalcKwh: 24,
          parityMatch: true,
        }),
      ]);
      expect(out.scoredDayWeatherRows?.map((row) => row.localDate)).toEqual(["2026-01-01"]);
      expect(out.simulatedChartDaily.map((row) => row.date)).toEqual(["2026-01-01"]);
    }
  });

  it("validates selected-days travel parity from fresh interval totals without widening to full-window recompute", async () => {
    usageSimulatorBuildFindUnique.mockResolvedValueOnce({
      buildInputs: {
        mode: "SMT_BASELINE",
        canonicalMonths: ["2026-01"],
        timezone: "America/Chicago",
        travelRanges: [{ startDate: "2026-01-03", endDate: "2026-01-04" }],
      },
    });
    getLatestCachedPastDatasetByScenario.mockResolvedValue({
      inputHash: "hash-selected-daily-totals",
      updatedAt: new Date("2026-01-20T00:00:00.000Z"),
      datasetJson: {
        summary: {
          source: "SIMULATED",
          intervalsCount: 96 * 5,
          totalKwh: 24 * 5,
          start: "2026-01-01",
          end: "2026-01-05",
        },
        meta: {
          curveShapingVersion: "shared_curve_v2",
          excludedDateKeysFingerprint: "2026-01-03,2026-01-04",
          weatherSourceSummary: "actual_only",
          canonicalArtifactSimulatedDayTotalsByDate: {
            "2026-01-03": 24,
            "2026-01-04": 24,
          },
        },
        daily: [
          { date: "2026-01-01", kwh: 24, source: "ACTUAL" },
          { date: "2026-01-03", kwh: 24, source: "SIMULATED" },
          { date: "2026-01-04", kwh: 24, source: "SIMULATED" },
        ],
        monthly: [{ month: "2026-01", kwh: 120 }],
        series: {},
      },
      intervalsCodec: "v1_delta_varint",
      intervalsCompressed: Buffer.from("00", "hex"),
    });
    simulatePastSelectedDaysShared.mockImplementation(async ({ selectedDateKeysLocal }: any) => {
      const selected = Array.from((selectedDateKeysLocal ?? []) as string[]).sort();
      return {
        simulatedIntervals: selected.flatMap((date) => oneChicagoLocalDayIntervals96(date, 24 / 96)),
        simulatedDayResults: selected.map((date) => simulatedDayResultForLocalDay(date)),
        canonicalSimulatedDayTotalsByDate: Object.fromEntries(selected.map((date) => [date, 24])),
        pastDayCounts: {},
        weatherSourceSummary: "actual_only",
        weatherKindUsed: "ACTUAL_LAST_YEAR",
      };
    });
    const phases: string[] = [];
    const selectedDaysCallsBefore = simulatePastSelectedDaysShared.mock.calls.length;
    const fullWindowCallsBeforePhases = simulatePastFullWindowShared.mock.calls.length;

    const out = await buildGapfillCompareSimShared({
      userId: "u1",
      houseId: "h1",
      timezone: "America/Chicago",
      canonicalWindow: { startDate: "2026-01-01", endDate: "2026-01-05" },
      testDateKeysLocal: new Set<string>(["2026-01-01"]),
      rebuildArtifact: false,
      compareFreshMode: "selected_days",
      includeFreshCompareCalc: false,
      selectedDaysLightweightArtifactRead: true,
      onPhaseUpdate: (phase) => {
        phases.push(String(phase));
      },
    });

    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.compareFreshModeUsed).toBe("selected_days");
      expect(simulatePastFullWindowShared.mock.calls.slice(fullWindowCallsBeforePhases)).toHaveLength(0);
      expect(simulatePastSelectedDaysShared.mock.calls.slice(selectedDaysCallsBefore)).toHaveLength(1);
      expect(out.compareSharedCalcPath).toContain("slice_test_days_and_parity_days_from_same_union_run");
      expect(out.travelVacantParityTruth).toMatchObject({
        availability: "validated",
        requestedDateCount: 2,
        validatedDateCount: 2,
        missingFreshCompareCount: 0,
      });
      expect(out.travelVacantParityRows).toEqual([
        expect.objectContaining({
          localDate: "2026-01-03",
          freshSharedDayCalcKwh: 24,
          parityMatch: true,
        }),
        expect.objectContaining({
          localDate: "2026-01-04",
          freshSharedDayCalcKwh: 24,
          parityMatch: true,
        }),
      ]);
      expect(phases).toContain("build_shared_compare_scored_row_keys_ready");
      expect(phases).toContain("build_shared_compare_scored_row_alignment_ready");
      expect(phases).toContain("build_shared_compare_scored_row_merge_ready");
      expect(phases).toContain("build_shared_compare_scored_rows_ready");
      expect(phases).toContain("build_shared_compare_metrics_ready");
      expect(phases).toContain("build_shared_compare_finalize_start");
    }
  });

  it("handles selected-date vs available-daily mismatch without widening scored-row merge scope", async () => {
    const selectedDates = Array.from({ length: 21 }, (_, idx) => {
      const day = String(idx + 1).padStart(2, "0");
      return `2026-01-${day}`;
    });
    const availableDailyDates = selectedDates.slice(0, 19);
    getLatestCachedPastDatasetByScenario.mockResolvedValue({
      inputHash: "hash-selected-21-with-19-daily",
      updatedAt: new Date("2026-01-31T00:00:00.000Z"),
      datasetJson: {
        summary: {
          source: "SIMULATED",
          intervalsCount: 96 * 31,
          totalKwh: 24 * 31,
          start: "2026-01-01",
          end: "2026-01-31",
        },
        meta: {
          curveShapingVersion: "shared_curve_v2",
          excludedDateKeysFingerprint: "",
          weatherSourceSummary: "actual_only",
          canonicalArtifactSimulatedDayTotalsByDate: Object.fromEntries(
            availableDailyDates.map((dk) => [dk, 24])
          ),
        },
        daily: availableDailyDates.map((dk) => ({ date: dk, kwh: 24, source: "SIMULATED" })),
        monthly: [{ month: "2026-01", kwh: 24 * 31 }],
        series: {},
      },
      intervalsCodec: "v1_delta_varint",
      intervalsCompressed: Buffer.from("00", "hex"),
    });
    simulatePastSelectedDaysShared.mockImplementation(async ({ selectedDateKeysLocal }: any) => ({
      simulatedIntervals: Array.from(selectedDateKeysLocal ?? []).flatMap((dk) =>
        oneChicagoLocalDayIntervals96(String(dk), 24 / 96)
      ),
      simulatedDayResults: Array.from(selectedDateKeysLocal ?? []).map((dk) =>
        simulatedDayResultForLocalDay(String(dk))
      ),
      canonicalSimulatedDayTotalsByDate: Object.fromEntries(
        Array.from(selectedDateKeysLocal ?? []).map((dk) => [String(dk), 24])
      ),
      pastDayCounts: {},
      weatherSourceSummary: "actual_only",
      weatherKindUsed: "ACTUAL_LAST_YEAR",
    }));
    const phases: string[] = [];
    let mergeReadyMeta: Record<string, unknown> | null = null;

    const out = await buildGapfillCompareSimShared({
      userId: "u1",
      houseId: "h1",
      timezone: "America/Chicago",
      canonicalWindow: { startDate: selectedDates[0]!, endDate: selectedDates[selectedDates.length - 1]! },
      testDateKeysLocal: new Set<string>(selectedDates),
      rebuildArtifact: false,
      compareFreshMode: "selected_days",
      includeFreshCompareCalc: false,
      selectedDaysLightweightArtifactRead: true,
      onPhaseUpdate: (phase, meta) => {
        phases.push(String(phase));
        if (String(phase) === "build_shared_compare_scored_row_merge_ready") mergeReadyMeta = meta ?? null;
      },
    });

    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.compareFreshModeUsed).toBe("selected_days");
      expect(simulatePastFullWindowShared).not.toHaveBeenCalled();
      expect(out.simulatedChartDaily.map((row) => row.date)).toEqual(availableDailyDates);
      expect(out.displayVsFreshParityForScoredDays?.availability).toBe("available");
      expect(out.displayVsFreshParityForScoredDays?.comparableDateCount).toBe(19);
      expect(out.displayVsFreshParityForScoredDays?.missingDisplaySimCount).toBe(2);
      expect(out.displayVsFreshParityForScoredDays?.reasonCode).toBe("ARTIFACT_SIMULATED_REFERENCE_AVAILABLE");
      expect(Number(mergeReadyMeta?.["alignedComparableDateCount"])).toBe(19);
      expect(Number(mergeReadyMeta?.["mergedComparableDateCount"])).toBe(19);
      expect(mergeReadyMeta?.["preservedComparableHandoff"]).toBe(true);
      expect(phases).toContain("build_shared_compare_scored_row_keys_ready");
      expect(phases).toContain("build_shared_compare_scored_row_alignment_ready");
      expect(phases).toContain("build_shared_compare_scored_row_merge_ready");
      expect(phases).toContain("build_shared_compare_scored_rows_ready");
    }
  });

  it("resolves compact scoped artifact canonical totals when meta keys are ISO-normalized", async () => {
    usageSimulatorBuildFindUnique.mockResolvedValueOnce({
      buildInputs: {
        mode: "SMT_BASELINE",
        canonicalMonths: ["2026-01"],
        timezone: "America/Chicago",
        travelRanges: [],
      },
    });
    getLatestCachedPastDatasetByScenario.mockResolvedValue({
      inputHash: "hash-iso-meta-keys",
      updatedAt: new Date("2026-01-20T00:00:00.000Z"),
      datasetJson: {
        summary: {
          source: "SIMULATED",
          intervalsCount: 96 * 5,
          totalKwh: 24 * 5,
          start: "2026-01-01",
          end: "2026-01-05",
        },
        meta: {
          curveShapingVersion: "shared_curve_v2",
          excludedDateKeysFingerprint: "",
          weatherSourceSummary: "actual_only",
          canonicalArtifactSimulatedDayTotalsByDate: {
            "2026-01-01T00:00:00.000Z": 24,
          },
        },
        daily: [{ date: "2026-01-01", kwh: 24, source: "SIMULATED" }],
        monthly: [{ month: "2026-01", kwh: 120 }],
        series: {},
      },
      intervalsCodec: "v1_delta_varint",
      intervalsCompressed: Buffer.from("00", "hex"),
    });
    simulatePastSelectedDaysShared.mockImplementation(async ({ selectedDateKeysLocal }: any) => {
      const selected = Array.from((selectedDateKeysLocal ?? []) as string[]).sort();
      return {
        simulatedIntervals: selected.flatMap((date) => oneChicagoLocalDayIntervals96(date, 24 / 96)),
        simulatedDayResults: selected.map((date) => simulatedDayResultForLocalDay(date)),
        canonicalSimulatedDayTotalsByDate: Object.fromEntries(selected.map((date) => [date, 24])),
        pastDayCounts: {},
        weatherSourceSummary: "actual_only",
        weatherKindUsed: "ACTUAL_LAST_YEAR",
      };
    });
    const selectedCallsBefore = simulatePastSelectedDaysShared.mock.calls.length;
    const out = await buildGapfillCompareSimShared({
      userId: "u1",
      houseId: "h1",
      timezone: "America/Chicago",
      canonicalWindow: { startDate: "2026-01-01", endDate: "2026-01-05" },
      testDateKeysLocal: new Set<string>(["2026-01-01"]),
      rebuildArtifact: false,
      compareFreshMode: "selected_days",
      includeFreshCompareCalc: false,
      selectedDaysLightweightArtifactRead: true,
    });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(simulatePastSelectedDaysShared.mock.calls.slice(selectedCallsBefore)).toHaveLength(1);
      expect(out.displayVsFreshParityForScoredDays?.comparableDateCount).toBe(1);
      expect(out.displayVsFreshParityForScoredDays?.missingDisplaySimCount).toBe(0);
      expect((out.modelAssumptions as any)?.artifactReferenceDayCountUsed).toBe(1);
    }
  });

  it("fills scored-day artifact canonical from daily SIMULATED when meta omits bounded date keys", async () => {
    usageSimulatorBuildFindUnique.mockResolvedValueOnce({
      buildInputs: {
        mode: "SMT_BASELINE",
        canonicalMonths: ["2026-01"],
        timezone: "America/Chicago",
        travelRanges: [],
      },
    });
    getLatestCachedPastDatasetByScenario.mockResolvedValue({
      inputHash: "hash-daily-augment-canonical",
      updatedAt: new Date("2026-01-20T00:00:00.000Z"),
      datasetJson: {
        summary: {
          source: "SIMULATED",
          intervalsCount: 96 * 5,
          totalKwh: 24 * 5,
          start: "2026-01-01",
          end: "2026-01-05",
        },
        meta: {
          curveShapingVersion: "shared_curve_v2",
          excludedDateKeysFingerprint: "",
          weatherSourceSummary: "actual_only",
          canonicalArtifactSimulatedDayTotalsByDate: {},
        },
        daily: [{ date: "2026-01-01", kwh: 24, source: "SIMULATED" }],
        monthly: [{ month: "2026-01", kwh: 120 }],
        series: {},
      },
      intervalsCodec: "v1_delta_varint",
      intervalsCompressed: Buffer.from("00", "hex"),
    });
    simulatePastSelectedDaysShared.mockImplementation(async ({ selectedDateKeysLocal }: any) => {
      const selected = Array.from((selectedDateKeysLocal ?? []) as string[]).sort();
      return {
        simulatedIntervals: selected.flatMap((date) => oneChicagoLocalDayIntervals96(date, 24 / 96)),
        simulatedDayResults: selected.map((date) => simulatedDayResultForLocalDay(date)),
        canonicalSimulatedDayTotalsByDate: Object.fromEntries(selected.map((date) => [date, 24])),
        pastDayCounts: {},
        weatherSourceSummary: "actual_only",
        weatherKindUsed: "ACTUAL_LAST_YEAR",
      };
    });
    const out = await buildGapfillCompareSimShared({
      userId: "u1",
      houseId: "h1",
      timezone: "America/Chicago",
      canonicalWindow: { startDate: "2026-01-01", endDate: "2026-01-05" },
      testDateKeysLocal: new Set<string>(["2026-01-01"]),
      rebuildArtifact: false,
      compareFreshMode: "selected_days",
      includeFreshCompareCalc: false,
      selectedDaysLightweightArtifactRead: true,
    });
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.displayVsFreshParityForScoredDays?.comparableDateCount).toBe(1);
      expect(out.displayVsFreshParityForScoredDays?.missingDisplaySimCount).toBe(0);
      expect((out.modelAssumptions as any)?.artifactReferenceDayCountUsed).toBe(1);
    }
  });

  it("does not double-count selected-day totals when simulatedDayResults and intervals both exist", async () => {
    usageSimulatorBuildFindUnique.mockResolvedValueOnce({
      buildInputs: {
        mode: "SMT_BASELINE",
        canonicalMonths: ["2026-01"],
        timezone: "America/Chicago",
        travelRanges: [{ startDate: "2026-01-03", endDate: "2026-01-04" }],
      },
    });
    getLatestCachedPastDatasetByScenario.mockResolvedValue({
      inputHash: "hash-selected-no-double-count",
      updatedAt: new Date("2026-01-20T00:00:00.000Z"),
      datasetJson: {
        summary: {
          source: "SIMULATED",
          intervalsCount: 96 * 5,
          totalKwh: 24 * 5,
          start: "2026-01-01",
          end: "2026-01-05",
        },
        meta: {
          curveShapingVersion: "shared_curve_v2",
          excludedDateKeysFingerprint: "2026-01-03,2026-01-04",
          weatherSourceSummary: "actual_only",
          canonicalArtifactSimulatedDayTotalsByDate: {
            "2026-01-03": 24,
            "2026-01-04": 24,
          },
        },
        daily: [
          { date: "2026-01-01", kwh: 24, source: "ACTUAL" },
          { date: "2026-01-03", kwh: 24, source: "SIMULATED" },
          { date: "2026-01-04", kwh: 24, source: "SIMULATED" },
        ],
        monthly: [{ month: "2026-01", kwh: 120 }],
        series: {},
      },
      intervalsCodec: "v1_delta_varint",
      intervalsCompressed: Buffer.from("00", "hex"),
    });
    simulatePastSelectedDaysShared.mockImplementation(async ({ selectedDateKeysLocal }: any) => {
      const selected = Array.from((selectedDateKeysLocal ?? []) as string[]).sort();
      return {
        simulatedIntervals: selected.flatMap((date) => oneChicagoLocalDayIntervals96(date, 24 / 96)),
        simulatedDayResults: selected.map((date) => simulatedDayResultForLocalDay(date)),
        canonicalSimulatedDayTotalsByDate: Object.fromEntries(selected.map((date) => [date, 24])),
        pastDayCounts: {},
        weatherSourceSummary: "actual_only",
        weatherKindUsed: "ACTUAL_LAST_YEAR",
      };
    });

    const selectedDaysCallsBefore = simulatePastSelectedDaysShared.mock.calls.length;
    const fullWindowCallsBeforeDoubleCount = simulatePastFullWindowShared.mock.calls.length;

    const out = await buildGapfillCompareSimShared({
      userId: "u1",
      houseId: "h1",
      timezone: "America/Chicago",
      canonicalWindow: { startDate: "2026-01-01", endDate: "2026-01-05" },
      testDateKeysLocal: new Set<string>(["2026-01-01"]),
      rebuildArtifact: false,
      compareFreshMode: "selected_days",
      includeFreshCompareCalc: false,
      selectedDaysLightweightArtifactRead: true,
    });

    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.compareFreshModeUsed).toBe("selected_days");
      expect(simulatePastFullWindowShared.mock.calls.slice(fullWindowCallsBeforeDoubleCount)).toHaveLength(0);
      expect(simulatePastSelectedDaysShared.mock.calls.slice(selectedDaysCallsBefore)).toHaveLength(1);
      expect(out.compareSharedCalcPath).toContain("slice_test_days_and_parity_days_from_same_union_run");
      expect(out.travelVacantParityTruth).toMatchObject({
        availability: "validated",
        requestedDateCount: 2,
        validatedDateCount: 2,
        mismatchCount: 0,
        missingFreshCompareCount: 0,
      });
      expect(out.travelVacantParityRows).toEqual([
        expect.objectContaining({
          localDate: "2026-01-03",
          freshSharedDayCalcKwh: 24,
          parityMatch: true,
        }),
        expect.objectContaining({
          localDate: "2026-01-04",
          freshSharedDayCalcKwh: 24,
          parityMatch: true,
        }),
      ]);
    }
  });

  it("does not treat passthrough selected-day intervals as fresh simulated ownership without day results", async () => {
    usageSimulatorBuildFindUnique.mockResolvedValueOnce({
      buildInputs: {
        mode: "SMT_BASELINE",
        canonicalMonths: ["2026-01"],
        timezone: "America/Chicago",
        travelRanges: [{ startDate: "2026-01-03", endDate: "2026-01-03" }],
      },
    });
    getLatestCachedPastDatasetByScenario.mockResolvedValue({
      inputHash: "hash-selected-owned-days-only",
      updatedAt: new Date("2026-01-20T00:00:00.000Z"),
      datasetJson: {
        summary: {
          source: "SIMULATED",
          intervalsCount: 96 * 3,
          totalKwh: 24 * 3,
          start: "2026-01-01",
          end: "2026-01-03",
        },
        meta: {
          curveShapingVersion: "shared_curve_v2",
          excludedDateKeysFingerprint: "2026-01-03",
          weatherSourceSummary: "actual_only",
          canonicalArtifactSimulatedDayTotalsByDate: {
            "2026-01-03": 24,
          },
        },
        daily: [
          { date: "2026-01-01", kwh: 24, source: "ACTUAL" },
          { date: "2026-01-02", kwh: 24, source: "ACTUAL" },
          { date: "2026-01-03", kwh: 24, source: "SIMULATED" },
        ],
        monthly: [{ month: "2026-01", kwh: 72 }],
        series: {},
      },
      intervalsCodec: "v1_delta_varint",
      intervalsCompressed: Buffer.from("00", "hex"),
    });
    simulatePastSelectedDaysShared.mockResolvedValue({
      simulatedIntervals: [
        ...oneChicagoLocalDayIntervals96("2026-01-01", 24 / 96),
        ...oneChicagoLocalDayIntervals96("2026-01-03", 24 / 96),
      ],
      simulatedDayResults: [simulatedDayResultForLocalDay("2026-01-03")],
      canonicalSimulatedDayTotalsByDate: { "2026-01-03": 24 },
      pastDayCounts: {},
      weatherSourceSummary: "actual_only",
      weatherKindUsed: "ACTUAL_LAST_YEAR",
    });

    const out = await buildGapfillCompareSimShared({
      userId: "u1",
      houseId: "h1",
      timezone: "America/Chicago",
      canonicalWindow: { startDate: "2026-01-01", endDate: "2026-01-03" },
      testDateKeysLocal: new Set<string>(["2026-01-01", "2026-01-03"]),
      rebuildArtifact: false,
      compareFreshMode: "selected_days",
      includeFreshCompareCalc: false,
      selectedDaysLightweightArtifactRead: true,
    });

    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.compareFreshModeUsed).toBe("selected_days");
      expect(out.simulatedTestIntervals).toHaveLength(96);
      expect((out as any).selectedDaysScoredCount ?? (out.modelAssumptions as any)?.selectedDaysScoredCount).toBe(1);
      expect(out.scoredTestDaysMissingSimulatedOwnershipCount).toBe(1);
      expect(out.freshCompareScoredDaySimTotalsByDate).toEqual({ "2026-01-03": 24 });
      expect(out.displayVsFreshParityForScoredDays).toMatchObject({
        availability: "available",
        comparableDateCount: 1,
        missingDisplaySimCount: 1,
      });
    }
  });

  it("does not use localDate-only selected-day results as simulated ownership", async () => {
    getLatestCachedPastDatasetByScenario.mockResolvedValue({
      inputHash: "hash-selected-no-localdate-fallback",
      updatedAt: new Date("2026-01-20T00:00:00.000Z"),
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
          weatherSourceSummary: "actual_only",
          canonicalArtifactSimulatedDayTotalsByDate: {
            "2026-01-01": 24,
          },
        },
        daily: [{ date: "2026-01-01", kwh: 24, source: "SIMULATED" }],
        monthly: [{ month: "2026-01", kwh: 24 }],
        series: {},
      },
      intervalsCodec: "v1_delta_varint",
      intervalsCompressed: Buffer.from("00", "hex"),
    });
    simulatePastSelectedDaysShared.mockResolvedValue({
      simulatedIntervals: oneChicagoLocalDayIntervals96("2026-01-01", 24 / 96),
      simulatedDayResults: [
        {
          localDate: "2026-01-01",
          intervals: [],
          intervalSumKwh: 24,
          finalDayKwh: 24,
        },
      ],
      pastDayCounts: {},
      weatherSourceSummary: "actual_only",
      weatherKindUsed: "ACTUAL_LAST_YEAR",
    });

    const out = await buildGapfillCompareSimShared({
      userId: "u1",
      houseId: "h1",
      timezone: "America/Chicago",
      canonicalWindow: { startDate: "2026-01-01", endDate: "2026-01-01" },
      testDateKeysLocal: new Set<string>(["2026-01-01"]),
      rebuildArtifact: false,
      compareFreshMode: "selected_days",
      includeFreshCompareCalc: false,
      selectedDaysLightweightArtifactRead: true,
    });

    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.simulatedTestIntervals).toHaveLength(0);
      expect((out as any).selectedDaysScoredCount ?? (out.modelAssumptions as any)?.selectedDaysScoredCount).toBe(0);
      expect(out.scoredTestDaysMissingSimulatedOwnershipCount).toBe(1);
      expect(out.freshCompareScoredDaySimTotalsByDate).toEqual({});
      expect(out.displayVsFreshParityForScoredDays).toMatchObject({
        availability: "missing_fresh_compare_sim",
        reasonCode: "SCORED_DAY_FRESH_COMPARE_SIM_MISSING",
        parityDisplayValueKind: "missing_fresh_compare_sim_day_total",
        mismatchCount: 0,
        missingFreshCompareSimCount: 1,
        comparableDateCount: 1,
        missingDisplaySimCount: 0,
      });
    }
  });

  it("does not derive selected-day compare totals from day results when canonical selected-day totals are absent", async () => {
    getLatestCachedPastDatasetByScenario.mockResolvedValue({
      inputHash: "hash-selected-missing-canonical-selected-total",
      updatedAt: new Date("2026-01-20T00:00:00.000Z"),
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
          weatherSourceSummary: "actual_only",
          canonicalArtifactSimulatedDayTotalsByDate: {
            "2026-01-01": 24,
          },
        },
        daily: [{ date: "2026-01-01", kwh: 24, source: "SIMULATED" }],
        monthly: [{ month: "2026-01", kwh: 24 }],
        series: {},
      },
      intervalsCodec: "v1_delta_varint",
      intervalsCompressed: Buffer.from("00", "hex"),
    });
    simulatePastSelectedDaysShared.mockResolvedValue({
      simulatedIntervals: oneChicagoLocalDayIntervals96("2026-01-01", 24 / 96),
      simulatedDayResults: [simulatedDayResultForLocalDay("2026-01-01")],
      pastDayCounts: {},
      weatherSourceSummary: "actual_only",
      weatherKindUsed: "ACTUAL_LAST_YEAR",
    });

    const out = await buildGapfillCompareSimShared({
      userId: "u1",
      houseId: "h1",
      timezone: "America/Chicago",
      canonicalWindow: { startDate: "2026-01-01", endDate: "2026-01-01" },
      testDateKeysLocal: new Set<string>(["2026-01-01"]),
      rebuildArtifact: false,
      compareFreshMode: "selected_days",
      includeFreshCompareCalc: false,
      selectedDaysLightweightArtifactRead: true,
    });

    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.simulatedTestIntervals).toHaveLength(0);
      expect((out as any).selectedDaysScoredCount ?? (out.modelAssumptions as any)?.selectedDaysScoredCount).toBe(0);
      expect(out.scoredTestDaysMissingSimulatedOwnershipCount).toBe(1);
      expect(out.freshCompareScoredDaySimTotalsByDate).toEqual({});
      expect(out.displayVsFreshParityForScoredDays).toMatchObject({
        availability: "missing_fresh_compare_sim",
        reasonCode: "SCORED_DAY_FRESH_COMPARE_SIM_MISSING",
        parityDisplayValueKind: "missing_fresh_compare_sim_day_total",
        mismatchCount: 0,
        missingFreshCompareSimCount: 1,
        comparableDateCount: 1,
        missingDisplaySimCount: 0,
      });
    }
  });

  it("uses fresh interval-summed day totals for travel/vacant parity proof when day-result totals drift", async () => {
    usageSimulatorBuildFindUnique.mockResolvedValueOnce({
      buildInputs: {
        mode: "SMT_BASELINE",
        canonicalMonths: ["2026-01"],
        timezone: "America/Chicago",
        travelRanges: [{ startDate: "2026-01-03", endDate: "2026-01-04" }],
      },
    });
    getLatestCachedPastDatasetByScenario.mockResolvedValue({
      inputHash: "hash-selected-parity-interval-basis",
      updatedAt: new Date("2026-01-20T00:00:00.000Z"),
      datasetJson: {
        summary: {
          source: "SIMULATED",
          intervalsCount: 96 * 5,
          totalKwh: 24 * 5,
          start: "2026-01-01",
          end: "2026-01-05",
        },
        meta: {
          curveShapingVersion: "shared_curve_v2",
          excludedDateKeysFingerprint: "2026-01-03,2026-01-04",
          weatherSourceSummary: "actual_only",
          canonicalArtifactSimulatedDayTotalsByDate: {
            "2026-01-03": 24,
            "2026-01-04": 24,
          },
        },
        daily: [
          { date: "2026-01-01", kwh: 24, source: "ACTUAL" },
          { date: "2026-01-03", kwh: 24, source: "SIMULATED" },
          { date: "2026-01-04", kwh: 24, source: "SIMULATED" },
        ],
        monthly: [{ month: "2026-01", kwh: 120 }],
        series: {},
      },
      intervalsCodec: "v1_delta_varint",
      intervalsCompressed: Buffer.from("00", "hex"),
    });
    simulatePastSelectedDaysShared.mockImplementation(async ({ selectedDateKeysLocal }: any) => {
      const selected = Array.from((selectedDateKeysLocal ?? []) as string[]).sort();
      const isTravelParitySet = selected.includes("2026-01-03") || selected.includes("2026-01-04");
      return {
        simulatedIntervals: selected.flatMap((date) => oneChicagoLocalDayIntervals96(date, 24 / 96)),
        simulatedDayResults: selected.map((date) => ({
          localDate: date,
          intervals: oneChicagoLocalDayIntervals96(date, 24 / 96),
          // Intentionally drift day-level totals away from interval sums for parity dates.
          intervalSumKwh: isTravelParitySet ? 24.09 : 24,
          finalDayKwh: isTravelParitySet ? 24.09 : 24,
        })),
        canonicalSimulatedDayTotalsByDate: Object.fromEntries(selected.map((date) => [date, 24])),
        pastDayCounts: {},
        weatherSourceSummary: "actual_only",
        weatherKindUsed: "ACTUAL_LAST_YEAR",
      };
    });

    const out = await buildGapfillCompareSimShared({
      userId: "u1",
      houseId: "h1",
      timezone: "America/Chicago",
      canonicalWindow: { startDate: "2026-01-01", endDate: "2026-01-05" },
      testDateKeysLocal: new Set<string>(["2026-01-01"]),
      rebuildArtifact: false,
      compareFreshMode: "selected_days",
      includeFreshCompareCalc: false,
      selectedDaysLightweightArtifactRead: true,
    });

    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.compareFreshModeUsed).toBe("selected_days");
      expect(out.travelVacantParityTruth).toMatchObject({
        availability: "validated",
        requestedDateCount: 2,
        validatedDateCount: 2,
        mismatchCount: 0,
        missingFreshCompareCount: 0,
      });
      expect(out.travelVacantParityRows).toEqual([
        expect.objectContaining({
          localDate: "2026-01-03",
          artifactCanonicalSimDayKwh: 24,
          freshSharedDayCalcKwh: 24,
          parityMatch: true,
        }),
        expect.objectContaining({
          localDate: "2026-01-04",
          artifactCanonicalSimDayKwh: 24,
          freshSharedDayCalcKwh: 24,
          parityMatch: true,
        }),
      ]);
    }
  });

  it("uses union selected-days fresh execution for exact travel parity (same path as non-exact)", async () => {
    usageSimulatorBuildFindUnique.mockResolvedValueOnce({
      buildInputs: {
        mode: "SMT_BASELINE",
        canonicalMonths: ["2026-01"],
        timezone: "America/Chicago",
        travelRanges: [{ startDate: "2026-01-03", endDate: "2026-01-04" }],
      },
    });
    getCachedPastDataset.mockResolvedValue({
      inputHash: "hash-selected-exact",
      datasetJson: {
        summary: {
          source: "SIMULATED",
          intervalsCount: 96 * 5,
          totalKwh: 24 * 5,
          start: "2026-01-01",
          end: "2026-01-05",
        },
        meta: {
          curveShapingVersion: "shared_curve_v2",
          excludedDateKeysFingerprint: "2026-01-03,2026-01-04",
          weatherSourceSummary: "actual_only",
          canonicalArtifactSimulatedDayTotalsByDate: {
            "2026-01-03": 24,
            "2026-01-04": 24,
          },
        },
        daily: [
          { date: "2026-01-01", kwh: 24, source: "ACTUAL" },
          { date: "2026-01-03", kwh: 24, source: "SIMULATED" },
          { date: "2026-01-04", kwh: 24, source: "SIMULATED" },
        ],
        monthly: [{ month: "2026-01", kwh: 120 }],
        series: {},
      },
      intervalsCodec: "v1_delta_varint",
      intervalsCompressed: Buffer.from("00", "hex"),
    });
    decodeIntervalsV1.mockReturnValue([
      ...oneChicagoLocalDayIntervals96("2026-01-01", 24 / 96),
      ...oneChicagoLocalDayIntervals96("2026-01-02", 24 / 96),
      ...oneChicagoLocalDayIntervals96("2026-01-03", 24 / 96),
      ...oneChicagoLocalDayIntervals96("2026-01-04", 24 / 96),
      ...oneChicagoLocalDayIntervals96("2026-01-05", 24 / 96),
    ]);
    simulatePastSelectedDaysShared.mockImplementation(async ({ selectedDateKeysLocal }: any) => {
      const keys = Array.from(selectedDateKeysLocal ?? []).map((dk) => String(dk).slice(0, 10));
      return {
        simulatedIntervals: keys.flatMap((dk) => oneChicagoLocalDayIntervals96(dk, 24 / 96)),
        simulatedDayResults: keys.map((dk) => simulatedDayResultForLocalDay(dk)),
        canonicalSimulatedDayTotalsByDate: Object.fromEntries(keys.map((dk) => [dk, 24])),
        pastDayCounts: {},
        actualWxByDateKey: new Map<string, { tAvgF: number; tMinF: number; tMaxF: number; hdd65: number; cdd65: number; source: string }>([
          ["2026-01-01", { tAvgF: 50, tMinF: 40, tMaxF: 60, hdd65: 15, cdd65: 0, source: "OPEN_METEO" }],
        ]),
        weatherSourceSummary: "actual_only",
        weatherKindUsed: "ACTUAL_LAST_YEAR",
      };
    });
    simulatePastFullWindowShared.mockResolvedValue({
      simulatedIntervals: [
        ...oneChicagoLocalDayIntervals96("2026-01-01", 24 / 96),
        ...oneChicagoLocalDayIntervals96("2026-01-02", 24 / 96),
        ...oneChicagoLocalDayIntervals96("2026-01-03", 24 / 96),
        ...oneChicagoLocalDayIntervals96("2026-01-04", 24 / 96),
        ...oneChicagoLocalDayIntervals96("2026-01-05", 24 / 96),
      ],
      canonicalSimulatedDayTotalsByDate: {
        "2026-01-01": 24,
        "2026-01-02": 24,
        "2026-01-03": 24,
        "2026-01-04": 24,
        "2026-01-05": 24,
      },
      actualWxByDateKey: new Map<string, unknown>(),
      weatherSourceSummary: "actual_only",
      weatherKindUsed: "ACTUAL_LAST_YEAR",
      weatherProviderName: "OPEN_METEO",
      weatherFallbackReason: null,
    });
    const selectedDaysCallsBefore = simulatePastSelectedDaysShared.mock.calls.length;
    const fullWindowCallsBefore = simulatePastFullWindowShared.mock.calls.length;
    const intervalFingerprintCallsBefore = getIntervalDataFingerprint.mock.calls.length;
    const weatherIdentityCallsBefore = computePastWeatherIdentity.mock.calls.length;
    const usageShapeIdentityCallsBefore = getUsageShapeProfileIdentityForPast.mock.calls.length;

    const out = await buildGapfillCompareSimShared({
      userId: "u1",
      houseId: "h1",
      timezone: "America/Chicago",
      canonicalWindow: { startDate: "2026-01-01", endDate: "2026-01-05" },
      testDateKeysLocal: new Set<string>(["2026-01-01"]),
      rebuildArtifact: false,
      compareFreshMode: "selected_days",
      includeFreshCompareCalc: false,
      selectedDaysLightweightArtifactRead: true,
      artifactExactScenarioId: "gapfill_lab",
      artifactExactInputHash: "hash-selected-exact",
      requireExactArtifactMatch: true,
      artifactIdentitySource: "same_run_artifact_ensure",
    });

    expect(out.ok).toBe(true);
    if (out.ok) {
      const selectedDaysCalls = simulatePastSelectedDaysShared.mock.calls.slice(selectedDaysCallsBefore);
      const fullWindowCalls = simulatePastFullWindowShared.mock.calls.slice(fullWindowCallsBefore);
      expect(selectedDaysCalls).toHaveLength(1);
      expect(fullWindowCalls).toHaveLength(0);
      expect(
        Array.from(
          (((selectedDaysCalls[0] ?? [])[0] as any)?.selectedDateKeysLocal ?? new Set()) as Set<string>
        ).sort()
      ).toEqual(["2026-01-01", "2026-01-03", "2026-01-04"]);
      expect(getIntervalDataFingerprint.mock.calls.length).toBe(intervalFingerprintCallsBefore);
      expect(computePastWeatherIdentity.mock.calls.length).toBe(weatherIdentityCallsBefore);
      expect(getUsageShapeProfileIdentityForPast.mock.calls.length).toBe(usageShapeIdentityCallsBefore);
      expect(decodeIntervalsV1).not.toHaveBeenCalled();
      expect(out.compareCalculationScope).toBe("selected_days_shared_path_only");
      expect(out.compareFreshModeUsed).toBe("selected_days");
      expect(out.compareSharedCalcPath).toContain("simulatePastSelectedDaysShared");
      expect(out.compareSharedCalcPath).toContain("simulatePastUsageDataset");
      expect(out.compareSharedCalcPath).toContain("buildSimulatedUsageDatasetFromCurve");
      expect(out.compareSharedCalcPath).toContain("slice_test_days_and_parity_days_from_same_union_run");
      expect(out.compareSimSource).toBe("shared_selected_days_calc");
      expect(out.scoringSimulatedSource).toBe("shared_selected_days_simulated_intervals15");
      expect(out.travelVacantParityTruth).toMatchObject({
        availability: "validated",
        requestedDateCount: 2,
        validatedDateCount: 2,
        mismatchCount: 0,
        missingArtifactReferenceCount: 0,
        missingFreshCompareCount: 0,
        exactProofSatisfied: true,
      });
      expect(out.travelVacantParityRows).toEqual([
        expect.objectContaining({
          localDate: "2026-01-03",
          artifactCanonicalSimDayKwh: 24,
          freshSharedDayCalcKwh: 24,
          parityMatch: true,
        }),
        expect.objectContaining({
          localDate: "2026-01-04",
          artifactCanonicalSimDayKwh: 24,
          freshSharedDayCalcKwh: 24,
          parityMatch: true,
        }),
      ]);
      expect(out.simulatedTestIntervals).toHaveLength(96);
      expect(out.simulatedChartDaily.map((row) => row.date)).toEqual(["2026-01-01"]);
      expect(loadWeatherForPastWindow).not.toHaveBeenCalled();
      expect(out.scoredDayWeatherRows).toEqual([
        expect.objectContaining({
          localDate: "2026-01-01",
          avgTempF: 50,
          minTempF: 40,
          maxTempF: 60,
          hdd65: 15,
          cdd65: 0,
        }),
      ]);
    }
  });

  it("uses saved canonical artifact day totals for exact travel parity even when legacy interval data differs", async () => {
    usageSimulatorBuildFindUnique.mockResolvedValueOnce({
      buildInputs: {
        mode: "SMT_BASELINE",
        canonicalMonths: ["2026-01"],
        timezone: "America/Chicago",
        travelRanges: [{ startDate: "2026-01-03", endDate: "2026-01-04" }],
      },
    });
    decodeIntervalsV1.mockReturnValue([
      ...oneChicagoLocalDayIntervals96("2026-01-01", 24 / 96),
      ...oneChicagoLocalDayIntervals96("2026-01-02", 24 / 96),
      ...oneChicagoLocalDayIntervals96("2026-01-03", 24 / 96),
      ...oneChicagoLocalDayIntervals96("2026-01-04", 24 / 96),
      ...oneChicagoLocalDayIntervals96("2026-01-05", 24 / 96),
    ]);
    getCachedPastDataset.mockResolvedValue({
      inputHash: "hash-selected-exact-stale-meta",
      datasetJson: {
        summary: {
          source: "SIMULATED",
          intervalsCount: 96 * 5,
          totalKwh: 120,
          start: "2026-01-01",
          end: "2026-01-05",
        },
        meta: {
          curveShapingVersion: "shared_curve_v2",
          excludedDateKeysFingerprint: "2026-01-03,2026-01-04",
          weatherSourceSummary: "actual_only",
          canonicalArtifactSimulatedDayTotalsByDate: {
            "2026-01-03": 23.78,
            "2026-01-04": 23.81,
          },
        },
        daily: [
          { date: "2026-01-01", kwh: 24, source: "ACTUAL" },
          { date: "2026-01-03", kwh: 23.78, source: "SIMULATED" },
          { date: "2026-01-04", kwh: 23.81, source: "SIMULATED" },
        ],
        monthly: [{ month: "2026-01", kwh: 95.59 }],
        series: {},
      },
      intervalsCodec: "v1_delta_varint",
      intervalsCompressed: Buffer.from("00", "hex"),
    });
    simulatePastSelectedDaysShared.mockResolvedValue({
      simulatedIntervals: oneChicagoLocalDayIntervals96("2026-01-01", 24 / 96),
      simulatedDayResults: [simulatedDayResultForLocalDay("2026-01-01")],
      canonicalSimulatedDayTotalsByDate: { "2026-01-01": 24 },
      pastDayCounts: {},
      weatherSourceSummary: "actual_only",
      weatherKindUsed: "ACTUAL_LAST_YEAR",
    });
    simulatePastSelectedDaysShared.mockImplementation(async ({ selectedDateKeysLocal }: any) => ({
      simulatedIntervals: Array.from(selectedDateKeysLocal ?? []).flatMap((dk) =>
        oneChicagoLocalDayIntervals96(String(dk), 24 / 96)
      ),
      simulatedDayResults: [],
      canonicalSimulatedDayTotalsByDate: Object.fromEntries(
        Array.from(selectedDateKeysLocal ?? []).map((dk) => [String(dk), 24])
      ),
      pastDayCounts: {},
      weatherSourceSummary: "actual_only",
      weatherKindUsed: "ACTUAL_LAST_YEAR",
    }));
    simulatePastFullWindowShared.mockResolvedValue({
      simulatedIntervals: [
        ...oneChicagoLocalDayIntervals96("2026-01-01", 24 / 96),
        ...oneChicagoLocalDayIntervals96("2026-01-02", 24 / 96),
        ...oneChicagoLocalDayIntervals96("2026-01-03", 24 / 96),
        ...oneChicagoLocalDayIntervals96("2026-01-04", 24 / 96),
        ...oneChicagoLocalDayIntervals96("2026-01-05", 24 / 96),
      ],
      canonicalSimulatedDayTotalsByDate: {
        "2026-01-01": 24,
        "2026-01-02": 24,
        "2026-01-03": 24,
        "2026-01-04": 24,
        "2026-01-05": 24,
      },
      actualWxByDateKey: new Map<string, unknown>(),
      weatherSourceSummary: "actual_only",
      weatherKindUsed: "ACTUAL_LAST_YEAR",
      weatherProviderName: "OPEN_METEO",
      weatherFallbackReason: null,
    });

    const out = await buildGapfillCompareSimShared({
      userId: "u1",
      houseId: "h1",
      timezone: "America/Chicago",
      canonicalWindow: { startDate: "2026-01-01", endDate: "2026-01-05" },
      testDateKeysLocal: new Set<string>(["2026-01-01"]),
      rebuildArtifact: false,
      compareFreshMode: "selected_days",
      includeFreshCompareCalc: false,
      selectedDaysLightweightArtifactRead: true,
      artifactExactScenarioId: "gapfill_lab",
      artifactExactInputHash: "hash-selected-exact-stale-meta",
      requireExactArtifactMatch: true,
      artifactIdentitySource: "same_run_artifact_ensure",
    });

    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(decodeIntervalsV1).not.toHaveBeenCalled();
      expect(simulatePastSelectedDaysShared).toHaveBeenCalled();
      expect(simulatePastFullWindowShared).not.toHaveBeenCalled();
      expect((out.body as any)?.travelVacantParityTruth).toMatchObject({
        availability: "mismatch_detected",
        mismatchCount: 2,
        exactProofSatisfied: false,
      });
      expect((out.body as any)?.travelVacantParityRows).toEqual([
        expect.objectContaining({
          localDate: "2026-01-03",
          artifactCanonicalSimDayKwh: 23.78,
          freshSharedDayCalcKwh: 24,
          parityMatch: false,
        }),
        expect.objectContaining({
          localDate: "2026-01-04",
          artifactCanonicalSimDayKwh: 23.81,
          freshSharedDayCalcKwh: 24,
          parityMatch: false,
        }),
      ]);
    }
  });

  it("validates exact travel parity from union selected-days output even when interval detail drifts", async () => {
    usageSimulatorBuildFindUnique.mockResolvedValueOnce({
      buildInputs: {
        mode: "SMT_BASELINE",
        canonicalMonths: ["2026-01"],
        timezone: "America/Chicago",
        travelRanges: [{ startDate: "2026-01-03", endDate: "2026-01-04" }],
      },
    });
    getCachedPastDataset.mockResolvedValue({
      inputHash: "hash-selected-exact-interval-authority",
      datasetJson: {
        summary: {
          source: "SIMULATED",
          intervalsCount: 96 * 5,
          totalKwh: 24 * 5,
          start: "2026-01-01",
          end: "2026-01-05",
        },
        meta: {
          curveShapingVersion: "shared_curve_v2",
          excludedDateKeysFingerprint: "2026-01-03,2026-01-04",
          weatherSourceSummary: "actual_only",
          canonicalArtifactSimulatedDayTotalsByDate: {
            "2026-01-03": 24,
            "2026-01-04": 24,
          },
        },
        daily: [
          { date: "2026-01-01", kwh: 24, source: "ACTUAL" },
          { date: "2026-01-03", kwh: 24, source: "SIMULATED" },
          { date: "2026-01-04", kwh: 24, source: "SIMULATED" },
        ],
        monthly: [{ month: "2026-01", kwh: 120 }],
        series: {},
      },
      intervalsCodec: "v1_delta_varint",
      intervalsCompressed: Buffer.from("00", "hex"),
    });
    decodeIntervalsV1.mockReturnValue([
      ...oneChicagoLocalDayIntervals96("2026-01-01", 24 / 96),
      ...oneChicagoLocalDayIntervals96("2026-01-02", 24 / 96),
      ...oneChicagoLocalDayIntervals96("2026-01-03", 24 / 96),
      ...oneChicagoLocalDayIntervals96("2026-01-04", 24 / 96),
      ...oneChicagoLocalDayIntervals96("2026-01-05", 24 / 96),
    ]);
    const phases: string[] = [];
    const selectedDaysCallsBefore = simulatePastSelectedDaysShared.mock.calls.length;
    const fullWindowCallsBefore = simulatePastFullWindowShared.mock.calls.length;
    simulatePastSelectedDaysShared.mockImplementation(async ({ selectedDateKeysLocal }: any) => {
      const selected = Array.from(selectedDateKeysLocal ?? []).map(String).sort();
      if (selected.includes("2026-01-03") || selected.includes("2026-01-04")) {
        const driftedDay3 = oneChicagoLocalDayIntervals96("2026-01-03", 24 / 96).map((row, idx) => ({
          ...row,
          kwh: idx === 0 ? row.kwh + 0.012 : row.kwh,
        }));
        const stableDay4 = oneChicagoLocalDayIntervals96("2026-01-04", 24 / 96);
        return {
          simulatedIntervals: [...driftedDay3, ...stableDay4],
          simulatedDayResults: selected.map((dk) =>
            dk === "2026-01-03"
              ? simulatedDayResultFromIntervals(dk, driftedDay3)
              : simulatedDayResultFromIntervals(dk, stableDay4)
          ),
          canonicalSimulatedDayTotalsByDate: Object.fromEntries(selected.map((dk) => [dk, 24])),
          pastDayCounts: {},
          weatherSourceSummary: "actual_only",
          weatherKindUsed: "ACTUAL_LAST_YEAR",
        };
      }
      return {
        simulatedIntervals: selected.flatMap((dk) => oneChicagoLocalDayIntervals96(dk, 24 / 96)),
        simulatedDayResults: selected.map((dk) => simulatedDayResultForLocalDay(dk)),
        canonicalSimulatedDayTotalsByDate: Object.fromEntries(selected.map((dk) => [dk, 24])),
        pastDayCounts: {},
        weatherSourceSummary: "actual_only",
        weatherKindUsed: "ACTUAL_LAST_YEAR",
      };
    });
    simulatePastFullWindowShared.mockResolvedValue({
      simulatedIntervals: [
        ...oneChicagoLocalDayIntervals96("2026-01-01", 24 / 96),
        ...oneChicagoLocalDayIntervals96("2026-01-02", 24 / 96),
        ...oneChicagoLocalDayIntervals96("2026-01-03", 24 / 96),
        ...oneChicagoLocalDayIntervals96("2026-01-04", 24 / 96),
        ...oneChicagoLocalDayIntervals96("2026-01-05", 24 / 96),
      ],
      canonicalSimulatedDayTotalsByDate: {
        "2026-01-01": 24,
        "2026-01-02": 24,
        "2026-01-03": 24,
        "2026-01-04": 24,
        "2026-01-05": 24,
      },
      actualWxByDateKey: new Map<string, unknown>(),
      weatherSourceSummary: "actual_only",
      weatherKindUsed: "ACTUAL_LAST_YEAR",
      weatherProviderName: "OPEN_METEO",
      weatherFallbackReason: null,
    });

    const out = await buildGapfillCompareSimShared({
      userId: "u1",
      houseId: "h1",
      timezone: "America/Chicago",
      canonicalWindow: { startDate: "2026-01-01", endDate: "2026-01-05" },
      testDateKeysLocal: new Set<string>(["2026-01-01"]),
      rebuildArtifact: false,
      compareFreshMode: "selected_days",
      includeFreshCompareCalc: false,
      selectedDaysLightweightArtifactRead: true,
      includeDiagnostics: false,
      includeFullReportText: false,
      artifactExactScenarioId: "gapfill_lab",
      artifactExactInputHash: "hash-selected-exact-interval-authority",
      requireExactArtifactMatch: true,
      artifactIdentitySource: "same_run_artifact_ensure",
      onPhaseUpdate: (phase) => {
        phases.push(String(phase));
      },
    });

    expect(out.ok).toBe(true);
    if (out.ok) {
      const selectedDaysCalls = simulatePastSelectedDaysShared.mock.calls.slice(selectedDaysCallsBefore);
      const fullWindowCalls = simulatePastFullWindowShared.mock.calls.slice(fullWindowCallsBefore);
      expect(phases).toContain("build_shared_compare_compact_compare_core_memory_reduced");
      expect(selectedDaysCalls).toHaveLength(1);
      expect(fullWindowCalls).toHaveLength(0);
      expect(out.travelVacantParityTruth).toMatchObject({
        availability: "validated",
        mismatchCount: 0,
        exactProofSatisfied: true,
      });
      expect(out.travelVacantParityRows).toEqual([
        expect.objectContaining({
          localDate: "2026-01-03",
          artifactCanonicalSimDayKwh: 24,
          freshSharedDayCalcKwh: 24,
          parityMatch: true,
        }),
        expect.objectContaining({
          localDate: "2026-01-04",
          artifactCanonicalSimDayKwh: 24,
          freshSharedDayCalcKwh: 24,
          parityMatch: true,
        }),
      ]);
    }
  });

  it("detects travel/vacant parity mismatch from union selected-days fresh totals in exact proof mode", async () => {
    usageSimulatorBuildFindUnique.mockResolvedValueOnce({
      buildInputs: {
        mode: "SMT_BASELINE",
        canonicalMonths: ["2026-01"],
        timezone: "America/Chicago",
        travelRanges: [{ startDate: "2026-01-03", endDate: "2026-01-04" }],
      },
    });
    getCachedPastDataset.mockResolvedValue({
      inputHash: "hash-selected-exact-mismatch-diag",
      datasetJson: {
        summary: {
          source: "SIMULATED",
          intervalsCount: 96 * 5,
          totalKwh: 24 * 5,
          start: "2026-01-01",
          end: "2026-01-05",
        },
        meta: {
          curveShapingVersion: "shared_curve_v2",
          excludedDateKeysFingerprint: "2026-01-03,2026-01-04",
          weatherSourceSummary: "actual_only",
          canonicalArtifactSimulatedDayTotalsByDate: {
            "2026-01-03": 24,
            "2026-01-04": 24,
          },
        },
        daily: [
          { date: "2026-01-01", kwh: 24, source: "ACTUAL" },
          { date: "2026-01-03", kwh: 24, source: "SIMULATED" },
          { date: "2026-01-04", kwh: 24, source: "SIMULATED" },
        ],
        monthly: [{ month: "2026-01", kwh: 120 }],
        series: {},
      },
      intervalsCodec: "v1_delta_varint",
      intervalsCompressed: Buffer.from("00", "hex"),
    });
    decodeIntervalsV1.mockReturnValue([
      ...oneChicagoLocalDayIntervals96("2026-01-01", 24 / 96),
      ...oneChicagoLocalDayIntervals96("2026-01-02", 24 / 96),
      ...oneChicagoLocalDayIntervals96("2026-01-03", 24 / 96),
      ...oneChicagoLocalDayIntervals96("2026-01-04", 24 / 96),
      ...oneChicagoLocalDayIntervals96("2026-01-05", 24 / 96),
    ]);
    simulatePastSelectedDaysShared.mockImplementation(async ({ selectedDateKeysLocal }: any) => {
      const keys = Array.from(selectedDateKeysLocal ?? []).map((dk) => String(dk).slice(0, 10));
      const driftedDay3 = oneChicagoLocalDayIntervals96("2026-01-03", 24 / 96).map((row, idx) => ({
        ...row,
        kwh: idx === 0 ? row.kwh + 0.012 : row.kwh,
      }));
      const simulatedIntervals = keys.flatMap((dk) =>
        dk === "2026-01-03" ? driftedDay3 : oneChicagoLocalDayIntervals96(dk, 24 / 96)
      );
      const canonicalSimulatedDayTotalsByDate = Object.fromEntries(
        keys.map((dk) => [dk, dk === "2026-01-03" ? 24.01 : 24] as const)
      );
      return {
        simulatedIntervals,
        simulatedDayResults: [],
        canonicalSimulatedDayTotalsByDate,
        pastDayCounts: {},
        weatherSourceSummary: "actual_only",
        weatherKindUsed: "ACTUAL_LAST_YEAR",
      };
    });

    const out = await buildGapfillCompareSimShared({
      userId: "u1",
      houseId: "h1",
      timezone: "America/Chicago",
      canonicalWindow: { startDate: "2026-01-01", endDate: "2026-01-05" },
      testDateKeysLocal: new Set<string>(["2026-01-01"]),
      rebuildArtifact: false,
      compareFreshMode: "selected_days",
      includeFreshCompareCalc: false,
      selectedDaysLightweightArtifactRead: true,
      includeDiagnostics: false,
      includeFullReportText: false,
      artifactExactScenarioId: "gapfill_lab",
      artifactExactInputHash: "hash-selected-exact-mismatch-diag",
      requireExactArtifactMatch: true,
      artifactIdentitySource: "same_run_artifact_ensure",
    });

    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(simulatePastSelectedDaysShared).toHaveBeenCalled();
      expect(simulatePastFullWindowShared).not.toHaveBeenCalled();
      expect((out.body as any)?.travelVacantParityTruth).toMatchObject({
        availability: "mismatch_detected",
        mismatchCount: 1,
        exactProofSatisfied: false,
      });
      expect((out.body as any)?.travelVacantParityRows).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            localDate: "2026-01-03",
            artifactCanonicalSimDayKwh: 24,
            freshSharedDayCalcKwh: 24.01,
            parityMatch: false,
          }),
        ])
      );
    }
  });

  it("reports full missing-reference totals when simulated artifact days are missing canonical references", async () => {
    const testDates = Array.from({ length: 12 }, (_, i) => `2026-01-${String(i + 1).padStart(2, "0")}`);
    getLatestCachedPastDatasetByScenario.mockResolvedValue({
      inputHash: "hash-selected-default",
      updatedAt: new Date("2026-01-20T00:00:00.000Z"),
      datasetJson: {
        summary: { source: "SIMULATED", intervalsCount: 96 * testDates.length, totalKwh: 24 * testDates.length, start: testDates[0], end: testDates[testDates.length - 1] },
        meta: { curveShapingVersion: "shared_curve_v2", excludedDateKeysFingerprint: "", weatherSourceSummary: "actual_only" },
        daily: testDates.map((date) => ({ date, kwh: 24, source: "ACTUAL" })),
        monthly: [{ month: "2026-01", kwh: 24 * testDates.length }],
        series: {},
      },
      intervalsCodec: "v1_delta_varint",
      intervalsCompressed: Buffer.from("00", "hex"),
    });
    simulatePastSelectedDaysShared.mockResolvedValue({
      simulatedIntervals: testDates.flatMap((date) => oneChicagoLocalDayIntervals96(date, 24 / 96)),
      simulatedDayResults: [],
      canonicalSimulatedDayTotalsByDate: Object.fromEntries(testDates.map((date) => [date, 24])),
      pastDayCounts: {},
      weatherSourceSummary: "actual_only",
      weatherKindUsed: "ACTUAL_LAST_YEAR",
    });

    const out = await buildGapfillCompareSimShared({
      userId: "u1",
      houseId: "h1",
      timezone: "America/Chicago",
      canonicalWindow: { startDate: testDates[0], endDate: testDates[testDates.length - 1] },
      testDateKeysLocal: new Set<string>(testDates),
      rebuildArtifact: false,
      compareFreshMode: "selected_days",
      includeFreshCompareCalc: false,
      selectedDaysLightweightArtifactRead: true,
    });

    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.displayVsFreshParityForScoredDays?.matches).toBeNull();
      expect(out.displayVsFreshParityForScoredDays?.mismatchCount).toBe(0);
      expect(out.displayVsFreshParityForScoredDays?.availability).toBe("missing_expected_reference");
      expect(out.displayVsFreshParityForScoredDays?.reasonCode).toBe("ARTIFACT_SIMULATED_REFERENCE_MISSING");
      expect(out.displayVsFreshParityForScoredDays?.missingDisplaySimCount).toBe(12);
      expect(out.displayVsFreshParityForScoredDays?.missingDisplaySimSampleDates).toHaveLength(10);
      expect(out.displayVsFreshParityForScoredDays?.missingDisplaySimSampleDates).toEqual(testDates.slice(0, 10));
      expect(out.displayVsFreshParityForScoredDays?.comparableDateCount).toBe(0);
      expect(out.displayVsFreshParityForScoredDays?.complete).toBeNull();
    }
  });

  it("backfills sparse canonical scored-day totals from union selected-days fresh totals when exact-match travel parity runs", async () => {
    usageSimulatorBuildFindUnique.mockResolvedValueOnce({
      buildInputs: {
        mode: "SMT_BASELINE",
        canonicalMonths: ["2026-01"],
        timezone: "America/Chicago",
        travelRanges: [{ startDate: "2026-01-03", endDate: "2026-01-03" }],
      },
    });
    getCachedPastDataset.mockResolvedValue({
      inputHash: "hash-selected-exact-no-reference-backfill",
      datasetJson: {
        summary: {
          source: "SIMULATED",
          intervalsCount: 96 * 3,
          totalKwh: 72,
          start: "2026-01-01",
          end: "2026-01-03",
        },
        meta: {
          curveShapingVersion: "shared_curve_v2",
          excludedDateKeysFingerprint: "2026-01-03",
          weatherSourceSummary: "actual_only",
          canonicalArtifactSimulatedDayTotalsByDate: {
            "2026-01-03": 24,
          },
        },
        daily: [
          { date: "2026-01-01", kwh: 24, source: "ACTUAL" },
          { date: "2026-01-02", kwh: 24, source: "ACTUAL" },
          { date: "2026-01-03", kwh: 24, source: "SIMULATED" },
        ],
        monthly: [{ month: "2026-01", kwh: 72 }],
        series: {},
      },
      intervalsCodec: "v1_delta_varint",
      intervalsCompressed: Buffer.from("00", "hex"),
    });
    decodeIntervalsV1.mockReturnValue([
      ...oneChicagoLocalDayIntervals96("2026-01-01", 24 / 96),
      ...oneChicagoLocalDayIntervals96("2026-01-02", 24 / 96),
      ...oneChicagoLocalDayIntervals96("2026-01-03", 24 / 96),
    ]);
    simulatePastSelectedDaysShared.mockImplementation(async ({ selectedDateKeysLocal }: any) => {
      const selected = Array.from((selectedDateKeysLocal ?? []) as string[]).sort();
      return {
        simulatedIntervals: selected.flatMap((date) => oneChicagoLocalDayIntervals96(date, 24 / 96)),
        simulatedDayResults: selected.map((date) => simulatedDayResultForLocalDay(date)),
        canonicalSimulatedDayTotalsByDate: Object.fromEntries(selected.map((date) => [date, 24])),
        pastDayCounts: {},
        weatherSourceSummary: "actual_only",
        weatherKindUsed: "ACTUAL_LAST_YEAR",
      };
    });
    simulatePastFullWindowShared.mockResolvedValue({
      simulatedIntervals: [
        ...oneChicagoLocalDayIntervals96("2026-01-01", 24 / 96),
        ...oneChicagoLocalDayIntervals96("2026-01-02", 24 / 96),
        ...oneChicagoLocalDayIntervals96("2026-01-03", 24 / 96),
      ],
      canonicalSimulatedDayTotalsByDate: {
        "2026-01-01": 24,
        "2026-01-02": 24,
        "2026-01-03": 24,
      },
      actualWxByDateKey: new Map<string, unknown>(),
      weatherSourceSummary: "actual_only",
      weatherKindUsed: "ACTUAL_LAST_YEAR",
      weatherProviderName: "OPEN_METEO",
      weatherFallbackReason: null,
    });

    const out = await buildGapfillCompareSimShared({
      userId: "u1",
      houseId: "h1",
      timezone: "America/Chicago",
      canonicalWindow: { startDate: "2026-01-01", endDate: "2026-01-03" },
      testDateKeysLocal: new Set<string>(["2026-01-01"]),
      rebuildArtifact: false,
      compareFreshMode: "selected_days",
      includeFreshCompareCalc: false,
      selectedDaysLightweightArtifactRead: true,
      artifactExactScenarioId: "gapfill_lab",
      artifactExactInputHash: "hash-selected-exact-no-reference-backfill",
      requireExactArtifactMatch: true,
      artifactIdentitySource: "same_run_artifact_ensure",
    });

    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(simulatePastSelectedDaysShared).toHaveBeenCalled();
      expect(simulatePastFullWindowShared).not.toHaveBeenCalled();
      expect((out.modelAssumptions as any)?.canonicalArtifactSimulatedDayTotalsFullWindowBackfillCount).toBe(1);
      expect((out.modelAssumptions as any)?.canonicalArtifactSimulatedDayTotalsFullWindowBackfillSource).toBe(
        "selected_shared_full_window_simulated_day_totals"
      );
      expect(out.displayVsFreshParityForScoredDays).toMatchObject({
        availability: "available",
        reasonCode: "ARTIFACT_SIMULATED_REFERENCE_AVAILABLE",
        matches: true,
        mismatchCount: 0,
        missingDisplaySimCount: 0,
        comparableDateCount: 1,
        complete: true,
      });
      expect(out.displayVsFreshParityForScoredDays?.missingDisplaySimSampleDates).toEqual([]);
      expect(out.travelVacantParityTruth).toMatchObject({
        availability: "validated",
        exactProofSatisfied: true,
        requestedDateCount: 1,
        validatedDateCount: 1,
      });
    }
  });

  it("keeps scored-day simulated value aligned between selected-days default and heavy full-window mode", async () => {
    getCachedPastDataset.mockResolvedValue({
      inputHash: "hash-selected-default",
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
    decodeIntervalsV1.mockReturnValue(oneChicagoLocalDayIntervals96("2026-01-01", 24 / 96));
    simulatePastSelectedDaysShared.mockResolvedValue({
      simulatedIntervals: oneChicagoLocalDayIntervals96("2026-01-01", 24 / 96),
      simulatedDayResults: [simulatedDayResultForLocalDay("2026-01-01")],
      canonicalSimulatedDayTotalsByDate: { "2026-01-01": 24 },
      pastDayCounts: {},
      weatherSourceSummary: "actual_only",
      weatherKindUsed: "ACTUAL_LAST_YEAR",
    });
    simulatePastFullWindowShared.mockResolvedValue({
      simulatedIntervals: oneChicagoLocalDayIntervals96("2026-01-01", 24 / 96),
      canonicalSimulatedDayTotalsByDate: { "2026-01-01": 24 },
      actualWxByDateKey: new Map(),
      weatherSourceSummary: "actual_only",
      weatherKindUsed: "ACTUAL_LAST_YEAR",
      weatherProviderName: "OPEN_METEO",
      weatherFallbackReason: null,
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