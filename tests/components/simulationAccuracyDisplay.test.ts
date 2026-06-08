import { describe, expect, it } from "vitest";

import {
  buildSimulationAccuracyUserDisplay,
  readValidationHoldoutProofOk,
  resolveSimulationAccuracyPercent,
} from "@/components/usage/simulationAccuracyDisplay";
import { buildValidationCompareDisplay } from "@/components/usage/validationCompareDisplay";

describe("simulationAccuracyDisplay", () => {
  it("maps WAPE 13.51% to Simulation Accuracy 86%", () => {
    expect(resolveSimulationAccuracyPercent(13.51)).toBe(86);
    const display = buildSimulationAccuracyUserDisplay({
      wapePercent: 13.51,
      validationDayCount: 14,
      holdoutProofOk: true,
    });
    expect(display.title).toBe("Simulation Accuracy");
    expect(display.mainMetric).toBe("86%");
    expect(display.subtitle).toContain("14 hidden days");
    expect(display.detail).toBe("Average miss: 13.5%");
    expect(display.accuracyPercent).toBe(86);
  });

  it("shows needs review when holdout proof did not pass", () => {
    const display = buildSimulationAccuracyUserDisplay({
      wapePercent: 5,
      validationDayCount: 3,
      holdoutProofOk: false,
    });
    expect(display.title).toBe("Simulation Check");
    expect(display.mainMetric).toBe("Needs review");
    expect(display.accuracyPercent).toBeNull();
    expect(display.detail).toBeNull();
  });

  it("reads holdout proof from dataset meta in compare display builder", () => {
    const built = buildValidationCompareDisplay({
      dataset: {
        meta: {
          validationCompareRows: [{ localDate: "2026-05-01", actualDayKwh: 10, simulatedDayKwh: 9 }],
          validationCompareMetrics: { wape: 10, compareMetricKind: "holdout_wape" },
          validationHoldoutProof: { ok: true, violations: [] },
        },
      },
    });
    expect(built.holdoutProofOk).toBe(true);
    expect(readValidationHoldoutProofOk({ validationHoldoutProof: { ok: true } })).toBe(true);
  });
});
