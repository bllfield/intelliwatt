import { beforeEach, describe, expect, it, vi } from "vitest";

const findFirstHouse = vi.fn();
const findFirstBuild = vi.fn();
const findFirstScenario = vi.fn();
const findUniqueBuild = vi.fn();
const findFirstArtifact = vi.fn();
const getActualUsageDatasetForHouse = vi.fn();
const getIntervalDataFingerprint = vi.fn();
const resolveHouseCommittedUsageSource = vi.fn();
const computePastWeatherIdentity = vi.fn();
const getLatestUsageFingerprintByHouseId = vi.fn();
const getManualUsageInputForUserHouse = vi.fn();
const saveManualUsageInputForUserHouse = vi.fn();
const dispatchPastSimRecalc = vi.fn();
const resolveManualGapfillSeedFromSourceContext = vi.fn();
const buildOnePathManualUsagePastSimReadResult = vi.fn();
const buildGapfillCompareSimShared = vi.fn();
const computeWapePercent = vi.fn();
const selectValidationDayKeys = vi.fn();

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
  getActualUsageDatasetForHouse: (...args: unknown[]) => getActualUsageDatasetForHouse(...args),
  getIntervalDataFingerprint: (...args: unknown[]) => getIntervalDataFingerprint(...args),
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
  saveManualUsageInputForUserHouse: (...args: unknown[]) => saveManualUsageInputForUserHouse(...args),
}));

vi.mock("@/modules/usageSimulator/pastSimRecalcDispatch", () => ({
  dispatchPastSimRecalc: (...args: unknown[]) => dispatchPastSimRecalc(...args),
}));

vi.mock("@/modules/manualUsage/manualGapfillSeed", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/manualUsage/manualGapfillSeed")>();
  return {
    ...actual,
    resolveManualGapfillSeedFromSourceContext: (...args: unknown[]) =>
      resolveManualGapfillSeedFromSourceContext(...args),
  };
});

vi.mock("@/modules/onePathSim/manualPastSimReadResult", () => ({
  buildOnePathManualUsagePastSimReadResult: (...args: unknown[]) =>
    buildOnePathManualUsagePastSimReadResult(...args),
}));

vi.mock("@/modules/usageSimulator/gapfillCompareCorePipeline", () => ({
  buildGapfillCompareSimShared: (...args: unknown[]) => buildGapfillCompareSimShared(...args),
}));

vi.mock("@/modules/usageSimulator/validationSelection", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/usageSimulator/validationSelection")>();
  return {
    ...actual,
    selectValidationDayKeys: (...args: unknown[]) => selectValidationDayKeys(...args),
  };
});

const SOURCE_HOUSE_ID = "4da5d9d3-f139-4d3a-a602-3250d933c71c";
const LAB_HOUSE_ID = "29a3d820-2593-4673-9dd6-cd161bbd7f6f";
const USER_ID = "user-1";
const SCENARIO_ID = "past-scenario-1";

const dailyRows = Array.from({ length: 365 }, (_, index) => ({
  date: new Date(Date.parse("2025-06-08T12:00:00.000Z") + index * 86400000).toISOString().slice(0, 10),
  kwh: 95,
}));

