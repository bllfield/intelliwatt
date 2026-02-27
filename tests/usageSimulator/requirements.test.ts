import { describe, expect, it } from "vitest";
import { computeRequirements } from "@/modules/usageSimulator/requirements";

const homeProfileComplete = {
  homeAge: 10,
  homeStyle: "brick",
  squareFeet: 1800,
  stories: 2,
  insulationType: "fiberglass",
  windowType: "double_pane",
  foundation: "slab",
  ledLights: true,
  smartThermostat: true,
  summerTemp: 73,
  winterTemp: 69,
  occupantsWork: 1,
  occupantsSchool: 1,
  occupantsHomeAllDay: 0,
  fuelConfiguration: "mixed",
  hvacType: "central",
  heatingType: "gas",
  hasPool: false,
};

const applianceProfileEmpty = { version: 1 as const, fuelConfiguration: "", appliances: [] };
const applianceProfileComplete = { version: 1 as const, fuelConfiguration: "mixed", appliances: [] };

describe("computeRequirements mode-specific gating", () => {
  it("SMT baseline does not block on appliances when home details are complete", () => {
    const out = computeRequirements(
      {
        manualUsagePayload: null,
        homeProfile: homeProfileComplete as any,
        applianceProfile: applianceProfileEmpty as any,
        hasActualIntervals: true,
      },
      "SMT_BASELINE"
    );
    expect(out.canRecalc).toBe(true);
    expect(out.missingItems.length).toBe(0);
  });

  it("SMT baseline still requires actual intervals", () => {
    const out = computeRequirements(
      {
        manualUsagePayload: null,
        homeProfile: homeProfileComplete as any,
        applianceProfile: applianceProfileEmpty as any,
        hasActualIntervals: false,
      },
      "SMT_BASELINE"
    );
    expect(out.canRecalc).toBe(false);
    expect(out.missingItems.some((m) => m.includes("15‑minute intervals required"))).toBe(true);
  });

  it("NEW_BUILD_ESTIMATE still requires appliances", () => {
    const out = computeRequirements(
      {
        manualUsagePayload: null,
        homeProfile: homeProfileComplete as any,
        applianceProfile: applianceProfileEmpty as any,
        hasActualIntervals: true,
      },
      "NEW_BUILD_ESTIMATE"
    );
    expect(out.canRecalc).toBe(false);
    expect(out.missingItems.some((m) => m.includes("Complete Appliances"))).toBe(true);
  });

  it("NEW_BUILD_ESTIMATE passes when appliances and home profile are complete", () => {
    const out = computeRequirements(
      {
        manualUsagePayload: null,
        homeProfile: homeProfileComplete as any,
        applianceProfile: applianceProfileComplete as any,
        hasActualIntervals: true,
      },
      "NEW_BUILD_ESTIMATE"
    );
    expect(out.canRecalc).toBe(true);
  });
});
