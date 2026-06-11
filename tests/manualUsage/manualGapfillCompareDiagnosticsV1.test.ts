import { describe, expect, it } from "vitest";
import {
  buildManualGapfillCompareDiagnosticsV1,
  buildMg4SourceActualIsolationLabelCleanup,
} from "@/modules/manualUsage/manualGapfillCompareDiagnosticsV1";
import type { ManualUsagePayload } from "@/modules/simulatedUsage/types";

const monthlySeed: ManualUsagePayload = {
  mode: "MONTHLY",
  anchorEndDate: "2025-08-06",
  monthlyKwh: [{ month: "2025-06", kwh: 2800 }],
  statementRanges: [{ month: "2025-06", startDate: "2025-06-08", endDate: "2025-06-30" }],
  travelRanges: [{ startDate: "2025-08-13", endDate: "2025-08-17" }],
};

function makeDailyRow(date: string, actualKwh: number, simulatedKwh: number) {
  return {
    date,
    actualKwh,
    simulatedKwh,
    deltaKwh: simulatedKwh - actualKwh,
    percentDelta: actualKwh === 0 ? null : Math.round(((simulatedKwh - actualKwh) / actualKwh) * 10000) / 100,
  };
}

function makeWeatherDataset(dates: string[], meanTempF: number, hdd = 0, cdd = 0) {
  const dailyWeather: Record<string, { meanTempF: number; hdd: number; cdd: number }> = {};
  for (const date of dates) dailyWeather[date] = { meanTempF, hdd, cdd };
  return { dailyWeather };
}

function makeIntervalDataset(dates: string[], patternByDate: Record<string, number[]> | number[]) {
  const intervals15 = dates.flatMap((date) => {
    const pattern = Array.isArray(patternByDate) ? patternByDate : patternByDate[date] ?? [];
    return pattern.flatMap((kwh, slot) => {
      const hour = Math.floor(slot / 4);
      const minute = (slot % 4) * 15;
      return {
        timestamp: `${date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00.000-05:00`,
        kwh,
      };
    });
  });
  return {
    meta: { timezone: "America/Chicago" },
    series: { intervals15 },
  };
}

