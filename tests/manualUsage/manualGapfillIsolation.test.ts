import { beforeEach, describe, expect, it, vi } from "vitest";

const findFirstHouse = vi.fn();
const findFirstBuild = vi.fn();
const findFirstScenario = vi.fn();
const findUniqueBuild = vi.fn();
const findFirstArtifact = vi.fn();
const resolveOnePathUpstreamUsageTruthForSimulation = vi.fn();
const getIntervalDataFingerprint = vi.fn();
const resolveHouseCommittedUsageSource = vi.fn();
const computePastWeatherIdentity = vi.fn();
const getLatestUsageFingerprintByHouseId = vi.fn();
const getManualUsageInputForUserHouse = vi.fn();
const buildOnePathManualUsagePastSimReadResult = vi.fn();
const dispatchPastSimRecalc = vi.fn();
const resolveGlobalValidationDayKeysForPastSim = vi.fn();
const getFlag = vi.fn();
const readTravelRangesForHouse = vi.fn();

vi.mock("@/lib/flags", () => ({
  getFlag: (...args: unknown[]) => getFlag(...args),
  setFlag: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    houseAddress: { findFirst: (...args: unknown[]) => findFirstHouse(...args) },
    usageSimulatorBuild: {
      findFirst: (...args: unknown[]) => findFirstBuild(...args),
      findUnique: (...args: unknown[]) => findUniqueBuild(...args),
    },
    usageSimulatorScenario: { findFirst: (...args: unknown[]) => findFirstScenario(...args) },
  },
}));

vi.mock("@/lib/db/usageClient", () => ({
  usagePrisma: {
    pastSimulatedDatasetCache: { findFirst: (...args: unknown[]) => findFirstArtifact(...args) },
  },
}));

vi.mock("@/lib/usage/actualDatasetForHouse", () => ({
  getIntervalDataFingerprint: (...args: unknown[]) => getIntervalDataFingerprint(...args),
}));

vi.mock("@/modules/onePathSim/runtime", () => ({
  resolveOnePathUpstreamUsageTruthForSimulation: (...args: unknown[]) =>
    resolveOnePathUpstreamUsageTruthForSimulation(...args),
}));

vi.mock("@/lib/usage/houseCommittedUsageSource", () => ({
  resolveHouseCommittedUsageSource: (...args: unknown[]) => resolveHouseCommittedUsageSource(...args),
}));

vi.mock("@/modules/weather/identity", () => ({
  computePastWeatherIdentity: (...args: unknown[]) => computePastWeatherIdentity(...args),
}));

vi.mock("@/modules/usageSimulator/fingerprintArtifactsRepo", () => ({
  getLatestUsageFingerprintByHouseId: (...args: unknown[]) => getLatestUsageFingerprintByHouseId(...args),
}));

vi.mock("@/modules/manualUsage/store", () => ({
  getManualUsageInputForUserHouse: (...args: unknown[]) => getManualUsageInputForUserHouse(...args),
}));

vi.mock("@/modules/onePathSim/manualPastSimReadResult", () => ({
  buildOnePathManualUsagePastSimReadResult: (...args: unknown[]) =>
    buildOnePathManualUsagePastSimReadResult(...args),
}));

vi.mock("@/modules/usageSimulator/pastSimRecalcDispatch", () => ({
  dispatchPastSimRecalc: (...args: unknown[]) => dispatchPastSimRecalc(...args),
}));

vi.mock("@/lib/usage/validationDayPolicy", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/usage/validationDayPolicy")>();
  return {
    ...actual,
    resolveGlobalValidationDayKeysForPastSim: (...args: unknown[]) =>
      resolveGlobalValidationDayKeysForPastSim(...args),
  };
});

vi.mock("@/lib/usage/pastSimTravelRanges", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/usage/pastSimTravelRanges")>();
  return {
    ...actual,
    readTravelRangesForHouse: (...args: unknown[]) => readTravelRangesForHouse(...args),
  };
});

