import { describe, expect, it } from "vitest";

import {
  applyPastSimValidationBaselineProjectionToDataset,
  computePastSimCanonicalOwnershipAudit,
} from "@/lib/usage/pastSimValidationBaselineProjection";

describe("pastSimValidationBaselineProjection", () => {
  it("replaces validation/test simulated daily totals with actual kWh in canonical Past curve", () => {
    const dataset = {
      summary: { totalKwh: 100, start: "2026-01-01", end: "2026-01-03" },
      totals: { importKwh: 100, exportKwh: 0, netKwh: 100 },
      daily: [
        { date: "2026-01-01", kwh: 30, source: "ACTUAL" },
        { date: "2026-01-02", kwh: 40, source: "SIMULATED", sourceDetail: "SIMULATED (VALIDATION/TEST)" },
        { date: "2026-01-03", kwh: 30, source: "SIMULATED", sourceDetail: "SIMULATED (TRAVEL/VACANT)" },
      ],
      monthly: [{ month: "2026-01", kwh: 100 }],
      series: {
        intervals15: [
          { timestamp: "2026-01-01T18:00:00.000Z", kwh: 30 },
          { timestamp: "2026-01-02T18:00:00.000Z", kwh: 40 },
          { timestamp: "2026-01-03T18:00:00.000Z", kwh: 30 },
        ],
      },
      meta: {
        datasetKind: "SIMULATED",
        timezone: "America/Chicago",
        validationOnlyDateKeysLocal: ["2026-01-02"],
      },
    } as Record<string, unknown>;

    const applied = applyPastSimValidationBaselineProjectionToDataset({
      dataset,
      actualDailyByDate: new Map([["2026-01-02", 52.5]]),
    });
    expect(applied).toBe(true);

    const daily = dataset.daily as Array<Record<string, unknown>>;
    expect(daily[1]).toMatchObject({
      date: "2026-01-02",
      kwh: 52.5,
      source: "ACTUAL",
      sourceDetail: "ACTUAL_VALIDATION_TEST_DAY",
    });
    expect((dataset.summary as Record<string, unknown>).totalKwh).toBe(112.5);
    expect((dataset.totals as Record<string, unknown>).netKwh).toBe(112.5);

    const ownership = computePastSimCanonicalOwnershipAudit({
      dataset,
      compareMetrics: { deltaKwhMasked: -12.5 },
    });
    expect(ownership.travelVacantSimulatedDateCount).toBe(1);
    expect(ownership.validationTestSimulatedDateCount).toBe(1);
    expect(ownership.validationTestActualInCanonicalDateCount).toBe(1);
    expect(ownership.canonicalPastIncludesValidationTestSimulation).toBe(false);
    expect(ownership.validationTestDeltaKwh).toBe(-12.5);
  });
});
