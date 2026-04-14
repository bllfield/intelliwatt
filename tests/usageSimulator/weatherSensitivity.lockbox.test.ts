import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const manualUsageInputFindUnique = vi.fn();
const usageSimulatorScenarioFindFirst = vi.fn();
const usageSimulatorScenarioEventFindMany = vi.fn();
const usageSimulatorBuildFindUnique = vi.fn();
const houseAddressFindUnique = vi.fn();
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
const getHouseWeatherDays = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    manualUsageInput: { findUnique: (...args: any[]) => manualUsageInputFindUnique(...args) },
    usageSimulatorScenario: { findFirst: (...args: any[]) => usageSimulatorScenarioFindFirst(...args) },
    usageSimulatorScenarioEvent: { findMany: (...args: any[]) => usageSimulatorScenarioEventFindMany(...args) },
    usageSimulatorBuild: { findUnique: (...args: any[]) => usageSimulatorBuildFindUnique(...args) },
    houseAddress: { findUnique: (...args: any[]) => houseAddressFindUnique(...args) },
  },
}));

vi.mock("@/modules/homeProfile/repo", () => ({
  getHomeProfileSimulatedByUserHouse: (...args: any[]) => getHomeProfileSimulatedByUserHouse(...args),
}));

vi.mock("@/modules/applianceProfile/repo", () => ({
  getApplianceProfileSimulatedByUserHouse: (...args: any[]) => getApplianceProfileSimulatedByUserHouse(...args),
}));

vi.mock("@/modules/homeProfile/validation", () => ({ validateHomeProfile: () => ({ ok: true }) }));
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

vi.mock("@/modules/weather/repo", () => ({
  getHouseWeatherDays: (...args: any[]) => getHouseWeatherDays(...args),
}));

vi.mock("@/modules/usageSimulator/intervalCodec", () => ({
  INTERVAL_CODEC_V1: "v1_delta_varint",
  decodeIntervalsV1: vi.fn(),
  digestEncodedIntervalsBuffer: vi.fn().mockReturnValue("digest-1"),
  encodeIntervalsV1: (...args: any[]) => encodeIntervalsV1(...args),
}));

vi.mock("@/modules/upgradesLedger/repo", () => ({
  listLedgerRows: (...args: any[]) => listLedgerRows(...args),
}));

import { recalcSimulatorBuild } from "@/modules/usageSimulator/service";

