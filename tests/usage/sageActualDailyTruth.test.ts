import { describe, expect, it } from "vitest";
import {
  applySageActualDailyTruthToCompareRows,
  applySageActualDailyTruthToDisplayRows,
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
