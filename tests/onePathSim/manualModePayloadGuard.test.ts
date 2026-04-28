import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const getHomeProfileSimulatedByUserHouse = vi.fn();
const getApplianceProfileSimulatedByUserHouse = vi.fn();
const getOnePathManualUsageInput = vi.fn();
const resolveOnePathCanonicalUsage365CoverageWindow = vi.fn();
const resolveOnePathUpstreamUsageTruthForSimulation = vi.fn();
const resolveOnePathWeatherSensitivityEnvelope = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    usageSimulatorBuild: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("@/modules/homeProfile/repo", () => ({
  getHomeProfileSimulatedByUserHouse: (...args: any[]) => getHomeProfileSimulatedByUserHouse(...args),
}));

vi.mock("@/modules/applianceProfile/repo", () => ({
  getApplianceProfileSimulatedByUserHouse: (...args: any[]) => getApplianceProfileSimulatedByUserHouse(...args),
}));

vi.mock("@/modules/applianceProfile/validation", () => ({
  normalizeStoredApplianceProfile: vi.fn((value: unknown) => value),
}));

vi.mock("@/modules/onePathSim/runtime", () => ({
  attachOnePathRunIdentityToEffectiveSimulationVariablesUsed: vi.fn((value: unknown) => value),
  buildOnePathDailyCurveComparePayload: vi.fn(),
  buildOnePathManualBillPeriodTargets: vi.fn(() => []),
  buildOnePathSharedPastSimDiagnostics: vi.fn(() => null),
  buildOnePathValidationCompareProjectionSidecar: vi.fn(() => ({ rows: [], metrics: {} })),
  buildOnePathWeatherEfficiencyDerivedInput: vi.fn(() => null),
  getOnePathManualUsageInput: (...args: any[]) => getOnePathManualUsageInput(...args),
  resolveOnePathCanonicalUsage365CoverageWindow: (...args: any[]) => resolveOnePathCanonicalUsage365CoverageWindow(...args),
  resolveOnePathManualStageOnePresentation: vi.fn(() => null),
  resolveOnePathUpstreamUsageTruthForSimulation: (...args: any[]) => resolveOnePathUpstreamUsageTruthForSimulation(...args),
  resolveOnePathWeatherSensitivityEnvelope: (...args: any[]) => resolveOnePathWeatherSensitivityEnvelope(...args),
}));

vi.mock("@/modules/onePathSim/manualArtifactDecorations", () => ({
  buildOnePathManualArtifactDecorations: vi.fn(),
}));

vi.mock("@/modules/onePathSim/onePathTruthSummary", () => ({
  buildOnePathTruthSummary: vi.fn(() => ({})),
}));

vi.mock("@/modules/onePathSim/serviceBridge", () => ({
  readOnePathSimulatedUsageScenario: vi.fn(),
  runOnePathSimulatorBuild: vi.fn(),
}));

vi.mock("@/modules/onePathSim/usageSimulator/simObservability", () => ({
  getMemoryRssMb: vi.fn(() => 123),
  logSimPipelineEvent: vi.fn(),
}));