const SOURCE_HOUSE_ID = "4da5d9d3-f139-4d3a-a602-3250d933c71c";
const LAB_HOUSE_ID = "29a3d820-2593-4673-9dd6-cd161bbd7f6f";
const USER_ID = "user-1";
const SCENARIO_ID = "past-scenario-1";
const VALIDATION_DAY = "2025-07-01";

const dailyRows = Array.from({ length: 365 }, (_, index) => ({
  date: new Date(Date.parse("2025-06-08T12:00:00.000Z") + index * 86400000).toISOString().slice(0, 10),
  kwh: 95,
}));

const sourceActualDatasetFull = {
  summary: {
    source: "SMT",
    intervalsCount: 35040,
    totalKwh: 34590,
    start: "2025-06-08",
    end: "2026-06-07",
    latest: "2026-06-07",
  },
  daily: dailyRows,
  monthly: [{ month: "2025-06", kwh: 2800 }],
  series: { intervals15: Array.from({ length: 5760 }, () => ({ kwh: 1 })) },
};

const monthlySeed = {
  mode: "MONTHLY" as const,
  anchorEndDate: "2026-06-07",
  monthlyKwh: [{ month: "2026-06", kwh: 2850 }],
  statementRanges: [{ month: "2026-06", startDate: "2026-05-08", endDate: "2026-06-07" }],
  travelRanges: [],
};

const annualSeed = {
  mode: "ANNUAL" as const,
  anchorEndDate: "2026-06-07",
  annualKwh: 34590,
  travelRanges: [],
};

function buildDaily(date: string, kwh: number) {
  return { date, kwh };
}

function mockSufficientSourceContext() {
  findFirstHouse.mockResolvedValue({ id: SOURCE_HOUSE_ID, esiid: "E123" });
  resolveHouseCommittedUsageSource.mockResolvedValue("SMT");
  resolveOnePathUpstreamUsageTruthForSimulation.mockResolvedValue({
    dataset: sourceActualDatasetFull,
    alternatives: { smt: sourceActualDatasetFull.summary, greenButton: null },
    usageTruthSource: "persisted_usage_output",
    actualContextHouse: { id: SOURCE_HOUSE_ID, esiid: "E123" },
    selectedHouse: { id: SOURCE_HOUSE_ID, esiid: "E123" },
  });
}

