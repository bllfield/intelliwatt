import { beforeEach, describe, expect, it, vi } from "vitest";

const pastDisplayScore = {
  weatherEfficiencyScore0to100: 51,
  coolingSensitivityScore0to100: 92,
  heatingSensitivityScore0to100: 76,
  confidenceScore0to100: 100,
  sourceOwner: "past_artifact_build",
  displayOwner: "past_artifact_build",
  scoringContext: "PAST_DISPLAY",
};

const preSimScore = {
  weatherEfficiencyScore0to100: 50,
  coolingSensitivityScore0to100: 96,
  heatingSensitivityScore0to100: 73,
  confidenceScore0to100: 100,
};

const { resolveSharedWeatherSensitivityEnvelope } = vi.hoisted(() => ({
  resolveSharedWeatherSensitivityEnvelope: vi.fn(),
}));

vi.mock("@/modules/weatherSensitivity/shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/weatherSensitivity/shared")>();
  return {
    ...actual,
    resolveSharedWeatherSensitivityEnvelope: (...args: unknown[]) =>
      resolveSharedWeatherSensitivityEnvelope(...args),
    buildWeatherEfficiencyDerivedInput: vi.fn((score: unknown) => score),
  };
});

import {
  resolvePastWeatherScoreFromHouseApiBody,
  resolveUserPastApiWeatherResponse,
} from "@/lib/usage/userPastApiWeatherResponse";

describe("userPastApiWeatherResponse", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveSharedWeatherSensitivityEnvelope.mockResolvedValue({
      score: pastDisplayScore,
      derivedInput: null,
    });
  });

  it("client guard prefers past display when top-level matches pre-sim diagnostic", () => {
    const resolved = resolvePastWeatherScoreFromHouseApiBody({
      weatherSensitivityScore: preSimScore,
      weatherCardsSourceOwner: "past_artifact_build",
      dataset: {
        meta: {
          weatherSensitivityScore: preSimScore,
          pastDisplayWeatherSensitivityScore: pastDisplayScore,
        },
      },
    });

    expect(resolved.rejectedPreSimFallback).toBe(true);
    expect(resolved.sourceOwner).toBe("past_artifact_build");
    expect(resolved.score?.weatherEfficiencyScore0to100).toBe(51);
    expect(resolved.score?.coolingSensitivityScore0to100).toBe(92);
    expect(resolved.score?.heatingSensitivityScore0to100).toBe(76);
  });

  it("client guard rejects pre-sim top-level when past display is missing", () => {
    const resolved = resolvePastWeatherScoreFromHouseApiBody({
      weatherSensitivityScore: preSimScore,
      weatherCardsSourceOwner: "simulation_build_diagnostic",
      dataset: {
        meta: {
          datasetKind: "SIMULATED",
          weatherSensitivityScore: preSimScore,
        },
      },
    });

    expect(resolved.score).toBeNull();
    expect(resolved.sourceOwner).toBe("missing_past_display_weather");
    expect(resolved.rejectedPreSimFallback).toBe(true);
  });

  it("client guard rejects non-past owners even when top-level score exists", () => {
    const resolved = resolvePastWeatherScoreFromHouseApiBody({
      weatherSensitivityScore: preSimScore,
      weatherCardsSourceOwner: "simulation_build_diagnostic",
      dataset: {
        meta: {
          datasetKind: "SIMULATED",
          weatherSensitivityScore: preSimScore,
          pastDisplayWeatherSensitivityScore: pastDisplayScore,
        },
      },
    });

    expect(resolved.sourceOwner).toBe("past_artifact_build");
    expect(resolved.score?.weatherEfficiencyScore0to100).toBe(51);
  });

  it("client guard rejects stale past display that still matches pre-sim diagnostic", () => {
    const resolved = resolvePastWeatherScoreFromHouseApiBody({
      weatherSensitivityScore: preSimScore,
      weatherCardsSourceOwner: "past_artifact_build",
      dataset: {
        meta: {
          datasetKind: "SIMULATED",
          weatherSensitivityScore: preSimScore,
          pastDisplayWeatherSensitivityScore: preSimScore,
        },
      },
    });

    expect(resolved.rejectedPreSimFallback).toBe(true);
    expect(resolved.score).toBeNull();
    expect(resolved.sourceOwner).toBe("missing_past_display_weather");
  });

  it("API resolver forces past display attach when persisted bundle C matches pre-sim bundle B", async () => {
    const dataset = {
      summary: { source: "SIMULATED" },
      daily: [{ date: "2025-04-10", kwh: 9, source: "SIMULATED" }],
      meta: {
        datasetKind: "SIMULATED",
        weatherSensitivityScore: preSimScore,
        pastDisplayWeatherSensitivityScore: {
          ...preSimScore,
          sourceOwner: "past_artifact_build",
          displayOwner: "past_artifact_build",
          scoringContext: "PAST_DISPLAY",
        },
      },
    };

    const resolved = await resolveUserPastApiWeatherResponse({
      dataset,
      scenarioName: "Past (Corrected)",
      scenarioId: "past-s1",
      requestedHouseId: "h1",
      weatherHouseId: "h1",
    });

    expect(resolved.weatherReadPath).toBe("past_display_forced_attach");
    expect(resolved.weatherSensitivity.score?.weatherEfficiencyScore0to100).toBe(51);
    expect(resolved.diagnostics.ownerViolation).toBeNull();
    expect(
      (dataset.meta as Record<string, unknown>).pastDisplayWeatherSensitivityScore
    ).toMatchObject({
      weatherEfficiencyScore0to100: 51,
      sourceOwner: "past_artifact_build",
    });
  });

  it("API resolver forces past display attach when artifact only has pre-sim diagnostic", async () => {
    const dataset = {
      summary: { source: "SIMULATED" },
      daily: [{ date: "2025-04-10", kwh: 9, source: "SIMULATED" }],
      meta: {
        datasetKind: "SIMULATED",
        weatherSensitivityScore: preSimScore,
      },
    };

    const resolved = await resolveUserPastApiWeatherResponse({
      dataset,
      scenarioName: "Past (Corrected)",
      scenarioId: "past-s1",
      requestedHouseId: "h1",
      weatherHouseId: "h1",
    });

    expect(resolved.weatherCardsSourceOwner).toBe("past_artifact_build");
    expect(resolved.weatherSensitivity.score?.weatherEfficiencyScore0to100).toBe(51);
    expect(resolved.weatherScoringAudit.scoringContext).toBe("PAST_DISPLAY");
    expect(resolved.weatherScoringAudit.displayOwner).toBe("past_artifact_build");
    expect(resolved.weatherReadPath).toBe("past_display_forced_attach");
    expect(resolved.diagnostics.visibleWeatherScoreSourceField).toBe("meta.pastDisplayWeatherSensitivityScore");
    expect(
      (dataset.meta as Record<string, unknown>).pastDisplayWeatherSensitivityScore
    ).toMatchObject({
      weatherEfficiencyScore0to100: 51,
      sourceOwner: "past_artifact_build",
    });
  });
});
