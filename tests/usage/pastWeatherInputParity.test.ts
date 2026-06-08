import { describe, expect, it } from "vitest";

import {
  auditPastWeatherInputParity,
  buildPastWeatherInputFingerprint,
} from "@/lib/usage/pastWeatherInputParity";
import { auditUserAdminPastReadModelParity } from "@/lib/usage/intervalReadModelInvariants";

function pastDatasetFixture(args: {
  houseLabel: string;
  usageShapeProfileIdentity: string;
  dailyKwhByDate: Record<string, number>;
  bundleC: { eff: number; cool: number; heat: number };
  bundleB: { eff: number; cool: number; heat: number };
  artifactInputHash: string;
  displayTruthRevision: string;
}) {
  const daily = Object.entries(args.dailyKwhByDate).map(([date, kwh]) => ({
    date,
    kwh,
    source: "ACTUAL",
    sourceDetail: "ACTUAL",
  }));
  return {
    summary: { source: "GREEN_BUTTON", totalKwh: 14460, start: "2025-06-05", end: "2026-06-04" },
    totals: { netKwh: 14460 },
    daily,
    dailyWeather: {
      "2025-07-01": { meanTempF: 85, hdd: 0, cdd: 12 },
      "2026-01-01": { meanTempF: 40, hdd: 25, cdd: 0 },
    },
    insights: {
      timeOfDayBuckets: [
        { key: "overnight", label: "Overnight", kwh: 3615 },
        { key: "morning", label: "Morning", kwh: 3615 },
        { key: "afternoon", label: "Afternoon", kwh: 3615 },
        { key: "evening", label: "Evening", kwh: 3615 },
      ],
    },
    meta: {
      datasetKind: "SIMULATED",
      actualSource: "GREEN_BUTTON",
      artifactInputHash: args.artifactInputHash,
      pastDisplayWeatherDisplayTruthRevision: args.displayTruthRevision,
      pastDisplayWeatherFinalizeVersion: "past_display_weather_finalize_v2",
      lockboxInput: {
        sourceContext: {
          sourceHouseId: "source-house",
          intervalFingerprint: "interval-fp",
          weatherIdentity: "weather-id",
        },
        profileContext: {
          profileHouseId: "source-house",
          usageShapeProfileIdentity: args.usageShapeProfileIdentity,
        },
        validationKeys: { localDateKeys: ["2025-07-12", "2026-01-01"] },
        travelRanges: { ranges: [{ startDate: "2025-06-27", endDate: "2025-07-11" }] },
      },
      weatherSensitivityScore: {
        weatherEfficiencyScore0to100: args.bundleB.eff,
        coolingSensitivityScore0to100: args.bundleB.cool,
        heatingSensitivityScore0to100: args.bundleB.heat,
        confidenceScore0to100: 100,
        sourceOwner: "simulation_build_diagnostic",
      },
      pastDisplayWeatherSensitivityScore: {
        weatherEfficiencyScore0to100: args.bundleC.eff,
        coolingSensitivityScore0to100: args.bundleC.cool,
        heatingSensitivityScore0to100: args.bundleC.heat,
        confidenceScore0to100: 100,
        sourceOwner: "past_artifact_build",
        scoringContext: "PAST_DISPLAY",
      },
    },
  };
}

