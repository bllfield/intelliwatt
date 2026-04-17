import { describe, expect, it } from "vitest";
import { buildBaselineParityReport } from "@/modules/onePathSim/baselineParityReport";

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

describe("buildBaselineParityReport", () => {
  it("reports a full pass when One Path and user usage baseline contracts match", () => {
    const userUsagePageContract = buildContract();
    const onePathBaselineContract = buildContract();

    const report = buildBaselineParityReport({
      userUsagePageContract,
      onePathBaselineContract,
    });

    expect(report.overallMatch).toBe(true);
    expect(report.firstDivergenceField).toBeNull();
    expect(report.mismatchedKeys).toEqual([]);
    expect(report.matchedKeys).toEqual(
      expect.arrayContaining([
        "source",
        "coverageStart",
        "coverageEnd",
        "intervalCount",
        "totals",
        "headlineTotal",
        "baseloadFields",
        "weatherScore",
        "monthlyRows",
        "dailyRowCount",
        "fifteenMinuteCurve",
        "weekdayWeekend",
        "timeOfDayBuckets",
        "breakdownNote",
        "weatherBasisLabel",
      ])
    );
  });

  it("identifies the first divergence in order when a baseline field drifts", () => {
    const userUsagePageContract = buildContract();
    const onePathBaselineContract = buildContract();
    onePathBaselineContract.dataset.summary.intervalsCount = 34763;
    onePathBaselineContract.dataset.totals.netKwh = 13526.78;

    const report = buildBaselineParityReport({
      userUsagePageContract,
      onePathBaselineContract,
    });

    expect(report.overallMatch).toBe(false);
    expect(report.firstDivergenceField).toBe("intervalCount");
    expect(report.mismatchedKeys).toContain("intervalCount");
    expect(report.fields.intervalCount).toMatchObject({
      matched: false,
      userValue: 34823,
      onePathValue: 34763,
    });
  });
});
