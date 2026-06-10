import { beforeEach, describe, expect, it, vi } from "vitest";

const findFirstHouse = vi.fn();
const findFirstBuild = vi.fn();
const getActualUsageDatasetForHouse = vi.fn();
const getIntervalDataFingerprint = vi.fn();
const resolveHouseCommittedUsageSource = vi.fn();
const computePastWeatherIdentity = vi.fn();
const getLatestUsageFingerprintByHouseId = vi.fn();
const ensureSmtCoverageForHouse = vi.fn();
const saveManualUsageInputForUserHouse = vi.fn();
const dispatchPastSimRecalc = vi.fn();
const selectValidationDayKeys = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    houseAddress: {
      findFirst: (...args: unknown[]) => findFirstHouse(...args),
    },
    usageSimulatorBuild: {
      findFirst: (...args: unknown[]) => findFirstBuild(...args),
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

vi.mock("@/lib/usage/ensureSmtCoverage", () => ({
  ensureSmtCoverageForHouse: (...args: unknown[]) => ensureSmtCoverageForHouse(...args),
}));

vi.mock("@/modules/manualUsage/store", () => ({
  saveManualUsageInputForUserHouse: (...args: unknown[]) => saveManualUsageInputForUserHouse(...args),
}));

vi.mock("@/modules/usageSimulator/pastSimRecalcDispatch", () => ({
  dispatchPastSimRecalc: (...args: unknown[]) => dispatchPastSimRecalc(...args),
}));

vi.mock("@/modules/usageSimulator/validationSelection", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/usageSimulator/validationSelection")>();
  return {
    ...actual,
    selectValidationDayKeys: (...args: unknown[]) => selectValidationDayKeys(...args),
  };
});

const WINDOW = { startDate: "2025-06-08", endDate: "2026-06-07" };
const SOURCE_HOUSE_ID = "4da5d9d3-f139-4d3a-a602-3250d933c71c";
const LAB_HOUSE_ID = "29a3d820-2593-4673-9dd6-cd161bbd7f6f";
const USER_ID = "user-1";