describe("manual gapfill lab isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getFlag.mockResolvedValue("");
    findFirstBuild.mockResolvedValue(null);
    getLatestUsageFingerprintByHouseId.mockResolvedValue(null);
    computePastWeatherIdentity.mockResolvedValue("weather:test");
    getIntervalDataFingerprint.mockResolvedValue("35040:1719792000000:abc123");
    findFirstHouse.mockResolvedValue({ id: SOURCE_HOUSE_ID, esiid: "E123" });
    resolveHouseCommittedUsageSource.mockResolvedValue("SMT");
    findFirstScenario.mockResolvedValue({ id: SCENARIO_ID });
    findUniqueBuild.mockResolvedValue({ buildInputsHash: "build-hash-1" });
    findFirstArtifact.mockResolvedValue({
      id: "artifact-1",
      inputHash: "artifact-hash-1",
      engineVersion: "engine-v1",
    });
    resolveGlobalValidationDayKeysForPastSim.mockResolvedValue({
      validationOnlyDateKeysLocal: [VALIDATION_DAY],
    });
    readTravelRangesForHouse.mockResolvedValue([]);
  });

  it("MG-5 daily compare uses raw artifact rows, not baseline-stitched display rows", async () => {
    const poisonedDisplayKwh = 999.99;
    const rawSimulatedKwh = 41.25;
    const sourceActualKwh = 95;

    mockSufficientSourceContext();
    getManualUsageInputForUserHouse.mockResolvedValue({ payload: monthlySeed, updatedAt: new Date().toISOString() });
    buildOnePathManualUsagePastSimReadResult.mockResolvedValue({
      ok: true,
      houseId: LAB_HOUSE_ID,
      scenarioId: SCENARIO_ID,
      payload: monthlySeed,
      dataset: {
        summary: { source: "SIMULATED", sourceDetail: "SIMULATED_MANUAL_CONSTRAINED", totalKwh: 34590 },
        daily: [buildDaily(VALIDATION_DAY, rawSimulatedKwh)],
      },
      displayDataset: {
        summary: { source: "SIMULATED", sourceDetail: "SIMULATED_MANUAL_CONSTRAINED", totalKwh: 34590 },
        daily: [buildDaily(VALIDATION_DAY, poisonedDisplayKwh)],
      },
      compareProjection: { rows: [], metrics: {} },
      manualValidationSummary: null,
    });

    const { compareManualGapfillSourceActualToLabSim } = await import("@/modules/manualUsage/manualGapfillCompare");
    const out = await compareManualGapfillSourceActualToLabSim({
      userId: USER_ID,
      sourceHouseId: SOURCE_HOUSE_ID,
      labHouseId: LAB_HOUSE_ID,
      mode: "MONTHLY_FROM_SOURCE_INTERVALS",
      includeDailyRows: true,
    });

    const validationRow = out.compare.dailyRows?.find((row) => row.date === VALIDATION_DAY);
    expect(validationRow?.simulatedKwh).toBe(rawSimulatedKwh);
    expect(validationRow?.simulatedKwh).not.toBe(poisonedDisplayKwh);
    expect(validationRow?.actualKwh).toBe(sourceActualKwh);
    expect(validationRow?.deltaKwh).not.toBe(0);
  });

  it("MG-5 loads source actual only after lab artifact read and does not pass actual into lab read", async () => {
    mockSufficientSourceContext();
    getManualUsageInputForUserHouse.mockResolvedValue({ payload: monthlySeed, updatedAt: new Date().toISOString() });
    buildOnePathManualUsagePastSimReadResult.mockResolvedValue({
      ok: true,
      dataset: { summary: { source: "SIMULATED" }, daily: [buildDaily(VALIDATION_DAY, 42)] },
      displayDataset: { summary: { source: "SIMULATED" }, daily: [buildDaily(VALIDATION_DAY, 95)] },
      compareProjection: { rows: [], metrics: {} },
      manualValidationSummary: null,
    });

    const { compareManualGapfillSourceActualToLabSim } = await import("@/modules/manualUsage/manualGapfillCompare");
    await compareManualGapfillSourceActualToLabSim({
      userId: USER_ID,
      sourceHouseId: SOURCE_HOUSE_ID,
      labHouseId: LAB_HOUSE_ID,
      mode: "MONTHLY_FROM_SOURCE_INTERVALS",
    });

    expect(buildOnePathManualUsagePastSimReadResult).toHaveBeenCalledWith(
      expect.objectContaining({ callerType: "gapfill_test" })
    );
    expect(buildOnePathManualUsagePastSimReadResult).toHaveBeenCalledWith(
      expect.not.objectContaining({
        actualDataset: expect.anything(),
        actualReference: expect.anything(),
      })
    );
    expect(resolveOnePathUpstreamUsageTruthForSimulation).toHaveBeenCalled();
  });

  it("MG-5 compare isolation diagnostics are present on ready compare", async () => {
    mockSufficientSourceContext();
    getManualUsageInputForUserHouse.mockResolvedValue({ payload: monthlySeed, updatedAt: new Date().toISOString() });
    buildOnePathManualUsagePastSimReadResult.mockResolvedValue({
      ok: true,
      dataset: { summary: { source: "SIMULATED", totalKwh: 34590 }, daily: [buildDaily(VALIDATION_DAY, 42)] },
      displayDataset: { summary: { source: "SIMULATED", totalKwh: 34590 }, daily: [buildDaily(VALIDATION_DAY, 42)] },
      compareProjection: { rows: [], metrics: {} },
      manualValidationSummary: null,
    });

    const { compareManualGapfillSourceActualToLabSim } = await import("@/modules/manualUsage/manualGapfillCompare");
    const out = await compareManualGapfillSourceActualToLabSim({
      userId: USER_ID,
      sourceHouseId: SOURCE_HOUSE_ID,
      labHouseId: LAB_HOUSE_ID,
      mode: "MONTHLY_FROM_SOURCE_INTERVALS",
    });

    expect(out.diagnostics.compareOnlyNoSimulationMutation).toBe(true);
    expect(out.diagnostics.sourceActualLoadedOnlyForCompare).toBe(true);
    expect(out.diagnostics.labSimulatedLoadedFromArtifact).toBe(true);
    expect(out.diagnostics.labRowsMutatedByCompare).toBe(false);
  });

  it("daily compare does not track changed source daily shape when monthly totals unchanged", async () => {
    const { buildManualGapfillDailyCompareSummary } = await import("@/modules/manualUsage/manualGapfillCompare");

    const sourceDaily = [
      buildDaily("2025-07-01", 10),
      buildDaily("2025-07-02", 20),
      buildDaily("2025-07-03", 30),
    ];
    const labDaily = [
      buildDaily("2025-07-01", 55),
      buildDaily("2025-07-02", 55),
      buildDaily("2025-07-03", 55),
    ];

    const { dailySummary } = buildManualGapfillDailyCompareSummary({
      sourceDaily,
      labDaily,
      actualSourceKind: "SMT",
      includeDailyRows: true,
    });

    expect(dailySummary.meanAbsoluteDailyDeltaKwh).toBeGreaterThan(0);
    expect(dailySummary.comparedDayCount).toBe(3);
  });

  it("annual MG-4 dispatch keeps lab actual context and skips source actual readback inputs", async () => {
    mockSufficientSourceContext();
    resolveGlobalValidationDayKeysForPastSim.mockResolvedValue({
      policy: { selectionMode: "stratified_weather_balanced", validationDayCount: 14 },
      policyHash: "policy-hash-1",
      selectionMode: "stratified_weather_balanced",
      validationDayCount: 14,
      validationOnlyDateKeysLocal: [VALIDATION_DAY],
      window: { startDate: "2025-06-08", endDate: "2026-06-07" },
      warnings: [],
    });
    dispatchPastSimRecalc.mockResolvedValue({
      executionMode: "inline",
      correlationId: "corr-annual",
      result: { ok: true, canonicalArtifactInputHash: "artifact-hash-annual" },
    });

    getManualUsageInputForUserHouse.mockResolvedValue({ payload: annualSeed, updatedAt: new Date().toISOString() });
    buildOnePathManualUsagePastSimReadResult.mockResolvedValue({
      ok: true,
      dataset: { summary: { source: "SIMULATED", totalKwh: 34590 }, daily: [], series: { intervals15: [] } },
      displayDataset: { summary: { source: "SIMULATED", totalKwh: 34590 }, daily: [], series: { intervals15: [] } },
      manualValidationSummary: null,
    });

    const { buildManualGapfillRunReadbackResult } = await import("@/modules/manualUsage/manualGapfillRunReadback");
    const out = await buildManualGapfillRunReadbackResult({
      userId: USER_ID,
      sourceHouseId: SOURCE_HOUSE_ID,
      labHouseId: LAB_HOUSE_ID,
      mode: "ANNUAL_FROM_SOURCE_INTERVALS",
    });

    expect(out.status).toBe("ready");
    expect(dispatchPastSimRecalc).toHaveBeenCalledWith(
      expect.objectContaining({ actualContextHouseId: LAB_HOUSE_ID, mode: "MANUAL_TOTALS" })
    );
    expect(buildOnePathManualUsagePastSimReadResult).toHaveBeenCalledWith(
      expect.not.objectContaining({
        actualDataset: expect.anything(),
      })
    );
  });
});
