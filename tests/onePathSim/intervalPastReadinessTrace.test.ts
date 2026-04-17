import { describe, expect, it } from "vitest";
import { buildBaselineParityReport } from "@/modules/onePathSim/baselineParityReport";
import { buildIntervalPastReadinessTrace } from "@/modules/onePathSim/intervalPastReadinessTrace";

function buildContract() {
  return {
    houseId: "house-1",
    label: "Home",
    address: { line1: "123 Main", city: "Dallas", state: "TX" },
    esiid: "esiid-1",
    dataset: {
      summary: {
        source: "SMT",
        intervalsCount: 34823,
        totalKwh: 13542.3,
        start: "2025-04-14",
        end: "2026-04-14",
      },
      totals: {
        importKwh: 13542.3,
        exportKwh: 0,
        netKwh: 13542.3,
      },
      monthly: [{ month: "2026-04", kwh: 13542.3 }],
      daily: [{ date: "2026-04-14", kwh: 13542.3, source: "ACTUAL", sourceDetail: "ACTUAL" }],
      insights: {
        baseload: 0.42,
        baseloadDaily: 44.2,
        baseloadMonthly: 1120.8,
        weekdayVsWeekend: { weekday: 11000, weekend: 2546.3 },
        timeOfDayBuckets: [{ key: "overnight", label: "Overnight", kwh: 4000 }],
        fifteenMinuteAverages: [{ hhmm: "00:15", avgKw: 1.2 }],
      },
      meta: {
        weatherSourceSummary: "actual_only",
      },
    },
    alternatives: { smt: null, greenButton: null },
    datasetError: null,
    weatherSensitivityScore: {
      weatherEfficiencyScore0to100: 32,
      scoringMode: "INTERVAL_BASED",
      explanationSummary: "Weather score summary",
    },
    weatherEfficiencyDerivedInput: null,
  };
}

describe("buildIntervalPastReadinessTrace", () => {
  it("shows baseline parity can pass while interval Past compare is still blocked", () => {
    const parityReport = buildBaselineParityReport({
      userUsagePageContract: buildContract(),
      onePathBaselineContract: buildContract(),
    });

    const trace = buildIntervalPastReadinessTrace({
      scenario: {
        scenarioKey: "keeper-interval-past-primary",
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
        applianceProfile: null,
      },
      baselineParityReport: parityReport,
      environmentVisibility: {
        homeDetails: { envVarPresent: false },
        appliances: { envVarPresent: false },
      },
    });

    expect(trace.baselineParity.overallMatch).toBe(true);
    expect(trace.compareCapableNow).toBe(false);
    expect(trace.exactBlocker).toMatchObject({
      category: "homeDetails",
      validator: "validateHomeProfile(requirePastBaselineFields=true)",
      failureCode: "occupants_invalid",
    });
  });

  it("surfaces exact blocking field values and read paths read-only", () => {
    const trace = buildIntervalPastReadinessTrace({
      scenario: {
        scenarioKey: "keeper-interval-past-primary",
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
        applianceProfile: { fuelConfiguration: "" },
      },
      baselineParityReport: {
        overallMatch: true,
        firstDivergenceField: null,
      },
      environmentVisibility: {
        homeDetails: { envVarPresent: false },
        appliances: { envVarPresent: false },
      },
    });

    expect(trace.exactBlocker?.fieldValuesSeen).toMatchObject({
      rawHomeProfilePresent: false,
      occupantsWork: 0,
      occupantsSchool: 0,
      occupantsHomeAllDay: 0,
      occupantsTotal: 0,
      fuelConfiguration: null,
      hvacType: null,
      heatingType: null,
    });
    expect(trace.sourceReadPath).toMatchObject({
      homeDetails: expect.objectContaining({
        runOwner: "modules/homeProfile/repo.ts :: getHomeProfileSimulatedByUserHouse",
        sameRunOwnerAsUserSite: true,
      }),
      applianceDetails: expect.objectContaining({
        runOwner: "modules/applianceProfile/repo.ts :: getApplianceProfileSimulatedByUserHouse",
        sameRunOwnerAsUserSite: true,
      }),
    });
    expect(trace.classification).toBe("unreadable_field_in_past_path_only");
  });
});
