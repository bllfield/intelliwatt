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
const buildOnePathManualUsagePastSimReadResult = vi.fn();
const previewGlobalValidationDaySelection = vi.fn();
const buildGapfillCompareSimShared = vi.fn();
const selectValidationDayKeys = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    houseAddress: {
      findFirst: (...args: unknown[]) => findFirstHouse(...args),
    },
    usageSimulatorBuild: {
      findFirst: (...args: unknown[]) => findFirstBuild(...args),
      findUnique: (...args: unknown[]) => findUniqueBuild(...args),
    },
    usageSimulatorScenario: {
      findFirst: (...args: unknown[]) => findFirstScenario(...args),
    },
  },
}));

vi.mock("@/lib/db/usageClient", () => ({
  usagePrisma: {
    pastSimulatedDatasetCache: {
      findFirst: (...args: unknown[]) => findFirstArtifact(...args),
    },
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

vi.mock("@/modules/onePathSim/manualPastSimReadResult", () => ({
  buildOnePathManualUsagePastSimReadResult: (...args: unknown[]) =>
    buildOnePathManualUsagePastSimReadResult(...args),
}));

vi.mock("@/lib/usage/validationDayPolicy", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/usage/validationDayPolicy")>();
  return {
    ...actual,
    previewGlobalValidationDaySelection: (...args: unknown[]) => previewGlobalValidationDaySelection(...args),
  };
});

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
const WINDOW = { startDate: "2025-06-08", endDate: "2026-06-07" };

const dailyRows = Array.from({ length: 365 }, (_, index) => ({
  date: new Date(Date.parse("2025-06-08T12:00:00.000Z") + index * 86400000).toISOString().slice(0, 10),
  kwh: 95,
}));

const sampleDataset = {
  summary: {
    source: "SMT" as const,
    intervalsCount: 35040,
    totalKwh: 34590,
    start: "2025-06-08",
    end: "2026-06-07",
    latest: "2026-06-07",
  },
  daily: dailyRows,
  monthly: [{ month: "2025-06", kwh: 2800 }],
  series: { annual: [{ kwh: 34590 }] },
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

const simulatedDataset = {
  summary: {
    source: "SIMULATED",
    sourceDetail: "SIMULATED_MANUAL_CONSTRAINED",
    totalKwh: 34590,
    start: "2025-06-08",
    end: "2026-06-07",
  },
  daily: dailyRows,
  series: { intervals15: Array.from({ length: 35040 }, () => ({ kwh: 1 })) },
  meta: { artifactInputHash: "artifact-hash-1", baseload15MinKwh: 0.42 },
};

function mockSufficientSourceContext() {
  findFirstHouse.mockResolvedValue({ id: SOURCE_HOUSE_ID, esiid: "E123" });
  resolveHouseCommittedUsageSource.mockResolvedValue("SMT");
  getActualUsageDatasetForHouse.mockResolvedValue({
    dataset: sampleDataset,
    alternatives: { smt: sampleDataset.summary, greenButton: null },
  });
}

function mockSuccessfulRunReadback() {
  findFirstScenario.mockResolvedValue({ id: SCENARIO_ID });
  findUniqueBuild.mockResolvedValue({ buildInputsHash: "build-hash-1" });
  findFirstArtifact.mockResolvedValue({
    id: "artifact-1",
    inputHash: "artifact-hash-1",
    engineVersion: "engine-v1",
  });
  previewGlobalValidationDaySelection.mockResolvedValue({
    ok: true,
    selectedValidationDateKeys: ["2025-07-04"],
    policyHash: "policy-hash-1",
  });
  dispatchPastSimRecalc.mockResolvedValue({
    executionMode: "inline",
    correlationId: "corr-1",
    result: {
      ok: true,
      canonicalArtifactInputHash: "artifact-hash-1",
      buildInputsHash: "build-hash-1",
    },
  });
  buildOnePathManualUsagePastSimReadResult.mockResolvedValue({
    ok: true,
    houseId: LAB_HOUSE_ID,
    scenarioId: SCENARIO_ID,
    payload: monthlySeed,
    dataset: simulatedDataset,
    displayDataset: simulatedDataset,
    compareProjection: { rows: [{ date: "2025-07-04" }], metrics: { wape: 1 } },
    manualValidationSummary: {
      billMatchVerification: {
        status: "pass",
        eligiblePeriodCount: 12,
        reconciledPeriodCount: 12,
      },
      intervalShape: { accuracyClaim: "estimated" },
    },
  });
}

describe("buildManualGapfillRunReadbackResult", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findFirstBuild.mockResolvedValue(null);
    getLatestUsageFingerprintByHouseId.mockResolvedValue(null);
    computePastWeatherIdentity.mockResolvedValue("weather:test");
    getIntervalDataFingerprint.mockResolvedValue("35040:1719792000000:abc123");
    saveManualUsageInputForUserHouse.mockResolvedValue({ ok: true });
    buildGapfillCompareSimShared.mockResolvedValue({ ok: true });
    selectValidationDayKeys.mockReturnValue({
      selectedDateKeys: ["2025-07-04"],
      diagnostics: { modeUsed: "stratified_weather_balanced" },
    });
  });

  it("missing lab seed returns needs_seed and does not dispatch recalc", async () => {
    mockSufficientSourceContext();
    getManualUsageInputForUserHouse.mockResolvedValue({ payload: null, updatedAt: null });
    const { buildManualGapfillRunReadbackResult } = await import("@/modules/manualUsage/manualGapfillRunReadback");
    const out = await buildManualGapfillRunReadbackResult({
      userId: USER_ID,
      sourceHouseId: SOURCE_HOUSE_ID,
      labHouseId: LAB_HOUSE_ID,
      mode: "MONTHLY_FROM_SOURCE_INTERVALS",
    });

    expect(out.status).toBe("needs_seed");
    expect(dispatchPastSimRecalc).not.toHaveBeenCalled();
  });

  it("missing source context returns source_context_missing and does not dispatch recalc", async () => {
    getManualUsageInputForUserHouse.mockResolvedValue({ payload: monthlySeed, updatedAt: new Date().toISOString() });
    findFirstHouse.mockResolvedValueOnce(null);
    const { buildManualGapfillRunReadbackResult } = await import("@/modules/manualUsage/manualGapfillRunReadback");
    const out = await buildManualGapfillRunReadbackResult({
      userId: USER_ID,
      sourceHouseId: SOURCE_HOUSE_ID,
      labHouseId: LAB_HOUSE_ID,
      mode: "MONTHLY_FROM_SOURCE_INTERVALS",
    });

    expect(out.status).toBe("source_context_missing");
    expect(dispatchPastSimRecalc).not.toHaveBeenCalled();
  });

  it("labHouseId === sourceHouseId rejects and does not dispatch recalc", async () => {
    getManualUsageInputForUserHouse.mockResolvedValue({ payload: monthlySeed, updatedAt: new Date().toISOString() });
    const { buildManualGapfillRunReadbackResult } = await import("@/modules/manualUsage/manualGapfillRunReadback");
    const out = await buildManualGapfillRunReadbackResult({
      userId: USER_ID,
      sourceHouseId: SOURCE_HOUSE_ID,
      labHouseId: SOURCE_HOUSE_ID,
      mode: "MONTHLY_FROM_SOURCE_INTERVALS",
    });

    expect(out.ok).toBe(false);
    expect(out.status).toBe("run_failed");
    expect(dispatchPastSimRecalc).not.toHaveBeenCalled();
  });

  it("valid monthly lab seed dispatches canonical manual Past Sim on labHouseId", async () => {
    mockSufficientSourceContext();
    getManualUsageInputForUserHouse.mockResolvedValue({ payload: monthlySeed, updatedAt: new Date().toISOString() });
    mockSuccessfulRunReadback();
    const { buildManualGapfillRunReadbackResult } = await import("@/modules/manualUsage/manualGapfillRunReadback");
    const out = await buildManualGapfillRunReadbackResult({
      userId: USER_ID,
      sourceHouseId: SOURCE_HOUSE_ID,
      labHouseId: LAB_HOUSE_ID,
      mode: "MONTHLY_FROM_SOURCE_INTERVALS",
    });

    expect(out.status).toBe("ready");
    expect(dispatchPastSimRecalc).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER_ID,
        houseId: LAB_HOUSE_ID,
        mode: "MANUAL_TOTALS",
      })
    );
  });

  it("valid annual lab seed dispatches canonical manual Past Sim on labHouseId", async () => {
    mockSufficientSourceContext();
    getManualUsageInputForUserHouse.mockResolvedValue({ payload: annualSeed, updatedAt: new Date().toISOString() });
    mockSuccessfulRunReadback();
    buildOnePathManualUsagePastSimReadResult.mockResolvedValue({
      ok: true,
      houseId: LAB_HOUSE_ID,
      scenarioId: SCENARIO_ID,
      payload: annualSeed,
      dataset: simulatedDataset,
      displayDataset: simulatedDataset,
      compareProjection: { rows: [] },
      manualValidationSummary: {
        billMatchVerification: { status: "pass", eligiblePeriodCount: 1, reconciledPeriodCount: 1 },
        intervalShape: { accuracyClaim: "estimated" },
      },
    });
    const { buildManualGapfillRunReadbackResult } = await import("@/modules/manualUsage/manualGapfillRunReadback");
    const out = await buildManualGapfillRunReadbackResult({
      userId: USER_ID,
      sourceHouseId: SOURCE_HOUSE_ID,
      labHouseId: LAB_HOUSE_ID,
      mode: "ANNUAL_FROM_SOURCE_INTERVALS",
    });

    expect(out.status).toBe("ready");
    expect(out.run.inputType).toBe("MANUAL_ANNUAL");
  });

  it("passes actualContextHouseId = sourceHouseId to dispatch", async () => {
    mockSufficientSourceContext();
    getManualUsageInputForUserHouse.mockResolvedValue({ payload: monthlySeed, updatedAt: new Date().toISOString() });
    mockSuccessfulRunReadback();
    const { buildManualGapfillRunReadbackResult } = await import("@/modules/manualUsage/manualGapfillRunReadback");
    await buildManualGapfillRunReadbackResult({
      userId: USER_ID,
      sourceHouseId: SOURCE_HOUSE_ID,
      labHouseId: LAB_HOUSE_ID,
      mode: "MONTHLY_FROM_SOURCE_INTERVALS",
    });

    expect(dispatchPastSimRecalc).toHaveBeenCalledWith(
      expect.objectContaining({ actualContextHouseId: SOURCE_HOUSE_ID })
    );
  });

  it("dispatch uses MANUAL_TOTALS / MANUAL_MONTHLY for monthly mode", async () => {
    mockSufficientSourceContext();
    getManualUsageInputForUserHouse.mockResolvedValue({ payload: monthlySeed, updatedAt: new Date().toISOString() });
    mockSuccessfulRunReadback();
    const { buildManualGapfillRunReadbackResult } = await import("@/modules/manualUsage/manualGapfillRunReadback");
    const out = await buildManualGapfillRunReadbackResult({
      userId: USER_ID,
      sourceHouseId: SOURCE_HOUSE_ID,
      labHouseId: LAB_HOUSE_ID,
      mode: "MONTHLY_FROM_SOURCE_INTERVALS",
    });

    expect(out.run.simulatorMode).toBe("MANUAL_TOTALS");
    expect(out.run.inputType).toBe("MANUAL_MONTHLY");
    expect(buildOnePathManualUsagePastSimReadResult).toHaveBeenCalledWith(
      expect.objectContaining({ usageInputMode: "MANUAL_MONTHLY" })
    );
  });

  it("dispatch uses MANUAL_TOTALS / MANUAL_ANNUAL for annual mode", async () => {
    mockSufficientSourceContext();
    getManualUsageInputForUserHouse.mockResolvedValue({ payload: annualSeed, updatedAt: new Date().toISOString() });
    mockSuccessfulRunReadback();
    buildOnePathManualUsagePastSimReadResult.mockResolvedValue({
      ok: true,
      dataset: simulatedDataset,
      displayDataset: simulatedDataset,
      compareProjection: { rows: [] },
      manualValidationSummary: {
        billMatchVerification: { status: "pass", eligiblePeriodCount: 1, reconciledPeriodCount: 1 },
        intervalShape: { accuracyClaim: "estimated" },
      },
    });
    const { buildManualGapfillRunReadbackResult } = await import("@/modules/manualUsage/manualGapfillRunReadback");
    const out = await buildManualGapfillRunReadbackResult({
      userId: USER_ID,
      sourceHouseId: SOURCE_HOUSE_ID,
      labHouseId: LAB_HOUSE_ID,
      mode: "ANNUAL_FROM_SOURCE_INTERVALS",
    });

    expect(out.run.simulatorMode).toBe("MANUAL_TOTALS");
    expect(out.run.inputType).toBe("MANUAL_ANNUAL");
  });

  it("readback returns coverageStart/coverageEnd/dailyRowCount/intervalCount/totalKwh/source/sourceDetail", async () => {
    mockSufficientSourceContext();
    getManualUsageInputForUserHouse.mockResolvedValue({ payload: monthlySeed, updatedAt: new Date().toISOString() });
    mockSuccessfulRunReadback();
    const { buildManualGapfillRunReadbackResult } = await import("@/modules/manualUsage/manualGapfillRunReadback");
    const out = await buildManualGapfillRunReadbackResult({
      userId: USER_ID,
      sourceHouseId: SOURCE_HOUSE_ID,
      labHouseId: LAB_HOUSE_ID,
      mode: "MONTHLY_FROM_SOURCE_INTERVALS",
    });

    expect(out.readback.coverageStart).toBe("2025-06-08");
    expect(out.readback.coverageEnd).toBe("2026-06-07");
    expect(out.readback.dailyRowCount).toBe(365);
    expect(out.readback.intervalCount).toBe(35040);
    expect(out.readback.totalKwh).toBe(34590);
    expect(out.readback.source).toBe("SIMULATED");
    expect(out.readback.sourceDetail).toBe("SIMULATED_MANUAL_CONSTRAINED");
  });

  it("readback returns manual validation summary but no source-vs-sim compare rows in MG-4 result", async () => {
    mockSufficientSourceContext();
    getManualUsageInputForUserHouse.mockResolvedValue({ payload: monthlySeed, updatedAt: new Date().toISOString() });
    mockSuccessfulRunReadback();
    const { buildManualGapfillRunReadbackResult } = await import("@/modules/manualUsage/manualGapfillRunReadback");
    const out = await buildManualGapfillRunReadbackResult({
      userId: USER_ID,
      sourceHouseId: SOURCE_HOUSE_ID,
      labHouseId: LAB_HOUSE_ID,
      mode: "MONTHLY_FROM_SOURCE_INTERVALS",
    });

    expect(out.readback.billMatchStatus).toBe("pass");
    expect(out.readback.eligiblePeriodCount).toBe(12);
    expect((out as any).compareProjection).toBeUndefined();
    expect((out as any).compareRows).toBeUndefined();
  });

  it("expectedSeedHash mismatch returns seed_source_mismatch and does not dispatch recalc", async () => {
    mockSufficientSourceContext();
    getManualUsageInputForUserHouse.mockResolvedValue({ payload: monthlySeed, updatedAt: new Date().toISOString() });
    const { hashManualGapfillSavedSeedPayload } = await import("@/modules/manualUsage/manualGapfillSeed");
    const { buildManualGapfillRunReadbackResult } = await import("@/modules/manualUsage/manualGapfillRunReadback");
    const out = await buildManualGapfillRunReadbackResult({
      userId: USER_ID,
      sourceHouseId: SOURCE_HOUSE_ID,
      labHouseId: LAB_HOUSE_ID,
      mode: "MONTHLY_FROM_SOURCE_INTERVALS",
      expectedSeedHash: "wrong-hash",
    });

    expect(out.status).toBe("seed_source_mismatch");
    expect(dispatchPastSimRecalc).not.toHaveBeenCalled();
    expect(hashManualGapfillSavedSeedPayload(monthlySeed)).not.toBe("wrong-hash");
  });

  it("expectedValidationDayPolicyHash mismatch returns policy_mismatch and does not dispatch recalc", async () => {
    getManualUsageInputForUserHouse.mockResolvedValue({ payload: monthlySeed, updatedAt: new Date().toISOString() });
    const { buildManualGapfillRunReadbackResult } = await import("@/modules/manualUsage/manualGapfillRunReadback");
    const out = await buildManualGapfillRunReadbackResult({
      userId: USER_ID,
      sourceHouseId: SOURCE_HOUSE_ID,
      labHouseId: LAB_HOUSE_ID,
      mode: "MONTHLY_FROM_SOURCE_INTERVALS",
      expectedValidationDayPolicyHash: "wrong-policy-hash",
    });

    expect(out.status).toBe("policy_mismatch");
    expect(dispatchPastSimRecalc).not.toHaveBeenCalled();
  });

  it("never calls saveManualUsageInputForUserHouse", async () => {
    mockSufficientSourceContext();
    getManualUsageInputForUserHouse.mockResolvedValue({ payload: monthlySeed, updatedAt: new Date().toISOString() });
    mockSuccessfulRunReadback();
    const { buildManualGapfillRunReadbackResult } = await import("@/modules/manualUsage/manualGapfillRunReadback");
    const out = await buildManualGapfillRunReadbackResult({
      userId: USER_ID,
      sourceHouseId: SOURCE_HOUSE_ID,
      labHouseId: LAB_HOUSE_ID,
      mode: "MONTHLY_FROM_SOURCE_INTERVALS",
    });

    expect(saveManualUsageInputForUserHouse).not.toHaveBeenCalled();
    expect(out.diagnostics.labManualPayloadWritten).toBe(false);
    expect(out.diagnostics.sourceHouseWritten).toBe(false);
  });

  it("never calls GapFill compare helpers", async () => {
    mockSufficientSourceContext();
    getManualUsageInputForUserHouse.mockResolvedValue({ payload: monthlySeed, updatedAt: new Date().toISOString() });
    mockSuccessfulRunReadback();
    const { buildManualGapfillRunReadbackResult } = await import("@/modules/manualUsage/manualGapfillRunReadback");
    await buildManualGapfillRunReadbackResult({
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
    mockSuccessfulRunReadback();
    const { buildManualGapfillRunReadbackResult } = await import("@/modules/manualUsage/manualGapfillRunReadback");
    const out = await buildManualGapfillRunReadbackResult({
      userId: USER_ID,
      sourceHouseId: SOURCE_HOUSE_ID,
      labHouseId: LAB_HOUSE_ID,
      mode: "MONTHLY_FROM_SOURCE_INTERVALS",
    });

    expect(out.diagnostics.localGapFillSelectorUsed).toBe(false);
  });

  it("compareRun remains false", async () => {
    mockSufficientSourceContext();
    getManualUsageInputForUserHouse.mockResolvedValue({ payload: monthlySeed, updatedAt: new Date().toISOString() });
    mockSuccessfulRunReadback();
    const { buildManualGapfillRunReadbackResult } = await import("@/modules/manualUsage/manualGapfillRunReadback");
    const out = await buildManualGapfillRunReadbackResult({
      userId: USER_ID,
      sourceHouseId: SOURCE_HOUSE_ID,
      labHouseId: LAB_HOUSE_ID,
      mode: "MONTHLY_FROM_SOURCE_INTERVALS",
    });

    expect(out.diagnostics.compareRun).toBe(false);
    expect(out.diagnostics.pastSimRecalcDispatched).toBe(true);
  });
});