describe("weather sensitivity shared lockbox attachment", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    manualUsageInputFindUnique.mockResolvedValue({
      payload: {
        mode: "MONTHLY",
        anchorEndDate: "2025-08-31",
        monthlyKwh: [
          { month: "2025-06", kwh: 900 },
          { month: "2025-07", kwh: 1500 },
        ],
        statementRanges: [
          { month: "2025-06", startDate: "2025-05-29", endDate: "2025-06-28" },
          { month: "2025-07", startDate: "2025-06-29", endDate: "2025-07-28" },
        ],
        travelRanges: [],
      },
    });
    houseAddressFindUnique.mockResolvedValue({ userId: "u1" });
    usageSimulatorScenarioFindFirst.mockResolvedValue(null);
    usageSimulatorScenarioEventFindMany.mockResolvedValue([]);
    usageSimulatorBuildFindUnique.mockResolvedValue(null);
    getHomeProfileSimulatedByUserHouse.mockResolvedValue({
      squareFeet: 2100,
      fuelConfiguration: "all_electric",
      hvacType: "central_air",
      heatingType: "heat_pump",
      summerTemp: 72,
      winterTemp: 68,
      occupantsHomeAllDay: 1,
      hasPool: true,
      poolPumpHp: 1.5,
    });
    getApplianceProfileSimulatedByUserHouse.mockResolvedValue({
      appliancesJson: {
        fuelConfiguration: { heating: "electric" },
        appliances: [{ type: "POOL_PUMP", hp: 1.5 }],
      },
    });
    hasActualIntervals.mockResolvedValue(true);
    resolveActualUsageSourceAnchor.mockResolvedValue({
      source: "SMT",
      anchorEndDate: "2025-08-31",
      smtAnchorEndDate: "2025-08-31",
      greenButtonAnchorEndDate: null,
    });
    fetchActualCanonicalMonthlyTotals.mockResolvedValue({
      source: "SMT",
      monthlyKwhByMonth: { "2025-08": 1200 },
    });
    fetchActualIntradayShape96.mockResolvedValue({
      source: "SMT",
      shape96: Array.from({ length: 96 }, () => 1 / 96),
    });
    getActualUsageDatasetForHouseMock.mockResolvedValue({
      dataset: {
        summary: { intervalsCount: 96 * 5, start: "2025-05-29", end: "2025-07-28" },
        daily: [
          { date: "2025-05-29", kwh: 28, source: "ACTUAL" },
          { date: "2025-06-15", kwh: 32, source: "ACTUAL" },
          { date: "2025-06-29", kwh: 47, source: "ACTUAL" },
          { date: "2025-07-15", kwh: 52, source: "ACTUAL" },
          { date: "2025-07-28", kwh: 49, source: "ACTUAL" },
        ],
        dailyWeather: {
          "2025-05-29": { tAvgF: 72, tMinF: 65, tMaxF: 80, hdd65: 0, cdd65: 7 },
          "2025-06-15": { tAvgF: 76, tMinF: 69, tMaxF: 84, hdd65: 0, cdd65: 11 },
          "2025-06-29": { tAvgF: 81, tMinF: 74, tMaxF: 89, hdd65: 0, cdd65: 16 },
          "2025-07-15": { tAvgF: 85, tMinF: 77, tMaxF: 94, hdd65: 0, cdd65: 20 },
          "2025-07-28": { tAvgF: 83, tMinF: 75, tMaxF: 91, hdd65: 0, cdd65: 18 },
        },
      },
    });
    simulatePastUsageDataset.mockResolvedValue({
      dataset: { summary: { totalKwh: 2400 }, daily: [], monthly: [], series: { intervals15: [] }, meta: {} },
      stitchedCurve: {
        start: "2024-09-01T00:00:00.000Z",
        end: "2025-08-31T23:45:00.000Z",
        intervals: [],
        monthlyTotals: [{ month: "2025-08", kwh: 1200 }],
        annualTotalKwh: 2400,
        meta: { excludedDays: 0, renormalized: false },
      },
      simulatedDayResults: [],
    });
    ensureSimulatorFingerprintsWithContext.mockResolvedValue(undefined);
    resolveSimFingerprintWithContext.mockResolvedValue(undefined);
    upsertSimulatorBuild.mockResolvedValue(undefined);
    saveCachedPastDataset.mockResolvedValue(undefined);
    getCachedPastDataset.mockResolvedValue(null);
    deleteCachedPastDatasetsForScenario.mockResolvedValue(undefined);
    saveIntervalSeries15m.mockResolvedValue(undefined);
    upsertSimulatedUsageBuckets.mockResolvedValue(undefined);
    computePastInputHash.mockReturnValue("past-hash");
    getIntervalDataFingerprint.mockResolvedValue("interval-hash");
    computePastWeatherIdentity.mockResolvedValue({ hash: "weather-hash", windowKind: "ACTUAL" });
    getUsageShapeProfileIdentityForPast.mockResolvedValue({ identity: "shape-1" });
    encodeIntervalsV1.mockReturnValue(Buffer.from("encoded"));
    listLedgerRows.mockResolvedValue([]);
    getHouseWeatherDays.mockResolvedValue(
      new Map([
        ["2025-05-29", { dateKey: "2025-05-29", tAvgF: 72, hdd65: 0, cdd65: 7 }],
        ["2025-06-28", { dateKey: "2025-06-28", tAvgF: 76, hdd65: 0, cdd65: 11 }],
        ["2025-06-29", { dateKey: "2025-06-29", tAvgF: 81, hdd65: 0, cdd65: 16 }],
        ["2025-07-28", { dateKey: "2025-07-28", tAvgF: 85, hdd65: 0, cdd65: 20 }],
      ])
    );
  });

  it("attaches the shared derived input before simulation executes without activating simulation consumption", async () => {
    const result = await recalcSimulatorBuild({
      userId: "u1",
      houseId: "house-1",
      esiid: "esiid-1",
      mode: "MANUAL_TOTALS",
      persistPastSimBaseline: false,
      correlationId: "corr-weather-lockbox",
    });

    const buildInputs = upsertSimulatorBuild.mock.calls[0]?.[0]?.buildInputs;
    expect(upsertSimulatorBuild).toHaveBeenCalledTimes(1);
    expect(buildInputs.weatherEfficiencyDerivedInput).toMatchObject({
      derivedInputAttached: true,
      simulationActive: false,
      scoringMode: "INTERVAL_BASED",
    });
    expect(buildInputs.snapshots.weatherSensitivityScore).toMatchObject({
      scoringMode: "INTERVAL_BASED",
      nextDetailPromptType: expect.any(String),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect((result.dataset as any)?.meta?.weatherSensitivityScore).toMatchObject({
        scoringMode: "INTERVAL_BASED",
      });
      expect((result.dataset as any)?.meta?.weatherEfficiencyDerivedInput).toMatchObject({
        derivedInputAttached: true,
        simulationActive: false,
        scoringMode: "INTERVAL_BASED",
      });
    }
  });

  it(
    "also attaches shared interval-based weather inputs before non-baseline past sim runs",
    async () => {
    manualUsageInputFindUnique.mockResolvedValueOnce(null);

    await recalcSimulatorBuild({
      userId: "u1",
      houseId: "house-1",
      esiid: "esiid-1",
      mode: "NEW_BUILD_ESTIMATE",
      persistPastSimBaseline: false,
      correlationId: "corr-weather-interval-universal",
    });

    const buildInputs = upsertSimulatorBuild.mock.calls[0]?.[0]?.buildInputs;
    expect(getActualUsageDatasetForHouseMock).toHaveBeenCalled();
    expect(buildInputs.weatherEfficiencyDerivedInput).toMatchObject({
      derivedInputAttached: true,
      simulationActive: false,
      scoringMode: "INTERVAL_BASED",
    });
    expect(buildInputs.snapshots.weatherSensitivityScore).toMatchObject({
      scoringMode: "INTERVAL_BASED",
    });
    },
    15000
  );
});