describe("manualGapfillCompareDiagnosticsV1", () => {
  it("includes weather bucket summaries when weather is available", () => {
    const dates = ["2025-07-01", "2025-07-02", "2025-01-10"];
    const out = buildManualGapfillCompareDiagnosticsV1({
      dailyRows: [
        makeDailyRow("2025-07-01", 100, 90),
        makeDailyRow("2025-07-02", 110, 95),
        makeDailyRow("2025-01-10", 80, 85),
      ],
      validationDayKeys: ["2025-07-01"],
      sourceActualDataset: {
        dailyWeather: {
          "2025-07-01": { meanTempF: 88, hdd: 0, cdd: 12 },
          "2025-07-02": { meanTempF: 95, hdd: 0, cdd: 12 },
          "2025-01-10": { meanTempF: 35, hdd: 20, cdd: 0 },
        },
      },
    });

    expect(out.weatherDiagnosticsAvailable).toBe(true);
    expect(out.dailyWeatherMissDiagnostics.summaryBuckets.hot_days.dayCount).toBe(1);
    expect(out.dailyWeatherMissDiagnostics.summaryBuckets.extreme_hot_days.dayCount).toBe(1);
    expect(out.dailyWeatherMissDiagnostics.summaryBuckets.cold_days.dayCount).toBe(1);
    expect(out.dailyWeatherMissDiagnostics.summaryBuckets.validation_days_only.dayCount).toBe(1);
  });

  it("gracefully reports weatherDiagnosticsAvailable:false when weather is missing", () => {
    const out = buildManualGapfillCompareDiagnosticsV1({
      dailyRows: [makeDailyRow("2025-07-01", 100, 90)],
      validationDayKeys: [],
    });

    expect(out.weatherDiagnosticsAvailable).toBe(false);
    expect(out.missingWeatherFields).toContain("dailyWeather");
    expect(out.dailyWeatherMissDiagnostics.days[0]?.weatherBucket).toBe("unknown");
  });

  it("calculates hot/cold/mild bucket WAPE and bias correctly", () => {
    const out = buildManualGapfillCompareDiagnosticsV1({
      dailyRows: [
        makeDailyRow("2025-07-01", 100, 90),
        makeDailyRow("2025-07-02", 100, 80),
        makeDailyRow("2025-01-10", 100, 110),
        makeDailyRow("2025-03-15", 100, 100),
      ],
      sourceActualDataset: {
        dailyWeather: {
          "2025-07-01": { meanTempF: 92, hdd: 0, cdd: 10 },
          "2025-07-02": { meanTempF: 95, hdd: 0, cdd: 12 },
          "2025-01-10": { meanTempF: 35, hdd: 20, cdd: 0 },
          "2025-03-15": { meanTempF: 60, hdd: 5, cdd: 0 },
        },
      },
    });

    expect(out.dailyWeatherMissDiagnostics.summaryBuckets.extreme_hot_days.wape).toBe(0.15);
    expect(out.dailyWeatherMissDiagnostics.summaryBuckets.extreme_hot_days.biasKwhPerDay).toBe(-15);
    expect(out.dailyWeatherMissDiagnostics.summaryBuckets.cold_days.wape).toBe(0.1);
    expect(out.dailyWeatherMissDiagnostics.summaryBuckets.mild_days.wape).toBe(0);
  });

  it("flags travel/vacant days in daily diagnostics", () => {
    const out = buildManualGapfillCompareDiagnosticsV1({
      dailyRows: [
        makeDailyRow("2025-08-14", 8, 95),
        makeDailyRow("2025-08-15", 7, 94),
        makeDailyRow("2025-08-20", 95, 94),
      ],
      labManualPayload: monthlySeed,
      travelContext: {
        effectiveRanges: [{ startDate: "2025-08-13", endDate: "2025-08-17" }],
        labDbRanges: [],
        sourceFallbackRanges: [],
        seedPayloadRanges: [{ startDate: "2025-08-13", endDate: "2025-08-17" }],
      },
    });

    const travelDay = out.dailyWeatherMissDiagnostics.days.find((day) => day.date === "2025-08-14");
    expect(travelDay?.travelVacantFlag).toBe(true);
    expect(travelDay?.travelRangeId).toBe("2025-08-13:2025-08-17");
    expect(out.travelDiagnostics.travelDayCount).toBe(2);
  });

  it("distinguishes travel sources lab_db, seed_payload, source_fallback, unknown", () => {
    const range = { startDate: "2025-08-13", endDate: "2025-08-17" };
    const out = buildManualGapfillCompareDiagnosticsV1({
      dailyRows: [makeDailyRow("2025-08-14", 8, 95)],
      travelContext: {
        effectiveRanges: [range],
        labDbRanges: [range],
        seedPayloadRanges: [range],
        sourceFallbackRanges: [range],
      },
    });
    expect(out.travelDiagnostics.days[0]?.sourceOfTravel).toBe("lab_db");

    const seedOnly = buildManualGapfillCompareDiagnosticsV1({
      dailyRows: [makeDailyRow("2025-08-14", 8, 95)],
      travelContext: {
        effectiveRanges: [range],
        labDbRanges: [],
        seedPayloadRanges: [range],
        sourceFallbackRanges: [range],
      },
    });
    expect(seedOnly.travelDiagnostics.days[0]?.sourceOfTravel).toBe("seed_payload");

    const sourceOnly = buildManualGapfillCompareDiagnosticsV1({
      dailyRows: [makeDailyRow("2025-08-14", 8, 95)],
      travelContext: {
        effectiveRanges: [range],
        labDbRanges: [],
        seedPayloadRanges: [],
        sourceFallbackRanges: [range],
      },
    });
    expect(sourceOnly.travelDiagnostics.days[0]?.sourceOfTravel).toBe("source_fallback");

    const unknown = buildManualGapfillCompareDiagnosticsV1({
      dailyRows: [makeDailyRow("2025-08-14", 8, 95)],
      travelContext: {
        effectiveRanges: [range],
        labDbRanges: [],
        seedPayloadRanges: [],
        sourceFallbackRanges: [],
      },
    });
    expect(unknown.travelDiagnostics.days[0]?.sourceOfTravel).toBe("unknown");
  });

  it("flags overly flat simulated allocation in bill-period flatness score", () => {
    const flatSimRows = Array.from({ length: 10 }, (_, index) =>
      makeDailyRow(`2025-06-${String(8 + index).padStart(2, "0")}`, 90 + index * 5, 95)
    );
    const out = buildManualGapfillCompareDiagnosticsV1({
      dailyRows: flatSimRows,
      monthlyRows: [
        {
          periodId: "2025-06:2025-06-30",
          startDate: "2025-06-08",
          endDate: "2025-06-17",
          actualKwh: 900,
          simulatedKwh: 950,
          deltaKwh: 50,
          percentDelta: 5.56,
          status: "matched",
          actualSource: "SMT",
          simulatedSource: "SIMULATED_MANUAL_CONSTRAINED",
        },
      ],
    });

    expect(out.billPeriodAllocationDiagnostics[0]?.flatnessScore).toBeLessThan(0.55);
    expect(out.billPeriodAllocationDiagnostics[0]?.diagnosticFlags).toContain("manual_period_flat_allocation");
  });

  it("loads validation interval diagnostics only for selected validation days plus top worst by default", () => {
    const validationDay = "2025-07-01";
    const worstDay = "2025-07-10";
    const otherDay = "2025-07-05";
    const actualPattern = Array.from({ length: 96 }, (_, slot) => (slot < 48 ? 0.5 : 2));
    const flatSimPattern = Array.from({ length: 96 }, () => 1);
    const spikySimPattern = Array.from({ length: 96 }, (_, slot) => (slot === 70 ? 5 : 0.5));

    const out = buildManualGapfillCompareDiagnosticsV1({
      dailyRows: [
        makeDailyRow(validationDay, 100, 90),
        makeDailyRow(worstDay, 100, 50),
        makeDailyRow(otherDay, 100, 95),
      ],
      validationDayKeys: [validationDay],
      sourceActualDataset: makeIntervalDataset([validationDay, worstDay, otherDay], actualPattern),
      labDataset: makeIntervalDataset([validationDay, worstDay], {
        [validationDay]: flatSimPattern,
        [worstDay]: spikySimPattern,
      }),
      topWorstDayCount: 1,
    });

    const dates = out.validationIntervalCurveDiagnostics.days.map((day) => day.date);
    expect(dates).toContain(validationDay);
    expect(dates).toContain(worstDay);
    expect(dates).not.toContain(otherDay);
  });

  it("calculates normalized shape error separately from raw interval WAPE", () => {
    const date = "2025-07-01";
    const actualPattern = Array.from({ length: 96 }, (_, slot) => (slot < 48 ? 0.5 : 2));
    const scaledSimPattern = actualPattern.map((value) => value * 0.8);

    const out = buildManualGapfillCompareDiagnosticsV1({
      dailyRows: [makeDailyRow(date, 100, 80)],
      validationDayKeys: [date],
      sourceActualDataset: makeIntervalDataset([date], actualPattern),
      labDataset: makeIntervalDataset([date], scaledSimPattern),
    });

    const day = out.validationIntervalCurveDiagnostics.days[0];
    expect(day?.intervalWape).toBeGreaterThan(0);
    expect(day?.normalizedShapeError).toBeLessThan(0.01);
  });

  it("calculates TOD bucket summary for validation days", () => {
    const date = "2025-07-01";
    const actualPattern = Array.from({ length: 96 }, (_, slot) => {
      if (slot <= 23) return 0.2;
      if (slot <= 47) return 0.5;
      if (slot <= 71) return 1.5;
      return 0.8;
    });
    const simPattern = Array.from({ length: 96 }, (_, slot) => {
      if (slot <= 23) return 0.3;
      if (slot <= 47) return 0.4;
      if (slot <= 71) return 1.2;
      return 1.0;
    });

    const out = buildManualGapfillCompareDiagnosticsV1({
      dailyRows: [makeDailyRow(date, 100, 100)],
      validationDayKeys: [date],
      sourceActualDataset: makeIntervalDataset([date], actualPattern),
      labDataset: makeIntervalDataset([date], simPattern),
    });

    const tod = out.validationIntervalCurveDiagnostics.todBucketSummary;
    expect(tod.overnight.actual).toBeGreaterThan(0);
    expect(tod.morning.actual).toBeGreaterThan(0);
    expect(tod.afternoon.actual).toBeGreaterThan(0);
    expect(tod.evening.actual).toBeGreaterThan(0);
    expect(tod.afternoon.delta).not.toBe(0);
  });

  it("returns likelyCauseTags without changing sim output", () => {
    const out = buildManualGapfillCompareDiagnosticsV1({
      dailyRows: [makeDailyRow("2025-08-14", 8, 95), makeDailyRow("2025-08-20", 95, 94)],
      labManualPayload: monthlySeed,
      travelContext: {
        effectiveRanges: [{ startDate: "2025-08-13", endDate: "2025-08-17" }],
        labDbRanges: [],
        seedPayloadRanges: [{ startDate: "2025-08-13", endDate: "2025-08-17" }],
        sourceFallbackRanges: [],
      },
    });

    expect(out.worstDayDiagnostics.topAbsoluteDailyMisses[0]?.likelyCauseTags).toContain("travel_not_applied");
    expect(out.worstDayDiagnostics.topAbsoluteDailyMisses[0]?.simulatedKwh).toBe(95);
  });
});

