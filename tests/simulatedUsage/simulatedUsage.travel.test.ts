import { describe, expect, it } from "vitest";
import { generateSimulatedCurveFromManual } from "@/modules/simulatedUsage/engine";

describe("simulatedUsage travel exclusions", () => {
  it("renormalizes remaining days to preserve annual total", () => {
    const payload = {
      mode: "ANNUAL",
      endDate: "2026-01-31",
      annualKwh: 365,
      travelRanges: [{ startDate: "2026-01-01", endDate: "2026-01-01" }],
    } as const;

    const curve = generateSimulatedCurveFromManual(payload as any);
    const total = curve.intervals.reduce((sum, r) => sum + r.consumption_kwh, 0);
    expect(Math.abs(total - 365)).toBeLessThan(1e-6);
    expect(curve.meta.excludedDays).toBeGreaterThanOrEqual(1);
    expect(curve.meta.renormalized).toBe(true);
  });

  it("throws if exclusions cover the full range", () => {
    const payload = {
      mode: "ANNUAL",
      endDate: "2026-01-02",
      annualKwh: 2,
      // Annual window is endDate - 364d through endDate inclusive.
      travelRanges: [{ startDate: "2025-01-03", endDate: "2026-01-02" }],
    } as const;

    expect(() => generateSimulatedCurveFromManual(payload as any)).toThrow(/travel_exclusions_cover_full_range/);
  });
});

