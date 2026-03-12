import { describe, expect, it } from "vitest";
import { buildUsageShapeProfileSnapFromMonthContract } from "@/modules/simulatedUsage/simulatePastUsageDataset";

describe("usage-shape month contract", () => {
  it("maps YYYY-MM keys by calendar month index, not key position", () => {
    const snap = buildUsageShapeProfileSnapFromMonthContract({
      monthKeys: ["2026-03", "2025-12", "2026-01"],
      // Jan..Dec
      weekdayVals: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
      weekendVals: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120],
    });
    expect(snap).not.toBeNull();
    expect(snap?.weekdayAvgByMonthKey["2026-03"]).toBe(3);
    expect(snap?.weekdayAvgByMonthKey["2025-12"]).toBe(12);
    expect(snap?.weekdayAvgByMonthKey["2026-01"]).toBe(1);
    expect(snap?.weekendAvgByMonthKey["2026-03"]).toBe(30);
    expect(snap?.weekendAvgByMonthKey["2025-12"]).toBe(120);
    expect(snap?.weekendAvgByMonthKey["2026-01"]).toBe(10);
  });
});
