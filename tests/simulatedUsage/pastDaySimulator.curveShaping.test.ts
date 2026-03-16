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
