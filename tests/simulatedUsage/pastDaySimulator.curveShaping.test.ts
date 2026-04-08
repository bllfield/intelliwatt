import { describe, expect, it } from "vitest";
import { buildPastDaySimulationContext, simulatePastDay } from "@/modules/simulatedUsage/pastDaySimulator";
import type { PastDayTrainingWeatherStats } from "@/modules/simulatedUsage/pastDaySimulatorTypes";

function fixedGrid(day: string): string[] {
  const start = new Date(`${day}T00:00:00.000Z`).getTime();
  return Array.from({ length: 96 }, (_, i) => new Date(start + i * 15 * 60 * 1000).toISOString());
}

function makeTrainingStats(): PastDayTrainingWeatherStats {
  return {
    byMonthDaytype: new Map([["2026-01:wd", { avgDayKwh: 18, avgHdd: 5, avgCdd: 1, count: 12 }]]),
    bySeasonDaytype: new Map([["winter:wd", { avgDayKwh: 16, avgHdd: 4, avgCdd: 0.5, count: 30 }]]),
    global: {
      avgDayKwhWd: 15,
      avgDayKwhWe: 14,
      avgHddWd: 4,
      avgHddWe: 4,
      avgCddWd: 1,
      avgCddWe: 1,
      countWd: 100,
      countWe: 40,
    },
  };
}

