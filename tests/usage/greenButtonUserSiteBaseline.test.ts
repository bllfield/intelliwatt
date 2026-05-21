import { describe, expect, it, vi } from "vitest";

vi.mock("@/modules/onePathSim/onePathSim", () => ({
  adaptGreenButtonRawInput: vi.fn(async () => ({ inputType: "GREEN_BUTTON" })),
  runSharedSimulation: vi.fn(async () => ({
    dataset: {
      summary: { source: "GREEN_BUTTON", totalKwh: 100, start: "2025-01-01", end: "2025-12-31" },
      meta: {
        actualSource: "GREEN_BUTTON",
        baselinePassthrough: true,
        weatherSensitivityScore: { weatherEfficiencyScore0to100: 77, scoringMode: "INTERVAL_BASED" },
      },
      daily: [{ date: "2025-06-01", kwh: 10 }],
      series: { intervals15: [], daily: [], monthly: [], annual: [] },
      insights: { fifteenMinuteAverages: [{ hhmm: "12:00", avgKw: 1 }] },
    },
  })),
}));

import { resolveGreenButtonBaselineUsageForUserSite } from "@/lib/usage/greenButtonUserSiteBaseline";
import { weatherSensitivityFromPassthroughDataset } from "@/lib/usage/greenButtonUserSiteBaseline";
import { adaptGreenButtonRawInput, runSharedSimulation } from "@/modules/onePathSim/onePathSim";

describe("greenButtonUserSiteBaseline", () => {
  it("runs shared GB passthrough for user-site baseline reads", async () => {
    const resolved = await resolveGreenButtonBaselineUsageForUserSite({
      userId: "u1",
      houseId: "h1",
      resolvedUsage: {
        dataset: {
          summary: { source: "GREEN_BUTTON" },
          meta: { actualSource: "GREEN_BUTTON" },
          insights: { fifteenMinuteAverages: [{ hhmm: "00:00", avgKw: 2 }] },
        },
        alternatives: { smt: null, greenButton: { rawId: "r1" } },
      },
    });

    expect(adaptGreenButtonRawInput).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "u1",
        houseId: "h1",
        actualContextHouseId: "h1",
        scenarioId: null,
      }),
    );
    expect(runSharedSimulation).toHaveBeenCalled();
    expect((resolved.dataset as any)?.meta?.baselinePassthrough).toBe(true);
    expect((resolved.dataset as any)?.insights?.fifteenMinuteAverages?.length).toBeGreaterThan(0);
  });

  it("reads weather score from passthrough dataset meta", () => {
    const out = weatherSensitivityFromPassthroughDataset({
      meta: {
        baselinePassthrough: true,
        weatherSensitivityScore: { weatherEfficiencyScore0to100: 77, scoringMode: "INTERVAL_BASED" },
      },
    });
    expect(out?.score.weatherEfficiencyScore0to100).toBe(77);
  });
});
