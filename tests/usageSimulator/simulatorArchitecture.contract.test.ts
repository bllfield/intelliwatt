import { describe, expect, it } from "vitest";
import {
  attachValidationCompareProjection,
  buildValidationCompareProjectionSidecar,
  CompareTruthIncompleteError,
  projectBaselineFromCanonicalDataset,
} from "@/modules/usageSimulator/compareProjection";
import { INCLUDE_FRESH_COMPARE_CALC_IN_GAPFILL_COMPARE_CORE } from "@/modules/usageSimulator/gapfillCompareCoreContract";

describe("simulator architecture contract (stitch vs compare, truth parity)", () => {
  it("GapFill compare_core exports includeFreshCompareCalc=true for documented canonical selected_days diagnostics", () => {
    expect(INCLUDE_FRESH_COMPARE_CALC_IN_GAPFILL_COMPARE_CORE).toBe(true);
  });

  it("compare projection rows include only validation (TEST) date keys, never TRAVEL_VACANT-only dates", () => {
    const projected = attachValidationCompareProjection({
      meta: {
        validationOnlyDateKeysLocal: ["2026-06-15"],
        canonicalArtifactSimulatedDayTotalsByDate: {
          "2026-06-15": 10,
          "2026-08-01": 88,
        },
      },
      daily: [
        { date: "2026-06-15", kwh: 10, source: "ACTUAL" },
        { date: "2026-08-01", kwh: 3, source: "SIMULATED", sourceDetail: "SIMULATED_TRAVEL_VACANT" },
      ],
    });
    const dates = (projected.meta.validationCompareRows ?? []).map((r: { localDate: string }) => r.localDate);
    expect(dates).toEqual(["2026-06-15"]);
    expect(dates).not.toContain("2026-08-01");
  });

  it("user-style compare sidecar matches repeated reads of the same stored dataset (additive analytics only)", () => {
    const base = {
      meta: {
        validationOnlyDateKeysLocal: ["2026-01-10", "2026-01-11"],
        canonicalArtifactSimulatedDayTotalsByDate: { "2026-01-10": 12, "2026-01-11": 13 },
      },
      daily: [
        { date: "2026-01-10", kwh: 11, source: "ACTUAL" },
        { date: "2026-01-11", kwh: 12, source: "ACTUAL" },
      ],
    };
    const withCompare = attachValidationCompareProjection(base);
    const a = buildValidationCompareProjectionSidecar(withCompare);
    const b = buildValidationCompareProjectionSidecar(withCompare);
    expect(a.rows).toEqual(b.rows);
    expect(a.metrics).toEqual(b.metrics);
  });

  it("attachValidationCompareProjection fails closed when canonical simulated-day totals are missing for a validation day", () => {
    expect(() =>
      attachValidationCompareProjection({
        meta: {
          validationOnlyDateKeysLocal: ["2026-07-04"],
          canonicalArtifactSimulatedDayTotalsByDate: {},
        },
        daily: [{ date: "2026-07-04", kwh: 40, source: "ACTUAL" }],
      })
    ).toThrow(CompareTruthIncompleteError);
  });

  it("CompareTruthIncompleteError exposes stable code for compare_truth_incomplete surfaces", () => {
    const err = new CompareTruthIncompleteError(["2026-01-01"]);
    expect(err.code).toBe("COMPARE_TRUTH_INCOMPLETE");
  });

  it("baseline stitch projection keeps validation TEST days actual in daily rows (TEST sim not shown as simulated in stitched chart)", () => {
    const projected = projectBaselineFromCanonicalDataset(
      {
        meta: {
          validationOnlyDateKeysLocal: ["2026-07-04"],
          timezone: "America/Chicago",
        },
        daily: [{ date: "2026-07-04", kwh: 99, source: "SIMULATED", sourceDetail: "SIMULATED_TEST_DAY" }],
      },
      "America/Chicago",
      new Map([["2026-07-04", 40]])
    );
    const row = (projected.daily as Array<{ date?: string; kwh?: number; source?: string; sourceDetail?: string }>).find(
      (d) => d.date === "2026-07-04"
    );
    expect(row?.source).toBe("ACTUAL");
    expect(row?.sourceDetail).toBe("ACTUAL_VALIDATION_TEST_DAY");
    expect(row?.kwh).toBe(40);
  });
});
