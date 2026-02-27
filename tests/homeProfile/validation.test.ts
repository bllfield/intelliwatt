import { describe, expect, it } from "vitest";
import { validateHomeProfile } from "@/modules/homeProfile/validation";

const baseProfile = {
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
};

describe("validateHomeProfile past baseline fields", () => {
  it("keeps occupancy requirements intact", () => {
    const out = validateHomeProfile({ ...baseProfile, occupantsWork: 0, occupantsSchool: 0, occupantsHomeAllDay: 0 });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toBe("occupants_invalid");
  });

  it("requires hvac/heating fields when past baseline mode is requested", () => {
    const out = validateHomeProfile(baseProfile, { requirePastBaselineFields: true });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toBe("hvacType_required");
  });

  it("requires pool details only when pool is enabled", () => {
    const out = validateHomeProfile(
      {
        ...baseProfile,
        hvacType: "central",
        heatingType: "electric",
        hasPool: true,
      },
      { requirePastBaselineFields: true }
    );
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toBe("poolPumpType_required");
  });

  it("passes with complete hvac and pool details", () => {
    const out = validateHomeProfile(
      {
        ...baseProfile,
        hvacType: "heat_pump",
        heatingType: "heat_pump",
        hasPool: true,
        poolPumpType: "variable_speed",
        poolPumpHp: 1.5,
        poolSummerRunHoursPerDay: 8,
        poolWinterRunHoursPerDay: 3,
        hasPoolHeater: true,
        poolHeaterType: "heat_pump",
      },
      { requirePastBaselineFields: true }
    );
    expect(out.ok).toBe(true);
  });
});
