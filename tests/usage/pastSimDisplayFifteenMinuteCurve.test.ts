import { describe, expect, it } from "vitest";

import { buildOnePathRunReadOnlyView } from "@/modules/onePathSim/runReadOnlyView";
import { resolvePastSimDisplayFifteenMinuteCurve } from "@/lib/usage/pastSimDisplayFifteenMinuteCurve";
import { buildUserUsageDashboardViewModel } from "@/lib/usage/userUsageDashboardViewModel";

describe("resolvePastSimDisplayFifteenMinuteCurve", () => {
  it("matches user Usage dashboard and One Path read-only for Past simulated fill", () => {
    const dataset = {
      summary: {
        source: "GREEN_BUTTON",
        intervalsCount: 3,
        totalKwh: 100,
        start: "2026-06-01",
        end: "2026-06-03",
      },
      totals: { importKwh: 100, exportKwh: 0, netKwh: 100 },
      daily: [
        { date: "2026-06-01", kwh: 40, source: "ACTUAL" },
        { date: "2026-06-02", kwh: 40, source: "ACTUAL" },
        { date: "2026-06-03", kwh: 20, source: "SIMULATED", sourceDetail: "SIMULATED (TRAVEL/VACANT)" },
      ],
      series: {
        intervals15: [
          { timestamp: "2026-06-01T17:00:00.000Z", kwh: 2 },
          { timestamp: "2026-06-02T17:00:00.000Z", kwh: 2 },
          { timestamp: "2026-06-03T17:00:00.000Z", kwh: 0.1 },
        ],
      },
      insights: {
        fifteenMinuteAverages: [{ hhmm: "12:00", avgKw: 0.4 }],
      },
      meta: {
        datasetKind: "SIMULATED",
        actualSource: "GREEN_BUTTON",
        monthProvenanceByMonth: { "2026-06": "SIMULATED" },
        timezone: "America/Chicago",
        coverageStart: "2026-06-01",
        coverageEnd: "2026-06-03",
      },
    };

    const viewModel = buildUserUsageDashboardViewModel({ dataset, datasetError: null });
    const adminView = buildOnePathRunReadOnlyView({ dataset });

    expect(viewModel?.derived.fifteenCurve).toEqual(adminView?.fifteenMinuteAverages);
    expect(adminView?.fifteenMinuteCurveSourceOwner).toBe(
      "greenButtonPersistedIntervalConvert.buildGreenButtonLoadCurveInsightsFromSeriesRows"
    );
    expect(viewModel?.derived.fifteenCurve.find((row) => row.hhmm === "12:00")?.avgKw).toBe(8);
  });

  it("excludes travel/vacant days from the averaged curve", () => {
    const timezone = "America/Chicago";
    const result = resolvePastSimDisplayFifteenMinuteCurve({
      insightsFifteenMinuteAverages: [{ hhmm: "12:00", avgKw: 0.4 }],
      intervals15: [
        { timestamp: "2026-06-01T17:00:00.000Z", kwh: 2 },
        { timestamp: "2026-06-02T17:00:00.000Z", kwh: 2 },
        { timestamp: "2026-06-03T17:00:00.000Z", kwh: 0.1 },
      ],
      hasSimulatedFill: true,
      displayDaily: [
        { date: "2026-06-01", source: "ACTUAL" },
        { date: "2026-06-02", source: "ACTUAL" },
        { date: "2026-06-03", source: "SIMULATED", sourceDetail: "SIMULATED (TRAVEL/VACANT)" },
      ],
      timezone,
      coverageStart: "2026-06-01",
      coverageEnd: "2026-06-03",
    });

    expect(result.fifteenMinuteAverages.find((row) => row.hhmm === "12:00")?.avgKw).toBe(8);
  });

  it("prefers shared Green Button series curve over stale insights for ACTUAL usage", () => {
    const intervals15 = Array.from({ length: 96 * 31 }, () => ({
      timestamp: "2026-06-01T05:00:00.000Z",
      kwh: 1,
    }));
    const result = resolvePastSimDisplayFifteenMinuteCurve({
      insightsFifteenMinuteAverages: [{ hhmm: "00:00", avgKw: 9.9 }],
      intervals15,
      hasSimulatedFill: false,
      displayDaily: [{ date: "2026-06-01", source: "ACTUAL" }],
      timezone: "America/Chicago",
      coverageStart: "2026-06-01",
      coverageEnd: "2026-06-30",
      meta: { actualSource: "GREEN_BUTTON", greenButtonIntervalTimestampMode: "home_local" },
    });

    expect(result.sourceOwner).toBe(
      "greenButtonPersistedIntervalConvert.buildGreenButtonLoadCurveInsightsFromSeriesRows"
    );
    expect(result.fifteenMinuteAverages.find((row) => row.hhmm === "00:00")?.avgKw).toBe(4);
  });
});
