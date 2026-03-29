import { describe, expect, it } from "vitest";
import {
  attachFailureContract,
  failureContractFromErrorKey,
  failureContractFromRecalcErr,
} from "@/lib/api/usageSimulationApiContract";

describe("usageSimulationApiContract (plan §27)", () => {
  it("maps snake_case error keys to UPPER_SNAKE failureCode", () => {
    expect(failureContractFromErrorKey("user_not_found", "msg").failureCode).toBe("USER_NOT_FOUND");
    expect(failureContractFromErrorKey("user_not_found", "msg").failureMessage).toBe("msg");
  });

  it("maps camelCase segments in error keys", () => {
    expect(failureContractFromErrorKey("houseId_required").failureCode).toBe("HOUSE_ID_REQUIRED");
    expect(failureContractFromErrorKey("jobId_required").failureCode).toBe("JOB_ID_REQUIRED");
  });

  it("attachFailureContract adds failure fields without dropping extras", () => {
    const out = attachFailureContract({
      ok: false,
      error: "test_ranges_required",
      message: "need dates",
      validationSelectionDiagnostics: { mode: "manual" },
    });
    expect(out.failureCode).toBe("TEST_RANGES_REQUIRED");
    expect(out.failureMessage).toBe("need dates");
    expect((out as any).validationSelectionDiagnostics).toEqual({ mode: "manual" });
  });

  it("failureContractFromRecalcErr uses missingItems as failureMessage", () => {
    const r = failureContractFromRecalcErr({
      ok: false,
      error: "requirements_unmet",
      missingItems: ["a", "b"],
    });
    expect(r.failureCode).toBe("REQUIREMENTS_UNMET");
    expect(r.failureMessage).toBe("a; b");
  });

  it("failureContractFromRecalcErr maps recalc_timeout", () => {
    expect(failureContractFromRecalcErr({ ok: false, error: "recalc_timeout" }).failureCode).toBe(
      "RECALC_TIMEOUT"
    );
  });
});
