import { describe, expect, it } from "vitest";
import {
  formatSharedPastSimulationCoreLabel,
  readPastValidationPolicyRevisionFromMeta,
} from "@/lib/usage/pastSimulationCoreLabel";
import { PAST_VALIDATION_POLICY_REVISION } from "@/lib/usage/pastValidationPolicy";

describe("pastSimulationCoreLabel", () => {
  it("includes shared core, day-sim, engine, and validation revision stamps", () => {
    const label = formatSharedPastSimulationCoreLabel();
    expect(label).toContain("shared_past_day_simulator");
    expect(label).toContain("day-sim 1.1.0");
    expect(label).toContain("engine production_past_stitched_v16");
    expect(label).toContain(`validation ${PAST_VALIDATION_POLICY_REVISION}`);
  });

  it("reads pastValidationPolicyRevision from artifact meta", () => {
    expect(readPastValidationPolicyRevisionFromMeta({ pastValidationPolicyRevision: " unified_stratified_14_v1 " })).toBe(
      "unified_stratified_14_v1"
    );
    expect(readPastValidationPolicyRevisionFromMeta({})).toBeNull();
  });
});
