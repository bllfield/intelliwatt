import { beforeEach, describe, expect, it, vi } from "vitest";

const getActualIntervalsForRange = vi.fn();
const getHouseWeatherDays = vi.fn();
const ensureHouseWeatherBackfill = vi.fn();
const ensureHouseWeatherStubbed = vi.fn();
const getHomeProfileSimulatedByUserHouse = vi.fn();
const getApplianceProfileSimulatedByUserHouse = vi.fn();
const getLatestUsageShapeProfile = vi.fn();
const ensureUsageShapeProfileForUserHouse = vi.fn();
const buildPastSimulatedBaselineV1 = vi.fn();

vi.mock("@/lib/usage/actualDatasetForHouse", () => ({
  getActualIntervalsForRange: (...args: any[]) => getActualIntervalsForRange(...args),
}));

vi.mock("@/modules/weather/repo", () => ({
  getHouseWeatherDays: (...args: any[]) => getHouseWeatherDays(...args),
}));

vi.mock("@/modules/weather/backfill", () => ({
  ensureHouseWeatherBackfill: (...args: any[]) => ensureHouseWeatherBackfill(...args),
}));

vi.mock("@/modules/weather/stubs", () => ({
  ensureHouseWeatherStubbed: (...args: any[]) => ensureHouseWeatherStubbed(...args),
}));

vi.mock("@/modules/homeProfile/repo", () => ({
  getHomeProfileSimulatedByUserHouse: (...args: any[]) => getHomeProfileSimulatedByUserHouse(...args),
}));

vi.mock("@/modules/applianceProfile/repo", () => ({
  getApplianceProfileSimulatedByUserHouse: (...args: any[]) => getApplianceProfileSimulatedByUserHouse(...args),
}));

vi.mock("@/modules/usageShapeProfile/repo", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    getLatestUsageShapeProfile: (...args: any[]) => getLatestUsageShapeProfile(...args),
  };
});

vi.mock("@/modules/usageShapeProfile/autoBuild", () => ({
  ensureUsageShapeProfileForUserHouse: (...args: any[]) => ensureUsageShapeProfileForUserHouse(...args),
}));

vi.mock("@/modules/simulatedUsage/engine", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/modules/simulatedUsage/engine")>();
  return {
    ...mod,
    buildPastSimulatedBaselineV1: (...args: any[]) => buildPastSimulatedBaselineV1(...args),
  };
});

vi.mock("@/modules/usageSimulator/metadataWindow", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    resolveCanonicalUsage365CoverageWindow: vi.fn(() => ({
      startDate: "2025-03-14",
      endDate: "2026-03-13",
    })),
  };
});

vi.mock("@/lib/admin/gapfillLab", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    dateKeyInTimezone: (iso: string) => String(iso).slice(0, 10),
  };
});

const { logPipeline } = vi.hoisted(() => ({
  logPipeline: vi.fn(),
}));

vi.mock("@/modules/usageSimulator/simObservability", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/modules/usageSimulator/simObservability")>();
  return { ...mod, logSimPipelineEvent: logPipeline };
});

import {
  collectSimulatedDayLocalDateIntervalConflicts,
  fillMissingCanonicalSelectedDayTotalsFromSimulatedResults,
  simulatePastUsageDataset,
  simulatePastFullWindowShared,
  simulatePastSelectedDaysShared,
} from "@/modules/simulatedUsage/simulatePastUsageDataset";

function weatherMap(dateKeys: string[]) {
  return new Map(
    dateKeys.map((dk) => [
      dk,
      {
        tAvgF: 60,
        tMinF: 50,
        tMaxF: 70,
        hdd65: 0,
        cdd65: 0,
        source: "OPEN_METEO",
      },
    ])
  );
}

function validUsageShapeRow() {
  return {
    id: "shape-1",
    version: "v1",
    derivedAt: "2026-03-14T00:00:00.000Z",
    windowStartUtc: "2025-03-14T00:00:00.000Z",
    windowEndUtc: "2026-03-13T23:59:59.999Z",
    shapeByMonth96: {
      "2026-01": Array.from({ length: 96 }, () => 1 / 96),
    },
    avgKwhPerDayWeekdayByMonth: Array.from({ length: 12 }, () => 24),
    avgKwhPerDayWeekendByMonth: Array.from({ length: 12 }, () => 20),
  };
}