function buildConsecutiveDailyRows(startDate: string, dayCount: number, kwh = 95) {
  const rows: Array<{ date: string; kwh: number }> = [];
  const cursor = new Date(`${startDate}T12:00:00.000Z`);
  for (let i = 0; i < dayCount; i++) {
    rows.push({ date: cursor.toISOString().slice(0, 10), kwh });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return rows;
}

const dailyRows = buildConsecutiveDailyRows("2025-06-08", 365, 95);

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

function mockSufficientSourceContext() {
  findFirstHouse.mockResolvedValue({ id: SOURCE_HOUSE_ID, esiid: "E123" });
  resolveHouseCommittedUsageSource.mockResolvedValue("SMT");
  getActualUsageDatasetForHouse.mockResolvedValue({
    dataset: sampleDataset,
    alternatives: { smt: sampleDataset.summary, greenButton: null },
  });
}

describe("resolveManualGapfillSeedFromSourceContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findFirstBuild.mockResolvedValue(null);
    getLatestUsageFingerprintByHouseId.mockResolvedValue(null);
    computePastWeatherIdentity.mockResolvedValue("weather:test");
    getIntervalDataFingerprint.mockResolvedValue("35040:1719792000000:abc123");
    ensureSmtCoverageForHouse.mockResolvedValue({ ok: true });
    saveManualUsageInputForUserHouse.mockResolvedValue({
      ok: true,
      updatedAt: new Date().toISOString(),
      payload: { mode: "MONTHLY" },
    });
    dispatchPastSimRecalc.mockResolvedValue({ ok: true });
    selectValidationDayKeys.mockReturnValue({
      selectedDateKeys: ["2025-07-04", "2025-08-12"],
      diagnostics: {
        modeUsed: "stratified_weather_balanced",
        targetCount: 14,
        selectedCount: 2,
        fallbackSubstitutions: 0,
        excludedTravelVacantCount: 0,
        excludedWeakCoverageCount: 0,
        weekdayWeekendSplit: { weekday: 1, weekend: 1 },
        seasonalSplit: { winter: 0, summer: 1, shoulder: 1 },
        bucketCounts: {},
        shortfallReason: null,
      },
    });
  });

  it("dry-run monthly seed from source actual truth returns statement ranges and monthly totals", async () => {
    mockSufficientSourceContext();
    const { resolveManualGapfillSeedFromSourceContext } = await import("@/modules/manualUsage/manualGapfillSeed");
    const out = await resolveManualGapfillSeedFromSourceContext({
      userId: USER_ID,
      sourceHouseId: SOURCE_HOUSE_ID,
      labHouseId: LAB_HOUSE_ID,
      mode: "MONTHLY_FROM_SOURCE_INTERVALS",
      window: WINDOW,
      anchorEndDate: "2026-06-07",
    });

    expect(out.ok).toBe(true);
    expect(out.status).toBe("ready");
    expect(out.seed?.manualUsageMode).toBe("manual_monthly");
    expect(out.seed?.statementRanges?.length).toBeGreaterThan(0);
    expect(out.seed?.monthlyTotalsKwhByMonth).toBeTruthy();
    expect(Object.keys(out.seed?.monthlyTotalsKwhByMonth ?? {}).length).toBeGreaterThan(0);
    expect(out.seed?.anchorEndDate).toBeTruthy();
  });

  it("dry-run annual seed from source actual truth returns annual total and anchor", async () => {
    mockSufficientSourceContext();
    const { resolveManualGapfillSeedFromSourceContext } = await import("@/modules/manualUsage/manualGapfillSeed");
    const out = await resolveManualGapfillSeedFromSourceContext({
      userId: USER_ID,
      sourceHouseId: SOURCE_HOUSE_ID,
      labHouseId: LAB_HOUSE_ID,
      mode: "ANNUAL_FROM_SOURCE_INTERVALS",
      window: WINDOW,
      anchorEndDate: "2026-06-07",
    });

    expect(out.ok).toBe(true);
    expect(out.status).toBe("ready");
    expect(out.seed?.manualUsageMode).toBe("manual_annual");
    expect(out.seed?.annualTotalKwh).toBeGreaterThan(0);
    expect(out.seed?.anchorEndDate).toBe("2026-06-07");
  });

  it("dry-run writes nothing", async () => {
    mockSufficientSourceContext();
    const { resolveManualGapfillSeedFromSourceContext } = await import("@/modules/manualUsage/manualGapfillSeed");
    await resolveManualGapfillSeedFromSourceContext({
      userId: USER_ID,
      sourceHouseId: SOURCE_HOUSE_ID,
      labHouseId: LAB_HOUSE_ID,
      mode: "MONTHLY_FROM_SOURCE_INTERVALS",
      window: WINDOW,
    });

    expect(saveManualUsageInputForUserHouse).not.toHaveBeenCalled();
    expect(dispatchPastSimRecalc).not.toHaveBeenCalled();
  });

  it("persist monthly writes manual payload only to labHouseId", async () => {
    mockSufficientSourceContext();
    const { resolveManualGapfillSeedFromSourceContext } = await import("@/modules/manualUsage/manualGapfillSeed");
    const out = await resolveManualGapfillSeedFromSourceContext({
      userId: USER_ID,
      sourceHouseId: SOURCE_HOUSE_ID,
      labHouseId: LAB_HOUSE_ID,
      mode: "MONTHLY_FROM_SOURCE_INTERVALS",
      window: WINDOW,
      persistToLabHome: true,
    });

    expect(out.ok).toBe(true);
    expect(out.status).toBe("persisted");
    expect(out.labContext.wroteManualPayload).toBe(true);
    expect(out.labContext.writeTarget).toBe("lab_home_only");
    expect(saveManualUsageInputForUserHouse).toHaveBeenCalledTimes(1);
    expect(saveManualUsageInputForUserHouse).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: USER_ID,
        houseId: LAB_HOUSE_ID,
        payload: expect.objectContaining({ mode: "MONTHLY" }),
      })
    );
  });

  it("persist annual writes manual payload only to labHouseId", async () => {
    mockSufficientSourceContext();
    const { resolveManualGapfillSeedFromSourceContext } = await import("@/modules/manualUsage/manualGapfillSeed");
    const out = await resolveManualGapfillSeedFromSourceContext({
      userId: USER_ID,
      sourceHouseId: SOURCE_HOUSE_ID,
      labHouseId: LAB_HOUSE_ID,
      mode: "ANNUAL_FROM_SOURCE_INTERVALS",
      window: WINDOW,
      persistToLabHome: true,
    });

    expect(out.ok).toBe(true);
    expect(out.status).toBe("persisted");
    expect(saveManualUsageInputForUserHouse).toHaveBeenCalledWith(
      expect.objectContaining({
        houseId: LAB_HOUSE_ID,
        payload: expect.objectContaining({ mode: "ANNUAL" }),
      })
    );
  });

  it("persist rejects labHouseId === sourceHouseId", async () => {
    mockSufficientSourceContext();
    const { resolveManualGapfillSeedFromSourceContext } = await import("@/modules/manualUsage/manualGapfillSeed");
    const out = await resolveManualGapfillSeedFromSourceContext({
      userId: USER_ID,
      sourceHouseId: SOURCE_HOUSE_ID,
      labHouseId: SOURCE_HOUSE_ID,
      mode: "MONTHLY_FROM_SOURCE_INTERVALS",
      window: WINDOW,
      persistToLabHome: true,
    });

    expect(out.ok).toBe(false);
    expect(out.status).toBe("invalid_seed");
    expect(saveManualUsageInputForUserHouse).not.toHaveBeenCalled();
  });

  it("missing MG-1 source truth returns missing_source_truth and writes nothing", async () => {
    findFirstHouse.mockResolvedValueOnce(null);
    const { resolveManualGapfillSeedFromSourceContext } = await import("@/modules/manualUsage/manualGapfillSeed");
    const out = await resolveManualGapfillSeedFromSourceContext({
      userId: USER_ID,
      sourceHouseId: SOURCE_HOUSE_ID,
      labHouseId: LAB_HOUSE_ID,
      mode: "MONTHLY_FROM_SOURCE_INTERVALS",
      window: WINDOW,
    });

    expect(out.ok).toBe(false);
    expect(out.status).toBe("missing_source_truth");
    expect(saveManualUsageInputForUserHouse).not.toHaveBeenCalled();
  });

  it("insufficient MG-1 source coverage returns insufficient_source_truth and writes nothing", async () => {
    findFirstHouse.mockResolvedValueOnce({ id: SOURCE_HOUSE_ID, esiid: "E123" });
    resolveHouseCommittedUsageSource.mockResolvedValueOnce("SMT");
    getActualUsageDatasetForHouse.mockResolvedValueOnce({
      dataset: { ...sampleDataset, daily: [] },
      alternatives: { smt: sampleDataset.summary, greenButton: null },
    });

    const { resolveManualGapfillSeedFromSourceContext } = await import("@/modules/manualUsage/manualGapfillSeed");
    const out = await resolveManualGapfillSeedFromSourceContext({
      userId: USER_ID,
      sourceHouseId: SOURCE_HOUSE_ID,
      labHouseId: LAB_HOUSE_ID,
      mode: "MONTHLY_FROM_SOURCE_INTERVALS",
      window: WINDOW,
    });

    expect(out.ok).toBe(false);
    expect(out.status).toBe("insufficient_source_truth");
    expect(saveManualUsageInputForUserHouse).not.toHaveBeenCalled();
  });

  it("invalid derived seed returns invalid_seed and writes nothing", async () => {
    mockSufficientSourceContext();
    const validation = await import("@/modules/manualUsage/validation");
    vi.spyOn(validation, "validateManualUsagePayload").mockReturnValueOnce({
      ok: false,
      error: "forced_invalid_seed",
    });
    const { resolveManualGapfillSeedFromSourceContext } = await import("@/modules/manualUsage/manualGapfillSeed");
    const out = await resolveManualGapfillSeedFromSourceContext({
      userId: USER_ID,
      sourceHouseId: SOURCE_HOUSE_ID,
      labHouseId: LAB_HOUSE_ID,
      mode: "MONTHLY_FROM_SOURCE_INTERVALS",
      window: WINDOW,
    });

    expect(out.ok).toBe(false);
    expect(out.status).toBe("invalid_seed");
    expect(saveManualUsageInputForUserHouse).not.toHaveBeenCalled();
  });

  it("seed output includes global validation policy revision/hash from MG-2", async () => {
    mockSufficientSourceContext();
    const { resolveManualGapfillSeedFromSourceContext } = await import("@/modules/manualUsage/manualGapfillSeed");
    const out = await resolveManualGapfillSeedFromSourceContext({
      userId: USER_ID,
      sourceHouseId: SOURCE_HOUSE_ID,
      labHouseId: LAB_HOUSE_ID,
      mode: "MONTHLY_FROM_SOURCE_INTERVALS",
      window: WINDOW,
    });

    expect(out.sourceContext.validationDayPolicyRevision).toBe("unified_past_validation_stratified_14_v4");
    expect(out.sourceContext.validationDayPolicyHash).toEqual(expect.any(String));
    expect(out.diagnostics.globalValidationPolicyUsed).toBe(true);
    expect(out.diagnostics.globalValidationPolicyHash).toBe(out.sourceContext.validationDayPolicyHash);
  });

  it("localGapFillSelectorUsed is false", async () => {
    mockSufficientSourceContext();
    const { resolveManualGapfillSeedFromSourceContext } = await import("@/modules/manualUsage/manualGapfillSeed");
    const out = await resolveManualGapfillSeedFromSourceContext({
      userId: USER_ID,
      sourceHouseId: SOURCE_HOUSE_ID,
      labHouseId: LAB_HOUSE_ID,
      mode: "MONTHLY_FROM_SOURCE_INTERVALS",
      window: WINDOW,
    });

    expect(out.diagnostics.localGapFillSelectorUsed).toBe(false);
  });

  it("Past Sim recalc is never dispatched", async () => {
    mockSufficientSourceContext();
    const { resolveManualGapfillSeedFromSourceContext } = await import("@/modules/manualUsage/manualGapfillSeed");
    const out = await resolveManualGapfillSeedFromSourceContext({
      userId: USER_ID,
      sourceHouseId: SOURCE_HOUSE_ID,
      labHouseId: LAB_HOUSE_ID,
      mode: "MONTHLY_FROM_SOURCE_INTERVALS",
      window: WINDOW,
      persistToLabHome: true,
    });

    expect(dispatchPastSimRecalc).not.toHaveBeenCalled();
    expect(out.diagnostics.pastSimRecalcDispatched).toBe(false);
  });

  it("compare logic is never called", async () => {
    mockSufficientSourceContext();
    const { resolveManualGapfillSeedFromSourceContext } = await import("@/modules/manualUsage/manualGapfillSeed");
    const out = await resolveManualGapfillSeedFromSourceContext({
      userId: USER_ID,
      sourceHouseId: SOURCE_HOUSE_ID,
      labHouseId: LAB_HOUSE_ID,
      mode: "ANNUAL_FROM_SOURCE_INTERVALS",
      window: WINDOW,
    });

    expect(out.diagnostics.compareRun).toBe(false);
    expect(dispatchPastSimRecalc).not.toHaveBeenCalled();
  });

  it("source house manual payload is never written", async () => {
    mockSufficientSourceContext();
    const { resolveManualGapfillSeedFromSourceContext } = await import("@/modules/manualUsage/manualGapfillSeed");
    await resolveManualGapfillSeedFromSourceContext({
      userId: USER_ID,
      sourceHouseId: SOURCE_HOUSE_ID,
      labHouseId: LAB_HOUSE_ID,
      mode: "MONTHLY_FROM_SOURCE_INTERVALS",
      window: WINDOW,
      persistToLabHome: true,
    });
    await resolveManualGapfillSeedFromSourceContext({
      userId: USER_ID,
      sourceHouseId: SOURCE_HOUSE_ID,
      labHouseId: LAB_HOUSE_ID,
      mode: "ANNUAL_FROM_SOURCE_INTERVALS",
      window: WINDOW,
      persistToLabHome: true,
    });

    for (const call of saveManualUsageInputForUserHouse.mock.calls) {
      expect(call[0]?.houseId).toBe(LAB_HOUSE_ID);
      expect(call[0]?.houseId).not.toBe(SOURCE_HOUSE_ID);
    }
  });
});
