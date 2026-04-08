import { describe, expect, it } from "vitest";
import { buildPastSimulatedBaselineV1 } from "@/modules/simulatedUsage/engine";
import { dateKeyFromTimestamp, getDayGridTimestamps } from "@/modules/usageSimulator/pastStitchedCurve";
import {
  buildPastDaySimulationContext,
  simulatePastDay,
  WEATHER_SCALED_PROFILE_ANCHOR_FRAC,
} from "@/modules/simulatedUsage/pastDaySimulator";
import type { PastDayTrainingWeatherStats } from "@/modules/simulatedUsage/pastDaySimulatorTypes";

function fixedGrid(day: string): string[] {
  const start = new Date(`${day}T00:00:00.000Z`).getTime();
  return Array.from({ length: 96 }, (_, i) => new Date(start + i * 15 * 60 * 1000).toISOString());
}

function trainingStats(): PastDayTrainingWeatherStats {
  return {
    byMonthDaytype: new Map([["2026-01:wd", { avgDayKwh: 20, avgHdd: 10, avgCdd: 0.5, count: 20 }]]),
    bySeasonDaytype: new Map([["winter:wd", { avgDayKwh: 18, avgHdd: 9, avgCdd: 0.5, count: 40 }]]),
    global: {
      avgDayKwhWd: 18,
      avgDayKwhWe: 16,
      avgHddWd: 8,
      avgHddWe: 8,
      avgCddWd: 1,
      avgCddWe: 1,
      countWd: 80,
      countWe: 32,
    },
  };
}

