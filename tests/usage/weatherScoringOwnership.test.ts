import { describe, expect, it, vi } from "vitest";

import { auditUserAdminPastReadModelParity } from "@/lib/usage/intervalReadModelInvariants";
import { resolveUserPastVisibleWeatherSensitivityScore } from "@/lib/usage/userPastVisibleWeather";
import {
  detectPastVisibleWeatherOwnerViolation,
  displayOwnerForContext,
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

describe("weatherScoringOwnership", () => {
  it("documents a single scorer module for all visible surfaces", () => {
    const modules = new Set(WEATHER_SCORING_OWNERSHIP_MATRIX.map((row) => row.scorerFunction));
    expect(modules.size).toBe(1);
    expect(modules.has(WEATHER_SCORER_MODULE)).toBe(true);
    expect(displayOwnerForContext("ACTUAL_USAGE")).toBe("actual_usage_weather_score");
    expect(displayOwnerForContext("PAST_DISPLAY")).toBe("past_artifact_build");
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

  it("passes parity when user and admin both read past display score C", () => {
    const dataset = {
      summary: { source: "GREEN_BUTTON", intervalsCount: 1, totalKwh: 1, start: "2026-06-01", end: "2026-06-01" },
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
      },
    };
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
  });
});
