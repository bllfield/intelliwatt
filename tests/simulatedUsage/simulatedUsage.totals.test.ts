import { describe, expect, it } from "vitest";
import { generateSimulatedCurveFromManual } from "@/modules/simulatedUsage/engine";

describe("simulatedUsage totals preserved", () => {
  it("monthly input preserves total kWh", () => {
    const payload = {
      mode: "MONTHLY",
      anchorEndMonth: "2026-01",
      billEndDay: 15,
      monthlyKwh: [
        { month: "2025-02", kwh: 100 },
        { month: "2025-03", kwh: 110 },
        { month: "2025-04", kwh: 120 },
        { month: "2025-05", kwh: 130 },
        { month: "2025-06", kwh: 140 },
        { month: "2025-07", kwh: 150 },
        { month: "2025-08", kwh: 160 },
        { month: "2025-09", kwh: 170 },
        { month: "2025-10", kwh: 180 },
        { month: "2025-11", kwh: 190 },
        { month: "2025-12", kwh: 200 },
        { month: "2026-01", kwh: 210 },
      ],
      travelRanges: [],
    } as const;

    const curve = generateSimulatedCurveFromManual(payload as any);
    const intended = payload.monthlyKwh.reduce((sum, r) => sum + r.kwh, 0);
    expect(Math.abs(curve.annualTotalKwh - intended)).toBeLessThan(1e-6);

    const fromIntervals = curve.intervals.reduce((sum, r) => sum + r.consumption_kwh, 0);
    expect(Math.abs(fromIntervals - intended)).toBeLessThan(1e-6);
  });
});

