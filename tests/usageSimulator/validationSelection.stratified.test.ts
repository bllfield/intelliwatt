import { describe, expect, it } from "vitest";
import { selectValidationDayKeys } from "@/modules/usageSimulator/validationSelection";
import { storedValidationKeysLookLikeSeasonMonthEdgeCluster } from "@/lib/usage/pastValidationPolicy";

function localDateKeysInRange(startDate: string, endDate: string): string[] {
  const out: string[] = [];
  const start = new Date(`${startDate}T12:00:00.000Z`).getTime();
  const end = new Date(`${endDate}T12:00:00.000Z`).getTime();
  for (let t = start; t <= end; t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}

describe("stratified_weather_balanced validation selection", () => {
  const legacyEdgeClusterKeys = [
    "2025-06-05",
    "2025-06-06",
    "2025-06-07",
    "2025-06-08",
    "2025-06-09",
    "2025-06-14",
    "2025-09-01",
    "2025-09-02",
    "2025-09-03",
    "2025-09-04",
    "2025-12-01",
    "2025-12-02",
    "2025-12-03",
    "2025-12-04",
  ];

  it("flags legacy season-month edge clusters for reconcile", () => {
    expect(
      storedValidationKeysLookLikeSeasonMonthEdgeCluster({
        storedValidationDateKeysLocal: legacyEdgeClusterKeys,
      })
    ).toBe(true);
  });

  it("spreads picks across season-month buckets inside the coverage window", () => {
    const candidates = localDateKeysInRange("2025-06-05", "2026-06-04");
    const selection = selectValidationDayKeys({
      mode: "stratified_weather_balanced",
      targetCount: 14,
      candidateDateKeys: candidates,
      travelDateKeysSet: new Set(["2025-06-27", "2025-07-11"]),
      timezone: "America/Chicago",
      seed: "29a3d820-2593-4673-9dd6-cd161bbd7f6f-2026-06-04",
    });

    expect(selection.selectedDateKeys).toHaveLength(14);
    expect(selection.selectedDateKeys.every((dk) => dk >= "2025-06-05" && dk <= "2026-06-04")).toBe(true);
    expect(selection.selectedDateKeys.some((dk) => dk >= "2025-07-01")).toBe(true);
    expect(selection.selectedDateKeys.some((dk) => dk >= "2026-01-01")).toBe(true);

    const keysByMonth = new Map<string, number>();
    for (const dk of selection.selectedDateKeys) {
      const month = dk.slice(0, 7);
      keysByMonth.set(month, (keysByMonth.get(month) ?? 0) + 1);
    }
    const monthsWithMultiple = Array.from(keysByMonth.values()).filter((count) => count >= 3);
    expect(monthsWithMultiple.length).toBeLessThanOrEqual(1);

    expect(
      storedValidationKeysLookLikeSeasonMonthEdgeCluster({
        storedValidationDateKeysLocal: selection.selectedDateKeys,
      })
    ).toBe(false);
  });
});