const sourceActualDataset = {
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

const labSimulatedDataset = {
  summary: {
    source: "SIMULATED",
    sourceDetail: "SIMULATED_MANUAL_CONSTRAINED",
    totalKwh: 34590,
    start: "2025-06-08",
    end: "2026-06-07",
  },
  daily: dailyRows.map((row) => ({ ...row, kwh: 94 })),
  meta: {
    artifactInputHash: "artifact-hash-1",
    manualBillPeriodSimTotalsById: { "2025-06:2025-06-30": 2800 },
    manualMonthlyInputState: { inputKindByMonth: { "2025-06": "entered_nonzero" } },
    filledMonths: [],
  },
};

const monthlySeed = {
  mode: "MONTHLY" as const,
  anchorEndDate: "2025-08-06",
  monthlyKwh: [{ month: "2025-06", kwh: 2800 }],
  statementRanges: [{ month: "2025-06", startDate: "2025-06-08", endDate: "2025-06-30" }],
  travelRanges: [],
};

const annualSeed = {
  mode: "ANNUAL" as const,
  anchorEndDate: "2025-08-06",
  annualKwh: 5650,
  travelRanges: [],
};

function mockSufficientSourceContext() {
  findFirstHouse.mockResolvedValue({ id: SOURCE_HOUSE_ID, esiid: "E123" });
  resolveHouseCommittedUsageSource.mockResolvedValue("SMT");
  getActualUsageDatasetForHouse.mockResolvedValue({
    dataset: sourceActualDataset,
    alternatives: { smt: sourceActualDataset.summary, greenButton: null },
  });
}

function mockSuccessfulLabReadback() {
  findFirstScenario.mockResolvedValue({ id: SCENARIO_ID });
  findUniqueBuild.mockResolvedValue({ buildInputsHash: "build-hash-1" });
  findFirstArtifact.mockResolvedValue({
    id: "artifact-1",
    inputHash: "artifact-hash-1",
    engineVersion: "engine-v1",
  });
  buildOnePathManualUsagePastSimReadResult.mockResolvedValue({
    ok: true,
    houseId: LAB_HOUSE_ID,
    scenarioId: SCENARIO_ID,
    payload: monthlySeed,
    dataset: labSimulatedDataset,
    displayDataset: labSimulatedDataset,
    compareProjection: { rows: [], metrics: {} },
    manualValidationSummary: null,
  });
}

describe("compareManualGapfillSourceActualToLabSim", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findFirstBuild.mockResolvedValue(null);
    getLatestUsageFingerprintByHouseId.mockResolvedValue(null);
    computePastWeatherIdentity.mockResolvedValue("weather:test");
    getIntervalDataFingerprint.mockResolvedValue("35040:1719792000000:abc123");
    saveManualUsageInputForUserHouse.mockResolvedValue({ ok: true });
    dispatchPastSimRecalc.mockResolvedValue({ ok: true });
    buildGapfillCompareSimShared.mockResolvedValue({ ok: true });
    computeWapePercent.mockReturnValue(1.2);
    selectValidationDayKeys.mockReturnValue({
      selectedDateKeys: ["2025-07-04"],
      diagnostics: { modeUsed: "stratified_weather_balanced" },
    });
  });

  it("missing source actual truth returns source_context_missing and does not compare", async () => {
    getManualUsageInputForUserHouse.mockResolvedValue({ payload: monthlySeed, updatedAt: new Date().toISOString() });
    findFirstHouse.mockResolvedValueOnce(null);
    const { compareManualGapfillSourceActualToLabSim } = await import("@/modules/manualUsage/manualGapfillCompare");
    const out = await compareManualGapfillSourceActualToLabSim({
      userId: USER_ID,
      sourceHouseId: SOURCE_HOUSE_ID,
      labHouseId: LAB_HOUSE_ID,
      mode: "MONTHLY_FROM_SOURCE_INTERVALS",
    });

    expect(out.status).toBe("source_context_missing");
    expect(buildOnePathManualUsagePastSimReadResult).not.toHaveBeenCalled();
  });

  it("missing lab readback/artifact returns lab_readback_missing", async () => {
    mockSufficientSourceContext();
    getIntervalDataFingerprint.mockResolvedValue("35040:1719792000000:abc123");
    getManualUsageInputForUserHouse.mockResolvedValue({ payload: monthlySeed, updatedAt: new Date().toISOString() });
    findFirstScenario.mockResolvedValue({ id: SCENARIO_ID });
    findFirstArtifact.mockResolvedValue(null);
    buildOnePathManualUsagePastSimReadResult.mockResolvedValue({
      ok: false,
      error: "artifact_missing",
      failureCode: "artifact_missing",
    });
    const { compareManualGapfillSourceActualToLabSim } = await import("@/modules/manualUsage/manualGapfillCompare");
    const out = await compareManualGapfillSourceActualToLabSim({
      userId: USER_ID,
      sourceHouseId: SOURCE_HOUSE_ID,
      labHouseId: LAB_HOUSE_ID,
      mode: "MONTHLY_FROM_SOURCE_INTERVALS",
    });

    expect(out.status).toBe("lab_readback_missing");
    expect(dispatchPastSimRecalc).not.toHaveBeenCalled();
  });

  it("labHouseId === sourceHouseId rejects", async () => {
    getManualUsageInputForUserHouse.mockResolvedValue({ payload: monthlySeed, updatedAt: new Date().toISOString() });
    const { compareManualGapfillSourceActualToLabSim } = await import("@/modules/manualUsage/manualGapfillCompare");
    const out = await compareManualGapfillSourceActualToLabSim({
      userId: USER_ID,
      sourceHouseId: SOURCE_HOUSE_ID,
      labHouseId: SOURCE_HOUSE_ID,
      mode: "MONTHLY_FROM_SOURCE_INTERVALS",
    });

    expect(out.ok).toBe(false);
    expect(out.status).toBe("compare_failed");
  });

  it("valid monthly compare returns ready with compareScope source_actual_vs_lab_simulated", async () => {
    mockSufficientSourceContext();
    getManualUsageInputForUserHouse.mockResolvedValue({ payload: monthlySeed, updatedAt: new Date().toISOString() });
    mockSuccessfulLabReadback();
    const { compareManualGapfillSourceActualToLabSim } = await import("@/modules/manualUsage/manualGapfillCompare");
    const out = await compareManualGapfillSourceActualToLabSim({
      userId: USER_ID,
      sourceHouseId: SOURCE_HOUSE_ID,
      labHouseId: LAB_HOUSE_ID,
      mode: "MONTHLY_FROM_SOURCE_INTERVALS",
    });

    expect(out.status).toBe("ready");
    expect(out.compare.compareScope).toBe("source_actual_vs_lab_simulated");
    expect(out.compare.monthly?.rows.length).toBeGreaterThan(0);
  });

  it("valid annual compare returns ready with annual compare summary", async () => {
    mockSufficientSourceContext();
    getManualUsageInputForUserHouse.mockResolvedValue({ payload: annualSeed, updatedAt: new Date().toISOString() });
    mockSuccessfulLabReadback();
    buildOnePathManualUsagePastSimReadResult.mockResolvedValue({
      ok: true,
      dataset: labSimulatedDataset,
      displayDataset: labSimulatedDataset,
      compareProjection: { rows: [] },
    });
    const { compareManualGapfillSourceActualToLabSim } = await import("@/modules/manualUsage/manualGapfillCompare");
    const out = await compareManualGapfillSourceActualToLabSim({
      userId: USER_ID,
      sourceHouseId: SOURCE_HOUSE_ID,
      labHouseId: LAB_HOUSE_ID,
      mode: "ANNUAL_FROM_SOURCE_INTERVALS",
    });

    expect(out.status).toBe("ready");
    expect(out.compare.annual).toBeTruthy();
  });

  it("monthly compare rows use source actual kWh as actualKwh", async () => {
    mockSufficientSourceContext();
    getManualUsageInputForUserHouse.mockResolvedValue({ payload: monthlySeed, updatedAt: new Date().toISOString() });
    mockSuccessfulLabReadback();
    const { compareManualGapfillSourceActualToLabSim } = await import("@/modules/manualUsage/manualGapfillCompare");
    const out = await compareManualGapfillSourceActualToLabSim({
      userId: USER_ID,
      sourceHouseId: SOURCE_HOUSE_ID,
      labHouseId: LAB_HOUSE_ID,
      mode: "MONTHLY_FROM_SOURCE_INTERVALS",
    });

    const row = out.compare.monthly?.rows[0];
    expect(row?.actualKwh).not.toBeNull();
    expect(row?.actualSource).toBe("SMT");
  });

  it("monthly compare rows use lab simulated readback as simulatedKwh", async () => {
    mockSufficientSourceContext();
    getManualUsageInputForUserHouse.mockResolvedValue({ payload: monthlySeed, updatedAt: new Date().toISOString() });
    mockSuccessfulLabReadback();
    const { compareManualGapfillSourceActualToLabSim } = await import("@/modules/manualUsage/manualGapfillCompare");
    const out = await compareManualGapfillSourceActualToLabSim({
      userId: USER_ID,
      sourceHouseId: SOURCE_HOUSE_ID,
      labHouseId: LAB_HOUSE_ID,
      mode: "MONTHLY_FROM_SOURCE_INTERVALS",
    });

    expect(out.compare.monthly?.rows[0]?.simulatedSource).toBe("SIMULATED_MANUAL_CONSTRAINED");
    expect(out.labSimulated.source).toBe("SIMULATED");
  });

  it("lab simulated data is never labeled ACTUAL", async () => {
    mockSufficientSourceContext();
    getManualUsageInputForUserHouse.mockResolvedValue({ payload: monthlySeed, updatedAt: new Date().toISOString() });
    mockSuccessfulLabReadback();
    const { compareManualGapfillSourceActualToLabSim } = await import("@/modules/manualUsage/manualGapfillCompare");
    const out = await compareManualGapfillSourceActualToLabSim({
      userId: USER_ID,
      sourceHouseId: SOURCE_HOUSE_ID,
      labHouseId: LAB_HOUSE_ID,
      mode: "MONTHLY_FROM_SOURCE_INTERVALS",
    });

    expect(out.labSimulated.source).toBe("SIMULATED");
    expect(out.sourceActual.actualSourceKind).toBe("SMT");
    expect(JSON.stringify(out)).not.toContain('"ACTUAL"');
  });

  it("source actual data is never taken from labHouseId", async () => {
    mockSufficientSourceContext();
    getManualUsageInputForUserHouse.mockResolvedValue({ payload: monthlySeed, updatedAt: new Date().toISOString() });
    mockSuccessfulLabReadback();
    const { compareManualGapfillSourceActualToLabSim } = await import("@/modules/manualUsage/manualGapfillCompare");
    await compareManualGapfillSourceActualToLabSim({
      userId: USER_ID,
      sourceHouseId: SOURCE_HOUSE_ID,
      labHouseId: LAB_HOUSE_ID,
      mode: "MONTHLY_FROM_SOURCE_INTERVALS",
    });

    expect(getActualUsageDatasetForHouse).toHaveBeenCalledWith(
      SOURCE_HOUSE_ID,
      expect.anything(),
      expect.objectContaining({ userId: USER_ID })
    );
    expect(getActualUsageDatasetForHouse).not.toHaveBeenCalledWith(
      LAB_HOUSE_ID,
      expect.anything(),
      expect.anything()
    );
  });

  it("expectedSeedHash mismatch returns seed_source_mismatch", async () => {
    mockSufficientSourceContext();
    getManualUsageInputForUserHouse.mockResolvedValue({ payload: monthlySeed, updatedAt: new Date().toISOString() });
    const { compareManualGapfillSourceActualToLabSim } = await import("@/modules/manualUsage/manualGapfillCompare");
    const out = await compareManualGapfillSourceActualToLabSim({
      userId: USER_ID,
      sourceHouseId: SOURCE_HOUSE_ID,
      labHouseId: LAB_HOUSE_ID,
      mode: "MONTHLY_FROM_SOURCE_INTERVALS",
      expectedSeedHash: "wrong-hash",
    });

    expect(out.status).toBe("seed_source_mismatch");
    expect(buildOnePathManualUsagePastSimReadResult).not.toHaveBeenCalled();
  });

  it("expectedSourceFingerprint mismatch returns seed_source_mismatch", async () => {
    mockSufficientSourceContext();
    getManualUsageInputForUserHouse.mockResolvedValue({ payload: monthlySeed, updatedAt: new Date().toISOString() });
    const { compareManualGapfillSourceActualToLabSim } = await import("@/modules/manualUsage/manualGapfillCompare");
    const out = await compareManualGapfillSourceActualToLabSim({
      userId: USER_ID,
      sourceHouseId: SOURCE_HOUSE_ID,
      labHouseId: LAB_HOUSE_ID,
      mode: "MONTHLY_FROM_SOURCE_INTERVALS",
      expectedSourceFingerprint: "wrong-fingerprint",
    });

    expect(out.status).toBe("seed_source_mismatch");
  });

  it("expectedValidationDayPolicyHash mismatch returns policy_mismatch", async () => {
    getManualUsageInputForUserHouse.mockResolvedValue({ payload: monthlySeed, updatedAt: new Date().toISOString() });
    const { compareManualGapfillSourceActualToLabSim } = await import("@/modules/manualUsage/manualGapfillCompare");
    const out = await compareManualGapfillSourceActualToLabSim({
      userId: USER_ID,
      sourceHouseId: SOURCE_HOUSE_ID,
      labHouseId: LAB_HOUSE_ID,
      mode: "MONTHLY_FROM_SOURCE_INTERVALS",
      expectedValidationDayPolicyHash: "wrong-policy",
    });

    expect(out.status).toBe("policy_mismatch");
  });

  it("expectedArtifactInputHash mismatch returns artifact_mismatch", async () => {
    mockSufficientSourceContext();
    getManualUsageInputForUserHouse.mockResolvedValue({ payload: monthlySeed, updatedAt: new Date().toISOString() });
    findFirstScenario.mockResolvedValue({ id: SCENARIO_ID });
    findFirstArtifact.mockResolvedValue({ inputHash: "artifact-hash-1" });
    const { compareManualGapfillSourceActualToLabSim } = await import("@/modules/manualUsage/manualGapfillCompare");
    const out = await compareManualGapfillSourceActualToLabSim({
      userId: USER_ID,
      sourceHouseId: SOURCE_HOUSE_ID,
      labHouseId: LAB_HOUSE_ID,
      mode: "MONTHLY_FROM_SOURCE_INTERVALS",
      expectedArtifactInputHash: "other-hash",
    });

    expect(out.status).toBe("artifact_mismatch");
  });

  it("includeDailyRows false omits dailyRows but includes dailySummary", async () => {
    mockSufficientSourceContext();
    getManualUsageInputForUserHouse.mockResolvedValue({ payload: monthlySeed, updatedAt: new Date().toISOString() });
    mockSuccessfulLabReadback();
    const { compareManualGapfillSourceActualToLabSim } = await import("@/modules/manualUsage/manualGapfillCompare");
    const out = await compareManualGapfillSourceActualToLabSim({
      userId: USER_ID,
      sourceHouseId: SOURCE_HOUSE_ID,
      labHouseId: LAB_HOUSE_ID,
      mode: "MONTHLY_FROM_SOURCE_INTERVALS",
      includeDailyRows: false,
    });

    expect(out.compare.dailySummary).toBeTruthy();
    expect(out.compare.dailyRows).toBeUndefined();
  });

  it("includeDailyRows true includes dailyRows", async () => {
    mockSufficientSourceContext();
    getManualUsageInputForUserHouse.mockResolvedValue({ payload: monthlySeed, updatedAt: new Date().toISOString() });
    mockSuccessfulLabReadback();
    const { compareManualGapfillSourceActualToLabSim } = await import("@/modules/manualUsage/manualGapfillCompare");
    const out = await compareManualGapfillSourceActualToLabSim({
      userId: USER_ID,
      sourceHouseId: SOURCE_HOUSE_ID,
      labHouseId: LAB_HOUSE_ID,
      mode: "MONTHLY_FROM_SOURCE_INTERVALS",
      includeDailyRows: true,
    });

    expect(out.compare.dailyRows?.length).toBeGreaterThan(0);
  });

  it("does not dispatch Past Sim recalc", async () => {
    mockSufficientSourceContext();
    getManualUsageInputForUserHouse.mockResolvedValue({ payload: monthlySeed, updatedAt: new Date().toISOString() });
    mockSuccessfulLabReadback();
    const { compareManualGapfillSourceActualToLabSim } = await import("@/modules/manualUsage/manualGapfillCompare");
    const out = await compareManualGapfillSourceActualToLabSim({
      userId: USER_ID,
      sourceHouseId: SOURCE_HOUSE_ID,
      labHouseId: LAB_HOUSE_ID,
      mode: "MONTHLY_FROM_SOURCE_INTERVALS",
    });

    expect(dispatchPastSimRecalc).not.toHaveBeenCalled();
    expect(out.diagnostics.pastSimRecalcDispatched).toBe(false);
  });

  it("does not save manual payloads", async () => {
    mockSufficientSourceContext();
    getManualUsageInputForUserHouse.mockResolvedValue({ payload: monthlySeed, updatedAt: new Date().toISOString() });
    mockSuccessfulLabReadback();
    const { compareManualGapfillSourceActualToLabSim } = await import("@/modules/manualUsage/manualGapfillCompare");
    await compareManualGapfillSourceActualToLabSim({
      userId: USER_ID,
      sourceHouseId: SOURCE_HOUSE_ID,
      labHouseId: LAB_HOUSE_ID,
      mode: "MONTHLY_FROM_SOURCE_INTERVALS",
    });

    expect(saveManualUsageInputForUserHouse).not.toHaveBeenCalled();
    expect(resolveManualGapfillSeedFromSourceContext).not.toHaveBeenCalled();
  });

  it("does not call GapFill compare helpers", async () => {
    mockSufficientSourceContext();
    getManualUsageInputForUserHouse.mockResolvedValue({ payload: monthlySeed, updatedAt: new Date().toISOString() });
    mockSuccessfulLabReadback();
    const { compareManualGapfillSourceActualToLabSim } = await import("@/modules/manualUsage/manualGapfillCompare");
    await compareManualGapfillSourceActualToLabSim({
      userId: USER_ID,
      sourceHouseId: SOURCE_HOUSE_ID,
      labHouseId: LAB_HOUSE_ID,
      mode: "MONTHLY_FROM_SOURCE_INTERVALS",
    });

    expect(buildGapfillCompareSimShared).not.toHaveBeenCalled();
  });

  it("localGapFillSelectorUsed remains false", async () => {
    mockSufficientSourceContext();
    getManualUsageInputForUserHouse.mockResolvedValue({ payload: monthlySeed, updatedAt: new Date().toISOString() });
    mockSuccessfulLabReadback();
    const { compareManualGapfillSourceActualToLabSim } = await import("@/modules/manualUsage/manualGapfillCompare");
    const out = await compareManualGapfillSourceActualToLabSim({
      userId: USER_ID,
      sourceHouseId: SOURCE_HOUSE_ID,
      labHouseId: LAB_HOUSE_ID,
      mode: "MONTHLY_FROM_SOURCE_INTERVALS",
    });

    expect(out.diagnostics.localGapFillSelectorUsed).toBe(false);
  });

  it("compareRun is true", async () => {
    mockSufficientSourceContext();
    getManualUsageInputForUserHouse.mockResolvedValue({ payload: monthlySeed, updatedAt: new Date().toISOString() });
    mockSuccessfulLabReadback();
    const { compareManualGapfillSourceActualToLabSim } = await import("@/modules/manualUsage/manualGapfillCompare");
    const out = await compareManualGapfillSourceActualToLabSim({
      userId: USER_ID,
      sourceHouseId: SOURCE_HOUSE_ID,
      labHouseId: LAB_HOUSE_ID,
      mode: "MONTHLY_FROM_SOURCE_INTERVALS",
    });

    expect(out.diagnostics.compareRun).toBe(true);
    expect(out.diagnostics.productionScoringChanged).toBe(false);
    expect(out.diagnostics.wapeChanged).toBe(false);
  });
});
