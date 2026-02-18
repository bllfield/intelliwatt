import { describe, expect, it } from "vitest";
import { mergePrefillIntoHomeDetailsState } from "@/modules/homeProfile/prefillMerge";

describe("homeProfile prefill merge rules", () => {
  it("does not overwrite user edits", () => {
    const state = {
      homeAge: 10,
      homeStyle: "brick",
      squareFeet: 2000,
      stories: 2,
      insulationType: "fiberglass",
      windowType: "double_pane",
      foundation: "slab",
      ledLights: true,
      smartThermostat: true,
      summerTemp: 74,
      winterTemp: 69,
      occupantsWork: 1,
      occupantsSchool: 0,
      occupantsHomeAllDay: 1,
      fuelConfiguration: "mixed",
    } as const;

    const merged = mergePrefillIntoHomeDetailsState(state as any, {
      homeAge: { value: 50, source: "PREFILL" },
      squareFeet: { value: 9999, source: "PREFILL" },
      homeStyle: { value: "wood", source: "PREFILL" },
      summerTemp: { value: 73, source: "DEFAULT" },
    });

    expect(merged.homeAge).toBe(10);
    expect(merged.squareFeet).toBe(2000);
    expect(merged.homeStyle).toBe("brick");
    expect(merged.summerTemp).toBe(74);
  });

  it("fills only empty fields", () => {
    const merged = mergePrefillIntoHomeDetailsState(
      {
        homeAge: "",
        homeStyle: "",
        squareFeet: "",
        stories: "",
        insulationType: "",
        windowType: "",
        foundation: "",
        ledLights: false,
        smartThermostat: false,
        summerTemp: "",
        winterTemp: "",
        occupantsWork: "",
        occupantsSchool: "",
        occupantsHomeAllDay: "",
        fuelConfiguration: "",
      },
      {
        homeAge: { value: 20, source: "PREFILL" },
        squareFeet: { value: 1800, source: "PREFILL" },
        homeStyle: { value: "brick", source: "PREFILL" },
        summerTemp: { value: 73, source: "DEFAULT" },
        winterTemp: { value: 70, source: "DEFAULT" },
      },
    );

    expect(merged.homeAge).toBe(20);
    expect(merged.squareFeet).toBe(1800);
    expect(merged.homeStyle).toBe("brick");
    expect(merged.summerTemp).toBe(73);
    expect(merged.winterTemp).toBe(70);
  });
});

