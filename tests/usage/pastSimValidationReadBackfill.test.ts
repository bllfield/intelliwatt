import { describe, expect, it } from "vitest";
import {
  isPastScenarioValidationBackfillEligible,
  WORKSPACE_PAST_SCENARIO_NAME,
} from "@/lib/usage/pastSimValidationReadBackfill";

describe("pastSimValidationReadBackfill", () => {
  it("does not backfill manual Past builds even when snapshots carry GREEN_BUTTON", () => {
    expect(
      isPastScenarioValidationBackfillEligible({
        scenarioId: "past-scenario-1",
        buildInputs: {
          mode: "MANUAL_TOTALS",
          timezone: "America/Chicago",
          snapshots: { actualSource: "GREEN_BUTTON", scenario: { name: WORKSPACE_PAST_SCENARIO_NAME } },
        },
        storedValidationKeyCount: 0,
        storedSelectionMode: null,
      }),
    ).toBe(false);
  });

  it("allows backfill for SMT baseline Past builds", () => {
    expect(
      isPastScenarioValidationBackfillEligible({
        scenarioId: "past-scenario-1",
        buildInputs: {
          mode: "SMT_BASELINE",
          timezone: "America/Chicago",
          snapshots: { actualSource: "SMT", scenario: { name: WORKSPACE_PAST_SCENARIO_NAME } },
        },
        storedValidationKeyCount: 0,
        storedSelectionMode: null,
      }),
    ).toBe(true);
  });
});
