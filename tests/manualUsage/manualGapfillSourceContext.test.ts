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

const sampleDataset = {
  summary: {
    source: "SMT" as const,
    intervalsCount: 35040,
    totalKwh: 34590,
    start: "2025-06-08",
    end: "2026-06-07",
    latest: "2026-06-07",
  },
  daily: [{ date: "2025-06-08", kwh: 95 }],
  monthly: [{ month: "2025-06", kwh: 2800 }],
  series: { annual: [{ kwh: 34590 }] },
};

describe("resolveManualGapfillSmtSourceContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findFirstBuild.mockResolvedValue(null);
    getLatestUsageFingerprintByHouseId.mockResolvedValue(null);
    computePastWeatherIdentity.mockResolvedValue("weather:test");
    getIntervalDataFingerprint.mockResolvedValue("35040:1719792000000:abc123");
    ensureSmtCoverageForHouse.mockResolvedValue({ ok: true });
    saveManualUsageInputForUserHouse.mockResolvedValue({ ok: true });
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

  it("returns missing status with warnings when the source house is not found", async () => {
    findFirstHouse.mockResolvedValueOnce(null);
    const { resolveManualGapfillSmtSourceContext } = await import("@/modules/manualUsage/manualGapfillSourceContext");
    const out = await resolveManualGapfillSmtSourceContext({
      sourceHouseId: "missing-house",
      userId: "user-1",
      window: WINDOW,
    });

    expect(out.status).toBe("missing");
    expect(out.diagnostics.warnings.length).toBeGreaterThan(0);
    expect(out.diagnostics.healAttempted).toBe(false);
    expect(out.diagnostics.healSkippedReason).toBe("read_only_resolver");
    expect(getActualUsageDatasetForHouse).not.toHaveBeenCalled();
  });

  it("returns coverage, totals, and source identity for a source house with actual usage", async () => {
    findFirstHouse.mockResolvedValueOnce({ id: "source-house-1", esiid: "E123" });
    resolveHouseCommittedUsageSource.mockResolvedValueOnce("SMT");
    getActualUsageDatasetForHouse.mockResolvedValueOnce({
      dataset: sampleDataset,
      alternatives: { smt: sampleDataset.summary, greenButton: null },
    });

    const { resolveManualGapfillSmtSourceContext } = await import("@/modules/manualUsage/manualGapfillSourceContext");
    const out = await resolveManualGapfillSmtSourceContext({
      sourceHouseId: "source-house-1",
      userId: "user-1",
      window: WINDOW,
      includeDiagnostics: true,
    });

    expect(out.status).toBe("available");
    expect(out.sourceHouseId).toBe("source-house-1");
    expect(out.userId).toBe("user-1");
    expect(out.esiid).toBe("E123");
    expect(out.committedUsageSource).toBe("SMT");
    expect(out.actualSource).toBe("SMT");
    expect(out.actualSourceKind).toBe("SMT");
    expect(out.sourceOwner).toBe("persisted_actual_usage");
    expect(out.coverage.intervalCount).toBe(35040);
    expect(out.actualData.monthlyTotals).toEqual([{ month: "2025-06", kwh: 2800 }]);
    expect(out.actualData.annualTotal).toBe(34590);
    expect(out.diagnostics.actualDatasetFound).toBe(true);
    expect(out.diagnostics.actualIntervalsFound).toBe(true);
  });

  it("keeps fingerprints stable for the same source and window", async () => {
    findFirstHouse.mockResolvedValue({ id: "source-house-1", esiid: "E123" });
    resolveHouseCommittedUsageSource.mockResolvedValue("SMT");
    getActualUsageDatasetForHouse.mockResolvedValue({
      dataset: {
        ...sampleDataset,
        daily: Array.from({ length: 365 }, (_, index) => ({
          date: `2025-${String(((index + 6) % 12) + 1).padStart(2, "0")}-${String((index % 28) + 1).padStart(2, "0")}`,
          kwh: 95,
        })),
      },
      alternatives: { smt: sampleDataset.summary, greenButton: null },
    });

    const { resolveManualGapfillSmtSourceContext } = await import("@/modules/manualUsage/manualGapfillSourceContext");
    const first = await resolveManualGapfillSmtSourceContext({
      sourceHouseId: "source-house-1",
      userId: "user-1",
      window: WINDOW,
    });
    const second = await resolveManualGapfillSmtSourceContext({
      sourceHouseId: "source-house-1",
      userId: "user-1",
      window: WINDOW,
    });

    expect(first.fingerprints.intervalFingerprint).toBe(second.fingerprints.intervalFingerprint);
    expect(first.fingerprints.dailyFingerprint).toBe(second.fingerprints.dailyFingerprint);
    expect(first.fingerprints.monthlyFingerprint).toBe(second.fingerprints.monthlyFingerprint);
    expect(first.fingerprints.weatherIdentity).toBe(second.fingerprints.weatherIdentity);
  });

  it("never writes manual payloads or dispatches Past Sim recalc", async () => {
    findFirstHouse.mockResolvedValueOnce({ id: "source-house-1", esiid: "E123" });
    resolveHouseCommittedUsageSource.mockResolvedValueOnce("SMT");
    getActualUsageDatasetForHouse.mockResolvedValueOnce({
      dataset: sampleDataset,
      alternatives: { smt: sampleDataset.summary, greenButton: null },
    });

    const { resolveManualGapfillSmtSourceContext } = await import("@/modules/manualUsage/manualGapfillSourceContext");
    await resolveManualGapfillSmtSourceContext({
      sourceHouseId: "source-house-1",
      userId: "user-1",
      window: WINDOW,
    });

    expect(saveManualUsageInputForUserHouse).not.toHaveBeenCalled();
    expect(dispatchPastSimRecalc).not.toHaveBeenCalled();
    expect(ensureSmtCoverageForHouse).not.toHaveBeenCalled();
  });

  it("loads actual truth from the source house id, not a lab test home", async () => {
    findFirstHouse.mockResolvedValueOnce({ id: "source-house-1", esiid: "E123" });
    resolveHouseCommittedUsageSource.mockResolvedValueOnce("SMT");
    getActualUsageDatasetForHouse.mockResolvedValueOnce({
      dataset: sampleDataset,
      alternatives: { smt: sampleDataset.summary, greenButton: null },
    });

    const { resolveManualGapfillSmtSourceContext } = await import("@/modules/manualUsage/manualGapfillSourceContext");
    await resolveManualGapfillSmtSourceContext({
      sourceHouseId: "source-house-1",
      userId: "user-1",
      window: WINDOW,
    });

    expect(getActualUsageDatasetForHouse).toHaveBeenCalledWith(
      "source-house-1",
      "E123",
      expect.objectContaining({
        userId: "user-1",
        skipFullYearIntervalFetch: true,
        skipLightweightInsightRecompute: true,
      })
    );
    expect(getActualUsageDatasetForHouse).not.toHaveBeenCalledWith(
      "lab-test-home-1",
      expect.anything(),
      expect.anything()
    );
  });

  it("reports missing actual usage without faking SMT truth", async () => {
    findFirstHouse.mockResolvedValueOnce({ id: "source-house-1", esiid: null });
    resolveHouseCommittedUsageSource.mockResolvedValueOnce(null);
    getActualUsageDatasetForHouse.mockResolvedValueOnce({
      dataset: null,
      alternatives: { smt: null, greenButton: null },
    });

    const { resolveManualGapfillSmtSourceContext } = await import("@/modules/manualUsage/manualGapfillSourceContext");
    const out = await resolveManualGapfillSmtSourceContext({
      sourceHouseId: "source-house-1",
      userId: "user-1",
      window: WINDOW,
    });

    expect(out.status).toBe("missing");
    expect(out.actualSourceKind).toBe("missing");
    expect(out.actualSource).toBeNull();
    expect(out.actualData.actualDatasetSummary).toBeNull();
    expect(out.fingerprints.intervalFingerprint).toBeNull();
    expect(out.diagnostics.warnings.join(" ")).toContain("No persisted actual usage truth");
  });

  it("reads global validation-day policy context without a GapFill-local selector", async () => {
    findFirstHouse.mockResolvedValueOnce({ id: "source-house-1", esiid: "E123" });
    resolveHouseCommittedUsageSource.mockResolvedValueOnce("SMT");
    getActualUsageDatasetForHouse.mockResolvedValueOnce({
      dataset: sampleDataset,
      alternatives: { smt: sampleDataset.summary, greenButton: null },
    });
    findFirstBuild.mockResolvedValueOnce({
      buildInputs: {
        pastValidationPolicyRevision: "unified_past_validation_stratified_14_v4",
        validationSelectionMode: "stratified_weather_balanced",
        validationOnlyDateKeysLocal: ["2025-07-04", "2025-08-12"],
      },
    });

    const { resolveManualGapfillSmtSourceContext } = await import("@/modules/manualUsage/manualGapfillSourceContext");
    const out = await resolveManualGapfillSmtSourceContext({
      sourceHouseId: "source-house-1",
      userId: "user-1",
      window: WINDOW,
    });

    expect(out.validation.localValidationSelectorRan).toBe(false);
    expect(out.validation.activeValidationDayPolicyLayer).toBe("global_validation_day_policy_v1");
    expect(out.validation.activeValidationDayPolicyHash).toEqual(expect.any(String));
    expect(out.validation.canonicalPastValidationPolicyRevision).toBe("unified_past_validation_stratified_14_v4");
    expect(out.validation.stampedValidationDateKeys).toEqual(["2025-07-04", "2025-08-12"]);
    expect(out.validation.selectedValidationDateKeys).toEqual(["2025-07-04", "2025-08-12"]);
    expect(selectValidationDayKeys).toHaveBeenCalled();
  });

  it("reports insufficient status when intervals exist but daily coverage is empty", async () => {
    findFirstHouse.mockResolvedValueOnce({ id: "source-house-1", esiid: "E123" });
    resolveHouseCommittedUsageSource.mockResolvedValueOnce("SMT");
    getActualUsageDatasetForHouse.mockResolvedValueOnce({
      dataset: {
        ...sampleDataset,
        daily: [],
      },
      alternatives: { smt: sampleDataset.summary, greenButton: null },
    });

    const { resolveManualGapfillSmtSourceContext } = await import("@/modules/manualUsage/manualGapfillSourceContext");
    const out = await resolveManualGapfillSmtSourceContext({
      sourceHouseId: "source-house-1",
      userId: "user-1",
      window: WINDOW,
    });

    expect(out.status).toBe("insufficient");
    expect(out.sourceOwner).toBe("none");
    expect(out.diagnostics.sourceCoverageSufficient).toBe(false);
  });

  it("marks available status when source coverage is sufficient", async () => {
    findFirstHouse.mockResolvedValueOnce({ id: "source-house-1", esiid: "E123" });
    resolveHouseCommittedUsageSource.mockResolvedValueOnce("SMT");
    getActualUsageDatasetForHouse.mockResolvedValueOnce({
      dataset: {
        ...sampleDataset,
        daily: Array.from({ length: 365 }, (_, index) => ({
          date: `2025-06-${String((index % 28) + 1).padStart(2, "0")}`,
          kwh: 95,
        })),
      },
      alternatives: { smt: sampleDataset.summary, greenButton: null },
    });

    const { resolveManualGapfillSmtSourceContext } = await import("@/modules/manualUsage/manualGapfillSourceContext");
    const out = await resolveManualGapfillSmtSourceContext({
      sourceHouseId: "source-house-1",
      userId: "user-1",
      window: WINDOW,
    });

    expect(out.status).toBe("available");
    expect(out.sourceOwner).toBe("persisted_actual_usage");
    expect(out.diagnostics.sourceCoverageSufficient).toBe(true);
    expect(out.fingerprints.intervalFingerprint).toBe("35040:1719792000000:abc123");
  });
});
