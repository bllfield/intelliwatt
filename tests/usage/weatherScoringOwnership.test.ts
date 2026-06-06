import { describe, expect, it, vi } from "vitest";

import { auditUserAdminPastReadModelParity } from "@/lib/usage/intervalReadModelInvariants";
import { resolveUserPastVisibleWeatherSensitivityScore } from "@/lib/usage/userPastVisibleWeather";
import {
  detectPastVisibleWeatherOwnerViolation,
  displayOwnerForContext,
  matrixRowsForSourceType,
  resolveActualUsageWeatherScore,
  WEATHER_SCORER_MODULE,
  WEATHER_SCORING_OWNERSHIP_MATRIX,
} from "@/lib/usage/weatherScoringOwnership";
import { WEATHER_CALCULATION_VERSION, WEATHER_SCORE_VERSION } from "@/modules/weatherSensitivity/shared";

vi.mock("@/modules/weatherSensitivity/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/weatherSensitivity/shared")>();
  return {
    ...actual,
    resolveSharedWeatherSensitivityEnvelope: vi.fn(async () => ({
      score: {
        scoringMode: "INTERVAL_BASED" as const,
        weatherEfficiencyScore0to100: 51,
        coolingSensitivityScore0to100: 92,
        heatingSensitivityScore0to100: 76,
        confidenceScore0to100: 100,
        shoulderBaselineKwhPerDay: 10,
        coolingSlopeKwhPerCDD: 1,
        heatingSlopeKwhPerHDD: 1,
        coolingResponseRatio: 1,
        heatingResponseRatio: 1,
        estimatedWeatherDrivenLoadShare: 0.2,
        estimatedBaseloadShare: 0.8,
        requiredInputAdjustmentsApplied: [],
        poolAdjustmentApplied: false,
        hvacAdjustmentApplied: false,
        occupancyAdjustmentApplied: false,
        thermostatAdjustmentApplied: false,
        excludedSimulatedDayCount: 0,
        excludedIncompleteMeterDayCount: 0,
        scoreVersion: WEATHER_SCORE_VERSION,
        calculationVersion: WEATHER_CALCULATION_VERSION,
        recommendationFlags: {
          appearsWeatherSensitive: false,
          needsMoreApplianceDetail: false,
          needsEnvelopeDetail: false,
          confidenceLimited: false,
        },
        explanationSummary: "test",
        nextDetailPromptType: "NONE" as const,
        scoringContext: "PAST_DISPLAY" as const,
        displayOwner: "past_artifact_build",
      },
      derivedInput: null,
    })),
  };
});

function pastDisplayDatasetFixture(source: "SMT" | "GREEN_BUTTON") {
  return {
    summary: { source, intervalsCount: 1, totalKwh: 1, start: "2026-06-01", end: "2026-06-01" },
    totals: { importKwh: 1, exportKwh: 0, netKwh: 1 },
    daily: [{ date: "2026-06-01", kwh: 1, source: "ACTUAL" }],
    monthly: [{ month: "2026-06", kwh: 1 }],
    insights: {
      timeOfDayBuckets: [
        { key: "overnight", label: "Overnight", kwh: 0.25 },
        { key: "morning", label: "Morning", kwh: 0.25 },
        { key: "afternoon", label: "Afternoon", kwh: 0.25 },
        { key: "evening", label: "Evening", kwh: 0.25 },
      ],
    },
    meta: {
      datasetKind: "SIMULATED",
      preferredActualSource: source,
      weatherSensitivityScore: {
        weatherEfficiencyScore0to100: 50,
        coolingSensitivityScore0to100: 96,
        heatingSensitivityScore0to100: 73,
        confidenceScore0to100: 100,
      },
      pastDisplayWeatherSensitivityScore: {
        weatherEfficiencyScore0to100: 51,
        coolingSensitivityScore0to100: 92,
        heatingSensitivityScore0to100: 76,
        confidenceScore0to100: 100,
        sourceOwner: "past_artifact_build",
        scoringContext: "PAST_DISPLAY",
      },
      pastDisplayWeatherScoringAudit: {
        scorerModule: WEATHER_SCORER_MODULE,
        scoreVersion: WEATHER_SCORE_VERSION,
        calculationVersion: WEATHER_CALCULATION_VERSION,
        sourceType: source,
        scoringContext: "PAST_DISPLAY",
        displayOwner: "past_artifact_build",
        outputField: "meta.pastDisplayWeatherSensitivityScore",
      },
    },
  };
}

