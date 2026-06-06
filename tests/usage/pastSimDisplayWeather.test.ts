import { describe, expect, it, vi } from "vitest";

import { attachPastSimDisplayWeatherToDataset } from "@/lib/usage/pastSimDisplayWeather";

vi.mock("@/modules/weatherSensitivity/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/weatherSensitivity/shared")>();
  return {
    ...actual,
    resolveSharedWeatherSensitivityEnvelope: vi.fn().mockResolvedValue({
      score: {
        scoringMode: "INTERVAL_BASED",
        weatherEfficiencyScore0to100: 48,
        coolingSensitivityScore0to100: 92,
        heatingSensitivityScore0to100: 82,
        confidenceScore0to100: 100,
        excludedSimulatedDayCount: 0,
      },
      derivedInput: null,
    }),
    buildWeatherEfficiencyDerivedInput: vi.fn().mockReturnValue({ derivedInputAttached: true }),
  };
});

describe("pastSimDisplayWeather", () => {
  it("stores display weather on past artifacts without using pre-sim actual snapshots", async () => {
    const dataset: Record<string, unknown> = {
      meta: {
        datasetKind: "SIMULATED",
        weatherSensitivityScore: {
          coolingSensitivityScore0to100: 95,
          heatingSensitivityScore0to100: 79,
        },
      },
      daily: [{ date: "2026-01-01", kwh: 30, source: "SIMULATED", sourceDetail: "SIMULATED_TRAVEL_VACANT" }],
    };

    await attachPastSimDisplayWeatherToDataset({ dataset, weatherHouseId: "house-1" });

    const meta = dataset.meta as Record<string, unknown>;
    const pastDisplay = meta.pastDisplayWeatherSensitivityScore as Record<string, number>;
    expect(pastDisplay.coolingSensitivityScore0to100).toBe(92);
    expect(pastDisplay.heatingSensitivityScore0to100).toBe(82);
    expect(pastDisplay.sourceOwner).toBe("past_artifact_build");
    expect(meta.pastDisplayWeatherScoringAudit).toBeTruthy();
  });
});
