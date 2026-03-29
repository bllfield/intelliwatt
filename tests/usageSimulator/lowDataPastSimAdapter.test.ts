import { describe, expect, it } from "vitest";
import {
  buildSyntheticIntervalsForSharedPastWindow,
  buildUsageShapeSnapFromMonthlyTotalsForLowData,
} from "@/modules/usageSimulator/lowDataPastSimAdapter";
import type { SimulatorBuildInputsV1 } from "@/modules/usageSimulator/dataset";
import { normalizeShape96 } from "@/modules/simulatedUsage/intradayTemplates";

const shape = normalizeShape96(Array.from({ length: 96 }, () => 1 / 96));

describe("lowDataPastSimAdapter", () => {
  it("builds synthetic intervals from monthly totals for the shared Past window", () => {
    const buildInputs = {
      version: 1 as const,
      mode: "MANUAL_TOTALS" as const,
      baseKind: "MANUAL" as const,
      canonicalEndMonth: "2026-02",
      canonicalMonths: ["2025-03", "2025-04", "2025-05", "2025-06", "2025-07", "2025-08", "2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02"],
      monthlyTotalsKwhByMonth: {
        "2025-03": 300,
        "2025-04": 300,
        "2025-05": 300,
        "2025-06": 300,
        "2025-07": 300,
        "2025-08": 300,
        "2025-09": 300,
        "2025-10": 300,
        "2025-11": 300,
        "2025-12": 300,
        "2026-01": 300,
        "2026-02": 300,
      },
      intradayShape96: shape,
      notes: [],
      filledMonths: [],
    } satisfies SimulatorBuildInputsV1;

    const ivs = buildSyntheticIntervalsForSharedPastWindow({
      buildInputs,
      startDate: "2025-03-14",
      endDate: "2026-03-13",
      timezone: "America/Chicago",
    });
    expect(ivs.length).toBeGreaterThan(0);
    const sum = ivs.reduce((s, r) => s + (Number(r.kwh) || 0), 0);
    expect(sum).toBeGreaterThan(3000);
  });

  it("derives uniform weekday/weekend daily averages from monthly kWh", () => {
    const snap = buildUsageShapeSnapFromMonthlyTotalsForLowData({
      canonicalMonths: ["2026-01"],
      monthlyTotalsKwhByMonth: { "2026-01": 310 },
    });
    const dim = 31;
    expect(snap.weekdayAvgByMonthKey["2026-01"]).toBeCloseTo(310 / dim, 5);
    expect(snap.weekendAvgByMonthKey["2026-01"]).toBeCloseTo(310 / dim, 5);
  });
});
