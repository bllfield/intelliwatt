import { describe, expect, it } from "vitest";

import {
  computePastDisplayTruthRevision,
  PAST_DISPLAY_WEATHER_FINALIZE_VERSION,
  shouldRecomputePastDisplayWeather,
} from "@/lib/usage/pastDisplayWeatherFinalizeGuard";
import { pastDisplayScoreMatchesPreSimDiagnostic } from "@/lib/usage/weatherScoringOwnership";

describe("pastDisplayWeatherFinalizeGuard", () => {
  it("recomputes when bundle C matches stale pre-sim diagnostic B", () => {
    const dataset: Record<string, unknown> = {
      meta: {
        datasetKind: "SIMULATED",
        pastDisplayWeatherSensitivityScore: {
          weatherEfficiencyScore0to100: 50,
          coolingSensitivityScore0to100: 93,
          heatingSensitivityScore0to100: 76,
          confidenceScore0to100: 100,
        },
        weatherSensitivityScore: {
          weatherEfficiencyScore0to100: 50,
          coolingSensitivityScore0to100: 93,
          heatingSensitivityScore0to100: 76,
          confidenceScore0to100: 100,
        },
        pastDisplayWeatherDisplayTruthRevision: "stale-revision",
        pastDisplayWeatherFinalizeVersion: PAST_DISPLAY_WEATHER_FINALIZE_VERSION,
      },
      daily: [{ date: "2026-01-01", kwh: 30, source: "SIMULATED" }],
    };
    const revision = computePastDisplayTruthRevision({ dataset, weatherHouseId: "house-a" });
    expect(pastDisplayScoreMatchesPreSimDiagnostic(dataset.meta as Record<string, unknown>)).toBe(true);
    expect(shouldRecomputePastDisplayWeather({ dataset, displayTruthRevision: revision })).toBe(true);
  });

  it("skips recompute on warm read when revision and bundle C are current", () => {
    const dataset: Record<string, unknown> = {
      meta: {
        datasetKind: "SIMULATED",
        pastDisplayWeatherSensitivityScore: {
          weatherEfficiencyScore0to100: 50,
          coolingSensitivityScore0to100: 93,
          heatingSensitivityScore0to100: 76,
          confidenceScore0to100: 100,
          sourceOwner: "past_artifact_build",
        },
        weatherSensitivityScore: {
          weatherEfficiencyScore0to100: 50,
          coolingSensitivityScore0to100: 97,
          heatingSensitivityScore0to100: 73,
          confidenceScore0to100: 100,
        },
      },
      daily: [{ date: "2026-01-01", kwh: 30, source: "SIMULATED" }],
    };
    const revision = computePastDisplayTruthRevision({ dataset, weatherHouseId: "house-a" });
    const meta = dataset.meta as Record<string, unknown>;
    meta.pastDisplayWeatherDisplayTruthRevision = revision;
    meta.pastDisplayWeatherFinalizeVersion = PAST_DISPLAY_WEATHER_FINALIZE_VERSION;
    expect(shouldRecomputePastDisplayWeather({ dataset, displayTruthRevision: revision })).toBe(false);
  });

  it("recomputes when display truth revision drifts", () => {
    const dataset: Record<string, unknown> = {
      meta: {
        datasetKind: "SIMULATED",
        pastDisplayWeatherSensitivityScore: {
          weatherEfficiencyScore0to100: 50,
          coolingSensitivityScore0to100: 93,
          heatingSensitivityScore0to100: 76,
          confidenceScore0to100: 100,
        },
        pastDisplayWeatherDisplayTruthRevision: "old-revision",
        pastDisplayWeatherFinalizeVersion: PAST_DISPLAY_WEATHER_FINALIZE_VERSION,
      },
      daily: [{ date: "2026-01-02", kwh: 31, source: "ACTUAL" }],
    };
    const revision = computePastDisplayTruthRevision({ dataset, weatherHouseId: "house-a" });
    expect(revision).not.toBe("old-revision");
    expect(shouldRecomputePastDisplayWeather({ dataset, displayTruthRevision: revision })).toBe(true);
  });
});
