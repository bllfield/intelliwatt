import { describe, expect, it } from "vitest";
import {
  DEFAULT_ONE_PATH_SCENARIO_PRESET_KEY,
  ONE_PATH_SCENARIO_PRESETS,
  getKnownHouseScenarioByKey,
  resolveKnownHouseScenarioSelection,
} from "@/modules/onePathSim/knownHouseScenarios";

describe("one path scenario presets", () => {
  it("defines generic presets across target data modes", () => {
    expect(ONE_PATH_SCENARIO_PRESETS.length).toBeGreaterThanOrEqual(12);
    expect(ONE_PATH_SCENARIO_PRESETS.every((scenario) => scenario.scenarioKey && scenario.label)).toBe(true);
    expect(ONE_PATH_SCENARIO_PRESETS.every((scenario) => scenario.sourceUserEmail === "")).toBe(true);
    expect(ONE_PATH_SCENARIO_PRESETS.every((scenario) => scenario.sourceHouseId == null)).toBe(true);
    expect(ONE_PATH_SCENARIO_PRESETS.every((scenario) => scenario.houseSelectionStrategy === "selected_house")).toBe(
      true
    );
    expect(ONE_PATH_SCENARIO_PRESETS.some((scenario) => scenario.scenarioType === "INTERVAL_TRUTH")).toBe(true);
    expect(ONE_PATH_SCENARIO_PRESETS.some((scenario) => scenario.scenarioType === "GREEN_BUTTON_TRUTH")).toBe(true);
    expect(ONE_PATH_SCENARIO_PRESETS.some((scenario) => scenario.scenarioType === "MANUAL_MONTHLY_TEST")).toBe(true);
    expect(ONE_PATH_SCENARIO_PRESETS.some((scenario) => scenario.scenarioType === "MANUAL_ANNUAL_TEST")).toBe(true);
    expect(ONE_PATH_SCENARIO_PRESETS.some((scenario) => scenario.scenarioType === "NEW_BUILD_TEST")).toBe(true);
  });

  it("uses mode-based labels without house-specific naming", () => {
    expect(DEFAULT_ONE_PATH_SCENARIO_PRESET_KEY).toBe("interval-past-primary");
    const labels = ONE_PATH_SCENARIO_PRESETS.map((scenario) => scenario.label);
    expect(labels.some((label) => /Brian|Fort Worth/i.test(label))).toBe(false);
    expect(labels).toContain("Green Button · Past Sim");
    expect(labels).toContain("Interval · Baseline");
  });

  it("maps legacy keeper preset keys to generic presets", () => {
    expect(getKnownHouseScenarioByKey("keeper-interval-past-primary")?.scenarioKey).toBe("interval-past-primary");
    expect(getKnownHouseScenarioByKey("keeper-fort-worth-green-button-past-primary")?.scenarioKey).toBe(
      "green-button-past-primary"
    );
  });

  it("resolves house and scenario from the active lookup selection", () => {
    const scenario = getKnownHouseScenarioByKey("interval-past-primary");
    expect(scenario).not.toBeNull();
    const resolved = resolveKnownHouseScenarioSelection({
      scenario: scenario!,
      lookup: {
        selectedHouse: { id: "house-selected" },
        houses: [
          { id: "house-selected", label: "Primary" },
          { id: "house-other", label: "Other" },
        ],
        scenarios: [{ id: "past-scenario-id", name: "Past (Corrected)" }],
      },
    });

    expect(resolved.selectedHouseId).toBe("house-selected");
    expect(resolved.actualContextHouseId).toBe("house-selected");
    expect(resolved.selectedScenarioId).toBe("past-scenario-id");
  });
});
