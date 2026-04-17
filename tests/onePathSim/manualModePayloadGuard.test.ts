import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/db", () => ({
  prisma: {
    usageSimulatorBuild: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("@/modules/homeProfile/repo", () => ({
  getHomeProfileSimulatedByUserHouse: vi.fn(),
}));

vi.mock("@/modules/applianceProfile/repo", () => ({
  getApplianceProfileSimulatedByUserHouse: vi.fn(),
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
  getOnePathManualUsageInput: vi.fn(),
  resolveOnePathCanonicalUsage365CoverageWindow: vi.fn(() => ({ startDate: "2025-05-01", endDate: "2026-04-30" })),
  resolveOnePathManualStageOnePresentation: vi.fn(() => null),
  resolveOnePathUpstreamUsageTruthForSimulation: vi.fn(),
  resolveOnePathWeatherSensitivityEnvelope: vi.fn(() => ({ score: null, derivedInput: null })),
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
});
