import { describe, expect, it } from "vitest";

import {
  mergeGreenButtonChartInsightsOntoPassthroughDataset,
  prepareUserSiteGreenButtonDisplayUsage,
} from "@/lib/usage/greenButtonChartInsights";

describe("prepareUserSiteGreenButtonDisplayUsage", () => {
  it("returns resolved usage without running One Path passthrough", async () => {
    const resolved = {
      dataset: {
        summary: { source: "GREEN_BUTTON" },
        insights: { fifteenMinuteAverages: [{ hhmm: "12:00", avgKw: 1 }] },
      },
      alternatives: { smt: null, greenButton: null },
    };
    const out = await prepareUserSiteGreenButtonDisplayUsage(resolved);
    expect(out).toBe(resolved);
  });
});

describe("mergeGreenButtonChartInsightsOntoPassthroughDataset", () => {
  it("fills missing passthrough fifteenMinuteAverages from the full resolved dataset", () => {
    const merged = mergeGreenButtonChartInsightsOntoPassthroughDataset({
      passthroughDataset: {
        summary: { source: "GREEN_BUTTON", start: "2025-05-14", end: "2026-05-13" },
        insights: { timeOfDayBuckets: [{ key: "evening", label: "Evening", kwh: 10 }] },
      },
      resolvedDataset: {
        insights: {
          fifteenMinuteAverages: [
            { hhmm: "00:00", avgKw: 1.1 },
            { hhmm: "00:15", avgKw: 1.2 },
          ],
          peakHour: { hour: 20, kw: 2.3 },
        },
      },
    });

    expect(merged.insights).toEqual({
      timeOfDayBuckets: [{ key: "evening", label: "Evening", kwh: 10 }],
      fifteenMinuteAverages: [
        { hhmm: "00:00", avgKw: 1.1 },
        { hhmm: "00:15", avgKw: 1.2 },
      ],
      peakHour: { hour: 20, kw: 2.3 },
    });
  });

  it("prefers resolved actual-layer curve over passthrough when both have points", () => {
    const merged = mergeGreenButtonChartInsightsOntoPassthroughDataset({
      passthroughDataset: {
        insights: {
          fifteenMinuteAverages: [{ hhmm: "12:00", avgKw: 9.9 }],
        },
      },
      resolvedDataset: {
        insights: {
          fifteenMinuteAverages: [{ hhmm: "00:00", avgKw: 1.1 }],
        },
      },
    });

    expect((merged.insights as { fifteenMinuteAverages: unknown[] }).fifteenMinuteAverages).toEqual([
      { hhmm: "00:00", avgKw: 1.1 },
    ]);
  });
});
