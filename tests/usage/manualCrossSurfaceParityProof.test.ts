import { describe, expect, it } from "vitest";

import {
  aggregateManualCrossSurfaceProofViolations,
  hashManualPayloadFields,
  normalizeManualPayloadForProof,
  resolveManualProofComparisonFamily,
  stableManualProofHash,
} from "@/lib/usage/manualCrossSurfaceParityProof";
import type { ManualUsagePayload } from "@/modules/simulatedUsage/types";

const monthlyPayload: ManualUsagePayload = {
  mode: "MONTHLY",
  anchorEndDate: "2026-05-31",
  monthlyKwh: [
    { month: "2026-05", kwh: 420 },
    { month: "2026-04", kwh: 390 },
  ],
  statementRanges: [{ month: "2026-05", startDate: "2026-05-01", endDate: "2026-05-31", kwh: 420 }],
  travelRanges: [{ startDate: "2026-04-10", endDate: "2026-04-12" }],
};

const annualPayload: ManualUsagePayload = {
  mode: "ANNUAL",
  anchorEndDate: "2026-05-31",
  annualKwh: 5000,
  travelRanges: [],
};

describe("manualCrossSurfaceParityProof helpers", () => {
  it("stableManualProofHash is deterministic", () => {
    const first = stableManualProofHash({ a: 1, b: [2, 3] });
    const second = stableManualProofHash({ a: 1, b: [2, 3] });
    expect(first).toBe(second);
    expect(first).toHaveLength(22);
  });

  it("normalizeManualPayloadForProof sorts monthly rows and normalizes travel", () => {
    const normalized = normalizeManualPayloadForProof(monthlyPayload);
    expect(normalized.mode).toBe("MONTHLY");
    expect((normalized.monthlyKwh as Array<{ month: string }>)[0]?.month).toBe("2026-04");
    expect(normalized.travelRanges).toEqual([{ startDate: "2026-04-10", endDate: "2026-04-12" }]);
  });

  it("hashManualPayloadFields exposes proof hashes", () => {
    const hashed = hashManualPayloadFields(monthlyPayload);
    expect(hashed.payloadMode).toBe("MONTHLY");
    expect(hashed.normalizedPayloadHash).toBeTruthy();
    expect(hashed.billPeriodHash).toBeTruthy();
    expect(hashed.validationResultHash).toBe(stableManualProofHash({ ok: true, error: null }));
    expect(hashed.monthlyTotals).toEqual([
      { month: "2026-04", kwh: 390 },
      { month: "2026-05", kwh: 420 },
    ]);
  });

  it("aggregateManualCrossSurfaceProofViolations flags cross-surface drift", () => {
    const base = {
      status: "ok" as const,
      comparisonFamily: "same_payload_parity" as const,
      canonicalCoverageStart: "2025-06-07",
      canonicalCoverageEnd: "2026-06-06",
      coverageWindowMatch: true,
      validationResultHash: stableManualProofHash({ ok: true, error: null }),
    };
    const { violations } = aggregateManualCrossSurfaceProofViolations({
      auditManualMode: "MONTHLY",
      auditGapfillMode: "MANUAL_MONTHLY",
      legs: [
        {
          legId: "user_manual_monthly",
          ...base,
          normalizedPayloadHash: "hash-a",
          finalizedDailyRowsHash: "daily-a",
          monthlyRowsHash: "monthly-a",
          displayTruthRevision: "truth-a",
        },
        {
          legId: "manual_monthly_lab",
          ...base,
          normalizedPayloadHash: "hash-b",
          finalizedDailyRowsHash: "daily-b",
          monthlyRowsHash: "monthly-b",
          displayTruthRevision: "truth-b",
          readModelPath: "usageSimulator/service.getSimulatedUsageForHouseScenario",
        },
      ],
      onePathFacadeParity: { ok: true, checked: [], mismatches: [] },
    });
    expect(violations).toContain("same_payload_parity: manual_monthly_lab: normalizedPayloadHash != user_manual_monthly");
    expect(violations).toContain(
      "manual_monthly_lab: legacy GapFill manual read path still hits usageSimulator/service"
    );
  });

  it("does not treat gapfill derived payload hash mismatch as same-payload violation", () => {
    const { violations, warnings } = aggregateManualCrossSurfaceProofViolations({
      auditManualMode: "MONTHLY",
      auditGapfillMode: "MANUAL_MONTHLY",
      legs: [
        {
          legId: "user_manual_monthly",
          status: "ok",
          comparisonFamily: "same_payload_parity",
          normalizedPayloadHash: "user-hash",
          validationResultHash: stableManualProofHash({ ok: true, error: null }),
          finalizedDailyRowsHash: "daily-user",
        },
        {
          legId: "gapfill_manual_monthly",
          status: "ok",
          comparisonFamily: "same_payload_parity",
          normalizedPayloadHash: "derived-hash",
          gapfillDerivedPayloadHash: "derived-hash",
          validationResultHash: stableManualProofHash({ ok: true, error: null }),
          finalizedDailyRowsHash: "daily-gapfill",
          readModelPath: "buildOnePathManualUsagePastSimReadResult->readOnePathSimulatedUsageScenario",
        },
      ],
      onePathFacadeParity: { ok: true, checked: [], mismatches: [] },
    });
    expect(violations.some((v) => v.includes("normalizedPayloadHash != user_manual_monthly"))).toBe(false);
    expect(warnings.some((w) => w.includes("gapfill_manual_monthly payload"))).toBe(true);
  });

  it("resolveManualProofComparisonFamily separates derived gapfill legs", () => {
    expect(resolveManualProofComparisonFamily("gapfill_manual_monthly")).toBe("same_payload_parity");
    expect(resolveManualProofComparisonFamily("gapfill_monthly_from_source_intervals")).toBe(
      "gapfill_derived_payload_parity"
    );
  });

  it("annual payload hashing includes annualKwh", () => {
    const hashed = hashManualPayloadFields(annualPayload);
    expect(hashed.payloadMode).toBe("ANNUAL");
    expect(hashed.annualKwh).toBe(5000);
    expect(hashed.monthlyTotals).toBeNull();
  });
});
