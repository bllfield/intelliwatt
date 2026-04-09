import { beforeEach, describe, expect, it, vi } from "vitest";
import * as manualPrefill from "@/modules/manualUsage/prefill";

vi.mock("server-only", () => ({}));

const buildSimulatedUsageDatasetFromCurve = vi.fn();

const manualUsageInputFindUnique = vi.fn();
const houseAddressFindUnique = vi.fn();
const usageSimulatorScenarioFindFirst = vi.fn();
const usageSimulatorScenarioEventFindMany = vi.fn();
const usageSimulatorBuildFindUnique = vi.fn();

const getHomeProfileSimulatedByUserHouse = vi.fn();
const getApplianceProfileSimulatedByUserHouse = vi.fn();
const hasActualIntervals = vi.fn();
const resolveActualUsageSourceAnchor = vi.fn();
const fetchActualCanonicalMonthlyTotals = vi.fn();
const fetchActualIntradayShape96 = vi.fn();
const getActualUsageDatasetForHouseMock = vi.fn();
const simulatePastUsageDataset = vi.fn();
const ensureSimulatorFingerprintsWithContext = vi.fn();
const resolveSimFingerprintWithContext = vi.fn();
const upsertSimulatorBuild = vi.fn();
const saveCachedPastDataset = vi.fn();
const getCachedPastDataset = vi.fn();
const deleteCachedPastDatasetsForScenario = vi.fn();
const saveIntervalSeries15m = vi.fn();
const upsertSimulatedUsageBuckets = vi.fn();
const computePastInputHash = vi.fn();
const getIntervalDataFingerprint = vi.fn();
const computePastWeatherIdentity = vi.fn();
const getUsageShapeProfileIdentityForPast = vi.fn();
const encodeIntervalsV1 = vi.fn();
const listLedgerRows = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    manualUsageInput: {
      findUnique: (...args: any[]) => manualUsageInputFindUnique(...args),
    },
    usageSimulatorScenario: {
      findFirst: (...args: any[]) => usageSimulatorScenarioFindFirst(...args),
    },
    usageSimulatorScenarioEvent: {
      findMany: (...args: any[]) => usageSimulatorScenarioEventFindMany(...args),
    },
    usageSimulatorBuild: {
      findUnique: (...args: any[]) => usageSimulatorBuildFindUnique(...args),
    },
    houseAddress: {
      findUnique: (...args: any[]) => houseAddressFindUnique(...args),
    },
  },
}));

vi.mock("@/modules/homeProfile/repo", () => ({
  getHomeProfileSimulatedByUserHouse: (...args: any[]) => getHomeProfileSimulatedByUserHouse(...args),
}));

vi.mock("@/modules/applianceProfile/repo", () => ({
  getApplianceProfileSimulatedByUserHouse: (...args: any[]) => getApplianceProfileSimulatedByUserHouse(...args),
}));

vi.mock("@/modules/homeProfile/validation", () => ({
  validateHomeProfile: () => ({ ok: true }),
}));

vi.mock("@/modules/applianceProfile/validation", () => ({
  normalizeStoredApplianceProfile: (value: unknown) => value,
  validateApplianceProfile: () => ({ ok: true }),
}));

vi.mock("@/modules/manualUsage/validation", () => ({
  validateManualUsagePayload: (value: unknown) => ({ ok: Boolean(value) }),
}));

vi.mock("@/modules/realUsageAdapter/actual", () => ({
  hasActualIntervals: (...args: any[]) => hasActualIntervals(...args),
  resolveActualUsageSourceAnchor: (...args: any[]) => resolveActualUsageSourceAnchor(...args),
  fetchActualCanonicalMonthlyTotals: (...args: any[]) => fetchActualCanonicalMonthlyTotals(...args),
  fetchActualIntradayShape96: (...args: any[]) => fetchActualIntradayShape96(...args),
}));