describe("pastDaySimulator Phase 1 temperature-primary day totals (Section 21)", () => {
  it("responds to temperature severity: higher HDD vs reference increases modeled day kWh when heating-dominant", () => {
    const context = buildPastDaySimulationContext({
      profile: {
        monthKeys: ["2026-01"],
        avgKwhPerDayWeekdayByMonth: [20],
        avgKwhPerDayWeekendByMonth: [18],
        weekdayCountByMonth: { "2026-01": 25 },
        weekendCountByMonth: { "2026-01": 6 },
        monthOverallAvgByMonth: { "2026-01": 19.5 },
        monthOverallCountByMonth: { "2026-01": 31 },
      },
      trainingWeatherStats: trainingStats(),
      weatherByDateKey: new Map(),
    });

    const cold = simulatePastDay(
      {
        localDate: "2026-01-10",
        isWeekend: false,
        gridTimestamps: fixedGrid("2026-01-10"),
        weatherForDay: {
          dailyAvgTempC: -5,
          dailyMinTempC: -10,
          dailyMaxTempC: 0,
          heatingDegreeSeverity: 28,
          coolingDegreeSeverity: 0,
          freezeHoursCount: 8,
        },
      },
      context
    );
    const mild = simulatePastDay(
      {
        localDate: "2026-01-11",
        isWeekend: false,
        gridTimestamps: fixedGrid("2026-01-11"),
        weatherForDay: {
          dailyAvgTempC: 8,
          dailyMinTempC: 4,
          dailyMaxTempC: 12,
          heatingDegreeSeverity: 6,
          coolingDegreeSeverity: 0,
          freezeHoursCount: 0,
        },
      },
      context
    );

    expect(cold.dayClassification).toBe("weather_scaled_day");
    expect(mild.dayClassification).toBe("weather_scaled_day");
    expect(cold.weatherModeUsed).toBe("heating");
    expect(mild.weatherModeUsed).toBe("heating");
    expect(cold.finalDayKwh).toBeGreaterThan(mild.finalDayKwh);
  });

  it("for weather_scaled_day, final total is closer to temperature-adjusted pre-blend than to profile alone", () => {
    const context = buildPastDaySimulationContext({
      profile: {
        monthKeys: ["2026-01"],
        avgKwhPerDayWeekdayByMonth: [20],
        avgKwhPerDayWeekendByMonth: [18],
        weekdayCountByMonth: { "2026-01": 25 },
        weekendCountByMonth: { "2026-01": 6 },
        monthOverallAvgByMonth: { "2026-01": 19.5 },
        monthOverallCountByMonth: { "2026-01": 31 },
      },
      trainingWeatherStats: trainingStats(),
      weatherByDateKey: new Map(),
    });
    const result = simulatePastDay(
      {
        localDate: "2026-01-15",
        isWeekend: false,
        gridTimestamps: fixedGrid("2026-01-15"),
        weatherForDay: {
          dailyAvgTempC: -2,
          dailyMinTempC: -6,
          dailyMaxTempC: 2,
          heatingDegreeSeverity: 22,
          coolingDegreeSeverity: 0,
          freezeHoursCount: 4,
        },
      },
      context
    );
    expect(result.dayClassification).toBe("weather_scaled_day");
    const base = result.profileSelectedDayKwh;
    const pre = result.preBlendAdjustedDayKwh ?? result.weatherAdjustedDayKwh;
    const fin = result.finalDayKwh;
    const distPre = Math.abs(fin - pre);
    const distBase = Math.abs(fin - base);
    expect(distPre).toBeLessThan(distBase);
    const expectedBlend =
      base * WEATHER_SCALED_PROFILE_ANCHOR_FRAC + pre * (1 - WEATHER_SCALED_PROFILE_ANCHOR_FRAC);
    expect(fin).toBeCloseTo(expectedBlend, 8);
  });

  it("keeps explicit weekday vs weekend profile separation in target day kWh before weather", () => {
    const context = buildPastDaySimulationContext({
      profile: {
        monthKeys: ["2026-01"],
        avgKwhPerDayWeekdayByMonth: [24],
        avgKwhPerDayWeekendByMonth: [10],
        weekdayCountByMonth: { "2026-01": 22 },
        weekendCountByMonth: { "2026-01": 9 },
        monthOverallAvgByMonth: { "2026-01": 20 },
        monthOverallCountByMonth: { "2026-01": 31 },
      },
      trainingWeatherStats: null,
      weatherByDateKey: new Map(),
    });
    const wd = simulatePastDay(
      {
        localDate: "2026-01-06",
        isWeekend: false,
        gridTimestamps: fixedGrid("2026-01-06"),
        weatherForDay: null,
      },
      context
    );
    const we = simulatePastDay(
      {
        localDate: "2026-01-07",
        isWeekend: true,
        gridTimestamps: fixedGrid("2026-01-07"),
        weatherForDay: null,
      },
      context
    );
    expect(wd.targetDayKwhBeforeWeather).toBe(24);
    expect(we.targetDayKwhBeforeWeather).toBe(10);
    expect(wd.dayTypeUsed).toBe("weekday");
    expect(we.dayTypeUsed).toBe("weekend");
  });

  it("leaves 96 interval energy subordinate: shape sums to the modeled day total", () => {
    const context = buildPastDaySimulationContext({
      profile: {
        monthKeys: ["2026-01"],
        avgKwhPerDayWeekdayByMonth: [15],
        avgKwhPerDayWeekendByMonth: [14],
        weekdayCountByMonth: { "2026-01": 22 },
        weekendCountByMonth: { "2026-01": 8 },
        monthOverallAvgByMonth: { "2026-01": 14.5 },
        monthOverallCountByMonth: { "2026-01": 30 },
      },
      trainingWeatherStats: trainingStats(),
      weatherByDateKey: new Map(),
    });
    const result = simulatePastDay(
      {
        localDate: "2026-01-20",
        isWeekend: false,
        gridTimestamps: fixedGrid("2026-01-20"),
        weatherForDay: {
          dailyAvgTempC: 0,
          dailyMinTempC: -4,
          dailyMaxTempC: 4,
          heatingDegreeSeverity: 15,
          coolingDegreeSeverity: 0,
          freezeHoursCount: 2,
        },
      },
      context
    );
    expect(result.intervalSumKwh).toBeCloseTo(result.finalDayKwh, 8);
  });

  it("uses bounded post-donor weather fine-tuning after weather-first donor selection", () => {
    const context = buildPastDaySimulationContext({
      profile: {
        monthKeys: ["2026-01", "2026-02"],
        avgKwhPerDayWeekdayByMonth: [14, 14],
        avgKwhPerDayWeekendByMonth: [12, 12],
        weekdayCountByMonth: { "2026-01": 20, "2026-02": 20 },
        weekendCountByMonth: { "2026-01": 8, "2026-02": 8 },
        monthOverallAvgByMonth: { "2026-01": 13.5, "2026-02": 13.5 },
        monthOverallCountByMonth: { "2026-01": 28, "2026-02": 28 },
      },
      trainingWeatherStats: trainingStats(),
      weatherByDateKey: new Map(),
      modeledDaySelectionStrategy: "weather_donor_first",
      weatherDonorSamples: [
        {
          localDate: "2026-02-01",
          monthKey: "2026-02",
          dayType: "weekday",
          weatherRegime: "heating",
          dayKwh: 30,
          dailyAvgTempC: -1,
          dailyMinTempC: -6,
          dailyMaxTempC: 4,
          tempSpreadC: 10,
          heatingDegreeSeverity: 20,
          coolingDegreeSeverity: 0,
        },
        {
          localDate: "2026-01-22",
          monthKey: "2026-01",
          dayType: "weekday",
          weatherRegime: "heating",
          dayKwh: 28,
          dailyAvgTempC: 1,
          dailyMinTempC: -4,
          dailyMaxTempC: 6,
          tempSpreadC: 10,
          heatingDegreeSeverity: 18,
          coolingDegreeSeverity: 0,
        },
        {
          localDate: "2026-01-24",
          monthKey: "2026-01",
          dayType: "weekday",
          weatherRegime: "heating",
          dayKwh: 27,
          dailyAvgTempC: 2,
          dailyMinTempC: -3,
          dailyMaxTempC: 7,
          tempSpreadC: 10,
          heatingDegreeSeverity: 17,
          coolingDegreeSeverity: 0,
        },
      ],
    });
    const result = simulatePastDay(
      {
        localDate: "2026-02-08",
        isWeekend: false,
        gridTimestamps: fixedGrid("2026-02-08"),
        weatherForDay: {
          dailyAvgTempC: -3,
          dailyMinTempC: -8,
          dailyMaxTempC: 2,
          heatingDegreeSeverity: 24,
          coolingDegreeSeverity: 0,
          freezeHoursCount: 2,
        },
      },
      context
    );
    const multiplier = result.finalDayKwh / Math.max(result.targetDayKwhBeforeWeather ?? 1, 1);
    expect(result.donorSelectionModeUsed).toBe("weather_nearest_daytype_regime");
    expect(result.weatherAdjustmentModeUsed).toBe("bounded_post_donor");
    expect(multiplier).toBeGreaterThan(0.92);
    expect(multiplier).toBeLessThan(1.1);
  });
});

