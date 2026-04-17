import { describe, expect, it } from "vitest";
import {
  KNOWN_HOUSE_SCENARIOS,
  getKnownHouseScenarioByKey,
  resolveKnownHouseScenarioSelection,
} from "@/modules/onePathSim/knownHouseScenarios";

describe("one path known-house scenario registry", () => {
  it("defines a stable sandbox-only registry with starter coverage across target types", () => {
    expect(Array.isArray(KNOWN_HOUSE_SCENARIOS)).toBe(true);
    expect(KNOWN_HOUSE_SCENARIOS.length).toBeGreaterThanOrEqual(5);
    expect(KNOWN_HOUSE_SCENARIOS.every((scenario) => scenario.scenarioKey && scenario.label)).toBe(true);
    expect(KNOWN_HOUSE_SCENARIOS.some((scenario) => scenario.scenarioType === "INTERVAL_TRUTH")).toBe(true);
    expect(KNOWN_HOUSE_SCENARIOS.some((scenario) => scenario.scenarioType === "MANUAL_MONTHLY_TEST")).toBe(true);
    expect(KNOWN_HOUSE_SCENARIOS.some((scenario) => scenario.scenarioType === "MANUAL_ANNUAL_TEST")).toBe(true);
    expect(KNOWN_HOUSE_SCENARIOS.some((scenario) => scenario.scenarioType === "NEW_BUILD_OPTIONAL")).toBe(true);
  });

  it("looks scenarios up by stable key", () => {
    const first = KNOWN_HOUSE_SCENARIOS[0];
    expect(getKnownHouseScenarioByKey(first.scenarioKey)).toEqual(first);
    expect(getKnownHouseScenarioByKey("missing-scenario-key")).toBeNull();
  });

  it("resolves lookup-driven house/context/scenario ids from a preset", () => {
    const scenario = {
      scenarioKey: "interval-past",
      label: "Interval Past",
      active: true,
      mode: "INTERVAL",
      scenarioType: "INTERVAL_TRUTH" as const,
      sourceUserEmail: "omoneo@o2epcm.com",
      sourceUserId: null,
      sourceHouseId: null,
      actualContextHouseId: null,
      scenarioId: null,
      scenarioNameHint: "Past",
      scenarioSelectionStrategy: "scenario_name" as const,
      houseSelectionStrategy: "selected_house" as const,
      baselineType: "interval_truth" as const,
      validationSelectionMode: "stratified_weather_balanced",
      validationDayCount: 14,
      validationOnlyDateKeysLocal: [],
      weatherPreference: "LAST_YEAR_WEATHER" as const,
      persistRequested: true,
      travelRanges: [],
      expectedTruthSource: "persisted_usage_output",
      expectations: {
        expectedBaselineParity: true,
        expectedPastSimCompareAvailable: true,
      },
      notes: "interval truth keeper",
    };

    const resolved = resolveKnownHouseScenarioSelection({
      scenario,
      lookup: {
        selectedHouse: { id: "house-selected" },
        houses: [
          { id: "house-selected", label: "Primary" },
          { id: "house-2", label: "Backup" },
        ],
        scenarios: [
          { id: "past-scenario-id", name: "Past" },
          { id: "future-scenario-id", name: "Future" },
        ],
      },
    });

    expect(resolved.selectedHouseId).toBe("house-selected");
    expect(resolved.actualContextHouseId).toBe("house-selected");
    expect(resolved.selectedScenarioId).toBe("past-scenario-id");
  });
});
