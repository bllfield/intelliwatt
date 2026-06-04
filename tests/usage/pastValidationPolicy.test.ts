import { describe, expect, it } from "vitest";
import {
  CANONICAL_PAST_SMT_VALIDATION_DAY_COUNT,
  CANONICAL_PAST_SMT_VALIDATION_SELECTION_MODE,
  resolvePastSmtValidationPolicy,
  resolvePastValidationEngineInput,
  resolveUserValidationPolicy,
  resolveAdminValidationPolicy,
  shouldReconcilePastSmtValidationSelection,
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

  it("reconciles legacy random_simple and count drift but preserves manual picks", () => {
    expect(
      shouldReconcilePastSmtValidationSelection({
        storedSelectionMode: "random_simple",
        storedValidationKeyCount: 4,
      })
    ).toBe(true);
    expect(
      shouldReconcilePastSmtValidationSelection({
        storedSelectionMode: "stratified_weather_balanced",
        storedValidationKeyCount: 4,
      })
    ).toBe(true);
    expect(
      shouldReconcilePastSmtValidationSelection({
        storedSelectionMode: "stratified_weather_balanced",
        storedValidationKeyCount: CANONICAL_PAST_SMT_VALIDATION_DAY_COUNT,
      })
    ).toBe(false);
    expect(
      shouldReconcilePastSmtValidationSelection({
        storedSelectionMode: "stratified_weather_balanced",
        storedValidationKeyCount: CANONICAL_PAST_SMT_VALIDATION_DAY_COUNT,
        storedValidationDateKeysLocal: Array.from({ length: 14 }, (_, i) => {
          const day = String(5 + i).padStart(2, "0");
          return `2026-05-${day}`;
        }),
        coverageEndDate: "2026-05-18",
      })
    ).toBe(true);
    expect(
      shouldReconcilePastSmtValidationSelection({
        storedSelectionMode: "stratified_weather_balanced",
        storedValidationKeyCount: CANONICAL_PAST_SMT_VALIDATION_DAY_COUNT,
        storedValidationDateKeysLocal: [
          "2025-12-10",
          "2026-01-15",
          "2026-02-20",
          "2026-03-08",
          "2026-04-12",
          "2026-05-03",
          "2026-06-14",
          "2026-07-19",
          "2026-08-09",
          "2025-12-14",
          "2026-01-18",
          "2026-02-22",
          "2026-03-15",
          "2026-04-18",
        ],
        timezone: "America/Chicago",
        coverageEndDate: "2026-05-18",
      })
    ).toBe(false);
    expect(
      shouldReconcilePastSmtValidationSelection({
        storedSelectionMode: "manual",
        storedValidationKeyCount: 4,
      })
    ).toBe(true);
    expect(
      shouldReconcilePastSmtValidationSelection({
        storedSelectionMode: "manual",
        storedValidationKeyCount: CANONICAL_PAST_SMT_VALIDATION_DAY_COUNT,
      })
    ).toBe(false);
  });
});
