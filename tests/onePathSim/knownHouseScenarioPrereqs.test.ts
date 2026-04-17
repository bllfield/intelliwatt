import { describe, expect, it } from "vitest";
import { buildKnownHouseScenarioPrereqStatus } from "@/modules/onePathSim/knownHouseScenarioPrereqs";

describe("one path known-house scenario prereqs", () => {
  it("reports blocking reasons for a Brian Past preset with missing sandbox prerequisites", () => {
    const status = buildKnownHouseScenarioPrereqStatus({
      scenario: {
        mode: "INTERVAL",
        scenarioSelectionStrategy: "scenario_name",
      },
      lookupSourceContext: {
        usageTruthSource: "persisted_usage_output",
        upstreamUsageTruth: {
          currentRun: {
            statusSummary: {
              downstreamSimulationAllowed: true,
            },
          },
        },
        homeProfile: null,
        applianceProfile: { version: 1, fuelConfiguration: "", appliances: [] },
        manualUsagePayload: null,
      },
    });

    expect(status.homeDetailsReady).toBe(false);
    expect(status.usageTruthReady).toBe(true);
    expect(status.compareCapableNow).toBe(false);
    expect(status.blockingReasons).toEqual(["Complete Home Details (required fields)."]);
    expect(status.availablePrepActions).toEqual(["prepare_home_details"]);
    expect(status.validatorAudit.homeDetails).toEqual(
      expect.objectContaining({
        ready: false,
        validator: "validateHomeProfile(requirePastBaselineFields=true)",
        failureCode: "occupants_invalid",
      })
    );
    expect(status.blockingDetails).toEqual([
      expect.objectContaining({
        category: "homeDetails",
        validator: "validateHomeProfile(requirePastBaselineFields=true)",
        failureCode: "occupants_invalid",
      }),
    ]);
    expect(status.readSourceComparison.usageTruth).toEqual(
      expect.objectContaining({
        sameRunOwnerAsUserSite: true,
      })
    );
  });

  it("marks a Brian manual monthly Past preset compare-capable only when home, appliances, usage truth, and manual totals are ready", () => {
    const status = buildKnownHouseScenarioPrereqStatus({
      scenario: {
        mode: "MANUAL_MONTHLY",
        scenarioSelectionStrategy: "scenario_name",
      },
      lookupSourceContext: {
        usageTruthSource: "persisted_usage_output",
        upstreamUsageTruth: {
          currentRun: {
            statusSummary: {
              downstreamSimulationAllowed: true,
            },
          },
        },
        homeProfile: {
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
          heatingType: "electric",
        },
        applianceProfile: {
          version: 1,
          fuelConfiguration: "mixed",
          appliances: [],
        },
        manualUsagePayload: {
          mode: "MONTHLY",
          anchorEndDate: "2026-03-15",
          monthlyKwh: [
            { month: "2026-02", kwh: 800 },
            { month: "2026-03", kwh: 820 },
          ],
        },
      },
    });

    expect(status.homeDetailsReady).toBe(true);
    expect(status.manualMonthlyPayloadReady).toBe(true);
    expect(status.manualAnnualPayloadReady).toBe(false);
    expect(status.usageTruthReady).toBe(true);
    expect(status.compareCapableNow).toBe(true);
    expect(status.blockingReasons).toEqual([]);
    expect(status.validatorAudit.manualMonthlyPayload).toEqual(
      expect.objectContaining({
        ready: true,
        validator: "hasUsableMonthlyPayload",
        failureCode: null,
      })
    );
    expect(status.readSourceComparison.manualUsage).toEqual(
      expect.objectContaining({
        sameBackingStoreAsUserSite: true,
        sameRunOwnerAsUserSite: false,
      })
    );
  });
});
