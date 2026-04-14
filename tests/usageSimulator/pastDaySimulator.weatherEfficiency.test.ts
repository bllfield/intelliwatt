import { describe, expect, it } from "vitest";
import { simulatePastDay } from "@/modules/simulatedUsage/pastDaySimulator";
import type { PastDaySimulationContext } from "@/modules/simulatedUsage/pastDaySimulatorTypes";

function buildContext(
  weatherEfficiencyDerivedInput: NonNullable<PastDaySimulationContext["weatherEfficiencyDerivedInput"]>
): PastDaySimulationContext {
  return {
    profile: {
      monthKeys: ["2026-07"],
      avgKwhPerDayWeekdayByMonth: [30],
      avgKwhPerDayWeekendByMonth: [32],
      weekdayCountByMonth: { "2026-07": 10 },
      weekendCountByMonth: { "2026-07": 8 },
      monthOverallAvgByMonth: { "2026-07": 31 },
      monthOverallCountByMonth: { "2026-07": 18 },
    },
    trainingWeatherStats: null,
    weatherByDateKey: new Map(),
    neighborDayTotals: null,
    weatherDonorSamples: null,
    modeledDaySelectionStrategy: "calendar_first",
    shapeVariants: {
      byMonthWeatherDayType96: {
        "2026-07": {
          weekday: {
            cooling: Array.from({ length: 96 }, (_, index) => (index >= 52 && index <= 72 ? 2 : 0.6)),
          },
        },
      },
    },
    lowDataSyntheticDayKwhByMonthDayType: {
      "2026-07": {
        weekday: 30,
        weekend: 32,
      },
    },
    lowDataWeatherEvidence: {
      inputMonthKeys: ["2026-07"],
      missingMonthKeys: [],
      explicitTravelRangesUsed: [],
      eligibleBillPeriodsUsed: [],
      excludedTravelTouchedBillPeriods: [],
      monthlyWeatherPressureInputsUsed: [],
      evidenceWeight: 1,
      wholeHomePriorFallbackWeight: 0,
      baseloadShare: 0.45,
      hvacShare: 0.55,
      heatingSensitivity: 0.25,
      coolingSensitivity: 1.2,
      dailyWeatherResponsiveness: "weather_driven",
      byMonth: {
        "2026-07": {
          monthKey: "2026-07",
          targetAvgDailyKwh: 30,
          evidenceSource: "eligible_bill_period",
          drivingBillPeriodIds: ["bp-1"],
          eligibleNonTravelDayCount: 30,
          excludedTravelDayCount: 0,
          eligibleBillPeriodCount: 1,
          excludedTravelTouchedBillPeriodCount: 0,
          baseloadShare: 0.45,
          hvacShare: 0.55,
          heatingSensitivity: 0.25,
          coolingSensitivity: 1.2,
          referenceDailyHdd: 0,
          referenceDailyCdd: 8,
          referenceAvgTempC: 28,
        },
      },
    },
    weatherEfficiencyDerivedInput,
  };
}

describe("shared weather-efficiency sim modifier", () => {
  it("compresses manual billing-period amplitude relative to interval-backed mode", () => {
    const baseDerivedInput = {
      derivedInputAttached: true as const,
      simulationActive: true,
      weatherEfficiencyScore0to100: 78,
      coolingSensitivityScore0to100: 81,
      heatingSensitivityScore0to100: 39,
      confidenceScore0to100: 72,
      shoulderBaselineKwhPerDay: 14,
      coolingSlopeKwhPerCDD: 1.8,
      heatingSlopeKwhPerHDD: 0.7,
      coolingResponseRatio: 1.18,
      heatingResponseRatio: 0.62,
      estimatedWeatherDrivenLoadShare: 0.52,
      estimatedBaseloadShare: 0.48,
      requiredInputAdjustmentsApplied: [],
      poolAdjustmentApplied: false,
      hvacAdjustmentApplied: true,
      occupancyAdjustmentApplied: false,
      thermostatAdjustmentApplied: true,
      scoreVersion: "test",
      calculationVersion: "test",
    };
    const request = {
      localDate: "2026-07-15",
      isWeekend: false,
      gridTimestamps: Array.from({ length: 96 }, (_, index) => new Date(Date.UTC(2026, 6, 15, 0, index * 15)).toISOString()),
      weatherForDay: {
        dailyAvgTempC: 33,
        dailyMinTempC: 27,
        dailyMaxTempC: 39,
        heatingDegreeSeverity: 0,
        coolingDegreeSeverity: 18,
        freezeHoursCount: 0,
      },
    };

    const intervalResult = simulatePastDay(request, buildContext({ ...baseDerivedInput, scoringMode: "INTERVAL_BASED" }));
    const billingResult = simulatePastDay(request, buildContext({ ...baseDerivedInput, scoringMode: "BILLING_PERIOD_BASED" }));

    expect(intervalResult.weatherEfficiencyApplied).toBe(true);
    expect(billingResult.weatherEfficiencyApplied).toBe(true);
    expect(intervalResult.weatherShapingMode).toBe("interval_based_shared_modifier");
    expect(billingResult.weatherShapingMode).toBe("billing_period_compressed_shared_modifier");
    expect((billingResult.weatherAmplitudeCompressionFactor ?? 1)).toBeLessThan(intervalResult.weatherAmplitudeCompressionFactor ?? 1);
    expect(Math.abs((billingResult.finalDayKwh ?? 0) - 30)).toBeLessThan(Math.abs((intervalResult.finalDayKwh ?? 0) - 30));
  });
});
