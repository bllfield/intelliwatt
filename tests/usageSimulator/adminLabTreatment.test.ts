import { describe, expect, it } from "vitest";
import { applyAdminLabTreatmentToResolvedFingerprint } from "@/modules/usageSimulator/adminLabTreatment";
import type { ResolvedSimFingerprint } from "@/modules/usageSimulator/resolvedSimFingerprintTypes";

function baseResolved(overrides: Partial<ResolvedSimFingerprint> = {}): ResolvedSimFingerprint {
  return {
    resolverVersion: "resolved_sim_fp_v2",
    resolvedHash: "x",
    blendMode: "blended",
    underlyingSourceMix: "blended",
    manualTotalsConstraint: "none",
    resolutionNotes: [],
    wholeHomeHouseId: "h1",
    usageFingerprintHouseId: "h1",
    wholeHomeFingerprintArtifactId: "wh",
    usageFingerprintArtifactId: "us",
    wholeHomeStatus: "ready",
    usageStatus: "ready",
    wholeHomeSourceHash: "a",
    usageSourceHash: "b",
    usageBlendWeight: 0.5,
    ...overrides,
  };
}

describe("applyAdminLabTreatmentToResolvedFingerprint", () => {
  it("forces usage_only for actual_data_fingerprint when usage fingerprint is ready", () => {
    const out = applyAdminLabTreatmentToResolvedFingerprint({
      resolved: baseResolved(),
      treatmentMode: "actual_data_fingerprint",
      simulatorMode: "SMT_BASELINE",
    });
    expect(out.blendMode).toBe("usage_only");
    expect(out.usageBlendWeight).toBe(1);
    expect(out.resolutionNotes.some((n) => n.includes("admin_lab_treatment:actual_data_fingerprint"))).toBe(true);
    expect(out.resolvedHash).not.toBe("x");
  });

  it("forces whole_home_only for whole_home_prior_only when whole-home artifact is ready", () => {
    const out = applyAdminLabTreatmentToResolvedFingerprint({
      resolved: baseResolved(),
      treatmentMode: "whole_home_prior_only",
      simulatorMode: "SMT_BASELINE",
    });
    expect(out.blendMode).toBe("whole_home_only");
    expect(out.usageBlendWeight).toBe(0);
  });

  it("adds pending notes for manual treatments when simulator is still SMT_BASELINE", () => {
    const out = applyAdminLabTreatmentToResolvedFingerprint({
      resolved: baseResolved(),
      treatmentMode: "manual_monthly_constrained",
      simulatorMode: "SMT_BASELINE",
    });
    expect(out.resolutionNotes.some((n) => n.includes("admin_lab_treatment_pending"))).toBe(true);
  });

  it("records applied manual_monthly when shared chain is already MANUAL_TOTALS", () => {
    const out = applyAdminLabTreatmentToResolvedFingerprint({
      resolved: baseResolved({ blendMode: "constrained_monthly_totals", manualTotalsConstraint: "monthly" }),
      treatmentMode: "manual_monthly_constrained",
      simulatorMode: "MANUAL_TOTALS",
    });
    expect(out.resolutionNotes.some((n) => n === "admin_lab_treatment:manual_monthly_constrained")).toBe(true);
    expect(out.resolutionNotes.some((n) => n.includes("admin_lab_treatment_pending"))).toBe(false);
  });
});
