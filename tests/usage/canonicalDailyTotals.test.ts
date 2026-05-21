import { describe, expect, test } from "vitest";
import { enumerateDateKeysInclusive } from "@/lib/time/chicago";
import {
  coverageWindowEndingOnDateKey,
  fillCanonicalDailyTotals,
  resolveCanonicalUsage365CoverageWindow,
} from "@/lib/usage/canonicalMetadataWindow";
import { CANONICAL_COVERAGE_TOTAL_DAYS } from "@/lib/usage/canonicalCoverageConfig";

describe("coverageWindowEndingOnDateKey", () => {
  test("returns 365 inclusive local days ending on the anchor complete day", () => {
    const window = coverageWindowEndingOnDateKey("2026-05-14", CANONICAL_COVERAGE_TOTAL_DAYS);
    expect(window).toEqual({ startDate: "2025-05-15", endDate: "2026-05-14" });
    expect(enumerateDateKeysInclusive(window!.startDate, window!.endDate)).toHaveLength(365);
  });
});

describe("fillCanonicalDailyTotals", () => {
  test("zero-fills missing tail day so daily count matches 365-day coverage window", () => {
    const window = resolveCanonicalUsage365CoverageWindow(new Date("2026-05-21T12:00:00.000Z"));
    expect(window.endDate).toBe("2026-05-19");
    expect(window.startDate).toBe("2025-05-20");

    const sparse = [
      { date: "2025-05-20", kwh: 10 },
      { date: "2026-05-18", kwh: 20 },
    ];
    const filled = fillCanonicalDailyTotals(sparse, window);
    expect(filled).toHaveLength(365);
    expect(filled[0]?.date).toBe("2025-05-20");
    expect(filled[filled.length - 1]?.date).toBe("2026-05-19");
    expect(filled[filled.length - 1]?.kwh).toBe(0);
    expect(filled.find((row) => row.date === "2026-05-18")?.kwh).toBe(20);
  });
});