describe("pastWeatherInputParity", () => {
  it("hard fails when profile fingerprints differ", () => {
    const userDataset = pastDatasetFixture({
      houseLabel: "user",
      usageShapeProfileIdentity: "shape-user",
      dailyKwhByDate: { "2025-07-01": 40, "2026-01-01": 30 },
      bundleC: { eff: 50, cool: 97, heat: 73 },
      bundleB: { eff: 55, cool: 81, heat: 79 },
      artifactInputHash: "Bxsq8-user",
      displayTruthRevision: "rev-user",
    });
    const adminDataset = pastDatasetFixture({
      houseLabel: "admin",
      usageShapeProfileIdentity: "shape-admin",
      dailyKwhByDate: { "2025-07-01": 40, "2026-01-01": 30 },
      bundleC: { eff: 50, cool: 93, heat: 76 },
      bundleB: { eff: 48, cool: 92, heat: 82 },
      artifactInputHash: "OaBVcok-admin",
      displayTruthRevision: "rev-admin",
    });

    const result = auditPastWeatherInputParity({
      userDataset,
      adminDataset,
      userProfileFingerprints: { homeProfile: "fp-user", applianceProfile: "fp-user-app" },
      adminProfileFingerprints: { homeProfile: "fp-admin", applianceProfile: "fp-admin-app" },
    });

    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.startsWith("homeProfileFingerprint:"))).toBe(true);
    expect(result.violations.some((v) => v.startsWith("usageShapeProfileIdentity:"))).toBe(true);
    expect(result.violations.some((v) => v.startsWith("artifactInputHash:"))).toBe(true);
    expect(result.violations.some((v) => v.startsWith("displayTruthRevision:"))).toBe(true);
  });

  it("hard fails when daily rows differ but totals match", () => {
    const userDataset = pastDatasetFixture({
      houseLabel: "user",
      usageShapeProfileIdentity: "shape-shared",
      dailyKwhByDate: { "2025-07-01": 45, "2026-01-01": 25 },
      bundleC: { eff: 50, cool: 97, heat: 73 },
      bundleB: { eff: 55, cool: 81, heat: 79 },
      artifactInputHash: "hash-a",
      displayTruthRevision: "rev-a",
    });
    const adminDataset = pastDatasetFixture({
      houseLabel: "admin",
      usageShapeProfileIdentity: "shape-shared",
      dailyKwhByDate: { "2025-07-01": 25, "2026-01-01": 45 },
      bundleC: { eff: 50, cool: 93, heat: 76 },
      bundleB: { eff: 48, cool: 92, heat: 82 },
      artifactInputHash: "hash-b",
      displayTruthRevision: "rev-b",
    });

    const result = auditPastWeatherInputParity({
      userDataset,
      adminDataset,
      userProfileFingerprints: { homeProfile: "fp-shared", applianceProfile: "fp-shared-app" },
      adminProfileFingerprints: { homeProfile: "fp-shared", applianceProfile: "fp-shared-app" },
    });

    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.includes("dailyRows differ with matching totals"))).toBe(true);
    expect(result.user.netKwhDailySum).toBe(70);
    expect(result.admin.netKwhDailySum).toBe(70);
  });

  it("passes when finalized input snapshots match", () => {
    const sharedDaily = { "2025-07-01": 40, "2026-01-01": 30 };
    const userDataset = pastDatasetFixture({
      houseLabel: "user",
      usageShapeProfileIdentity: "shape-shared",
      dailyKwhByDate: sharedDaily,
      bundleC: { eff: 50, cool: 93, heat: 76 },
      bundleB: { eff: 55, cool: 81, heat: 79 },
      artifactInputHash: "hash-shared",
      displayTruthRevision: "rev-shared",
    });
    const adminDataset = pastDatasetFixture({
      houseLabel: "admin",
      usageShapeProfileIdentity: "shape-shared",
      dailyKwhByDate: sharedDaily,
      bundleC: { eff: 50, cool: 93, heat: 76 },
      bundleB: { eff: 55, cool: 81, heat: 79 },
      artifactInputHash: "hash-shared",
      displayTruthRevision: "rev-shared",
    });

    const result = auditPastWeatherInputParity({
      userDataset,
      adminDataset,
      userProfileFingerprints: { homeProfile: "fp-shared", applianceProfile: "fp-shared-app" },
      adminProfileFingerprints: { homeProfile: "fp-shared", applianceProfile: "fp-shared-app" },
    });
    expect(result.ok).toBe(true);
    expect(buildPastWeatherInputFingerprint({ dataset: userDataset }).bundleC.cooling).toBe(93);
  });

  it("bounds finalized daily row hash to canonical coverage window only", () => {
    const inWindow = pastDatasetFixture({
      houseLabel: "user",
      usageShapeProfileIdentity: "shape-shared",
      dailyKwhByDate: { "2025-06-05": 40, "2026-06-04": 42 },
      bundleC: { eff: 46, cool: 100, heat: 64 },
      bundleB: { eff: 48, cool: 100, heat: 64 },
      artifactInputHash: "hash-shared",
      displayTruthRevision: "rev-shared",
    });
    const withBoundaryRows = {
      ...inWindow,
      daily: [
        ...(inWindow.daily as Array<Record<string, unknown>>),
        { date: "2025-06-04", kwh: 99, source: "ACTUAL", sourceDetail: "ACTUAL" },
        { date: "2026-06-05", kwh: 88, source: "ACTUAL", sourceDetail: "ACTUAL" },
      ],
    };
    const bounded = buildPastWeatherInputFingerprint({ dataset: inWindow });
    const withExtra = buildPastWeatherInputFingerprint({ dataset: withBoundaryRows });
    expect(withExtra.finalizedDailyRowsHash).toBe(bounded.finalizedDailyRowsHash);
    expect(withExtra.displayTruthRevision).toBe(bounded.displayTruthRevision);
  });

  it("flags same-dataset audit as false green", () => {
    const dataset = pastDatasetFixture({
      houseLabel: "user",
      usageShapeProfileIdentity: "shape-shared",
      dailyKwhByDate: { "2025-07-01": 40 },
      bundleC: { eff: 50, cool: 93, heat: 76 },
      bundleB: { eff: 55, cool: 81, heat: 79 },
      artifactInputHash: "hash-shared",
      displayTruthRevision: "rev-shared",
    });
    const parity = auditUserAdminPastReadModelParity({ dataset, scenarioName: "Past (Corrected)" });
    expect(parity.ok).toBe(false);
    expect(parity.violations.some((v) => v.includes("same in-memory dataset"))).toBe(true);
  });
});
