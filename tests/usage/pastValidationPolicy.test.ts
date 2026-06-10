import { describe, expect, it } from "vitest";
import {
  CANONICAL_PAST_VALIDATION_DAY_COUNT,
  CANONICAL_PAST_VALIDATION_SELECTION_MODE,
  PAST_VALIDATION_POLICY_REVISION,
  resolvePastValidationPolicy,
  resolvePastValidationEngineInput,
  resolveUserValidationPolicy,
  resolveAdminValidationPolicy,
  shouldReconcilePastValidationSelection,
  storedValidationKeysLookLikeSeasonMonthEdgeCluster,
} from "@/lib/usage/pastValidationPolicy";

describe("pastValidationPolicy", () => {
  it("uses the same canonical defaults for user site and admin lab (SMT + Green Button Past)", () => {
    expect(resolvePastValidationPolicy({ surface: "user_site" })).toEqual({
      owner: "userValidationPolicy",
      selectionMode: CANONICAL_PAST_VALIDATION_SELECTION_MODE,
      validationDayCount: CANONICAL_PAST_VALIDATION_DAY_COUNT,
    });
    expect(resolvePastValidationPolicy({ surface: "admin_lab" })).toEqual({
      owner: "adminValidationPolicy",
      selectionMode: CANONICAL_PAST_VALIDATION_SELECTION_MODE,
      validationDayCount: CANONICAL_PAST_VALIDATION_DAY_COUNT,
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
      validationDayCount: CANONICAL_PAST_VALIDATION_DAY_COUNT,
    });
  });

  it("ignores per-request mode and count overrides (global MG-2 policy owner)", () => {
    expect(
      resolveAdminValidationPolicy({
        selectionMode: "customer_style_seasonal_mix",
        validationDayCount: 9,
      })
    ).toEqual({
      owner: "adminValidationPolicy",
      selectionMode: CANONICAL_PAST_VALIDATION_SELECTION_MODE,
      validationDayCount: CANONICAL_PAST_VALIDATION_DAY_COUNT,
    });
    expect(
      resolveUserValidationPolicy({
        validationSelectionMode: "random_simple",
        validationDayCount: 21,
      })
    ).toEqual({
      owner: "userValidationPolicy",
      selectionMode: CANONICAL_PAST_VALIDATION_SELECTION_MODE,
      validationDayCount: CANONICAL_PAST_VALIDATION_DAY_COUNT,
    });
  });

  it("reconciles legacy random_simple and count drift but preserves manual picks", () => {
    expect(
      shouldReconcilePastValidationSelection({
        storedSelectionMode: "random_simple",
        storedValidationKeyCount: 4,
      })
    ).toBe(true);
    expect(
      shouldReconcilePastValidationSelection({
        storedSelectionMode: "stratified_weather_balanced",
        storedValidationKeyCount: 4,
      })
    ).toBe(true);
    expect(
      shouldReconcilePastValidationSelection({
        storedSelectionMode: "stratified_weather_balanced",
        storedValidationKeyCount: CANONICAL_PAST_VALIDATION_DAY_COUNT,
      })
    ).toBe(false);
    expect(
      shouldReconcilePastValidationSelection({
        storedSelectionMode: "stratified_weather_balanced",
        storedValidationKeyCount: CANONICAL_PAST_VALIDATION_DAY_COUNT,
        storedValidationDateKeysLocal: Array.from({ length: 14 }, (_, i) => {
          const day = String(5 + i).padStart(2, "0");
          return `2026-05-${day}`;
        }),
        coverageEndDate: "2026-05-18",
      })
    ).toBe(true);
    expect(
      shouldReconcilePastValidationSelection({
        storedSelectionMode: "stratified_weather_balanced",
        storedValidationKeyCount: CANONICAL_PAST_VALIDATION_DAY_COUNT,
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
      shouldReconcilePastValidationSelection({
        storedSelectionMode: "manual",
        storedValidationKeyCount: 4,
      })
    ).toBe(true);
    expect(
      shouldReconcilePastValidationSelection({
        storedSelectionMode: "manual",
        storedValidationKeyCount: CANONICAL_PAST_VALIDATION_DAY_COUNT,
      })
    ).toBe(false);
  });

  it("reconciles legacy season-month edge clusters and stale policy revisions", () => {
    const legacyEdgeClusterKeys = [
      "2025-06-05",
      "2025-06-06",
      "2025-06-07",
      "2025-06-08",
      "2025-06-09",
      "2025-06-14",
      "2025-09-01",
      "2025-09-02",
      "2025-09-03",
      "2025-09-04",
      "2025-12-01",
      "2025-12-02",
      "2025-12-03",
      "2025-12-04",
    ];
    expect(
      storedValidationKeysLookLikeSeasonMonthEdgeCluster({
        storedValidationDateKeysLocal: legacyEdgeClusterKeys,
      })
    ).toBe(true);
    expect(
      shouldReconcilePastValidationSelection({
        storedSelectionMode: "stratified_weather_balanced",
        storedValidationKeyCount: CANONICAL_PAST_VALIDATION_DAY_COUNT,
        storedValidationDateKeysLocal: legacyEdgeClusterKeys,
        timezone: "America/Chicago",
      })
    ).toBe(true);
    expect(
      shouldReconcilePastValidationSelection({
        storedSelectionMode: "stratified_weather_balanced",
        storedValidationKeyCount: CANONICAL_PAST_VALIDATION_DAY_COUNT,
        storedPastValidationPolicyRevision: "unified_past_validation_stratified_14_v3",
      })
    ).toBe(true);
    expect(
      shouldReconcilePastValidationSelection({
        storedSelectionMode: "stratified_weather_balanced",
        storedValidationKeyCount: CANONICAL_PAST_VALIDATION_DAY_COUNT,
        storedPastValidationPolicyRevision: PAST_VALIDATION_POLICY_REVISION,
      })
    ).toBe(false);
  });
});
