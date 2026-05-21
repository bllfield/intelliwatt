import { describe, expect, it } from "vitest";
import {
  applySageActualDailyTruthToCompareRows,
  applySageActualDailyTruthToDisplayRows,
  clampDailyRowsToCanonicalCoverageWindow,
  sageActualDailyKwhByDate,
} from "@/lib/usage/sageActualDailyTruth";

describe("sageActualDailyTruth", () => {
  it("overlays ACTUAL display rows only", () => {
    const sage = sageActualDailyKwhByDate({
      daily: [
        { date: "2026-05-18", kwh: 51.47 },
        { date: "2025-05-19", kwh: 20.95 },
      ],
    });
    const rows = applySageActualDailyTruthToDisplayRows(
      [
        { date: "2026-05-18", kwh: 45.08, source: "ACTUAL" },
        { date: "2025-05-19", kwh: 43.19, source: "SIMULATED", sourceDetail: "SIMULATED_TRAVEL_VACANT" },
      ],
      sage
    );
    expect(rows[0]?.kwh).toBe(51.47);
    expect(rows[1]?.kwh).toBe(43.19);
  });

  it("clamps daily rows to the canonical 365-day window and dedupes by date", () => {
    const clamped = clampDailyRowsToCanonicalCoverageWindow(
      [
        { date: "2025-05-18", kwh: 11.32 },
        { date: "2025-05-19", kwh: 20.95 },
        { date: "2026-05-18", kwh: 51.47 },
        { date: "2026-05-19", kwh: 99 },
      ],
      { startDate: "2025-05-19", endDate: "2026-05-18" }
    );
    expect(clamped.map((row) => row.date)).toEqual(["2025-05-19", "2026-05-18"]);
    expect(clamped[0]?.kwh).toBe(20.95);
    expect(clamped[1]?.kwh).toBe(51.47);
  });

  it("recomputes compare actual and error from sage truth", () => {
    const sage = sageActualDailyKwhByDate({ daily: [{ date: "2026-04-16", kwh: 10 }] });
    const rows = applySageActualDailyTruthToCompareRows(
      [
        {
          localDate: "2026-04-16",
          dayType: "weekday",
          actualDayKwh: 8.1,
          simulatedDayKwh: 7.8,
          errorKwh: -0.3,
          percentError: 3.7,
        },
      ],
      sage
    );
    expect(rows[0]?.actualDayKwh).toBe(10);
    expect(rows[0]?.errorKwh).toBe(-2.2);
    expect(rows[0]?.percentError).toBe(22);
  });
});