describe("shared sim usage-shape ensure path", () => {
  beforeEach(() => {
    logPipeline.mockClear();
    getActualIntervalsForRange.mockReset();
    getHouseWeatherDays.mockReset();
    ensureHouseWeatherBackfill.mockReset();
    ensureHouseWeatherStubbed.mockReset();
    getHomeProfileSimulatedByUserHouse.mockReset();
    getApplianceProfileSimulatedByUserHouse.mockReset();
    getLatestUsageShapeProfile.mockReset();
    ensureUsageShapeProfileForUserHouse.mockReset();
    buildPastSimulatedBaselineV1.mockReset();

    getHomeProfileSimulatedByUserHouse.mockResolvedValue(null);
    getApplianceProfileSimulatedByUserHouse.mockResolvedValue(null);
    ensureHouseWeatherBackfill.mockResolvedValue({ fetched: 0, stubbed: 0 });
    ensureHouseWeatherStubbed.mockResolvedValue(undefined);
    getActualIntervalsForRange.mockResolvedValue([
      { timestamp: "2026-01-01T00:00:00.000Z", kwh: 0.25 },
      { timestamp: "2026-01-01T00:15:00.000Z", kwh: 0.25 },
    ]);
    getHouseWeatherDays.mockImplementation(async ({ dateKeys }: any) => weatherMap(Array.from(dateKeys ?? [])));
    buildPastSimulatedBaselineV1.mockImplementation(() => ({
      intervals: [
        { timestamp: "2026-01-01T00:00:00.000Z", kwh: 0.25 },
        { timestamp: "2026-01-01T00:15:00.000Z", kwh: 0.25 },
      ],
      dayResults: [
        {
          localDate: "2026-01-01",
          intervals: [
            { timestamp: "2026-01-01T00:00:00.000Z", kwh: 0.25 },
            { timestamp: "2026-01-01T00:15:00.000Z", kwh: 0.25 },
          ],
          intervalSumKwh: 0.5,
          finalDayKwh: 0.5,
        },
      ],
    }));
  });

  it("ensures missing usage shape in full-window shared sim before simulation runs", async () => {
    getLatestUsageShapeProfile.mockResolvedValueOnce(null).mockResolvedValueOnce(validUsageShapeRow());
    ensureUsageShapeProfileForUserHouse.mockResolvedValue({
      ok: true,
      profileId: "shape-1",
      diagnostics: { dependentPastRebuildRequired: true },
    });

    const out = await simulatePastFullWindowShared({
      userId: "u1",
      houseId: "h1",
      esiid: "1044",
      startDate: "2026-01-01",
      endDate: "2026-01-01",
      timezone: "America/Chicago",
      travelRanges: [],
      buildInputs: {
        canonicalMonths: ["2026-01"],
        snapshots: {},
      } as any,
      buildPathKind: "lab_validation",
      includeSimulatedDayResults: false,
    });

    expect(out.simulatedIntervals).not.toBeNull();
    if (out.simulatedIntervals !== null) {
      expect(ensureUsageShapeProfileForUserHouse).toHaveBeenCalledWith({
        userId: "u1",
        houseId: "h1",
        timezone: "America/Chicago",
      });
      expect(ensureUsageShapeProfileForUserHouse.mock.invocationCallOrder[0]).toBeLessThan(
        buildPastSimulatedBaselineV1.mock.invocationCallOrder[0]
      );
      expect(buildPastSimulatedBaselineV1.mock.calls[0]?.[0]?.usageShapeProfile).toEqual({
        weekdayAvgByMonthKey: { "2026-01": 24 },
        weekendAvgByMonthKey: { "2026-01": 20 },
      });
      expect(out.profileAutoBuilt).toBe(true);
      expect(out.usageShapeProfileDiag).toMatchObject({
        reasonNotUsed: null,
        ensuredInFlow: true,
        ensuredReason: "profile_not_found",
      });
      expect(out.canonicalSimulatedDayTotalsByDate).toEqual({ "2026-01-01": 0.5 });
    }
  });

  it("emits day_simulation measurement events with correlationId, durationMs, memoryRssMb, and baseline_phase timing (Slice 11)", async () => {
    getLatestUsageShapeProfile.mockResolvedValueOnce(null).mockResolvedValueOnce(validUsageShapeRow());
    ensureUsageShapeProfileForUserHouse.mockResolvedValue({
      ok: true,
      profileId: "shape-1",
      diagnostics: { dependentPastRebuildRequired: true },
    });
    const cid = "22222222-2222-4222-8222-222222222222";
    await simulatePastFullWindowShared({
      userId: "u1",
      houseId: "h1",
      esiid: "1044",
      startDate: "2026-01-01",
      endDate: "2026-01-01",
      timezone: "America/Chicago",
      travelRanges: [],
      buildInputs: {
        canonicalMonths: ["2026-01"],
        snapshots: {},
      } as any,
      buildPathKind: "lab_validation",
      includeSimulatedDayResults: false,
      correlationId: cid,
    });
    const startEv = logPipeline.mock.calls.find((c) => c[0] === "day_simulation_start");
    const successEv = logPipeline.mock.calls.find((c) => c[0] === "day_simulation_success");
    const baselineEv = logPipeline.mock.calls.find((c) => c[0] === "day_simulation_baseline_phase");
    const weatherStartEv = logPipeline.mock.calls.find((c) => c[0] === "day_simulation_weather_load_start");
    const weatherSuccessEv = logPipeline.mock.calls.find((c) => c[0] === "day_simulation_weather_load_success");
    const inputPrepStartEv = logPipeline.mock.calls.find((c) => c[0] === "day_simulation_input_prep_start");
    const inputPrepSuccessEv = logPipeline.mock.calls.find((c) => c[0] === "day_simulation_input_prep_success");
    const baselineBuildStartEv = logPipeline.mock.calls.find((c) => c[0] === "day_simulation_baseline_build_start");
    const baselineBuildSuccessEv = logPipeline.mock.calls.find((c) => c[0] === "day_simulation_baseline_build_success");
    const stitchCurveStartEv = logPipeline.mock.calls.find((c) => c[0] === "day_simulation_stitch_curve_start");
    const stitchCurveSuccessEv = logPipeline.mock.calls.find((c) => c[0] === "day_simulation_stitch_curve_success");
    const stitchDatasetStartEv = logPipeline.mock.calls.find((c) => c[0] === "day_simulation_stitch_dataset_start");
    const stitchDatasetSuccessEv = logPipeline.mock.calls.find((c) => c[0] === "day_simulation_stitch_dataset_success");
    expect(startEv?.[1]).toMatchObject({ correlationId: cid, houseId: "h1" });
    expect(successEv?.[1]).toMatchObject({ correlationId: cid });
    expect(typeof (successEv?.[1] as { durationMs?: unknown })?.durationMs).toBe("number");
    expect(baselineEv?.[1]).toMatchObject({ correlationId: cid });
    expect(typeof (baselineEv?.[1] as { durationMs?: unknown })?.durationMs).toBe("number");
    expect(weatherStartEv?.[1]).toMatchObject({ correlationId: cid });
    expect(weatherSuccessEv?.[1]).toMatchObject({ correlationId: cid });
    expect(typeof (weatherSuccessEv?.[1] as { durationMs?: unknown })?.durationMs).toBe("number");
    expect(inputPrepStartEv?.[1]).toMatchObject({ correlationId: cid });
    expect(inputPrepSuccessEv?.[1]).toMatchObject({ correlationId: cid });
    expect(typeof (inputPrepSuccessEv?.[1] as { durationMs?: unknown })?.durationMs).toBe("number");
    expect(baselineBuildStartEv?.[1]).toMatchObject({ correlationId: cid });
    expect(baselineBuildSuccessEv?.[1]).toMatchObject({ correlationId: cid });
    expect(typeof (baselineBuildSuccessEv?.[1] as { durationMs?: unknown })?.durationMs).toBe("number");
    expect(stitchCurveStartEv?.[1]).toMatchObject({ correlationId: cid });
    expect(stitchCurveSuccessEv?.[1]).toMatchObject({ correlationId: cid });
    expect(typeof (stitchCurveSuccessEv?.[1] as { durationMs?: unknown })?.durationMs).toBe("number");
    expect(stitchDatasetStartEv?.[1]).toMatchObject({ correlationId: cid });
    expect(stitchDatasetSuccessEv?.[1]).toMatchObject({ correlationId: cid });
    expect(typeof (stitchDatasetSuccessEv?.[1] as { durationMs?: unknown })?.durationMs).toBe("number");
    expect(successEv?.[1]).toHaveProperty("memoryRssMb");
  });

  it("refreshes stale usage shape in selected-days shared sim before simulation runs", async () => {
    const staleRow = {
      ...validUsageShapeRow(),
      windowStartUtc: "2024-03-14T00:00:00.000Z",
      windowEndUtc: "2025-03-13T23:59:59.999Z",
    };
    getLatestUsageShapeProfile.mockResolvedValueOnce(staleRow).mockResolvedValueOnce(validUsageShapeRow());
    ensureUsageShapeProfileForUserHouse.mockResolvedValue({
      ok: true,
      profileId: "shape-1",
      diagnostics: { dependentPastRebuildRequired: true },
    });

    const out = await simulatePastSelectedDaysShared({
      userId: "u1",
      houseId: "h1",
      esiid: "1044",
      startDate: "2026-01-01",
      endDate: "2026-01-01",
      timezone: "America/Chicago",
      travelRanges: [],
      buildInputs: {
        canonicalMonths: ["2026-01"],
        snapshots: {},
      } as any,
      buildPathKind: "lab_validation",
      selectedDateKeysLocal: new Set(["2026-01-01"]),
    });

    expect(out.simulatedIntervals).not.toBeNull();
    if (out.simulatedIntervals !== null) {
      expect(ensureUsageShapeProfileForUserHouse).toHaveBeenCalledWith({
        userId: "u1",
        houseId: "h1",
        timezone: "America/Chicago",
      });
      expect(ensureUsageShapeProfileForUserHouse.mock.invocationCallOrder[0]).toBeLessThan(
        buildPastSimulatedBaselineV1.mock.invocationCallOrder[0]
      );
      expect(buildPastSimulatedBaselineV1.mock.calls[0]?.[0]?.usageShapeProfile).toEqual({
        weekdayAvgByMonthKey: { "2026-01": 24 },
        weekendAvgByMonthKey: { "2026-01": 20 },
      });
      expect(buildPastSimulatedBaselineV1.mock.calls[0]?.[0]?.emitAllIntervals).toBe(false);
      expect(buildPastSimulatedBaselineV1.mock.calls[0]?.[0]?.forceSimulateDateKeys).toBeUndefined();
      expect(out.profileAutoBuilt).toBe(true);
      expect(out.usageShapeProfileDiag).toMatchObject({
        reasonNotUsed: null,
        ensuredInFlow: true,
        ensuredReason: "coverage_window_mismatch",
      });
      expect(out.canonicalSimulatedDayTotalsByDate).toEqual({ "2026-01-01": 0.5 });
    }
  });

  it("slices selected-day outputs only after the shared full-path dataset is built", async () => {
    getLatestUsageShapeProfile.mockResolvedValue(validUsageShapeRow());
    buildPastSimulatedBaselineV1.mockImplementationOnce(() => ({
      intervals: [
        { timestamp: "2026-01-01T00:00:00.000Z", kwh: 0.2 },
        { timestamp: "2026-01-01T00:15:00.000Z", kwh: 0.3 },
        { timestamp: "2026-01-02T00:00:00.000Z", kwh: 0.4 },
        { timestamp: "2026-01-02T00:15:00.000Z", kwh: 0.6 },
      ],
      dayResults: [
        {
          localDate: "2026-01-01",
          displayDayKwh: 0.5,
          intervals: [
            { timestamp: "2026-01-01T00:00:00.000Z", kwh: 0.2 },
            { timestamp: "2026-01-01T00:15:00.000Z", kwh: 0.3 },
          ],
          intervalSumKwh: 0.5,
          finalDayKwh: 0.5,
        },
        {
          localDate: "2026-01-02",
          displayDayKwh: 1,
          intervals: [
            { timestamp: "2026-01-02T00:00:00.000Z", kwh: 0.4 },
            { timestamp: "2026-01-02T00:15:00.000Z", kwh: 0.6 },
          ],
          intervalSumKwh: 1,
          finalDayKwh: 1,
        },
      ],
    }));

    const out = await simulatePastSelectedDaysShared({
      userId: "u1",
      houseId: "h1",
      esiid: "1044",
      startDate: "2026-01-01",
      endDate: "2026-01-02",
      timezone: "America/Chicago",
      travelRanges: [],
      buildInputs: {
        canonicalMonths: ["2026-01"],
        snapshots: {},
      } as any,
      buildPathKind: "lab_validation",
      selectedDateKeysLocal: new Set(["2026-01-02"]),
    });

    expect(out.simulatedIntervals).not.toBeNull();
    if (out.simulatedIntervals !== null) {
      expect(buildPastSimulatedBaselineV1.mock.calls[0]?.[0]?.emitAllIntervals).toBe(false);
      expect(buildPastSimulatedBaselineV1.mock.calls[0]?.[0]?.forceSimulateDateKeys).toBeUndefined();
      expect(out.simulatedIntervals).toEqual([
        { timestamp: "2026-01-02T00:00:00.000Z", kwh: 0.4 },
        { timestamp: "2026-01-02T00:15:00.000Z", kwh: 0.6 },
      ]);
      expect(out.simulatedDayResults.map((row) => row.localDate)).toEqual(["2026-01-02"]);
      expect(out.canonicalSimulatedDayTotalsByDate).toEqual({ "2026-01-02": 1 });
    }
  });

  it("fills missing selected-day canonical totals from SimulatedDayResult intervals (meta sparse vs local scored date)", () => {
    // Meta map may omit a local scored date when dataset.meta keys align to localDate anchors only,
    // while interval timestamps still carry simulator-owned kWh on a different local calendar day.
    const filled = fillMissingCanonicalSelectedDayTotalsFromSimulatedResults({
      selectedValid: new Set(["2026-01-02"]),
      canonicalFromMeta: {},
      simulatedDayResults: [
        {
          localDate: "2026-01-01",
          intervals: [{ timestamp: "2026-01-02T08:00:00.000Z", kwh: 0.5 }],
          intervalSumKwh: 0.5,
          finalDayKwh: 0.5,
        } as any,
      ],
      timezone: "America/Chicago",
    });
    expect(filled).toEqual({ "2026-01-02": 0.5 });
  });

  it("fails selected-day shared path when localDate conflicts with interval-derived local date keys", async () => {
    getLatestUsageShapeProfile.mockResolvedValue(validUsageShapeRow());
    buildPastSimulatedBaselineV1.mockImplementationOnce(() => ({
      intervals: [
        { timestamp: "2026-01-01T00:00:00.000Z", kwh: 0.2 },
        { timestamp: "2026-01-01T00:15:00.000Z", kwh: 0.3 },
      ],
      dayResults: [
        {
          localDate: "2026-01-02",
          displayDayKwh: 0.5,
          intervals: [
            { timestamp: "2026-01-01T00:00:00.000Z", kwh: 0.2 },
            { timestamp: "2026-01-01T00:15:00.000Z", kwh: 0.3 },
          ],
          intervalSumKwh: 0.5,
          finalDayKwh: 0.5,
        },
      ],
    }));

    const out = await simulatePastSelectedDaysShared({
      userId: "u1",
      houseId: "h1",
      esiid: "1044",
      startDate: "2026-01-01",
      endDate: "2026-01-02",
      timezone: "America/Chicago",
      travelRanges: [],
      buildInputs: {
        canonicalMonths: ["2026-01"],
        snapshots: {},
      } as any,
      buildPathKind: "lab_validation",
      selectedDateKeysLocal: new Set(["2026-01-01"]),
    });

    expect(out.simulatedIntervals).toBeNull();
    expect("error" in out ? out.error : null).toBe("simulated_day_local_date_interval_invariant_violation");
    const failed = out as { invariantViolations?: { localDate: string; intervalDerivedDateKeys: string[] }[] };
    expect(Array.isArray(failed.invariantViolations)).toBe(true);
    expect(failed.invariantViolations).toEqual([
      { localDate: "2026-01-02", intervalDerivedDateKeys: ["2026-01-01"] },
    ]);
  });

  it("does not admit empty-interval selected-day results through localDate metadata", async () => {
    getLatestUsageShapeProfile.mockResolvedValue(validUsageShapeRow());
    buildPastSimulatedBaselineV1.mockImplementationOnce(() => ({
      intervals: [{ timestamp: "2026-01-01T00:00:00.000Z", kwh: 0.2 }],
      dayResults: [
        {
          localDate: "2026-01-01",
          displayDayKwh: 0.2,
          intervals: [],
          intervalSumKwh: 0.2,
          finalDayKwh: 0.2,
        },
      ],
    }));

    const out = await simulatePastSelectedDaysShared({
      userId: "u1",
      houseId: "h1",
      esiid: "1044",
      startDate: "2026-01-01",
      endDate: "2026-01-01",
      timezone: "America/Chicago",
      travelRanges: [],
      buildInputs: {
        canonicalMonths: ["2026-01"],
        snapshots: {},
      } as any,
      buildPathKind: "lab_validation",
      selectedDateKeysLocal: new Set(["2026-01-01"]),
    });

    expect(out.simulatedIntervals).not.toBeNull();
    if (out.simulatedIntervals !== null) {
      expect(out.simulatedIntervals).toEqual([{ timestamp: "2026-01-01T00:00:00.000Z", kwh: 0.2 }]);
      expect(out.simulatedDayResults).toEqual([]);
    }
  });

  it("retains only requested selected-day result payloads while still simulating all selected days", async () => {
    getLatestUsageShapeProfile.mockResolvedValue(validUsageShapeRow());
    buildPastSimulatedBaselineV1.mockImplementationOnce(() => ({
      intervals: [
        { timestamp: "2026-01-01T00:00:00.000Z", kwh: 0.2 },
        { timestamp: "2026-01-02T00:00:00.000Z", kwh: 0.4 },
      ],
      dayResults: [
        {
          localDate: "2026-01-01",
          displayDayKwh: 0.2,
          intervals: [{ timestamp: "2026-01-01T00:00:00.000Z", kwh: 0.2 }],
          intervalSumKwh: 0.2,
          finalDayKwh: 0.2,
        },
        {
          localDate: "2026-01-02",
          displayDayKwh: 0.4,
          intervals: [{ timestamp: "2026-01-02T00:00:00.000Z", kwh: 0.4 }],
          intervalSumKwh: 0.4,
          finalDayKwh: 0.4,
        },
      ],
    }));

    const out = await simulatePastSelectedDaysShared({
      userId: "u1",
      houseId: "h1",
      esiid: "1044",
      startDate: "2026-01-01",
      endDate: "2026-01-02",
      timezone: "America/Chicago",
      travelRanges: [],
      buildInputs: {
        canonicalMonths: ["2026-01"],
        snapshots: {},
      } as any,
      buildPathKind: "lab_validation",
      selectedDateKeysLocal: new Set(["2026-01-01", "2026-01-02"]),
      retainSimulatedDayResultDateKeysLocal: new Set(["2026-01-02"]),
    });

    expect(out.simulatedIntervals).not.toBeNull();
    if (out.simulatedIntervals !== null) {
      expect(buildPastSimulatedBaselineV1.mock.calls[0]?.[0]?.forceSimulateDateKeys).toBeUndefined();
      expect(buildPastSimulatedBaselineV1.mock.calls[0]?.[0]?.emitAllIntervals).toBe(false);
      expect(buildPastSimulatedBaselineV1.mock.calls[0]?.[0]?.collectSimulatedDayResultsDateKeys).toBeUndefined();
      expect(out.simulatedIntervals.map((row) => row.timestamp)).toEqual([
        "2026-01-01T00:00:00.000Z",
        "2026-01-02T00:00:00.000Z",
      ]);
      expect(out.simulatedDayResults.map((row) => row.localDate)).toEqual(["2026-01-02"]);
    }
  });

  it("keeps only canonical in-window UTC retain keys when timezone is missing", async () => {
    getLatestUsageShapeProfile.mockResolvedValue(validUsageShapeRow());

    const out = await simulatePastUsageDataset({
      userId: "u1",
      houseId: "h1",
      esiid: "1044",
      startDate: "2026-01-01",
      endDate: "2026-01-01",
      timezone: undefined,
      travelRanges: [],
      buildInputs: {
        canonicalMonths: ["2026-01"],
        snapshots: {},
      } as any,
      buildPathKind: "lab_validation",
      includeSimulatedDayResults: true,
      retainSimulatedDayResultDateKeysLocal: new Set(["2026-01-01", "2026-02-01"]),
    });

    expect(out.dataset).not.toBeNull();
    expect((out as any).stitchedCurve).toBeUndefined();
    expect((out.dataset?.meta as any)?.canonicalArtifactSimulatedDayTotalsByDate).toEqual({
      "2026-01-01": 0.5,
    });
    expect(buildPastSimulatedBaselineV1.mock.calls[0]?.[0]?.collectSimulatedDayResultsDateKeys).toBeInstanceOf(Set);
    expect(
      Array.from(buildPastSimulatedBaselineV1.mock.calls[0]?.[0]?.collectSimulatedDayResultsDateKeys ?? []).sort()
    ).toEqual(["2026-01-01"]);
  });

  it("forwards undefined retain keys when local retained keys do not intersect UTC dates", async () => {
    getLatestUsageShapeProfile.mockResolvedValue(validUsageShapeRow());

    const out = await simulatePastUsageDataset({
      userId: "u1",
      houseId: "h1",
      esiid: "1044",
      startDate: "2026-01-01",
      endDate: "2026-01-01",
      timezone: undefined,
      travelRanges: [],
      buildInputs: {
        canonicalMonths: ["2026-01"],
        snapshots: {},
      } as any,
      buildPathKind: "lab_validation",
      includeSimulatedDayResults: true,
      retainSimulatedDayResultDateKeysLocal: new Set(["2026-02-01"]),
    });

    expect(out.dataset).not.toBeNull();
    expect(buildPastSimulatedBaselineV1.mock.calls[0]?.[0]?.collectSimulatedDayResultsDateKeys).toBeUndefined();
  });
});