vi.mock("@/modules/simulatedUsage/simulatePastUsageDataset", () => ({
  ensureUsageShapeProfileForSharedSimulation: vi.fn(),
  getUsageShapeProfileIdentityForPast: (...args: any[]) => getUsageShapeProfileIdentityForPast(...args),
  loadWeatherForPastWindow: vi.fn(),
  simulatePastFullWindowShared: vi.fn(),
  simulatePastSelectedDaysShared: vi.fn(),
  simulatePastUsageDataset: (...args: any[]) => simulatePastUsageDataset(...args),
}));

vi.mock("@/modules/usageSimulator/fingerprintOrchestration", () => ({
  createFingerprintRecalcContext: (args: unknown) => args,
  ensureSimulatorFingerprintsWithContext: (...args: any[]) => ensureSimulatorFingerprintsWithContext(...args),
  resolveSimFingerprintWithContext: (...args: any[]) => resolveSimFingerprintWithContext(...args),
}));

vi.mock("@/modules/usageSimulator/repo", () => ({
  getHouseAddressForUserHouse: vi.fn(),
  listHouseAddressesForUser: vi.fn(),
  normalizeScenarioKey: (v: string | null | undefined) => (v ? String(v) : "BASELINE"),
  upsertSimulatorBuild: (...args: any[]) => upsertSimulatorBuild(...args),
}));

vi.mock("@/modules/usageSimulator/pastCache", () => ({
  PAST_ENGINE_VERSION: "production_past_stitched_v2",
  computePastInputHash: (...args: any[]) => computePastInputHash(...args),
  deleteCachedPastDatasetsForScenario: (...args: any[]) => deleteCachedPastDatasetsForScenario(...args),
  getCachedPastDataset: (...args: any[]) => getCachedPastDataset(...args),
  saveCachedPastDataset: (...args: any[]) => saveCachedPastDataset(...args),
}));

vi.mock("@/lib/usage/intervalSeriesRepo", () => ({
  saveIntervalSeries15m: (...args: any[]) => saveIntervalSeries15m(...args),
}));

vi.mock("@/lib/usage/simulatedUsageBuckets", () => ({
  upsertSimulatedUsageBuckets: (...args: any[]) => upsertSimulatedUsageBuckets(...args),
}));

vi.mock("@/lib/usage/actualDatasetForHouse", () => ({
  getActualDailyKwhForLocalDateKeys: vi.fn().mockResolvedValue(new Map()),
  getActualIntervalsForRange: vi.fn().mockResolvedValue([]),
  getActualUsageDatasetForHouse: (...args: any[]) => getActualUsageDatasetForHouseMock(...args),
  getIntervalDataFingerprint: (...args: any[]) => getIntervalDataFingerprint(...args),
}));

vi.mock("@/modules/weather/identity", () => ({
  computePastWeatherIdentity: (...args: any[]) => computePastWeatherIdentity(...args),
}));

vi.mock("@/modules/usageSimulator/intervalCodec", () => ({
  INTERVAL_CODEC_V1: "v1_delta_varint",
  decodeIntervalsV1: vi.fn(),
  digestEncodedIntervalsBuffer: vi.fn().mockReturnValue("digest-1"),
  encodeIntervalsV1: (...args: any[]) => encodeIntervalsV1(...args),
}));

vi.mock("@/modules/usageSimulator/dataset", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/modules/usageSimulator/dataset")>();
  return {
    ...mod,
    buildSimulatedUsageDatasetFromCurve: (...args: any[]) => buildSimulatedUsageDatasetFromCurve(...args),
  };
});

vi.mock("@/modules/upgradesLedger/repo", () => ({
  listLedgerRows: (...args: any[]) => listLedgerRows(...args),
}));

import { recalcSimulatorBuild } from "@/modules/usageSimulator/service";

