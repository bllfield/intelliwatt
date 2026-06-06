import { describe, expect, it } from "vitest";

import {
  resolveUserPastVisibleWeatherSensitivityScore,
  shouldUsePastDisplayWeatherCards,
} from "@/lib/usage/userPastVisibleWeather";

describe("userPastVisibleWeather", () => {
  it("uses past display weather for Past (Corrected) even when datasetKind metadata is missing", () => {
    expect(
      shouldUsePastDisplayWeatherCards({
        scenarioName: "Past (Corrected)",
        meta: {},
      })
    ).toBe(true);
  });

  it("prefers persisted past display weather over pre-sim weatherSensitivityScore", () => {
    const resolved = resolveUserPastVisibleWeatherSensitivityScore({
      scenarioName: "Past (Corrected)",
      dataset: {
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
          },
        },
      },
    });

    expect(resolved.sourceOwner).toBe("past_artifact_build");
    expect(resolved.score?.weatherEfficiencyScore0to100).toBe(51);
    expect(resolved.score?.coolingSensitivityScore0to100).toBe(92);
    expect(resolved.score?.heatingSensitivityScore0to100).toBe(76);
  });
});
