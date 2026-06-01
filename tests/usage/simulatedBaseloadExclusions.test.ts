import { describe, expect, it } from "vitest";
import { buildSimulatedUsageDatasetFromCurve } from "@/modules/usageSimulator/dataset";
import { buildSimulatedHomeDateKeysExcludedFromBaseload } from "@/lib/usage/simulatedBaseloadExclusions";
import type { SimulatedCurve } from "@/modules/simulatedUsage/types";

function makeUtcDayIntervals(dayIso: string, kwhPerInterval: number) {
  const out: Array<{ timestamp: string; consumption_kwh: number; interval_minutes: 15 }> = [];
  const start = new Date(`${dayIso}T00:00:00.000Z`);
  for (let i = 0; i < 96; i++) {
    out.push({
      timestamp: new Date(start.getTime() + i * 15 * 60 * 1000).toISOString(),
      consumption_kwh: kwhPerInterval,
      interval_minutes: 15 as const,
    });
  }
  return out;
}

describe("simulatedBaseloadExclusions", () => {
  it("excludes travel/vacant but keeps INCOMPLETE_METER_DAY in 15-min baseload pool", () => {
    const excluded = buildSimulatedHomeDateKeysExcludedFromBaseload([
      { localDate: "2026-05-14", simulatedReasonCode: "INCOMPLETE_METER_DAY" },
      { localDate: "2026-05-15", simulatedReasonCode: "TRAVEL_VACANT" },
    ]);
    expect(excluded?.has("2026-05-14")).toBe(false);
    expect(excluded?.has("2026-05-15")).toBe(true);
  });

  it("computes 15-min baseload when only INCOMPLETE_METER modeled days are present", () => {
    const intervals = [
      ...makeUtcDayIntervals("2026-05-14", 0.5),
      ...makeUtcDayIntervals("2026-05-15", 0.5),
      ...makeUtcDayIntervals("2026-05-16", 0.5),
      ...makeUtcDayIntervals("2026-05-17", 0.5),
      ...makeUtcDayIntervals("2026-05-18", 0.5),
      ...makeUtcDayIntervals("2026-05-19", 0.5),
      ...makeUtcDayIntervals("2026-05-20", 0.5),
      ...makeUtcDayIntervals("2026-05-21", 0.5),
    ];
    const curve: SimulatedCurve = {
      start: "2026-05-14",
      end: "2026-05-21",
      intervals,
      monthlyTotals: [],
      annualTotalKwh: 0,
      meta: { excludedDays: 0, renormalized: false },
    };

    const dataset = buildSimulatedUsageDatasetFromCurve(
      curve,
      { baseKind: "GREEN_BUTTON", mode: "PAST", canonicalEndMonth: "2026-05" },
      {
        homeTimezone: "America/Chicago",
        simulatedDayResults: [
          { localDate: "2026-05-14", simulatedReasonCode: "INCOMPLETE_METER_DAY" },
          { localDate: "2026-05-15", simulatedReasonCode: "INCOMPLETE_METER_DAY" },
          { localDate: "2026-05-16", simulatedReasonCode: "INCOMPLETE_METER_DAY" },
          { localDate: "2026-05-17", simulatedReasonCode: "INCOMPLETE_METER_DAY" },
          { localDate: "2026-05-18", simulatedReasonCode: "INCOMPLETE_METER_DAY" },
          { localDate: "2026-05-19", simulatedReasonCode: "INCOMPLETE_METER_DAY" },
          { localDate: "2026-05-20", simulatedReasonCode: "INCOMPLETE_METER_DAY" },
          { localDate: "2026-05-21", simulatedReasonCode: "INCOMPLETE_METER_DAY" },
        ] as any,
      }
    );

    expect(dataset.insights.baseload).not.toBeNull();
    expect(Number(dataset.insights.baseload)).toBeGreaterThan(0);
    expect(dataset.insights.baseloadMethod).toBe("FILTERED_NORMAL_LIFE_V1");
  });
});
