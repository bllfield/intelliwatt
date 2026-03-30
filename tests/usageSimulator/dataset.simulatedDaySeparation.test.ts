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

describe("dataset simulated day separation", () => {
  it("keeps travel/vacant simulation distinct from test-day modeled simulation", () => {
    const intervals = [
      ...makeUtcDayIntervals("2025-08-10", 0.1),
      ...makeUtcDayIntervals("2025-08-11", 0.1),
      ...makeUtcDayIntervals("2025-08-12", 0.1),
    ];
    const curve: SimulatedCurve = {
      start: "2025-08-10",
      end: "2025-08-12",
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
        canonicalEndMonth: "2025-08",
      },
      {
        simulatedDayResults: [
          { localDate: "2025-08-11", displayDayKwh: 9.9, simulatedReasonCode: "TRAVEL_VACANT" } as any,
          { localDate: "2025-08-12", displayDayKwh: 8.8, simulatedReasonCode: "TEST_MODELED_KEEP_REF" } as any,
        ],
      }
    );

    const byDate = new Map(dataset.daily.map((row) => [row.date, row]));
    expect(byDate.get("2025-08-10")).toMatchObject({ source: "ACTUAL", sourceDetail: "ACTUAL" });
    expect(byDate.get("2025-08-11")).toMatchObject({
      source: "SIMULATED",
      sourceDetail: "SIMULATED_TRAVEL_VACANT",
    });
    expect(byDate.get("2025-08-12")).toMatchObject({
      source: "SIMULATED",
      sourceDetail: "SIMULATED_TEST_DAY",
    });
    expect(dataset.meta.simulatedTravelVacantDateKeysLocal).toEqual(["2025-08-11"]);
    expect(dataset.meta.simulatedTestModeledDateKeysLocal).toEqual(["2025-08-12"]);
  });
});