describe("one path manual mode payload guards", () => {
  beforeEach(() => {
    getHomeProfileSimulatedByUserHouse.mockReset();
    getApplianceProfileSimulatedByUserHouse.mockReset();
    getOnePathManualUsageInput.mockReset();
    resolveOnePathCanonicalUsage365CoverageWindow.mockReset();
    resolveOnePathUpstreamUsageTruthForSimulation.mockReset();
    resolveOnePathWeatherSensitivityEnvelope.mockReset();

    getHomeProfileSimulatedByUserHouse.mockResolvedValue(null);
    getApplianceProfileSimulatedByUserHouse.mockResolvedValue(null);
    getOnePathManualUsageInput.mockResolvedValue({ payload: null });
    resolveOnePathCanonicalUsage365CoverageWindow.mockReturnValue({ startDate: "2025-05-01", endDate: "2026-04-30" });
    resolveOnePathWeatherSensitivityEnvelope.mockResolvedValue({ score: null, derivedInput: null });
  });

  it("fails MANUAL_MONTHLY when the saved payload is present but not usable monthly truth", async () => {
    const { adaptManualMonthlyRawInput, SharedSimulationRunError } = await import("@/modules/onePathSim/onePathSim");

    await expect(
      adaptManualMonthlyRawInput({
        userId: "user-1",
        houseId: "house-1",
        actualContextHouseId: "house-1",
        scenarioId: "past-1",
        weatherPreference: "LAST_YEAR_WEATHER",
        validationSelectionMode: "stratified_weather_balanced",
        validationDayCount: 14,
        validationOnlyDateKeysLocal: [],
        travelRanges: [],
        persistRequested: true,
        manualUsagePayload: {
          mode: "MONTHLY",
          anchorEndDate: "2026-01-15",
          monthlyKwh: [
            { month: "2025-12", kwh: "" },
            { month: "2026-01", kwh: "" },
          ],
        } as any,
      })
    ).rejects.toMatchObject(
      new SharedSimulationRunError({
        code: "requirements_unmet",
        missingItems: ["Save filled manual monthly usage totals before running MANUAL_MONTHLY."],
      })
    );
  });

  it("fails MANUAL_ANNUAL when the saved payload is not a usable annual payload", async () => {
    const { adaptManualAnnualRawInput, SharedSimulationRunError } = await import("@/modules/onePathSim/onePathSim");

    await expect(
      adaptManualAnnualRawInput({
        userId: "user-1",
        houseId: "house-1",
        actualContextHouseId: "house-1",
        scenarioId: null,
        weatherPreference: "LAST_YEAR_WEATHER",
        validationSelectionMode: "stratified_weather_balanced",
        validationDayCount: 14,
        validationOnlyDateKeysLocal: [],
        travelRanges: [],
        persistRequested: true,
        manualUsagePayload: {
          mode: "MONTHLY",
          anchorEndDate: "2026-01-15",
          monthlyKwh: [{ month: "2026-01", kwh: 100 }],
        } as any,
      })
    ).rejects.toMatchObject(
      new SharedSimulationRunError({
        code: "requirements_unmet",
        missingItems: ["Save a MANUAL_ANNUAL payload before running MANUAL_ANNUAL."],
      })
    );
  });

  it("allows MANUAL_MONTHLY to adapt from saved manual truth without upstream interval usage", async () => {
    resolveOnePathUpstreamUsageTruthForSimulation.mockResolvedValue({
      selectedHouse: { id: "house-1", esiid: "esiid-1" },
      actualContextHouse: { id: "house-1", esiid: "esiid-1" },
      dataset: null,
      alternatives: { smt: null, greenButton: null },
      usageTruthSource: "missing_usage_truth",
      seedResult: null,
      summary: { title: "Upstream Usage Truth", summary: "manual-only house", currentRun: {}, sharedOwners: [] },
    });

    const { adaptManualMonthlyRawInput } = await import("@/modules/onePathSim/onePathSim");
    const engineInput = await adaptManualMonthlyRawInput({
      userId: "user-1",
      houseId: "house-1",
      actualContextHouseId: "house-1",
      scenarioId: "past-1",
      weatherPreference: "LAST_YEAR_WEATHER",
      validationSelectionMode: "stratified_weather_balanced",
      validationDayCount: 14,
      validationOnlyDateKeysLocal: [],
      travelRanges: [],
      persistRequested: true,
      manualUsagePayload: {
        mode: "MONTHLY",
        anchorEndDate: "2026-01-15",
        monthlyKwh: [{ month: "2026-01", kwh: 500 }],
        statementRanges: [{ month: "2026-01", startDate: "2025-12-16", endDate: "2026-01-15" }],
        travelRanges: [],
      } as any,
    });

    expect(resolveOnePathUpstreamUsageTruthForSimulation).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        houseId: "house-1",
        actualContextHouseId: "house-1",
        seedIfMissing: false,
      })
    );
    expect(engineInput.inputType).toBe("MANUAL_MONTHLY");
    expect(engineInput.actualIntervalsReference).toEqual([]);
    expect(engineInput.upstreamUsageTruth).toEqual(
      expect.objectContaining({
        summary: "manual-only house",
      })
    );
  });

  it("skips optional enrichment for GREEN_BUTTON baseline adaptation", async () => {
    resolveOnePathUpstreamUsageTruthForSimulation.mockResolvedValue({
      selectedHouse: { id: "house-1", esiid: "esiid-1" },
      actualContextHouse: { id: "house-1", esiid: "esiid-1" },
      dataset: {
        summary: { source: "GREEN_BUTTON", start: "2025-04-26", end: "2026-04-25", totalKwh: 1234 },
        daily: [{ date: "2025-04-26", kwh: 10 }],
        monthly: [{ month: "2025-04", kwh: 10 }],
        meta: { actualSource: "GREEN_BUTTON", timezone: "America/Chicago" },
        series: { intervals15: [{ timestamp: "2025-04-26T12:00:00.000Z", kwh: 1 }] },
      },
      alternatives: { smt: null, greenButton: { totalKwh: 1234 } },
      usageTruthSource: "persisted_usage_output",
      seedResult: null,
      summary: { title: "Upstream Usage Truth", summary: "green button baseline", currentRun: {}, sharedOwners: [] },
    });

    const { adaptGreenButtonRawInput } = await import("@/modules/onePathSim/onePathSim");
    const engineInput = await adaptGreenButtonRawInput({
      userId: "user-1",
      houseId: "house-1",
      actualContextHouseId: "house-1",
      scenarioId: null,
      weatherPreference: "LAST_YEAR_WEATHER",
      validationSelectionMode: "stratified_weather_balanced",
      validationDayCount: 14,
      validationOnlyDateKeysLocal: [],
      travelRanges: [],
      persistRequested: true,
    });

    expect(resolveOnePathUpstreamUsageTruthForSimulation).toHaveBeenCalledWith({
      userId: "user-1",
      houseId: "house-1",
      actualContextHouseId: "house-1",
      seedIfMissing: false,
      preferredActualSource: "GREEN_BUTTON",
    });
    expect(getOnePathManualUsageInput).not.toHaveBeenCalled();
    expect(getHomeProfileSimulatedByUserHouse).not.toHaveBeenCalled();
    expect(getApplianceProfileSimulatedByUserHouse).not.toHaveBeenCalled();
    expect(resolveOnePathWeatherSensitivityEnvelope).not.toHaveBeenCalled();
    expect(engineInput.inputType).toBe("GREEN_BUTTON");
    expect(engineInput.actualIntervalsReference).toEqual([]);
    expect(engineInput.actualDailyReference).toEqual([]);
    expect(engineInput.weatherDaysReference).toBeNull();
    expect(engineInput.weatherEfficiencyDerivedInput).toBeNull();
  });
});
