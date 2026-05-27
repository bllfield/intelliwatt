import { describe, expect, it } from "vitest";
import {
  CANONICAL_PAST_SMT_VALIDATION_DAY_COUNT,
  CANONICAL_PAST_SMT_VALIDATION_SELECTION_MODE,
  resolvePastSmtValidationPolicy,
  resolvePastValidationEngineInput,
  resolveUserValidationPolicy,
  resolveAdminValidationPolicy,
} from "@/lib/usage/pastValidationPolicy";

describe("pastValidationPolicy", () => {
  it("uses the same canonical defaults for user site and admin lab", () => {
    expect(resolvePastSmtValidationPolicy({ surface: "user_site" })).toEqual({
      owner: "userValidationPolicy",
      selectionMode: CANONICAL_PAST_SMT_VALIDATION_SELECTION_MODE,
      validationDayCount: CANONICAL_PAST_SMT_VALIDATION_DAY_COUNT,
    });
    expect(resolvePastSmtValidationPolicy({ surface: "admin_lab" })).toEqual({
      owner: "adminValidationPolicy",
      selectionMode: CANONICAL_PAST_SMT_VALIDATION_SELECTION_MODE,
      validationDayCount: CANONICAL_PAST_SMT_VALIDATION_DAY_COUNT,
    });
  });

  it("treats explicit validation date keys as manual selection", () => {
    expect(
      resolvePastValidationEngineInput({
        surface: "admin_lab",
        validationOnlyDateKeysLocal: ["2025-06-02"],
      })
    ).toEqual({
      validationSelectionMode: "manual",
      validationDayCount: CANONICAL_PAST_SMT_VALIDATION_DAY_COUNT,
    });
  });

  it("preserves explicit mode and count overrides", () => {
    expect(
      resolveAdminValidationPolicy({
        selectionMode: "customer_style_seasonal_mix",
        validationDayCount: 9,
      })
    ).toEqual({
      owner: "adminValidationPolicy",
      selectionMode: "customer_style_seasonal_mix",
      validationDayCount: 9,
    });
    expect(
      resolveUserValidationPolicy({
        validationSelectionMode: "random_simple",
        validationDayCount: 21,
      }).selectionMode
    ).toBe("random_simple");
  });
});
