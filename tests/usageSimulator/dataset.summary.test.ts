import { describe, expect, it } from "vitest";
import { buildSimulatedUsageDatasetFromCurve } from "@/modules/usageSimulator/dataset";
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

describe("usageSimulator dataset summary invariants", () => {
  it("uses final intervals for summary total/count in past-curve builder", () => {
    const intervals = [
      ...makeUtcDayIntervals("2024-01-31", 0.00005),
      ...makeUtcDayIntervals("2024-02-01", 0.00005),
    ];
    const curve: SimulatedCurve = {
      start: "2024-01-31",
      end: "2024-02-01",
      intervals,
      monthlyTotals: [],
      annualTotalKwh: 0,
      meta: { excludedDays: 0, renormalized: false },
    };

    const dataset = buildSimulatedUsageDatasetFromCurve(curve, {
      baseKind: "SMT_ACTUAL_BASELINE",
      mode: "SMT_BASELINE",
      canonicalEndMonth: "2024-02",
    });

    const intervals15 = dataset.series.intervals15 ?? [];
    const sumIntervals = intervals15.reduce((s, r) => s + (Number(r.kwh) || 0), 0);
    const expectedTotal = Math.round(sumIntervals * 100) / 100;
    expect(dataset.summary.totalKwh).toBe(expectedTotal);
    expect(dataset.summary.intervalsCount).toBe(intervals15.length);
    const monthlySum = (dataset.monthly ?? []).reduce((s, m) => s + (Number(m.kwh) || 0), 0);
    expect(Math.abs(monthlySum - dataset.summary.totalKwh)).toBeLessThanOrEqual(0.01);

    const start = new Date(`${dataset.summary.start}T12:00:00.000Z`);
    const end = new Date(`${dataset.summary.end}T12:00:00.000Z`);
    const totalDays = Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)) + 1;
    expect(dataset.summary.intervalsCount).toBe(totalDays * 96);
  });
});