describe("collectSimulatedDayLocalDateIntervalConflicts", () => {
  const tz = "America/Chicago";

  it("returns empty when intervals are empty (no interval-backed membership to check)", () => {
    const conflicts = collectSimulatedDayLocalDateIntervalConflicts(
      [{ localDate: "2026-01-01", intervals: [] } as any],
      tz
    );
    expect(conflicts).toEqual([]);
  });

  it("returns empty when localDate matches the single interval-derived local date key", () => {
    const conflicts = collectSimulatedDayLocalDateIntervalConflicts(
      [
        {
          localDate: "2026-01-01",
          intervals: [{ timestamp: "2026-01-01T12:00:00.000Z", kwh: 1 }],
        } as any,
      ],
      tz
    );
    expect(conflicts).toEqual([]);
  });

  it("flags when localDate disagrees with interval-derived keys", () => {
    const conflicts = collectSimulatedDayLocalDateIntervalConflicts(
      [
        {
          localDate: "2026-01-01",
          intervals: [{ timestamp: "2026-01-02T12:00:00.000Z", kwh: 1 }],
        } as any,
      ],
      tz
    );
    expect(conflicts).toEqual([
      { localDate: "2026-01-01", intervalDerivedDateKeys: ["2026-01-02"] },
    ]);
  });

  it("allows localDate when it is one of multiple interval-derived local calendar days (midnight span)", () => {
    const conflicts = collectSimulatedDayLocalDateIntervalConflicts(
      [
        {
          localDate: "2026-01-01",
          intervals: [
            { timestamp: "2026-01-01T12:00:00.000Z", kwh: 0.5 },
            { timestamp: "2026-01-02T12:00:00.000Z", kwh: 0.5 },
          ],
        } as any,
      ],
      tz
    );
    expect(conflicts).toEqual([]);
  });
});
