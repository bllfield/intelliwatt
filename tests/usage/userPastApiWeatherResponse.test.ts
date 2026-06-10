import { describe, expect, it } from "vitest";
import { applyFinalizedPastVisibleWeatherToRunDisplayView } from "@/lib/usage/resolvePastVisibleWeatherScore";
import {
  resolvePastWeatherScoreFromHouseApiBody,
  resolveUserPastApiWeatherResponse,
} from "@/lib/usage/userPastApiWeatherResponse";

const pastDisplayScore = {
  weatherEfficiencyScore0to100: 50,
  coolingSensitivityScore0to100: 93,
  heatingSensitivityScore0to100: 76,
  confidenceScore0to100: 100,
  sourceOwner: "past_artifact_build",
  displayOwner: "past_artifact_build",
  scoringContext: "PAST_DISPLAY",
};

const preSimScore = {
  weatherEfficiencyScore0to100: 50,
  coolingSensitivityScore0to100: 97,
  heatingSensitivityScore0to100: 73,
  confidenceScore0to100: 100,
};

describe("userPastApiWeatherResponse", () => {
  it("client guard prefers past display when top-level diverges from meta bundle C", () => {
    const resolved = resolvePastWeatherScoreFromHouseApiBody({
      weatherSensitivityScore: {
        ...preSimScore,
        sourceOwner: "past_artifact_build",
      },
      weatherCardsSourceOwner: "past_artifact_build",
      dataset: {
        meta: {
          datasetKind: "SIMULATED",
          weatherSensitivityScore: preSimScore,
          pastDisplayWeatherSensitivityScore: pastDisplayScore,
        },
      },
    });

    expect(resolved.rejectedPreSimFallback).toBe(true);
    expect(resolved.sourceOwner).toBe("past_artifact_build");
    expect(resolved.score?.coolingSensitivityScore0to100).toBe(93);
    expect(resolved.score?.heatingSensitivityScore0to100).toBe(76);
  });

  it("client guard prefers past display when top-level matches pre-sim diagnostic", () => {
    const resolved = resolvePastWeatherScoreFromHouseApiBody({
      weatherSensitivityScore: preSimScore,
      weatherCardsSourceOwner: "past_artifact_build",
      dataset: {
        meta: {
          datasetKind: "SIMULATED",
          weatherSensitivityScore: preSimScore,
          pastDisplayWeatherSensitivityScore: pastDisplayScore,
        },
      },
    });

    expect(resolved.rejectedPreSimFallback).toBe(true);
    expect(resolved.sourceOwner).toBe("past_artifact_build");
    expect(resolved.score?.weatherEfficiencyScore0to100).toBe(50);
    expect(resolved.score?.coolingSensitivityScore0to100).toBe(93);
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

  it("API resolver reads finalized past display from meta without recomputing", async () => {
    const dataset = {
      summary: { source: "GREEN_BUTTON", start: "2025-06-05", end: "2026-06-04" },
      daily: [{ date: "2025-06-05", kwh: 74.12, source: "ACTUAL" }],
      meta: {
        datasetKind: "SIMULATED",
        actualSource: "GREEN_BUTTON",
        weatherSensitivityScore: preSimScore,
        pastValidationPolicyRevision: "unified_past_validation_stratified_14_v4",
        pastDisplayWeatherSensitivityScore: pastDisplayScore,
        pastDisplayWeatherScoringAudit: {
          scorerModule: "resolveSharedWeatherSensitivityEnvelope",
          scoringContext: "PAST_DISPLAY",
          displayOwner: "past_artifact_build",
          outputField: "meta.pastDisplayWeatherSensitivityScore",
        },
        displayWeatherCardsSourceOwner: "past_artifact_build",
        displayWeatherRecomputeCount: 1,
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
    expect(resolved.weatherSensitivity.score?.weatherEfficiencyScore0to100).toBe(50);
    expect(resolved.weatherSensitivity.score?.coolingSensitivityScore0to100).toBe(93);
    expect(resolved.weatherSensitivity.score?.heatingSensitivityScore0to100).toBe(76);
    expect(resolved.weatherScoringAudit.scoringContext).toBe("PAST_DISPLAY");
    expect(resolved.diagnostics.visibleWeatherScoreSourceField).toBe(
      "meta.pastDisplayWeatherSensitivityScore"
    );
    expect(resolved.diagnostics.datasetMetaWeatherSensitivityScore).toEqual(preSimScore);
    expect(resolved.diagnostics.datasetMetaPastDisplayWeatherSensitivityScore).toEqual(
      pastDisplayScore
    );
  });

  it("patches admin runDisplayView weatherScore from finalized bundle C", () => {
    const patched = applyFinalizedPastVisibleWeatherToRunDisplayView(
      {
        summary: { totals: { netKwh: 100 } },
        weatherScore: preSimScore,
      },
      {
        weatherSensitivity: {
          score: pastDisplayScore as never,
          derivedInput: null,
        },
      }
    );

    expect(patched?.weatherScore).toEqual(pastDisplayScore);
  });

  it("manual monthly Past Sim weather card uses estimated manual-bill wording", () => {
    const measuredCopy =
      "This home's usage has a moderate weather response. The score reflects measured usage movement after accounting for pool, HVAC, thermostat.";
    const resolved = resolvePastWeatherScoreFromHouseApiBody({
      weatherSensitivityScore: {
        ...pastDisplayScore,
        explanationSummary: measuredCopy,
      },
      weatherCardsSourceOwner: "past_artifact_build",
      dataset: {
        meta: {
          datasetKind: "SIMULATED",
          mode: "MANUAL_TOTALS",
          usageInputMode: "MANUAL_MONTHLY",
          pastDisplayWeatherSensitivityScore: {
            ...pastDisplayScore,
            explanationSummary: measuredCopy,
          },
        },
      },
    });

    expect(resolved.score?.explanationSummary).toContain("manual bills");
    expect(resolved.score?.explanationSummary).not.toContain("measured usage movement");
  });
});