describe("pastDaySimulator shared curve shaping", () => {
  it("prefers weather-similar donors before broader calendar fallbacks", () => {
    const context = buildPastDaySimulationContext({
      profile: {
        monthKeys: ["2026-01", "2026-02"],
        avgKwhPerDayWeekdayByMonth: [11, 12],
        avgKwhPerDayWeekendByMonth: [9, 10],
        weekdayCountByMonth: { "2026-01": 18, "2026-02": 18 },
        weekendCountByMonth: { "2026-01": 8, "2026-02": 8 },
        monthOverallAvgByMonth: { "2026-01": 10.5, "2026-02": 11.5 },
        monthOverallCountByMonth: { "2026-01": 26, "2026-02": 26 },
      },
      trainingWeatherStats: makeTrainingStats(),
      weatherByDateKey: new Map(),
      modeledDaySelectionStrategy: "weather_donor_first",
      weatherDonorSamples: [
        {
          localDate: "2026-02-10",
          monthKey: "2026-02",
          dayType: "weekday",
          weatherRegime: "cooling",
          dayKwh: 42,
          dailyAvgTempC: 34,
          dailyMinTempC: 29,
          dailyMaxTempC: 40,
          tempSpreadC: 11,
          heatingDegreeSeverity: 0,
          coolingDegreeSeverity: 18,
        },
        {
          localDate: "2026-01-12",
          monthKey: "2026-01",
          dayType: "weekday",
          weatherRegime: "cooling",
          dayKwh: 24,
          dailyAvgTempC: 28,
          dailyMinTempC: 24,
          dailyMaxTempC: 33,
          tempSpreadC: 9,
          heatingDegreeSeverity: 0,
          coolingDegreeSeverity: 9,
        },
        {
          localDate: "2026-01-08",
          monthKey: "2026-01",
          dayType: "weekday",
          weatherRegime: "cooling",
          dayKwh: 20,
          dailyAvgTempC: 26,
          dailyMinTempC: 21,
          dailyMaxTempC: 31,
          tempSpreadC: 10,
          heatingDegreeSeverity: 0,
          coolingDegreeSeverity: 7,
        },
        {
          localDate: "2026-01-05",
          monthKey: "2026-01",
          dayType: "weekday",
          weatherRegime: "heating",
          dayKwh: 17,
          dailyAvgTempC: 2,
          dailyMinTempC: -3,
          dailyMaxTempC: 7,
          tempSpreadC: 10,
          heatingDegreeSeverity: 16,
          coolingDegreeSeverity: 0,
        },
      ],
    });
    const result = simulatePastDay(
      {
        localDate: "2026-02-20",
        isWeekend: false,
        gridTimestamps: fixedGrid("2026-02-20"),
        weatherForDay: {
          dailyAvgTempC: 35,
          dailyMinTempC: 30,
          dailyMaxTempC: 41,
          heatingDegreeSeverity: 0,
          coolingDegreeSeverity: 19,
          freezeHoursCount: 0,
        },
      },
      context
    );
    expect(result.fallbackLevel).toBe("weather_nearest_daytype_regime");
    expect(result.donorSelectionModeUsed).toBe("weather_nearest_daytype_regime");
    expect(result.donorWeatherRegimeUsed).toBe("cooling");
    expect(result.selectedDonorLocalDates).toContain("2026-02-10");
    expect(result.selectedDonorWeights?.length).toBe(3);
    expect((result.selectedDonorWeights ?? []).reduce((sum, entry) => sum + entry.weight, 0)).toBeCloseTo(1, 6);
    expect(result.sameRegimeDonorPoolAvailable).toBe(true);
    expect(result.broadFallbackUsed).toBe(false);
    expect(result.targetDayKwhBeforeWeather).toBeGreaterThan(19);
    expect(result.selectedFingerprintBucketMonth).toBe("2026-02");
  });

  it("dampens noisy donor pools back toward the donor median when variance is high", () => {
    const context = buildPastDaySimulationContext({
      profile: {
        monthKeys: ["2026-06"],
        avgKwhPerDayWeekdayByMonth: [20],
        avgKwhPerDayWeekendByMonth: [16],
        weekdayCountByMonth: { "2026-06": 22 },
        weekendCountByMonth: { "2026-06": 8 },
        monthOverallAvgByMonth: { "2026-06": 19 },
        monthOverallCountByMonth: { "2026-06": 30 },
      },
      trainingWeatherStats: makeTrainingStats(),
      weatherByDateKey: new Map(),
      modeledDaySelectionStrategy: "weather_donor_first",
      weatherDonorSamples: [
        {
          localDate: "2026-06-07",
          monthKey: "2026-06",
          dayType: "weekend",
          weatherRegime: "cooling",
          dayKwh: 18,
          dailyAvgTempC: 31,
          dailyMinTempC: 25,
          dailyMaxTempC: 37,
          tempSpreadC: 12,
          heatingDegreeSeverity: 0,
          coolingDegreeSeverity: 16,
        },
        {
          localDate: "2026-06-14",
          monthKey: "2026-06",
          dayType: "weekend",
          weatherRegime: "cooling",
          dayKwh: 42,
          dailyAvgTempC: 32,
          dailyMinTempC: 26,
          dailyMaxTempC: 38,
          tempSpreadC: 12,
          heatingDegreeSeverity: 0,
          coolingDegreeSeverity: 17,
        },
        {
          localDate: "2026-06-21",
          monthKey: "2026-06",
          dayType: "weekend",
          weatherRegime: "cooling",
          dayKwh: 20,
          dailyAvgTempC: 30,
          dailyMinTempC: 24,
          dailyMaxTempC: 36,
          tempSpreadC: 12,
          heatingDegreeSeverity: 0,
          coolingDegreeSeverity: 15,
        },
      ],
    });
    const result = simulatePastDay(
      {
        localDate: "2026-06-28",
        isWeekend: true,
        gridTimestamps: fixedGrid("2026-06-28"),
        weatherForDay: {
          dailyAvgTempC: 31,
          dailyMinTempC: 25,
          dailyMaxTempC: 37,
          heatingDegreeSeverity: 0,
          coolingDegreeSeverity: 16,
          freezeHoursCount: 0,
        },
      },
      context
    );
    expect(result.donorVarianceGuardrailTriggered).toBe(true);
    expect(result.donorPoolBlendStrategy).toBe("variance_dampened_blend");
    expect(result.donorPoolMedianKwh).toBe(20);
    expect(result.targetDayKwhBeforeWeather).toBeLessThan(30);
    expect(result.targetDayKwhBeforeWeather).toBeGreaterThan(19);
  });

  it("uses neighboring actual day totals before month average fallback", () => {
    const context = buildPastDaySimulationContext({
      profile: {
        monthKeys: ["2026-01"],
        avgKwhPerDayWeekdayByMonth: [10],
        avgKwhPerDayWeekendByMonth: [8],
        weekdayCountByMonth: { "2026-01": 20 },
        weekendCountByMonth: { "2026-01": 8 },
        monthOverallAvgByMonth: { "2026-01": 9.5 },
        monthOverallCountByMonth: { "2026-01": 28 },
      },
      trainingWeatherStats: null,
      weatherByDateKey: new Map(),
      neighborDayTotals: {
        weekdayByMonth: {
          "2026-01": [
            { localDate: "2026-01-13", dayOfMonth: 13, dayKwh: 18 },
            { localDate: "2026-01-14", dayOfMonth: 14, dayKwh: 19 },
            { localDate: "2026-01-16", dayOfMonth: 16, dayKwh: 17 },
          ],
        },
      },
    });
    const result = simulatePastDay(
      {
        localDate: "2026-01-15",
        isWeekend: false,
        gridTimestamps: fixedGrid("2026-01-15"),
        weatherForDay: null,
      },
      context
    );
    expect(result.fallbackLevel).toBe("month_daytype_neighbor");
    expect(result.targetDayKwhBeforeWeather).toBeGreaterThan(16);
    expect(result.targetDayKwhBeforeWeather).toBeLessThan(20);
  });

  it("falls back to calendar ladders when weather-similar donor evidence is too thin", () => {
    const context = buildPastDaySimulationContext({
      profile: {
        monthKeys: ["2026-01"],
        avgKwhPerDayWeekdayByMonth: [16],
        avgKwhPerDayWeekendByMonth: [12],
        weekdayCountByMonth: { "2026-01": 20 },
        weekendCountByMonth: { "2026-01": 8 },
        monthOverallAvgByMonth: { "2026-01": 15 },
        monthOverallCountByMonth: { "2026-01": 28 },
      },
      trainingWeatherStats: makeTrainingStats(),
      weatherByDateKey: new Map(),
      modeledDaySelectionStrategy: "weather_donor_first",
      weatherDonorSamples: [
        {
          localDate: "2026-01-04",
          monthKey: "2026-01",
          dayType: "weekday",
          weatherRegime: "cooling",
          dayKwh: 30,
          dailyAvgTempC: 31,
          dailyMinTempC: 26,
          dailyMaxTempC: 37,
          tempSpreadC: 11,
          heatingDegreeSeverity: 0,
          coolingDegreeSeverity: 14,
        },
        {
          localDate: "2026-01-06",
          monthKey: "2026-01",
          dayType: "weekday",
          weatherRegime: "cooling",
          dayKwh: 28,
          dailyAvgTempC: 29,
          dailyMinTempC: 24,
          dailyMaxTempC: 34,
          tempSpreadC: 10,
          heatingDegreeSeverity: 0,
          coolingDegreeSeverity: 12,
        },
      ],
    });
    const result = simulatePastDay(
      {
        localDate: "2026-01-18",
        isWeekend: false,
        gridTimestamps: fixedGrid("2026-01-18"),
        weatherForDay: {
          dailyAvgTempC: 33,
          dailyMinTempC: 28,
          dailyMaxTempC: 38,
          heatingDegreeSeverity: 0,
          coolingDegreeSeverity: 16,
          freezeHoursCount: 0,
        },
      },
      context
    );
    expect(result.donorSelectionModeUsed).toBe("calendar_fallback");
    expect(result.fallbackLevel).toBe("month_daytype");
    expect(result.broadFallbackUsed).toBe(true);
    expect(result.sameRegimeDonorPoolAvailable).toBe(false);
    expect(result.targetDayKwhBeforeWeather).toBe(16);
  });

  it("selects weather/daytype/month 96-shape variant and emits diagnostics", () => {
    const heatingShape = Array.from({ length: 96 }, (_, i) => (i === 0 ? 1 : 0));
    const neutralShape = Array.from({ length: 96 }, () => 1 / 96);
    const context = buildPastDaySimulationContext({
      profile: {
        monthKeys: ["2026-01"],
        avgKwhPerDayWeekdayByMonth: [12],
        avgKwhPerDayWeekendByMonth: [10],
        weekdayCountByMonth: { "2026-01": 20 },
        weekendCountByMonth: { "2026-01": 8 },
        monthOverallAvgByMonth: { "2026-01": 11.5 },
        monthOverallCountByMonth: { "2026-01": 28 },
      },
      trainingWeatherStats: makeTrainingStats(),
      weatherByDateKey: new Map(),
      shapeVariants: {
        byMonthWeatherDayType96: {
          "2026-01": {
            weekday: { heating: heatingShape, neutral: neutralShape },
          },
        },
      },
    });
    const result = simulatePastDay(
      {
        localDate: "2026-01-15",
        isWeekend: false,
        gridTimestamps: fixedGrid("2026-01-15"),
        weatherForDay: {
          dailyAvgTempC: -2,
          dailyMinTempC: -5,
          dailyMaxTempC: 1,
          heatingDegreeSeverity: 20,
          coolingDegreeSeverity: 0,
          freezeHoursCount: 10,
        },
      },
      context
    );
    expect(result.dayTypeUsed).toBe("weekday");
    expect(result.shapeVariantUsed).toContain("month_weekday_weather_heating");
    expect(result.intervals[0]!.kwh).toBeGreaterThan(result.intervals[95]!.kwh);
    expect(result.finalDayKwh).toBeGreaterThan(0);
    expect(result.weatherAdjustedDayKwh).toBeGreaterThan(0);
    expect(result.intervalSumKwh).toBeCloseTo(result.finalDayKwh, 8);
  });
});