describe("recalcSimulatorBuild admin lab manual totals", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    manualUsageInputFindUnique.mockResolvedValue(null);
    houseAddressFindUnique.mockResolvedValue({ userId: "source-user-1" });
    usageSimulatorScenarioFindFirst.mockResolvedValue({ id: "past-s1", name: "Past (Corrected)" });
    usageSimulatorScenarioEventFindMany.mockResolvedValue([]);
    usageSimulatorBuildFindUnique.mockResolvedValue({
      buildInputs: {
        canonicalMonths: [
          "2025-03",
          "2025-04",
          "2025-05",
          "2025-06",
          "2025-07",
          "2025-08",
          "2025-09",
          "2025-10",
          "2025-11",
          "2025-12",
          "2026-01",
          "2026-02",
        ],
        canonicalEndMonth: "2026-02",
      },
    });
    getHomeProfileSimulatedByUserHouse.mockResolvedValue({ occupancyAdults: 2 });
    getApplianceProfileSimulatedByUserHouse.mockResolvedValue({
      appliancesJson: { fuelConfiguration: { heating: "electric" } },
    });
    hasActualIntervals.mockResolvedValue(true);
    resolveActualUsageSourceAnchor.mockResolvedValue({
      source: "SMT",
      anchorEndDate: "2026-02-28",
      smtAnchorEndDate: "2026-02-28",
      greenButtonAnchorEndDate: null,
    });
    fetchActualCanonicalMonthlyTotals.mockResolvedValue({
      source: "SMT",
      monthlyKwhByMonth: {
        "2025-03": 1.5,
      },
    });
    fetchActualIntradayShape96.mockResolvedValue({
      source: "SMT",
      shape96: Array.from({ length: 96 }, () => 1 / 96),
    });
    getActualUsageDatasetForHouseMock.mockResolvedValue({
      dataset: {
        summary: {
          end: "2026-02-28",
        },
        daily: [
          { date: "2025-03-01", kwh: 10 },
          { date: "2025-03-02", kwh: 10 },
          { date: "2026-02-28", kwh: 25 },
        ],
      },
    });
    simulatePastUsageDataset.mockResolvedValue({ dataset: null, stitchedCurve: null, simulatedDayResults: [] });
    ensureSimulatorFingerprintsWithContext.mockResolvedValue(undefined);
    resolveSimFingerprintWithContext.mockResolvedValue(undefined);
    upsertSimulatorBuild.mockResolvedValue(undefined);
    saveCachedPastDataset.mockResolvedValue(undefined);
    getCachedPastDataset.mockResolvedValue(null);
    deleteCachedPastDatasetsForScenario.mockResolvedValue(0);
    saveIntervalSeries15m.mockResolvedValue({ seriesId: "series-1" });
    upsertSimulatedUsageBuckets.mockResolvedValue(undefined);
    computePastInputHash.mockReturnValue("input-hash-1");
    getIntervalDataFingerprint.mockResolvedValue("interval-fingerprint-1");
    computePastWeatherIdentity.mockResolvedValue("weather-identity-1");
    getUsageShapeProfileIdentityForPast.mockResolvedValue({
      usageShapeProfileId: "shape-1",
      usageShapeProfileVersion: "1",
      usageShapeProfileDerivedAt: "2026-01-01T00:00:00.000Z",
      usageShapeProfileSimHash: "shape-hash-1",
    });
    encodeIntervalsV1.mockReturnValue({ bytes: Buffer.from("00", "hex") });
    buildSimulatedUsageDatasetFromCurve.mockReturnValue({
      summary: {
        source: "SIMULATED",
        intervalsCount: 2,
        totalKwh: 1.5,
        start: "2025-03-30",
        end: "2026-03-29",
      },
      meta: {},
      daily: [{ date: "2025-03-30", kwh: 1.5, source: "SIMULATED" }],
      monthly: [{ month: "2025-03", kwh: 1.5 }],
      usageBucketsByMonth: { "2025-03": { "kwh.m.all.total": 1.5 } },
      series: {
        intervals15: [
          { timestamp: "2025-03-30T00:00:00.000Z", kwh: 0.75 },
          { timestamp: "2025-03-30T00:15:00.000Z", kwh: 0.75 },
        ],
      },
    });
    listLedgerRows.mockResolvedValue([]);
  });

  it("builds source-derived monthly manual payloads before MANUAL_TOTALS requirements are enforced", async () => {
    const resolveSpy = vi.spyOn(manualPrefill, "resolveManualUsageStageOnePayloadForMode");
    manualUsageInputFindUnique.mockImplementation(async ({ where }: any) => {
      const key = where?.userId_houseId;
      if (key?.userId === "source-user-1" && key?.houseId === "source-home-1") {
        return {
          payload: {
            mode: "MONTHLY",
            anchorEndDate: "2026-02-28",
            monthlyKwh: [
              { month: "2025-03", kwh: 1000 },
              { month: "2025-04", kwh: 900 },
              { month: "2025-05", kwh: 800 },
              { month: "2025-06", kwh: 700 },
              { month: "2025-07", kwh: 600 },
              { month: "2025-08", kwh: 500 },
              { month: "2025-09", kwh: 400 },
              { month: "2025-10", kwh: 300 },
              { month: "2025-11", kwh: 200 },
              { month: "2025-12", kwh: 100 },
              { month: "2026-01", kwh: 50 },
              { month: "2026-02", kwh: 25 },
            ],
            statementRanges: [{ month: "2026-02", startDate: "2026-02-01", endDate: "2026-02-28" }],
            travelRanges: [],
          },
        };
      }
      return null;
    });
    simulatePastUsageDataset.mockResolvedValueOnce({
      dataset: {
        summary: {
          source: "SIMULATED",
          intervalsCount: 2,
          totalKwh: 1.5,
          start: "2025-03-30",
          end: "2026-03-29",
        },
        meta: {
          sharedProducerPathUsed: true,
        },
        daily: [{ date: "2025-03-30", kwh: 1.5, source: "SIMULATED" }],
        monthly: [{ month: "2025-03", kwh: 1.5 }],
        series: {
          intervals15: [
            { timestamp: "2025-03-30T00:00:00.000Z", kwh: 0.75 },
            { timestamp: "2025-03-30T00:15:00.000Z", kwh: 0.75 },
          ],
        },
      },
      stitchedCurve: {
        start: "2025-03-30",
        end: "2026-03-29",
        intervals: [],
        monthlyTotals: [{ month: "2025-03", kwh: 1.5 }],
        annualTotalKwh: 1.5,
        meta: { excludedDays: 0, renormalized: false },
      },
      simulatedDayResults: [],
    });

    const out = await recalcSimulatorBuild({
      userId: "u1",
      houseId: "test-home-1",
      actualContextHouseId: "source-home-1",
      esiid: "E1",
      mode: "MANUAL_TOTALS",
      scenarioId: "past-s1",
      adminLabTreatmentMode: "manual_monthly_constrained",
      persistPastSimBaseline: true,
      correlationId: "cid-1",
      runContext: {
        callerLabel: "gapfill_launcher",
        buildPathKind: "recalc",
        persistRequested: true,
        adminLabTreatmentMode: "manual_monthly_constrained",
      },
    });

    expect(houseAddressFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "source-home-1" },
      })
    );
    expect(resolveSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "MONTHLY",
      })
    );
    expect(getActualUsageDatasetForHouseMock).toHaveBeenCalledWith(
      "source-home-1",
      "E1",
      expect.objectContaining({ skipFullYearIntervalFetch: true })
    );
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.error).toBe("artifact_persist_failed");
    }
    expect(simulatePastUsageDataset).toHaveBeenCalledWith(
      expect.objectContaining({
        buildInputs: expect.objectContaining({
          mode: "MANUAL_TOTALS",
          monthlyTotalsKwhByMonth: expect.objectContaining({
            "2025-03": 1000,
            "2026-02": 25,
          }),
          sharedProducerPathUsed: true,
        }),
      })
    );
    expect(ensureSimulatorFingerprintsWithContext).not.toHaveBeenCalled();
    expect(resolveSimFingerprintWithContext).not.toHaveBeenCalled();
    expect(getUsageShapeProfileIdentityForPast).not.toHaveBeenCalled();
    expect(upsertSimulatorBuild).toHaveBeenCalledTimes(1);
    expect(upsertSimulatorBuild.mock.calls[0]?.[0]?.mode).toBe("MANUAL_TOTALS");
    expect(upsertSimulatorBuild.mock.calls[0]?.[0]?.buildInputs?.sharedProducerPathUsed).toBe(true);
  }, 15000);

  it("does not route non-Past MANUAL_TOTALS scenarios into the shared Past producer path", async () => {
    usageSimulatorScenarioFindFirst.mockResolvedValueOnce({ id: "future-s1", name: "Future (What-if)" });
    manualUsageInputFindUnique.mockResolvedValueOnce({
      payload: {
        mode: "MONTHLY",
        anchorEndDate: "2026-02-28",
        monthlyKwh: [{ month: "2026-02", kwh: 25 }],
        travelRanges: [],
      },
    });

    const out = await recalcSimulatorBuild({
      userId: "u1",
      houseId: "test-home-1",
      actualContextHouseId: "source-home-1",
      esiid: "E1",
      mode: "MANUAL_TOTALS",
      scenarioId: "future-s1",
      persistPastSimBaseline: true,
      correlationId: "cid-future-manual",
      runContext: {
        callerLabel: "user_recalc",
        buildPathKind: "recalc",
        persistRequested: true,
      },
    });

    expect(simulatePastUsageDataset).not.toHaveBeenCalled();
    expect(upsertSimulatorBuild).toHaveBeenCalledTimes(1);
    expect(upsertSimulatorBuild.mock.calls[0]?.[0]?.buildInputs?.sharedProducerPathUsed).toBe(false);
    expect(out).toBeTruthy();
  }, 15000);

  it("propagates saved manual travel ranges into the shared Past producer inputs", async () => {
    manualUsageInputFindUnique.mockResolvedValueOnce({
      payload: {
        mode: "MONTHLY",
        anchorEndDate: "2026-02-28",
        monthlyKwh: [{ month: "2026-02", kwh: 25 }],
        statementRanges: [{ month: "2026-02", startDate: "2026-02-01", endDate: "2026-02-28" }],
        travelRanges: [{ startDate: "2026-02-10", endDate: "2026-02-12" }],
      },
    });
    simulatePastUsageDataset.mockResolvedValueOnce({
      dataset: {
        summary: {
          source: "SIMULATED",
          intervalsCount: 2,
          totalKwh: 25,
          start: "2026-02-01",
          end: "2026-02-28",
        },
        meta: {
          sharedProducerPathUsed: true,
        },
        daily: [{ date: "2026-02-10", kwh: 1, source: "SIMULATED" }],
        monthly: [{ month: "2026-02", kwh: 25 }],
        series: {
          intervals15: [
            { timestamp: "2026-02-10T00:00:00.000Z", kwh: 0.5 },
            { timestamp: "2026-02-10T00:15:00.000Z", kwh: 0.5 },
          ],
        },
      },
      stitchedCurve: {
        start: "2026-02-01",
        end: "2026-02-28",
        intervals: [],
        monthlyTotals: [{ month: "2026-02", kwh: 25 }],
        annualTotalKwh: 25,
        meta: { excludedDays: 3, renormalized: false },
      },
      simulatedDayResults: [],
    });

    const out = await recalcSimulatorBuild({
      userId: "u1",
      houseId: "test-home-1",
      actualContextHouseId: "source-home-1",
      esiid: "E1",
      mode: "MANUAL_TOTALS",
      scenarioId: "past-s1",
      persistPastSimBaseline: true,
      correlationId: "cid-manual-travel",
      runContext: {
        callerLabel: "user_recalc",
        buildPathKind: "recalc",
        persistRequested: true,
      },
    });

    expect(simulatePastUsageDataset).toHaveBeenCalledWith(
      expect.objectContaining({
        travelRanges: expect.arrayContaining([{ startDate: "2026-02-10", endDate: "2026-02-12" }]),
        buildInputs: expect.objectContaining({
          travelRanges: expect.arrayContaining([{ startDate: "2026-02-10", endDate: "2026-02-12" }]),
        }),
      })
    );
    expect(out).toBeTruthy();
  }, 15000);

  it("does not fail source-derived manual modes when source travel ranges cover the canonical window", async () => {
    simulatePastUsageDataset.mockResolvedValueOnce({
      dataset: {
        summary: {
          source: "SIMULATED",
          intervalsCount: 2,
          totalKwh: 1.5,
          start: "2025-03-30",
          end: "2026-03-29",
        },
        meta: {
          sharedProducerPathUsed: true,
        },
        daily: [{ date: "2025-03-30", kwh: 1.5, source: "SIMULATED" }],
        monthly: [{ month: "2025-03", kwh: 1.5 }],
        series: {
          intervals15: [
            { timestamp: "2025-03-30T00:00:00.000Z", kwh: 0.75 },
            { timestamp: "2025-03-30T00:15:00.000Z", kwh: 0.75 },
          ],
        },
      },
      stitchedCurve: {
        start: "2025-03-30",
        end: "2026-03-29",
        intervals: [],
        monthlyTotals: [{ month: "2025-03", kwh: 1.5 }],
        annualTotalKwh: 1.5,
        meta: { excludedDays: 365, renormalized: false },
      },
      simulatedDayResults: [],
    });
    const out = await recalcSimulatorBuild({
      userId: "u1",
      houseId: "test-home-1",
      actualContextHouseId: "source-home-1",
      esiid: "E1",
      mode: "MANUAL_TOTALS",
      scenarioId: "past-s1",
      adminLabTreatmentMode: "manual_monthly_constrained",
      preLockboxTravelRanges: [{ startDate: "2025-03-01", endDate: "2026-02-28" }],
      persistPastSimBaseline: true,
      correlationId: "cid-1b",
      runContext: {
        callerLabel: "gapfill_launcher",
        buildPathKind: "recalc",
        persistRequested: true,
        adminLabTreatmentMode: "manual_monthly_constrained",
      },
    });

    expect(getActualUsageDatasetForHouseMock).toHaveBeenCalledWith(
      "source-home-1",
      "E1",
      expect.objectContaining({ skipFullYearIntervalFetch: true })
    );
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.error).not.toBe("travel_exclusions_cover_full_range");
    }
  }, 15000);

  it("treats PROFILE_ONLY_NEW_BUILD as profile-only and does not propagate travel exclusions", async () => {
    simulatePastUsageDataset.mockResolvedValueOnce({
      dataset: {
        summary: {
          source: "SIMULATED",
          intervalsCount: 2,
          totalKwh: 1.5,
          start: "2025-03-30",
          end: "2026-03-29",
        },
        meta: {},
        daily: [{ date: "2025-03-30", kwh: 1.5, source: "SIMULATED" }],
        monthly: [{ month: "2025-03", kwh: 1.5 }],
        series: {
          intervals15: [
            { timestamp: "2025-03-30T00:00:00.000Z", kwh: 0.75 },
            { timestamp: "2025-03-30T00:15:00.000Z", kwh: 0.75 },
          ],
        },
      },
      stitchedCurve: {
        monthlyTotals: [{ month: "2025-03", kwh: 1.5 }],
      },
      simulatedDayResults: [],
    });

    const out = await recalcSimulatorBuild({
      userId: "u1",
      houseId: "test-home-1",
      actualContextHouseId: "source-home-1",
      esiid: "E1",
      mode: "NEW_BUILD_ESTIMATE",
      scenarioId: "past-s1",
      preLockboxTravelRanges: [{ startDate: "2025-03-01", endDate: "2026-02-28" }],
      persistPastSimBaseline: false,
      correlationId: "cid-1c",
      runContext: {
        callerLabel: "gapfill_launcher",
        buildPathKind: "recalc",
        persistRequested: false,
      },
    });

    expect(out.ok).toBe(true);
    expect(simulatePastUsageDataset).toHaveBeenCalledWith(
      expect.objectContaining({
        travelRanges: [],
      })
    );
  }, 15000);

  it("persists canonical past artifacts for PROFILE_ONLY_NEW_BUILD so artifact-only reads can load it", async () => {
    simulatePastUsageDataset.mockResolvedValueOnce({
      dataset: {
        summary: {
          source: "SIMULATED",
          intervalsCount: 2,
          totalKwh: 1.5,
          start: "2025-03-30",
          end: "2026-03-29",
        },
        meta: {},
        daily: [{ date: "2025-03-30", kwh: 1.5, source: "SIMULATED" }],
        monthly: [{ month: "2025-03", kwh: 1.5 }],
        series: {
          intervals15: [
            { timestamp: "2025-03-30T00:00:00.000Z", kwh: 0.75 },
            { timestamp: "2025-03-30T00:15:00.000Z", kwh: 0.75 },
          ],
        },
      },
      stitchedCurve: {
        monthlyTotals: [{ month: "2025-03", kwh: 1.5 }],
      },
      simulatedDayResults: [],
    });
    getCachedPastDataset.mockResolvedValueOnce({
      intervalsCodec: "v1_delta_varint",
    });

    const out = await recalcSimulatorBuild({
      userId: "u1",
      houseId: "test-home-1",
      actualContextHouseId: "source-home-1",
      esiid: "E1",
      mode: "NEW_BUILD_ESTIMATE",
      scenarioId: "past-s1",
      persistPastSimBaseline: true,
      correlationId: "cid-1d",
      runContext: {
        callerLabel: "gapfill_launcher",
        buildPathKind: "recalc",
        persistRequested: true,
      },
    });

    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.canonicalArtifactInputHash).toBe("input-hash-1");
    }
    expect(saveCachedPastDataset).toHaveBeenCalledTimes(1);
    expect(saveCachedPastDataset.mock.calls[0]?.[0]).toMatchObject({
      houseId: "test-home-1",
      scenarioId: "past-s1",
      inputHash: "input-hash-1",
      engineVersion: "production_past_stitched_v2",
    });
    expect(getCachedPastDataset).toHaveBeenCalledWith({
      houseId: "test-home-1",
      scenarioId: "past-s1",
      inputHash: "input-hash-1",
    });
  }, 15000);

  it("reuses the stitched dataset returned by simulatePastUsageDataset", async () => {
    simulatePastUsageDataset.mockResolvedValueOnce({
      dataset: {
        summary: {
          source: "SIMULATED",
          intervalsCount: 2,
          totalKwh: 1.5,
          start: "2025-03-30",
          end: "2026-03-29",
        },
        meta: {},
        daily: [{ date: "2025-03-30", kwh: 1.5, source: "SIMULATED" }],
        monthly: [{ month: "2025-03", kwh: 1.5 }],
        series: {
          intervals15: [
            { timestamp: "2025-03-30T00:00:00.000Z", kwh: 0.75 },
            { timestamp: "2025-03-30T00:15:00.000Z", kwh: 0.75 },
          ],
        },
      },
      stitchedCurve: {
        monthlyTotals: [{ month: "2025-03", kwh: 1.5 }],
      },
      simulatedDayResults: [],
    });

    const out = await recalcSimulatorBuild({
      userId: "u1",
      houseId: "test-home-1",
      actualContextHouseId: "source-home-1",
      esiid: "E1",
      mode: "SMT_BASELINE",
      scenarioId: "past-s1",
      persistPastSimBaseline: false,
      correlationId: "cid-2",
      validationDaySelectionMode: "manual",
      validationDayCount: 21,
      runContext: {
        callerLabel: "gapfill_launcher",
        buildPathKind: "recalc",
        persistRequested: false,
      },
    });

    expect(out.ok).toBe(true);
    expect(buildSimulatedUsageDatasetFromCurve).not.toHaveBeenCalled();
  }, 15000);

  it("does not wait for stale scenario cache cleanup before finishing shared recalc persistence", async () => {
    deleteCachedPastDatasetsForScenario.mockImplementationOnce(() => new Promise(() => {}));
    simulatePastUsageDataset.mockResolvedValueOnce({
      dataset: {
        summary: {
          source: "SIMULATED",
          intervalsCount: 2,
          totalKwh: 1.5,
          start: "2025-03-30",
          end: "2026-03-29",
        },
        meta: {},
        daily: [{ date: "2025-03-30", kwh: 1.5, source: "SIMULATED" }],
        monthly: [{ month: "2025-03", kwh: 1.5 }],
        series: {
          intervals15: [
            { timestamp: "2025-03-30T00:00:00.000Z", kwh: 0.75 },
            { timestamp: "2025-03-30T00:15:00.000Z", kwh: 0.75 },
          ],
        },
      },
      stitchedCurve: {
        monthlyTotals: [{ month: "2025-03", kwh: 1.5 }],
      },
      simulatedDayResults: [],
    });

    const out = await Promise.race([
      recalcSimulatorBuild({
        userId: "u1",
        houseId: "test-home-1",
        actualContextHouseId: "source-home-1",
        esiid: "E1",
        mode: "SMT_BASELINE",
        scenarioId: "past-s1",
        persistPastSimBaseline: true,
        correlationId: "cid-3",
        validationDaySelectionMode: "manual",
        validationDayCount: 21,
        runContext: {
          callerLabel: "gapfill_launcher",
          buildPathKind: "recalc",
          persistRequested: true,
        },
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("recalc waited on cache cleanup")), 100)
      ),
    ]);

    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.error).toBe("artifact_persist_failed");
    }
    expect(saveCachedPastDataset).toHaveBeenCalledTimes(1);
    expect(deleteCachedPastDatasetsForScenario).toHaveBeenCalledWith({
      houseId: "test-home-1",
      scenarioId: "past-s1",
      excludeInputHash: "input-hash-1",
    });
  }, 15000);

  it("returns MANUAL_TOTALS recalc success without waiting on post-artifact bucket or interval persistence", async () => {
    upsertSimulatedUsageBuckets.mockImplementationOnce(() => new Promise(() => {}));
    saveIntervalSeries15m.mockImplementationOnce(() => new Promise(() => {}));
    manualUsageInputFindUnique.mockResolvedValueOnce({
      payload: {
        mode: "ANNUAL",
        annualKwh: 1200,
      },
    });
    simulatePastUsageDataset.mockResolvedValueOnce({
      dataset: {
        summary: {
          source: "SIMULATED",
          intervalsCount: 2,
          totalKwh: 1.5,
          start: "2025-03-30",
          end: "2026-03-29",
        },
        meta: {},
        daily: [{ date: "2025-03-30", kwh: 1.5, source: "SIMULATED" }],
        monthly: [{ month: "2025-03", kwh: 1.5 }],
        usageBucketsByMonth: { "2025-03": { "kwh.m.all.total": 1.5 } },
        series: {
          intervals15: [
            { timestamp: "2025-03-30T00:00:00.000Z", kwh: 0.75 },
            { timestamp: "2025-03-30T00:15:00.000Z", kwh: 0.75 },
          ],
        },
      },
      stitchedCurve: {
        monthlyTotals: [{ month: "2025-03", kwh: 1.5 }],
      },
      simulatedDayResults: [],
    });
    getCachedPastDataset.mockResolvedValueOnce({
      intervalsCodec: "v1_delta_varint",
    });

    const out = await Promise.race([
      recalcSimulatorBuild({
        userId: "u1",
        houseId: "test-home-1",
        actualContextHouseId: "source-home-1",
        esiid: "E1",
        mode: "MANUAL_TOTALS",
        scenarioId: "past-s1",
        persistPastSimBaseline: true,
        correlationId: "cid-manual-fast-return",
        runContext: {
          callerLabel: "admin_manual_monthly_lab",
          buildPathKind: "recalc",
          persistRequested: true,
        },
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("MANUAL_TOTALS waited on post-artifact persistence")), 100)
      ),
    ]);

    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.canonicalArtifactInputHash).toBe("input-hash-1");
    }
    expect(upsertSimulatedUsageBuckets).toHaveBeenCalledTimes(1);
    expect(saveIntervalSeries15m).toHaveBeenCalledTimes(1);
  }, 15000);
});
