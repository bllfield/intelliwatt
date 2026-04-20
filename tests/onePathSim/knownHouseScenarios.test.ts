import { describe, expect, it } from "vitest";
import {
  DEFAULT_BRIAN_KNOWN_SCENARIO_KEY,
  KNOWN_HOUSE_SCENARIOS,
  PRIMARY_BRIAN_SANDBOX_CONTEXT,
  getKnownHouseScenarioByKey,
  resolveKnownHouseScenarioSelection,
} from "@/modules/onePathSim/knownHouseScenarios";

describe("one path known-house scenario registry", () => {
  it("defines a stable sandbox-only registry with starter coverage across target types", () => {
    expect(Array.isArray(KNOWN_HOUSE_SCENARIOS)).toBe(true);
    expect(KNOWN_HOUSE_SCENARIOS.length).toBeGreaterThanOrEqual(12);
    expect(KNOWN_HOUSE_SCENARIOS.every((scenario) => scenario.scenarioKey && scenario.label)).toBe(true);
    expect(KNOWN_HOUSE_SCENARIOS.some((scenario) => scenario.scenarioType === "INTERVAL_TRUTH")).toBe(true);
    expect(KNOWN_HOUSE_SCENARIOS.some((scenario) => scenario.scenarioType === "GREEN_BUTTON_TRUTH")).toBe(true);
    expect(KNOWN_HOUSE_SCENARIOS.some((scenario) => scenario.scenarioType === "MANUAL_MONTHLY_TEST")).toBe(true);
    expect(KNOWN_HOUSE_SCENARIOS.some((scenario) => scenario.scenarioType === "MANUAL_ANNUAL_TEST")).toBe(true);
    expect(KNOWN_HOUSE_SCENARIOS.some((scenario) => scenario.scenarioType === "NEW_BUILD_TEST")).toBe(true);
  });

  it("anchors the Brian sandbox presets to one resolved primary house/context", () => {
    expect(PRIMARY_BRIAN_SANDBOX_CONTEXT.email).toBe("brian@intellipath-solutions.com");
    expect(PRIMARY_BRIAN_SANDBOX_CONTEXT.houseId).toBe("8a6fe8b9-601e-4f9d-aa3e-7ef0b4bddde8");
    expect(DEFAULT_BRIAN_KNOWN_SCENARIO_KEY).toBe("keeper-interval-past-primary");
    const brianPresets = KNOWN_HOUSE_SCENARIOS.filter(
      (scenario) => scenario.sourceUserEmail === PRIMARY_BRIAN_SANDBOX_CONTEXT.email && scenario.active
    );
    expect(brianPresets.length).toBeGreaterThanOrEqual(10);
    expect(brianPresets.every((scenario) => scenario.sourceHouseId === PRIMARY_BRIAN_SANDBOX_CONTEXT.houseId)).toBe(true);
    expect(brianPresets.every((scenario) => scenario.actualContextHouseId === PRIMARY_BRIAN_SANDBOX_CONTEXT.actualContextHouseId)).toBe(true);
    expect(brianPresets.some((scenario) => scenario.scenarioKey === "keeper-brian-interval-baseline-primary")).toBe(true);
    expect(brianPresets.some((scenario) => scenario.scenarioKey === "keeper-brian-interval-future-primary")).toBe(true);
    expect(brianPresets.some((scenario) => scenario.scenarioKey === "keeper-manual-monthly-baseline-primary")).toBe(true);
    expect(brianPresets.some((scenario) => scenario.scenarioKey === "keeper-manual-monthly-future-primary")).toBe(true);
    expect(brianPresets.some((scenario) => scenario.scenarioKey === "keeper-manual-annual-phase1-primary")).toBe(true);
    expect(brianPresets.some((scenario) => scenario.scenarioKey === "keeper-manual-annual-past-primary")).toBe(true);
    expect(brianPresets.some((scenario) => scenario.scenarioKey === "keeper-manual-annual-future-primary")).toBe(true);
    expect(brianPresets.some((scenario) => scenario.scenarioKey === "keeper-new-build-past-primary")).toBe(true);
    expect(brianPresets.some((scenario) => scenario.scenarioKey === "keeper-new-build-future-primary")).toBe(true);
    expect(brianPresets.some((scenario) => scenario.scenarioKey === "keeper-green-button-baseline-primary")).toBe(true);
    expect(brianPresets.some((scenario) => scenario.scenarioKey === "keeper-green-button-future-primary")).toBe(true);
  });

  it("covers the requested baseline/past/future lifecycle families by mode", () => {
    const scenarioKeys = KNOWN_HOUSE_SCENARIOS.map((scenario) => scenario.scenarioKey);

    expect(scenarioKeys).toContain("keeper-brian-interval-baseline-primary");
    expect(scenarioKeys).toContain("keeper-interval-past-primary");
    expect(scenarioKeys).toContain("keeper-brian-interval-future-primary");

    expect(scenarioKeys).toContain("keeper-manual-monthly-baseline-primary");
    expect(scenarioKeys).toContain("keeper-manual-monthly-past-primary");
    expect(scenarioKeys).toContain("keeper-manual-monthly-future-primary");

    expect(scenarioKeys).toContain("keeper-manual-annual-phase1-primary");
    expect(scenarioKeys).toContain("keeper-manual-annual-past-primary");
    expect(scenarioKeys).toContain("keeper-manual-annual-future-primary");

    expect(scenarioKeys).toContain("keeper-new-build-past-primary");
    expect(scenarioKeys).toContain("keeper-new-build-future-primary");
    expect(scenarioKeys).not.toContain("keeper-new-build-baseline-primary");

    expect(scenarioKeys).toContain("keeper-green-button-baseline-primary");
    expect(scenarioKeys).toContain("keeper-green-button-past-primary");
    expect(scenarioKeys).toContain("keeper-green-button-future-primary");
  });

  it("labels manual preset truth around the effective Stage 1 payload that actually loads", () => {
    const manualPresets = KNOWN_HOUSE_SCENARIOS.filter(
      (scenario) => scenario.mode === "MANUAL_MONTHLY" || scenario.mode === "MANUAL_ANNUAL"
    );

    expect(manualPresets.length).toBeGreaterThan(0);
    expect(manualPresets.every((scenario) => scenario.expectedTruthSource === "effective_manual_stage_one_payload")).toBe(true);
  });

  it("looks scenarios up by stable key", () => {
    const first = KNOWN_HOUSE_SCENARIOS[0];
    expect(getKnownHouseScenarioByKey(first.scenarioKey)).toEqual(first);
    expect(getKnownHouseScenarioByKey("missing-scenario-key")).toBeNull();
  });

  it("resolves lookup-driven house/context/scenario ids from a preset and fuzzy-matches scenario hints", () => {
    const scenario = {
      scenarioKey: "interval-past",
      label: "Interval Past",
      active: true,
      mode: "INTERVAL",
      scenarioType: "INTERVAL_TRUTH" as const,
      sourceUserEmail: "brian@intellipath-solutions.com",
      sourceUserId: null,
      sourceHouseId: "house-source",
      actualContextHouseId: "house-actual",
      scenarioId: null,
      scenarioNameHint: "Past",
      scenarioSelectionStrategy: "scenario_name" as const,
      houseSelectionStrategy: "source_house_id" as const,
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
          { id: "house-source", label: "Sandbox House" },
        ],
        scenarios: [
          { id: "past-scenario-id", name: "Past (Corrected)" },
          { id: "future-scenario-id", name: "Future" },
        ],
      },
    });

    expect(resolved.selectedHouseId).toBe("house-source");
    expect(resolved.actualContextHouseId).toBe("house-actual");
    expect(resolved.selectedScenarioId).toBe("past-scenario-id");
  });
});
