import { describe, expect, it } from "vitest";
import {
  isModelIntelligenceMaskedAdminRun,
  resolveModelIntelligenceMaskedRunMode,
} from "@/lib/usage/onePathAdminMaskedRunDiagnostics";

describe("onePathAdminMaskedRunDiagnostics", () => {
  it("detects model intelligence masked run modes from orchestration", () => {
    expect(
      resolveModelIntelligenceMaskedRunMode({
        runReason: "model_intelligence_monthly_masked",
        orchestration: { runMode: "MONTHLY_MASKED" },
        forceActualDerivedManualPayload: true,
      })
    ).toBe("MONTHLY_MASKED");
    expect(
      resolveModelIntelligenceMaskedRunMode({
        runReason: "model_intelligence_annual_masked",
        orchestration: { runMode: "ANNUAL_MASKED" },
        forceActualDerivedManualPayload: true,
      })
    ).toBe("ANNUAL_MASKED");
  });

  it("limits masked admin run detection to manual modes", () => {
    expect(
      isModelIntelligenceMaskedAdminRun({
        mode: "MANUAL_MONTHLY",
        runReason: "model_intelligence_monthly_masked",
        orchestration: { runMode: "MONTHLY_MASKED" },
        forceActualDerivedManualPayload: true,
      })
    ).toBe(true);
    expect(
      isModelIntelligenceMaskedAdminRun({
        mode: "INTERVAL",
        runReason: "model_intelligence_smt_interval_truth",
        orchestration: { runMode: "SMT_INTERVAL_TRUTH" },
        forceActualDerivedManualPayload: false,
      })
    ).toBe(false);
  });
});
