/**
 * Admin Gap-Fill lab only: optional treatment overrides on top of `resolveSimFingerprint` output.
 * Same shared simulator chain; no alternate resolver implementation (plan §24).
 */

import { sha256HexUtf8, stableStringify } from "@/modules/usageSimulator/fingerprintHash";
import { RESOLVED_SIM_FINGERPRINT_VERSION } from "@/modules/usageSimulator/resolveSimFingerprint";
import type { ResolvedSimFingerprint } from "@/modules/usageSimulator/resolvedSimFingerprintTypes";
import type { SimulatorMode } from "@/modules/usageSimulator/requirements";
import { SimulatorFingerprintStatus } from "@/.prisma/usage-client";

export const ADMIN_LAB_TREATMENT_MODES = [
  "actual_data_fingerprint",
  "whole_home_prior_only",
  "manual_monthly_constrained",
  "manual_annual_constrained",
] as const;

export type AdminLabTreatmentMode = (typeof ADMIN_LAB_TREATMENT_MODES)[number];

export function isAdminLabTreatmentMode(s: string | null | undefined): s is AdminLabTreatmentMode {
  return Boolean(s && (ADMIN_LAB_TREATMENT_MODES as readonly string[]).includes(s));
}

export function isAdminLabManualConstraintTreatmentMode(
  m: AdminLabTreatmentMode | string | null | undefined
): m is "manual_monthly_constrained" | "manual_annual_constrained" {
  return m === "manual_monthly_constrained" || m === "manual_annual_constrained";
}

function isReadyStatus(status: string | null | undefined): boolean {
  return status === SimulatorFingerprintStatus.ready;
}

function rehashResolvedLikeResolver(r: ResolvedSimFingerprint, simulatorMode: SimulatorMode): ResolvedSimFingerprint {
  const resolvedHash = sha256HexUtf8(
    stableStringify({
      version: RESOLVED_SIM_FINGERPRINT_VERSION,
      wholeHomeHouseId: r.wholeHomeHouseId,
      usageFingerprintHouseId: r.usageFingerprintHouseId,
      mode: simulatorMode,
      blendMode: r.blendMode,
      underlyingSourceMix: r.underlyingSourceMix,
      manualTotalsConstraint: r.manualTotalsConstraint,
      resolutionNotes: [...r.resolutionNotes].sort(),
      usageBlendWeight: r.usageBlendWeight,
      wholeHomeSourceHash: r.wholeHomeSourceHash ?? null,
      usageSourceHash: r.usageSourceHash ?? null,
      wholeHomeFingerprintArtifactId: r.wholeHomeFingerprintArtifactId ?? null,
      usageFingerprintArtifactId: r.usageFingerprintArtifactId ?? null,
    })
  );
  return { ...r, resolvedHash };
}

/**
 * Applies §24 admin treatment selection to an already-resolved fingerprint for the canonical recalc chain.
 * Manual constraint modes run as `MANUAL_TOTALS` with an admin-lab-derived manual payload from actual-context usage.
 */
export function applyAdminLabTreatmentToResolvedFingerprint(args: {
  resolved: ResolvedSimFingerprint;
  treatmentMode: AdminLabTreatmentMode;
  simulatorMode: SimulatorMode;
}): ResolvedSimFingerprint {
  const { resolved, treatmentMode, simulatorMode } = args;
  const notes = [...resolved.resolutionNotes];

  if (treatmentMode === "manual_monthly_constrained" || treatmentMode === "manual_annual_constrained") {
    if (simulatorMode !== "MANUAL_TOTALS") {
      notes.push(`admin_lab_treatment_pending:${treatmentMode}_needs_MANUAL_TOTALS_lab_wiring`);
      return rehashResolvedLikeResolver({ ...resolved, resolutionNotes: notes }, simulatorMode);
    }
    notes.push(`admin_lab_treatment:${treatmentMode}`);
    return rehashResolvedLikeResolver({ ...resolved, resolutionNotes: notes }, simulatorMode);
  }

  if (treatmentMode === "actual_data_fingerprint") {
    if (isReadyStatus(resolved.usageStatus)) {
      const next: ResolvedSimFingerprint = {
        ...resolved,
        blendMode: "usage_only",
        underlyingSourceMix: "usage_only",
        usageBlendWeight: 1,
        resolutionNotes: [...notes, "admin_lab_treatment:actual_data_fingerprint"],
      };
      return rehashResolvedLikeResolver(next, simulatorMode);
    }
    notes.push("admin_lab_treatment:actual_data_fingerprint_skipped_usage_fingerprint_not_ready");
    return rehashResolvedLikeResolver({ ...resolved, resolutionNotes: notes }, simulatorMode);
  }

  if (treatmentMode === "whole_home_prior_only") {
    if (isReadyStatus(resolved.wholeHomeStatus)) {
      const next: ResolvedSimFingerprint = {
        ...resolved,
        blendMode: "whole_home_only",
        underlyingSourceMix: "whole_home_only",
        usageBlendWeight: 0,
        resolutionNotes: [...notes, "admin_lab_treatment:whole_home_prior_only"],
      };
      return rehashResolvedLikeResolver(next, simulatorMode);
    }
    notes.push("admin_lab_treatment:whole_home_prior_only_skipped_whole_home_fingerprint_not_ready");
    return rehashResolvedLikeResolver({ ...resolved, resolutionNotes: notes }, simulatorMode);
  }

  return resolved;
}
