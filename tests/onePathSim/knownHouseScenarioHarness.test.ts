import { describe, expect, it } from "vitest";
import {
  buildKnownScenarioHarnessRunControls,
  resolveKnownScenarioHarnessRunControls,
} from "@/modules/onePathSim/knownHouseScenarioHarness";
import { getKnownHouseScenarioByKey } from "@/modules/onePathSim/knownHouseScenarios";

describe("knownHouseScenarioHarness", () => {
  const lookup = {
    selectedHouse: { id: "house-1" },
    houses: [{ id: "house-1", label: "Main" }],
    scenarios: [
      { id: "past-1", name: "Past (Corrected)" },
      { id: "future-1", name: "Future (What-if)" },
    ],
  };

  it("maps interval baseline preset to null scenario and known_house runReason", () => {
    const scenario = getKnownHouseScenarioByKey("interval-baseline-primary");
    expect(scenario).not.toBeNull();
    const controls = buildKnownScenarioHarnessRunControls({ scenario: scenario!, lookup });
    expect(controls.mode).toBe("INTERVAL");
    expect(controls.selectedScenarioId).toBe("");
    expect(controls.runReason).toBe("known_house:interval-baseline-primary");
  });

  it("maps interval past preset to Past scenario id without a server reload", () => {
    const scenario = getKnownHouseScenarioByKey("interval-past-primary");
    expect(scenario).not.toBeNull();
    const controls = buildKnownScenarioHarnessRunControls({ scenario: scenario!, lookup });
    expect(controls.mode).toBe("INTERVAL");
    expect(controls.selectedScenarioId).toBe("past-1");
    expect(controls.runReason).toBe("known_house:interval-past-primary");
  });

  it("falls back to db travel ranges when preset does not define any", () => {
    const scenario = getKnownHouseScenarioByKey("interval-past-primary");
    expect(scenario).not.toBeNull();
    const controls = buildKnownScenarioHarnessRunControls({
      scenario: scenario!,
      lookup,
      travelRangesFromDb: [{ startDate: "2025-06-27", endDate: "2025-07-11" }],
    });
    expect(controls.travelRanges).toEqual([{ startDate: "2025-06-27", endDate: "2025-07-11" }]);
  });

  it("resolveKnownScenarioHarnessRunControls returns null without lookup", () => {
    expect(resolveKnownScenarioHarnessRunControls({ scenarioKey: "interval-past-primary", lookup: null })).toBeNull();
  });
});
