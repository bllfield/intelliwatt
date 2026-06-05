import { describe, expect, it } from "vitest";
import {
  alignGreenButtonValidationKeysToResolvableActualTruth,
  applyGreenButtonShiftedTargetActualTotals,
  finalizeGreenButtonValidationCompareTruthSync,
  mergeGreenButtonValidationActualDailyRecords,
} from "@/lib/usage/greenButtonPastValidationCompareTruth";
import { attachValidationCompareProjection } from "@/lib/usage/validationCompareProjection";

describe("greenButtonPastValidationCompareTruth", () => {
  it("merges partial GB validation actual maps per key", () => {
    const merged = mergeGreenButtonValidationActualDailyRecords(
      { "2025-06-04": 12.5 },
      { "2025-06-05": 13.1, "2025-06-04": 99 }
    );
    expect(merged).toEqual({ "2025-06-04": 99, "2025-06-05": 13.1 });
  });

  it("maps year-shifted target validation days from source-day totals", () => {
    const actual = applyGreenButtonShiftedTargetActualTotals({
      actualByDate: { "2024-06-03": 18.42 },
      sourceDateByTargetDate: { "2025-06-03": "2024-06-03" },
      validationKeys: ["2025-06-03"],
    });
    expect(actual["2025-06-03"]).toBe(18.42);
  });

  it("drops validation keys without resolvable actual totals", () => {
    const aligned = alignGreenButtonValidationKeysToResolvableActualTruth({
      validationKeys: ["2025-06-03", "2025-06-04"],
      actualByDate: { "2025-06-04": 20.11 },
    });
    expect(aligned.validationKeys).toEqual(["2025-06-04"]);
    expect(aligned.actualByDate).toEqual({ "2025-06-04": 20.11 });
  });

  it("finalize sync keeps keys aligned with interval-backed totals", () => {
    const intervals = Array.from({ length: 96 }, (_, slot) => ({
      timestamp: new Date(new Date("2025-06-04T05:00:00.000Z").getTime() + slot * 15 * 60 * 1000).toISOString(),
      kwh: 0.25,
      homeDateKey: "2025-06-04",
    }));
    const finalized = finalizeGreenButtonValidationCompareTruthSync({
      validationKeys: ["2025-06-03", "2025-06-04"],
      existingActual: { "2025-06-03": 17.5 },
      intervals,
      timezone: "America/Chicago",
    });
    expect(finalized.validationKeys).toEqual(["2025-06-03", "2025-06-04"]);
    expect(finalized.actualByDate["2025-06-04"]).toBe(24);
    expect(finalized.actualByDate["2025-06-03"]).toBe(17.5);
  });

  it("attachValidationCompareProjection succeeds when GB meta keys and actuals are paired", () => {
    const dataset = {
      daily: [
        { date: "2025-06-04", kwh: 24, source: "SIMULATED_TEST_DAY" },
        { date: "2025-06-05", kwh: 10, source: "ACTUAL" },
      ],
      meta: {
        actualSource: "GREEN_BUTTON",
        validationOnlyDateKeysLocal: ["2025-06-04"],
        validationActualDailyKwhByDateLocal: { "2025-06-04": 24 },
        canonicalArtifactSimulatedDayTotalsByDate: { "2025-06-04": 24 },
        timezone: "America/Chicago",
      },
    };
    expect(() => attachValidationCompareProjection(dataset)).not.toThrow();
  });
});
