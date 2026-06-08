import { describe, expect, it } from "vitest";

import {
  aggregateManualCrossSurfaceProofViolations,
  assertManifestLegMatchesProofFamily,
  buildManualReadModelFingerprints,
  evaluateGapfillBillPeriodActualComparison,
  hashManualPayloadFields,
  isZeroAnnualManualPayload,
  isZeroMonthlyManualPayload,
  normalizeManualPayloadForProof,
  resolveAuditProofFamilyFromGapfillMode,
  resolveManifestFixtureFamily,
  resolveManualDisplayTruthWeatherHouseId,
  resolveManualProofComparisonFamily,
  resolveManualProofLegPayload,
  readArtifactCoverageFromDataset,
  readManualArtifactProofDiagnostics,
  stableManualProofHash,
  validateManifestFixtureIsolation,
} from "@/lib/usage/manualCrossSurfaceParityProof";
import { MANUAL_CANONICAL_ARTIFACT_WINDOW_VERSION } from "@/lib/usage/persistManualPastArtifactCanonicalWindow";
import { shouldPreservePastCacheVariants } from "@/modules/usageSimulator/pastSimLockbox";
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
          fixtureFamily: "SAME_PAYLOAD",
          normalizedPayloadHash: "user-hash",
          validationResultHash: stableManualProofHash({ ok: true, error: null }),
          finalizedDailyRowsHash: "daily-user",
        },
        {
          legId: "gapfill_manual_monthly",
          status: "ok",
          comparisonFamily: "same_payload_parity",
          fixtureFamily: "SAME_PAYLOAD",
          normalizedPayloadHash: "derived-hash",
          gapfillDerivedPayloadHash: "derived-hash",
          validationResultHash: stableManualProofHash({ ok: true, error: null }),
          finalizedDailyRowsHash: "daily-gapfill",
          readModelPath: "buildOnePathManualUsagePastSimReadResult->readOnePathSimulatedUsageScenario",
        },
      ],
      onePathFacadeParity: { ok: true, checked: [], mismatches: [] },
    });
    expect(violations).toContain("same_payload_parity: gapfill_manual_monthly normalizedPayloadHash != anchor");
    expect(warnings.some((w) => w.includes("gapfill_manual_monthly payload"))).toBe(false);
  });

  it("allows gapfill derived payload hash difference only in GAPFILL_DERIVED family", () => {
    const { violations, warnings } = aggregateManualCrossSurfaceProofViolations({
      auditManualMode: "MONTHLY",
      auditGapfillMode: "MONTHLY_FROM_SOURCE_INTERVALS",
      legs: [
        {
          legId: "user_manual_monthly",
          status: "not_available",
          unavailableReason: "gapfill_mode_scope",
        },
        {
          legId: "gapfill_monthly_from_source_intervals",
          status: "ok",
          comparisonFamily: "gapfill_derived_payload_parity",
          fixtureFamily: "GAPFILL_DERIVED",
          normalizedPayloadHash: "derived-hash",
          gapfillDerivedPayloadHash: "derived-hash",
          validationResultHash: stableManualProofHash({ ok: true, error: null }),
          gapfillActualComparison: { ok: true, comparedBillPeriodCount: 3 },
        },
      ],
      onePathFacadeParity: { ok: true, checked: [], mismatches: [] },
      manifest: {
        legs: {
          gapfill_monthly_from_source_intervals: {
            fixtureFamily: "GAPFILL_DERIVED",
            normalizedPayloadHash: "derived-hash",
          },
        },
      },
    });
    expect(violations.some((v) => v.includes("normalizedPayloadHash"))).toBe(false);
    expect(
      warnings.some((w) => w.includes("gapfillDerivedPayloadHash differs from user-entered payload"))
    ).toBe(false);
  });

  it("fail closed when SAME_PAYLOAD leg is compared against GAPFILL_DERIVED manifest entry", () => {
    const violation = assertManifestLegMatchesProofFamily({
      legId: "manual_monthly_lab",
      manifestLeg: { fixtureFamily: "GAPFILL_DERIVED" },
      auditProofFamily: "SAME_PAYLOAD",
    });
    expect(violation).toContain("manifest fixtureFamily GAPFILL_DERIVED != audit proof family SAME_PAYLOAD");

    const { violations } = aggregateManualCrossSurfaceProofViolations({
      auditManualMode: "MONTHLY",
      auditGapfillMode: "MANUAL_MONTHLY",
      legs: [
        {
          legId: "manual_monthly_lab",
          status: "ok",
          fixtureFamily: "GAPFILL_DERIVED",
          comparisonFamily: "same_payload_parity",
          normalizedPayloadHash: "hash-a",
          validationResultHash: stableManualProofHash({ ok: true, error: null }),
        },
      ],
      onePathFacadeParity: { ok: true, checked: [], mismatches: [] },
      manifest: {
        samePayloadAnchor: { monthly: { normalizedPayloadHash: "hash-a" } },
        legs: {
          manual_monthly_lab: { fixtureFamily: "GAPFILL_DERIVED", normalizedPayloadHash: "hash-a" },
        },
      },
    });
    expect(violations.some((v) => v.includes("fixture family GAPFILL_DERIVED cannot be compared"))).toBe(true);
    expect(violations.some((v) => v.includes("manifest fixtureFamily GAPFILL_DERIVED"))).toBe(true);
  });

  it("validateManifestFixtureIsolation enforces proof family boundaries", () => {
    const result = validateManifestFixtureIsolation({
      auditManualMode: "MONTHLY",
      auditGapfillMode: "MONTHLY_FROM_SOURCE_INTERVALS",
      inScopeLegIds: ["gapfill_monthly_from_source_intervals", "gapfill_manual_monthly"],
      manifest: {
        legs: {
          gapfill_monthly_from_source_intervals: { fixtureFamily: "GAPFILL_DERIVED" },
          gapfill_manual_monthly: { fixtureFamily: "SAME_PAYLOAD" },
        },
      },
    });
    expect(result.auditProofFamily).toBe("GAPFILL_DERIVED");
    expect(result.violations.some((v) => v.includes("gapfill_manual_monthly"))).toBe(true);
  });

  it("detects all-zero monthly and annual fixture payloads", () => {
    expect(isZeroMonthlyManualPayload({ mode: "MONTHLY", anchorEndDate: "2026-05-31", monthlyKwh: [{ month: "2026-05", kwh: 0 }] })).toBe(true);
    expect(isZeroMonthlyManualPayload(monthlyPayload)).toBe(false);
    expect(isZeroAnnualManualPayload({ mode: "ANNUAL", anchorEndDate: "2026-05-31", annualKwh: 0 })).toBe(true);
    expect(isZeroAnnualManualPayload(annualPayload)).toBe(false);
  });

  it("resolveAuditProofFamilyFromGapfillMode and resolveManifestFixtureFamily label families", () => {
    expect(resolveAuditProofFamilyFromGapfillMode("MANUAL_MONTHLY")).toBe("SAME_PAYLOAD");
    expect(resolveAuditProofFamilyFromGapfillMode("MONTHLY_FROM_SOURCE_INTERVALS")).toBe("GAPFILL_DERIVED");
    expect(resolveManifestFixtureFamily("gapfill_manual_monthly")).toBe("SAME_PAYLOAD");
    expect(resolveManifestFixtureFamily("gapfill_monthly_from_source_intervals")).toBe("GAPFILL_DERIVED");
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

  it("same-payload user/gapfill monthly displayTruthRevision matches when weather-house identity is aligned", () => {
    const sourceHouseId = "source-house-weather";
    const labHouseId = "lab-house-request";
    const dataset = {
      meta: {
        coverageStart: "2025-06-07",
        coverageEnd: "2026-06-06",
        actualContextHouseId: sourceHouseId,
      },
      summary: { start: "2025-06-07", end: "2026-06-06" },
      daily: [{ date: "2025-06-07", kwh: 12.5, source: "MANUAL" }],
      dailyWeather: { "2025-06-07": { meanTempF: 70, hdd: 0, cdd: 5 } },
    };
    const userFingerprints = buildManualReadModelFingerprints({
      dataset,
      fallbackHouseId: sourceHouseId,
    });
    const gapfillFingerprints = buildManualReadModelFingerprints({
      dataset,
      fallbackHouseId: labHouseId,
    });
    expect(resolveManualDisplayTruthWeatherHouseId({ dataset, fallbackHouseId: labHouseId })).toBe(sourceHouseId);
    expect(userFingerprints.weatherHouseId).toBe(gapfillFingerprints.weatherHouseId);
    expect(userFingerprints.displayTruthRevision).toBe(gapfillFingerprints.displayTruthRevision);
    expect(userFingerprints.finalizedDailyRowsHash).toBe(gapfillFingerprints.finalizedDailyRowsHash);
  });

  it("displayTruthRevision mismatch remains a hard violation when display/weather truth truly differs", () => {
    const base = {
      status: "ok" as const,
      comparisonFamily: "same_payload_parity" as const,
      fixtureFamily: "SAME_PAYLOAD" as const,
      canonicalCoverageStart: "2025-06-07",
      canonicalCoverageEnd: "2026-06-06",
      coverageWindowMatch: true,
      normalizedPayloadHash: "same-hash",
      validationResultHash: stableManualProofHash({ ok: true, error: null }),
      finalizedDailyRowsHash: "daily-shared",
      monthlyRowsHash: "monthly-shared",
    };
    const { violations } = aggregateManualCrossSurfaceProofViolations({
      auditManualMode: "MONTHLY",
      auditGapfillMode: "MANUAL_MONTHLY",
      legs: [
        { legId: "user_manual_monthly", ...base, displayTruthRevision: "truth-user" },
        { legId: "gapfill_manual_monthly", ...base, displayTruthRevision: "truth-gapfill" },
      ],
      onePathFacadeParity: { ok: true, checked: [], mismatches: [] },
    });
    expect(violations).toContain("same_payload_parity: displayTruthRevision differs for same-hash:user_read");
  });

  it("evaluateGapfillBillPeriodActualComparison uses actualIntervalTotalKwh", () => {
    const withActual = evaluateGapfillBillPeriodActualComparison({
      readModel: {
        billPeriodCompare: {
          rows: [
            { actualIntervalTotalKwh: 420, status: "reconciled" },
            { actualIntervalTotalKwh: null, status: "delta_present" },
          ],
        },
      },
    });
    expect(withActual.comparedBillPeriodCount).toBe(1);
    expect(withActual.ok).toBe(true);
    expect(withActual.reconciledCount).toBe(1);

    const withoutActual = evaluateGapfillBillPeriodActualComparison({
      readModel: {
        billPeriodCompare: {
          rows: [{ actualIntervalTotalKwh: null, status: "delta_present" }],
        },
      },
    });
    expect(withoutActual.comparedBillPeriodCount).toBe(0);
    expect(withoutActual.ok).toBe(false);
  });

  it("derived payload hash mismatch is a hard violation in SAME_PAYLOAD family", () => {
    const { violations, warnings } = aggregateManualCrossSurfaceProofViolations({
      auditManualMode: "MONTHLY",
      auditGapfillMode: "MANUAL_MONTHLY",
      legs: [
        {
          legId: "user_manual_monthly",
          status: "ok",
          comparisonFamily: "same_payload_parity",
          fixtureFamily: "SAME_PAYLOAD",
          normalizedPayloadHash: "anchor-hash",
          validationResultHash: stableManualProofHash({ ok: true, error: null }),
        },
        {
          legId: "gapfill_manual_monthly",
          status: "ok",
          comparisonFamily: "same_payload_parity",
          fixtureFamily: "SAME_PAYLOAD",
          normalizedPayloadHash: "anchor-hash",
          gapfillDerivedPayloadHash: "derived-hash",
          validationResultHash: stableManualProofHash({ ok: true, error: null }),
        },
      ],
      onePathFacadeParity: { ok: true, checked: [], mismatches: [] },
    });
    expect(violations).toContain("same_payload_parity: gapfill_manual_monthly: gapfillDerivedPayloadHash != anchor");
    expect(warnings.some((w) => w.includes("gapfillDerivedPayloadHash differs from user-entered payload"))).toBe(
      false
    );
  });

  it("resolveManualProofLegPayload uses manifest fallback when live lab payload mode drifted", () => {
    const fallback = { ...monthlyPayload };
    const resolved = resolveManualProofLegPayload({
      livePayload: { ...annualPayload },
      wantMode: "MONTHLY",
      manifestLeg: { status: "ok", fixturePayloadMode: "MONTHLY" },
      fallbackPayload: fallback,
    });
    expect(resolved).toEqual(fallback);
  });

  it("missing_fixture is a hard violation for required proof legs", () => {
    const { violations } = aggregateManualCrossSurfaceProofViolations({
      auditManualMode: "MONTHLY",
      auditGapfillMode: "MANUAL_MONTHLY",
      legs: [
        {
          legId: "manual_monthly_lab",
          status: "missing_fixture",
          unavailableReason: "lab_manual_monthly_missing",
        },
      ],
    });
    expect(violations).toContain("manual_monthly_lab: missing_fixture (lab_manual_monthly_missing)");
  });

  it("flags stale artifact selection when live hash differs from manifest-pinned hash", () => {
    const { violations } = aggregateManualCrossSurfaceProofViolations({
      auditManualMode: "MONTHLY",
      auditGapfillMode: "MANUAL_MONTHLY",
      legs: [
        {
          legId: "user_manual_monthly",
          status: "ok",
          fixtureFamily: "SAME_PAYLOAD",
          fixtureArtifactInputHash: "manifest-hash",
          artifactInputHash: "latest-survivor-hash",
          manualCanonicalArtifactWindowVersion: MANUAL_CANONICAL_ARTIFACT_WINDOW_VERSION,
        },
      ],
    });
    expect(violations).toContain(
      "user_manual_monthly: live artifactInputHash latest-survivor-hash != manifest-pinned manifest-hash"
    );
  });

  it("requires canonical persist stamp when expectCanonicalArtifactPersist is enabled", () => {
    const { violations } = aggregateManualCrossSurfaceProofViolations({
      auditManualMode: "ANNUAL",
      auditGapfillMode: "ANNUAL_FROM_SOURCE_INTERVALS",
      expectCanonicalArtifactPersist: true,
      legs: [
        {
          legId: "gapfill_annual_from_source_intervals",
          status: "ok",
          fixtureFamily: "GAPFILL_DERIVED",
          artifactCoverageStart: "2025-06-05",
          artifactCoverageEnd: "2026-06-04",
          canonicalCoverageStart: "2025-06-07",
          canonicalCoverageEnd: "2026-06-06",
        },
      ],
    });
    expect(violations).toContain(
      "gapfill_annual_from_source_intervals: missing manualCanonicalArtifactWindowVersion stamp (Phase 4C persist hook not applied)"
    );
  });

  it("shouldPreservePastCacheVariants honors runContext and bootstrap env", () => {
    expect(shouldPreservePastCacheVariants({ preservePastCacheVariants: true })).toBe(true);
    expect(
      shouldPreservePastCacheVariants(undefined, {
        ...process.env,
        MANUAL_CROSS_SURFACE_FIXTURE_BOOTSTRAP: "1",
      })
    ).toBe(true);
    expect(
      shouldPreservePastCacheVariants(undefined, {
        ...process.env,
        MANUAL_CROSS_SURFACE_FIXTURE_BOOTSTRAP: "0",
      })
    ).toBe(false);
  });

  it("readArtifactCoverageFromDataset uses dataset summary/meta only", () => {
    const coverage = readArtifactCoverageFromDataset({
      summary: { start: "2025-06-07", end: "2026-06-06" },
      meta: {
        manualCanonicalArtifactWindowVersion: MANUAL_CANONICAL_ARTIFACT_WINDOW_VERSION,
        manualCanonicalArtifactWindowPersistAudit: {
          afterCoverageStart: "2025-06-05",
          afterCoverageEnd: "2026-06-04",
        },
        coverageStart: "2025-06-07",
        coverageEnd: "2026-06-06",
      },
    });
    expect(coverage.artifactCoverageStart).toBe("2025-06-07");
    expect(coverage.artifactCoverageEnd).toBe("2026-06-06");
  });

  it("readManualArtifactProofDiagnostics distinguishes canonical and legacy artifacts", () => {
    const legacy = readManualArtifactProofDiagnostics({
      summary: { start: "2025-06-05", end: "2026-06-04" },
      meta: { usageInputMode: "MANUAL_ANNUAL" },
      manualUsageMode: "ANNUAL",
    });
    const canonical = readManualArtifactProofDiagnostics({
      summary: { start: "2025-06-07", end: "2026-06-06" },
      meta: {
        manualCanonicalArtifactWindowVersion: MANUAL_CANONICAL_ARTIFACT_WINDOW_VERSION,
        usageInputMode: "MANUAL_ANNUAL",
      },
      manualUsageMode: "ANNUAL",
    });
    expect(legacy.manualArtifactCoverageClass).toBe("legacy");
    expect(canonical.manualArtifactCoverageClass).toBe("canonical");
  });
});