describe("weatherScoringOwnership", () => {
  it("documents a single scorer module for all visible surfaces", () => {
    const modules = new Set(WEATHER_SCORING_OWNERSHIP_MATRIX.map((row) => row.scorerFunction));
    expect(modules.size).toBe(1);
    expect(modules.has(WEATHER_SCORER_MODULE)).toBe(true);
    expect(displayOwnerForContext("ACTUAL_USAGE")).toBe("actual_usage_weather_score");
    expect(displayOwnerForContext("PAST_DISPLAY")).toBe("past_artifact_build");
  });

  it("includes SMT Actual and SMT Past rows in the ownership matrix", () => {
    const smtRows = matrixRowsForSourceType("SMT");
    expect(smtRows.some((row) => row.surface.includes("SMT Actual"))).toBe(true);
    expect(smtRows.some((row) => row.surface.includes("SMT-backed Past"))).toBe(true);
    expect(smtRows.some((row) => row.surface.includes("One Path Admin / SMT Past"))).toBe(true);
    expect(smtRows.some((row) => row.sourceOwner === "past_artifact_build")).toBe(true);
  });

  it("scores SMT Actual and Green Button Actual through the same scorer module", async () => {
    const smt = await resolveActualUsageWeatherScore({
      scoringDataset: { summary: { source: "SMT" }, daily: [{ date: "2026-06-01", kwh: 1 }] },
      preferredActualSource: "SMT",
    });
    const gb = await resolveActualUsageWeatherScore({
      scoringDataset: { summary: { source: "GREEN_BUTTON" }, daily: [{ date: "2026-06-01", kwh: 1 }] },
      preferredActualSource: "GREEN_BUTTON",
    });
    expect(smt.audit.scorerModule).toBe(WEATHER_SCORER_MODULE);
    expect(gb.audit.scorerModule).toBe(WEATHER_SCORER_MODULE);
    expect(smt.audit.scoreVersion).toBe(WEATHER_SCORE_VERSION);
    expect(gb.audit.scoreVersion).toBe(WEATHER_SCORE_VERSION);
    expect(smt.audit.sourceType).toBe("SMT");
    expect(gb.audit.sourceType).toBe("GREEN_BUTTON");
    expect(smt.audit.displayOwner).toBe("actual_usage_weather_score");
    expect(gb.audit.displayOwner).toBe("actual_usage_weather_score");
  });

  it("detects bundle B misuse for visible Past weather", () => {
    const meta = {
      weatherSensitivityScore: {
        weatherEfficiencyScore0to100: 50,
        coolingSensitivityScore0to100: 96,
        heatingSensitivityScore0to100: 73,
        confidenceScore0to100: 100,
      },
      pastDisplayWeatherSensitivityScore: {
        weatherEfficiencyScore0to100: 51,
        coolingSensitivityScore0to100: 92,
        heatingSensitivityScore0to100: 76,
        confidenceScore0to100: 100,
      },
    };
    const violation = detectPastVisibleWeatherOwnerViolation({
      meta,
      visibleScore: meta.weatherSensitivityScore,
      visibleSourceOwner: "simulation_build_diagnostic",
      actualBaselineScore: {
        weatherEfficiencyScore0to100: 48,
        coolingSensitivityScore0to100: 95,
        heatingSensitivityScore0to100: 79,
        confidenceScore0to100: 100,
      },
    });
    expect(violation).toContain("pre-sim build diagnostic");
  });

  it("passes parity when user and admin both read Green Button past display score C", () => {
    const dataset = pastDisplayDatasetFixture("GREEN_BUTTON");
    const visible = resolveUserPastVisibleWeatherSensitivityScore({
      dataset,
      scenarioName: "Past (Corrected)",
    });
    expect(visible.sourceOwner).toBe("past_artifact_build");
    expect(visible.score?.weatherEfficiencyScore0to100).toBe(51);

    const parity = auditUserAdminPastReadModelParity({
      dataset,
      scenarioName: "Past (Corrected)",
      actualBaselineWeatherScore: {
        weatherEfficiencyScore0to100: 48,
        coolingSensitivityScore0to100: 95,
        heatingSensitivityScore0to100: 79,
        confidenceScore0to100: 100,
      },
    });
    expect(parity.weatherCards.pass).toBe(true);
    expect(parity.weatherCards.ownerViolation).toBeNull();
    expect(parity.weatherScoringAudit?.scorerModule).toBe(WEATHER_SCORER_MODULE);
    expect(parity.weatherScoringAudit?.scoreVersion).toBe(WEATHER_SCORE_VERSION);
    expect(parity.weatherScoringAudit?.sourceType).toBe("GREEN_BUTTON");
  });

  it("passes parity when user and admin both read SMT past display score C", () => {
    const dataset = pastDisplayDatasetFixture("SMT");
    const visible = resolveUserPastVisibleWeatherSensitivityScore({
      dataset,
      scenarioName: "Past (Corrected)",
    });
    expect(visible.sourceOwner).toBe("past_artifact_build");

    const parity = auditUserAdminPastReadModelParity({
      dataset,
      scenarioName: "Past (Corrected)",
      actualBaselineWeatherScore: {
        weatherEfficiencyScore0to100: 48,
        coolingSensitivityScore0to100: 95,
        heatingSensitivityScore0to100: 79,
        confidenceScore0to100: 100,
      },
    });
    expect(parity.weatherCards.pass).toBe(true);
    expect(parity.weatherCards.ownerViolation).toBeNull();
    expect(parity.weatherScoringAudit?.scorerModule).toBe(WEATHER_SCORER_MODULE);
    expect(parity.weatherScoringAudit?.sourceType).toBe("SMT");
    expect(parity.weatherScoringAudit?.displayOwner).toBe("past_artifact_build");
  });

  it("flags stale persisted past display that still matches pre-sim diagnostic", () => {
    const meta = pastDisplayDatasetFixture("SMT").meta as Record<string, unknown>;
    const preSim = meta.weatherSensitivityScore as Record<string, unknown>;
    meta.pastDisplayWeatherSensitivityScore = {
      ...preSim,
      sourceOwner: "past_artifact_build",
      displayOwner: "past_artifact_build",
      scoringContext: "PAST_DISPLAY",
    };

    const violation = detectPastVisibleWeatherOwnerViolation({
      meta,
      visibleScore: meta.pastDisplayWeatherSensitivityScore,
      visibleSourceOwner: "past_artifact_build",
    });
    expect(violation).toContain("stale bundle C");
  });

  it("does not expose simulation_build_diagnostic as visible SMT Past weather", () => {
    const meta = pastDisplayDatasetFixture("SMT").meta as Record<string, unknown>;
    const violation = detectPastVisibleWeatherOwnerViolation({
      meta,
      visibleScore: meta.weatherSensitivityScore,
      visibleSourceOwner: "simulation_build_diagnostic",
    });
    expect(violation).toContain("diagnostic");
  });

  it("fails SMT Past parity when persisted past display weather is missing", () => {
    const dataset = pastDisplayDatasetFixture("SMT");
    const meta = dataset.meta as Record<string, unknown>;
    delete meta.pastDisplayWeatherSensitivityScore;

    const parity = auditUserAdminPastReadModelParity({
      dataset,
      scenarioName: "Past (Corrected)",
    });
    expect(parity.weatherCards.pass).toBe(false);
    expect(parity.violations.some((v) => v.includes("weather cards mismatch") || v.includes("missing"))).toBe(true);
  });

  it("fails SMT Past parity when user and admin owners diverge", () => {
    const dataset = pastDisplayDatasetFixture("SMT");
    const meta = dataset.meta as Record<string, unknown>;
    meta.pastDisplayWeatherSensitivityScore = {
      weatherEfficiencyScore0to100: 51,
      coolingSensitivityScore0to100: 92,
      heatingSensitivityScore0to100: 76,
      confidenceScore0to100: 100,
      sourceOwner: "simulation_build_diagnostic",
      scoringContext: "SIMULATION_BUILD",
    };

    const visible = resolveUserPastVisibleWeatherSensitivityScore({
      dataset,
      scenarioName: "Past (Corrected)",
    });
    expect(visible.sourceOwner).toBe("simulation_build_diagnostic");

    const parity = auditUserAdminPastReadModelParity({
      dataset,
      scenarioName: "Past (Corrected)",
    });
    expect(parity.weatherCards.pass).toBe(false);
    expect(parity.violations.some((v) => v.includes("sourceOwner=simulation_build_diagnostic"))).toBe(true);
  });
});