describe("buildPastSimulatedBaselineV1 shared simulatePastDay for travel vs keep-ref modeled days", () => {
  it("uses the same simulated-day core for excluded travel days and gapfill keep-ref modeled days", () => {
    const d1 = new Date("2026-04-01T00:00:00.000Z").getTime();
    const d2 = new Date("2026-04-02T00:00:00.000Z").getTime();
    const d3 = new Date("2026-04-03T00:00:00.000Z").getTime();
    const d4 = new Date("2026-04-04T00:00:00.000Z").getTime();
    const g1 = getDayGridTimestamps(d1);
    const g2 = getDayGridTimestamps(d2);
    const g3 = getDayGridTimestamps(d3);
    const g4 = getDayGridTimestamps(d4);

    const mkFull = (grid: string[], k: number) => grid.map((ts) => ({ timestamp: ts, kwh: k }));
    const actualIntervals = [...mkFull(g1, 0.4), ...mkFull(g2, 0.5), ...mkFull(g3, 0.45), ...mkFull(g4, 0.42)];

    const wx = (hdd: number) =>
      ({ tAvgF: 45, tMinF: 35, tMaxF: 55, hdd65: hdd, cdd65: 0 }) as const;

    const out = buildPastSimulatedBaselineV1({
      actualIntervals,
      canonicalDayStartsMs: [d1, d2, d3, d4],
      excludedDateKeys: new Set<string>(["2026-04-02"]),
      dateKeyFromTimestamp,
      getDayGridTimestamps,
      collectSimulatedDayResults: true,
      forceModeledOutputKeepReferencePoolDateKeys: new Set<string>(["2026-04-04"]),
      emitAllIntervals: false,
      actualWxByDateKey: new Map([
        ["2026-04-01", wx(12)],
        ["2026-04-02", wx(14)],
        ["2026-04-03", wx(11)],
        ["2026-04-04", wx(13)],
      ]),
    });

    const travel = out.dayResults.find((r) => r.localDate === "2026-04-02");
    const keepRef = out.dayResults.find((r) => r.localDate === "2026-04-04");
    expect(travel?.source).toBe("simulated_vacant_day");
    expect(keepRef?.source).toBe("simulated_vacant_day");
    expect(travel?.fallbackLevel).toBeTruthy();
    expect(keepRef?.fallbackLevel).toBeTruthy();
    expect(["weekday", "weekend"]).toContain(travel?.dayTypeUsed);
    expect(["weekday", "weekend"]).toContain(keepRef?.dayTypeUsed);
  });
});
