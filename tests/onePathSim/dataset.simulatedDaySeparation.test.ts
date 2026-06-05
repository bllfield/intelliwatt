import { describe, expect, it } from "vitest";
import { buildSimulatedUsageDatasetFromCurve } from "@/modules/onePathSim/usageSimulator/dataset";
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

describe("onePathSim dataset simulated day separation", () => {
  it("keeps TRAVEL_VACANT simulated on GB trusted home days", () => {
    const intervals = [
      ...makeUtcDayIntervals("2025-06-27", 0.8),
      ...makeUtcDayIntervals("2025-06-28", 0.1),
    ];
    const curve: SimulatedCurve = {
      start: "2025-06-27",
      end: "2025-06-28",
      intervals,
      monthlyTotals: [],
      annualTotalKwh: 0,
      meta: { excludedDays: 0, renormalized: false },
    };
    const dataset = buildSimulatedUsageDatasetFromCurve(
      curve,
      {
        baseKind: "SMT_ACTUAL_BASELINE",
        mode: "SMT_BASELINE",
        canonicalEndMonth: "2025-06",
      },
      {
        greenButtonTrustedHomeDateKeys: new Set(["2025-06-27", "2025-06-28"]),
        simulatedDayResults: [
          { localDate: "2025-06-27", displayDayKwh: 52.4, simulatedReasonCode: "TRAVEL_VACANT" } as any,
          { localDate: "2025-06-28", displayDayKwh: 48.1, simulatedReasonCode: "TRAVEL_VACANT" } as any,
        ],
      }
    );
    const byDate = new Map(dataset.daily.map((row) => [row.date, row]));
    expect(byDate.get("2025-06-27")).toMatchObject({
      source: "SIMULATED",
      sourceDetail: "SIMULATED_TRAVEL_VACANT",
      kwh: 52.4,
    });
    expect(byDate.get("2025-06-28")).toMatchObject({
      source: "SIMULATED",
      sourceDetail: "SIMULATED_TRAVEL_VACANT",
      kwh: 48.1,
    });
    expect(dataset.meta.simulatedTravelVacantDateKeysLocal).toEqual(["2025-06-27", "2025-06-28"]);
  });
});