describe("MG-4 label cleanup", () => {
  it("adds replacement diagnostics while keeping backward compatibility", () => {
    const labels = buildMg4SourceActualIsolationLabelCleanup({
      usedSourceActualTruthAsContextOnly: true,
      sourceActualUsedForFingerprintGuardrail: true,
    });

    expect(labels.usedSourceActualTruthAsContextOnly).toBe(true);
    expect(labels.usedSourceActualTruthAsContextOnlyDeprecated).toBe(true);
    expect(labels.replacementFields).toContain("sourceActualPassedIntoManualSimulator");
    expect(labels.sourceActualPassedIntoManualSimulator).toBe(false);
    expect(labels.sourceActualPassedIntoManualReadbackProjection).toBe(false);
    expect(labels.sourceActualUsedForSeedOnly).toBe(true);
    expect(labels.sourceActualUsedForFingerprintGuardrail).toBe(true);
  });
});

describe("compare envelope diagnostics wiring", () => {
  it("does not mutate lab simulated rows when building diagnostics", () => {
    const labDaily = [{ date: "2025-07-01", kwh: 90 }];
    const before = labDaily[0]?.kwh;
    const out = buildManualGapfillCompareDiagnosticsV1({
      dailyRows: [makeDailyRow("2025-07-01", 100, 90)],
      validationDayKeys: ["2025-07-01"],
      sourceActualDataset: {
        daily: labDaily,
        dailyWeather: { "2025-07-01": { meanTempF: 85, hdd: 0, cdd: 10 } },
      },
      labDataset: { daily: [{ date: "2025-07-01", kwh: 90 }] },
    });
    expect(labDaily[0]?.kwh).toBe(before);
    expect(out.version).toBe("v1");
  });
});
