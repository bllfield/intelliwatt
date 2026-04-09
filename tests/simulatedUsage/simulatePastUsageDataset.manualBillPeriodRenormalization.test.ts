import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { renormalizeManualBillPeriodIntervals } from "@/modules/simulatedUsage/simulatePastUsageDataset";

describe("manual bill-period renormalization", () => {
  it("forces eligible manual bill periods back to the exact entered totals", () => {
    const jan1 = Array.from({ length: 96 }, (_, idx) => ({
      timestamp: new Date(Date.UTC(2026, 0, 1, 0, idx * 15)).toISOString(),
      kwh: 60 / 96,
    }));
    const jan2 = Array.from({ length: 96 }, (_, idx) => ({
      timestamp: new Date(Date.UTC(2026, 0, 2, 0, idx * 15)).toISOString(),
      kwh: 60 / 96,
    }));
    const patchedIntervals = [...jan1, ...jan2];
    const dayResults = [
      {
        localDate: "2026-01-01",
        source: "simulated_vacant_day" as const,
        simulatedReasonCode: "MONTHLY_CONSTRAINED_NON_TRAVEL_DAY" as const,
        intervals: [...jan1],
        intervals15: jan1.map((row) => row.kwh),
        intervalSumKwh: 60,
        displayDayKwh: 60,
        rawDayKwh: 60,
        weatherAdjustedDayKwh: 60,
        profileSelectedDayKwh: 60,
        finalDayKwh: 60,
        weatherSeverityMultiplier: 1,
        weatherModeUsed: "neutral" as const,
        auxHeatKwhAdder: 0,
        poolFreezeProtectKwhAdder: 0,
        dayClassification: "weather_scaled_day" as const,
        fallbackLevel: "month_daytype_neighbor" as const,
        clampApplied: false,
        shape96Used: Array.from({ length: 96 }, () => 1 / 96),
      },
      {
        localDate: "2026-01-02",
        source: "simulated_vacant_day" as const,
        simulatedReasonCode: "MONTHLY_CONSTRAINED_NON_TRAVEL_DAY" as const,
        intervals: [...jan2],
        intervals15: jan2.map((row) => row.kwh),
        intervalSumKwh: 60,
        displayDayKwh: 60,
        rawDayKwh: 60,
        weatherAdjustedDayKwh: 60,
        profileSelectedDayKwh: 60,
        finalDayKwh: 60,
        weatherSeverityMultiplier: 1,
        weatherModeUsed: "neutral" as const,
        auxHeatKwhAdder: 0,
        poolFreezeProtectKwhAdder: 0,
        dayClassification: "weather_scaled_day" as const,
        fallbackLevel: "month_daytype_neighbor" as const,
        clampApplied: false,
        shape96Used: Array.from({ length: 96 }, () => 1 / 96),
      },
    ];
    const firstDayIntervalsRef = dayResults[0]!.intervals;
    const firstDayInterval0Ref = dayResults[0]!.intervals[0];
    const firstDayIntervals15Ref = dayResults[0]!.intervals15;

    renormalizeManualBillPeriodIntervals({
      patchedIntervals,
      dayResults,
      manualBillPeriods: [
        {
          id: "bill-1",
          startDate: "2026-01-01",
          endDate: "2026-01-02",
          eligibleForConstraint: true,
        },
      ],
      manualBillPeriodTotalsKwhById: { "bill-1": 100 },
      timezone: "UTC",
    });

    const total = patchedIntervals.reduce((sum, interval) => sum + interval.kwh, 0);
    expect(total).toBeCloseTo(100, 6);
    expect(dayResults.map((row) => Number(row.finalDayKwh))).toSatisfy((values: number[]) => values.every((value) => Math.abs(value - 50) < 1e-6));
    expect(dayResults.map((row) => Number(row.displayDayKwh))).toEqual([50, 50]);
    expect(dayResults[0]!.intervals).toBe(firstDayIntervalsRef);
    expect(dayResults[0]!.intervals[0]).toBe(firstDayInterval0Ref);
    expect(dayResults[0]!.intervals15).toBe(firstDayIntervals15Ref);
  });
});
