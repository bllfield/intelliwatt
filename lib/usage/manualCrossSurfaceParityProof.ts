import { createHash } from "crypto";

import { resolveCanonicalUsage365CoverageWindow } from "@/lib/usage/canonicalMetadataWindow";
import { buildPastMonthlyRowsParityDebug } from "@/lib/usage/intervalReadModelInvariants";
import { buildPastWeatherInputFingerprint } from "@/lib/usage/pastWeatherInputParity";
import { buildManualBillPeriodTargets, normalizeStatementRanges, normalizeTravelRanges } from "@/modules/manualUsage/statementRanges";
import { validateManualUsagePayload } from "@/modules/manualUsage/validation";
import { buildUserUsageDashboardViewModel } from "@/lib/usage/userUsageDashboardViewModel";
import { buildOnePathRunReadOnlyView } from "@/modules/onePathSim/runReadOnlyView";
import { remapManualDisplayDatasetToCanonicalWindow } from "@/modules/onePathSim/manualDisplayDataset";
import type { ManualUsagePayload } from "@/modules/simulatedUsage/types";

export const MANUAL_CROSS_SURFACE_PROOF_VERSION = "manual_cross_surface_parity_v2";

export type ManualFixtureFamily = "SAME_PAYLOAD" | "GAPFILL_DERIVED";

export type ManualFixturePayloadMode = "MONTHLY" | "ANNUAL";

export type ManualFixtureManifestLeg = {
  fixtureFamily?: ManualFixtureFamily | null;
  fixturePayloadMode?: ManualFixturePayloadMode | null;
  sourcePayloadHash?: string | null;
  normalizedPayloadHash?: string | null;
  gapfillDerivedPayloadHash?: string | null;
  billPeriodHash?: string | null;
  statementRangesHash?: string | null;
  validationResultHash?: string | null;
  artifactId?: string | null;
  artifactInputHash?: string | null;
  readModelPath?: string | null;
  runDispatchPath?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  status?: string | null;
  [key: string]: unknown;
};

export type ManualFixtureManifest = {
  bootstrapVersion?: string | null;
  samePayloadAnchor?: Partial<
    Record<
      "monthly" | "annual",
      {
        normalizedPayloadHash?: string | null;
        sourcePayloadHash?: string | null;
        billPeriodHash?: string | null;
        statementRangesHash?: string | null;
        validationResultHash?: string | null;
      }
    >
  > | null;
  legs?: Partial<Record<ManualCrossSurfaceProofLegId, ManualFixtureManifestLeg>> | null;
};

export type ManualCrossSurfaceProofLegId =
  | "user_manual_monthly"
  | "user_manual_annual"
  | "manual_monthly_lab"
  | "one_path_admin_manual_monthly"
  | "one_path_admin_manual_annual"
  | "gapfill_manual_monthly"
  | "gapfill_monthly_from_source_intervals"
  | "gapfill_annual_from_source_intervals";

export type ManualCrossSurfaceProofLegStatus = "ok" | "missing_fixture" | "not_available";

export type ManualCrossSurfaceProofLeg = {
  legId: ManualCrossSurfaceProofLegId;
  status: ManualCrossSurfaceProofLegStatus;
  unavailableReason?: string | null;
  houseId?: string | null;
  userId?: string | null;
  scenarioId?: string | null;
  mode?: "MANUAL_MONTHLY" | "MANUAL_ANNUAL" | null;
  payloadMode?: "MONTHLY" | "ANNUAL" | null;
  anchorDate?: string | null;
  canonicalCoverageStart?: string | null;
  canonicalCoverageEnd?: string | null;
  artifactCoverageStart?: string | null;
  artifactCoverageEnd?: string | null;
  displayCoverageStart?: string | null;
  displayCoverageEnd?: string | null;
  coverageWindowMatch?: boolean | null;
  sourcePayloadHash?: string | null;
  normalizedPayloadHash?: string | null;
  billPeriodHash?: string | null;
  statementRangesHash?: string | null;
  travelRangesHash?: string | null;
  validationResultHash?: string | null;
  runDispatchPath?: string | null;
  producerVersion?: string | null;
  readModelPath?: string | null;
  artifactInputHash?: string | null;
  finalizedDailyRowsHash?: string | null;
  displayTruthRevision?: string | null;
  monthlyRowsHash?: string | null;
  timeOfDayBucketsHash?: string | null;
  annualKwh?: number | null;
  monthlyTotals?: Array<{ month: string; kwh: number }> | null;
  gapfillDerivedPayloadHash?: string | null;
  gapfillActualComparison?: Record<string, unknown> | null;
  comparisonFamily?: "same_payload_parity" | "gapfill_derived_payload_parity" | null;
  payloadProvenance?: "user_entered" | "lab_saved" | "gapfill_derived" | null;
  fixtureArtifactInputHash?: string | null;
  fixtureFamily?: ManualFixtureFamily | null;
  applyAdminRemap?: boolean | null;
};

export function resolveManualProofComparisonFamily(
  legId: ManualCrossSurfaceProofLegId
): "same_payload_parity" | "gapfill_derived_payload_parity" {
  if (legId === "gapfill_monthly_from_source_intervals" || legId === "gapfill_annual_from_source_intervals") {
    return "gapfill_derived_payload_parity";
  }
  return "same_payload_parity";
}

export function resolveManualProofPayloadProvenance(
  legId: ManualCrossSurfaceProofLegId
): "user_entered" | "lab_saved" | "gapfill_derived" {
  if (legId.startsWith("gapfill_")) return "gapfill_derived";
  if (legId.startsWith("user_")) return "user_entered";
  return "lab_saved";
}

export function resolveManifestFixtureFamily(legId: ManualCrossSurfaceProofLegId): ManualFixtureFamily {
  if (legId === "gapfill_monthly_from_source_intervals" || legId === "gapfill_annual_from_source_intervals") {
    return "GAPFILL_DERIVED";
  }
  return "SAME_PAYLOAD";
}

export function resolveAuditProofFamilyFromGapfillMode(
  auditGapfillMode: "MANUAL_MONTHLY" | "MONTHLY_FROM_SOURCE_INTERVALS" | "ANNUAL_FROM_SOURCE_INTERVALS"
): ManualFixtureFamily {
  return auditGapfillMode === "MANUAL_MONTHLY" ? "SAME_PAYLOAD" : "GAPFILL_DERIVED";
}

export function isZeroMonthlyManualPayload(payload: ManualUsagePayload | null | undefined): boolean {
  if (!payload || payload.mode !== "MONTHLY") return false;
  const rows = Array.isArray(payload.monthlyKwh) ? payload.monthlyKwh : [];
  return !rows.some(
    (row) => typeof (row as { kwh?: unknown }).kwh === "number" && Number.isFinite((row as { kwh: number }).kwh) && (row as { kwh: number }).kwh > 0
  );
}

export function isZeroAnnualManualPayload(payload: ManualUsagePayload | null | undefined): boolean {
  if (!payload || payload.mode !== "ANNUAL") return false;
  return !(typeof payload.annualKwh === "number" && Number.isFinite(payload.annualKwh) && payload.annualKwh > 0);
}

export function assertManifestLegMatchesProofFamily(args: {
  legId: ManualCrossSurfaceProofLegId;
  manifestLeg: ManualFixtureManifestLeg | null | undefined;
  auditProofFamily: ManualFixtureFamily;
}): string | null {
  if (!args.manifestLeg) return null;
  const manifestFamily = args.manifestLeg.fixtureFamily ?? resolveManifestFixtureFamily(args.legId);
  if (manifestFamily !== args.auditProofFamily) {
    return `${args.legId}: manifest fixtureFamily ${manifestFamily} != audit proof family ${args.auditProofFamily}`;
  }
  return null;
}

export function validateManifestFixtureIsolation(args: {
  manifest: ManualFixtureManifest | null;
  auditManualMode: "MONTHLY" | "ANNUAL";
  auditGapfillMode: "MANUAL_MONTHLY" | "MONTHLY_FROM_SOURCE_INTERVALS" | "ANNUAL_FROM_SOURCE_INTERVALS";
  inScopeLegIds: ManualCrossSurfaceProofLegId[];
}): {
  violations: string[];
  auditProofFamily: ManualFixtureFamily;
  anchorNormalizedPayloadHash: string | null;
} {
  const auditProofFamily = resolveAuditProofFamilyFromGapfillMode(args.auditGapfillMode);
  const violations: string[] = [];
  const anchorKey = args.auditManualMode === "MONTHLY" ? "monthly" : "annual";
  const anchorNormalizedPayloadHash =
    args.manifest?.samePayloadAnchor?.[anchorKey as "monthly" | "annual"]?.normalizedPayloadHash ?? null;

  for (const legId of args.inScopeLegIds) {
    if (legId.startsWith("user_")) continue;
    const familyViolation = assertManifestLegMatchesProofFamily({
      legId,
      manifestLeg: args.manifest?.legs?.[legId] ?? null,
      auditProofFamily,
    });
    if (familyViolation) violations.push(familyViolation);
  }

  return { violations, auditProofFamily, anchorNormalizedPayloadHash };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asDateKey(value: unknown): string | null {
  const text = String(value ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

export function stableManualProofHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("base64url").slice(0, 22);
}

export function resolveCanonicalCoverageForProof(now = new Date()): { startDate: string; endDate: string } {
  return resolveCanonicalUsage365CoverageWindow(now);
}

export function normalizeManualPayloadForProof(payload: ManualUsagePayload): Record<string, unknown> {
  const travelRanges = normalizeTravelRanges(Array.isArray(payload.travelRanges) ? payload.travelRanges : []);
  if (payload.mode === "MONTHLY") {
    const statementRanges = normalizeStatementRanges(
      Array.isArray(payload.statementRanges) ? payload.statementRanges : []
    );
    const monthlyKwh = Array.isArray(payload.monthlyKwh)
      ? payload.monthlyKwh
          .map((row) => ({
            month: String((row as { month?: unknown }).month ?? "").slice(0, 7),
            kwh: typeof (row as { kwh?: unknown }).kwh === "number" ? (row as { kwh: number }).kwh : null,
          }))
          .filter((row) => /^\d{4}-\d{2}$/.test(row.month))
          .sort((left, right) => left.month.localeCompare(right.month))
      : [];
    return {
      mode: "MONTHLY",
      anchorEndDate: String(payload.anchorEndDate ?? "").slice(0, 10) || null,
      anchorEndMonth: String((payload as { anchorEndMonth?: unknown }).anchorEndMonth ?? "").slice(0, 7) || null,
      dateSourceMode: (payload as { dateSourceMode?: unknown }).dateSourceMode ?? null,
      monthlyKwh,
      statementRanges,
      travelRanges,
    };
  }
  return {
    mode: "ANNUAL",
    anchorEndDate: String(payload.anchorEndDate ?? "").slice(0, 10) || null,
    endDate: String((payload as { endDate?: unknown }).endDate ?? "").slice(0, 10) || null,
    annualKwh: typeof payload.annualKwh === "number" ? payload.annualKwh : null,
    travelRanges,
  };
}

export function hashManualPayloadFields(payload: ManualUsagePayload | null | undefined): {
  sourcePayloadHash: string | null;
  normalizedPayloadHash: string | null;
  billPeriodHash: string | null;
  statementRangesHash: string | null;
  travelRangesHash: string | null;
  validationResultHash: string | null;
  anchorDate: string | null;
  payloadMode: "MONTHLY" | "ANNUAL" | null;
  annualKwh: number | null;
  monthlyTotals: Array<{ month: string; kwh: number }> | null;
} {
  if (!payload) {
    return {
      sourcePayloadHash: null,
      normalizedPayloadHash: null,
      billPeriodHash: null,
      statementRangesHash: null,
      travelRangesHash: null,
      validationResultHash: null,
      anchorDate: null,
      payloadMode: null,
      annualKwh: null,
      monthlyTotals: null,
    };
  }
  const normalized = normalizeManualPayloadForProof(payload);
  const validation = validateManualUsagePayload(payload);
  const billPeriodTargets = buildManualBillPeriodTargets(payload).map((row) => ({
    id: row.id,
    startDate: row.startDate,
    endDate: row.endDate,
    enteredKwh: row.enteredKwh,
    inputKind: row.inputKind,
    travelExcluded: row.travelExcluded,
  }));
  const statementRanges =
    payload.mode === "MONTHLY"
      ? normalizeStatementRanges(Array.isArray(payload.statementRanges) ? payload.statementRanges : [])
      : [];
  const travelRanges = normalizeTravelRanges(Array.isArray(payload.travelRanges) ? payload.travelRanges : []);
  const anchorDate =
    payload.mode === "MONTHLY"
      ? asDateKey(payload.anchorEndDate) ??
        (String((payload as { anchorEndMonth?: unknown }).anchorEndMonth ?? "").slice(0, 7) || null)
      : asDateKey(payload.anchorEndDate) ?? asDateKey((payload as { endDate?: unknown }).endDate);
  const monthlyTotals =
    payload.mode === "MONTHLY" && Array.isArray(payload.monthlyKwh)
      ? payload.monthlyKwh
          .map((row) => ({
            month: String((row as { month?: unknown }).month ?? "").slice(0, 7),
            kwh: Number((row as { kwh?: unknown }).kwh) || 0,
          }))
          .filter((row) => /^\d{4}-\d{2}$/.test(row.month))
          .sort((left, right) => left.month.localeCompare(right.month))
      : null;
  return {
    sourcePayloadHash: stableManualProofHash(payload),
    normalizedPayloadHash: stableManualProofHash(normalized),
    billPeriodHash: stableManualProofHash(billPeriodTargets),
    statementRangesHash: stableManualProofHash(statementRanges),
    travelRangesHash: stableManualProofHash(travelRanges),
    validationResultHash: stableManualProofHash({
      ok: validation.ok,
      error: validation.ok ? null : validation.error,
    }),
    anchorDate,
    payloadMode: payload.mode,
    annualKwh: payload.mode === "ANNUAL" ? Number(payload.annualKwh) || 0 : null,
    monthlyTotals,
  };
}

export function readArtifactCoverageFromDataset(dataset: Record<string, unknown> | null | undefined): {
  artifactCoverageStart: string | null;
  artifactCoverageEnd: string | null;
} {
  if (!dataset) return { artifactCoverageStart: null, artifactCoverageEnd: null };
  const meta = asRecord(dataset.meta);
  const summary = asRecord(dataset.summary);
  return {
    artifactCoverageStart: asDateKey(meta.coverageStart ?? summary.start),
    artifactCoverageEnd: asDateKey(meta.coverageEnd ?? summary.end),
  };
}

export function readDisplayCoverageFromDataset(args: {
  dataset: Record<string, unknown> | null | undefined;
  usageInputMode?: string | null;
  applyAdminRemap?: boolean;
}): {
  displayCoverageStart: string | null;
  displayCoverageEnd: string | null;
  displayDataset: Record<string, unknown> | null;
} {
  if (!args.dataset) {
    return { displayCoverageStart: null, displayCoverageEnd: null, displayDataset: null };
  }
  const displayDataset =
    args.applyAdminRemap === true
      ? (remapManualDisplayDatasetToCanonicalWindow({
          dataset: args.dataset,
          usageInputMode: args.usageInputMode ?? null,
        }) as Record<string, unknown>)
      : args.dataset;
  const userView = buildUserUsageDashboardViewModel({ dataset: displayDataset as never });
  const adminView = buildOnePathRunReadOnlyView({ dataset: displayDataset });
  const coverageStart = userView?.coverage.start ?? adminView?.summary.coverageStart ?? null;
  const coverageEnd = userView?.coverage.end ?? adminView?.summary.coverageEnd ?? null;
  return {
    displayCoverageStart: coverageStart,
    displayCoverageEnd: coverageEnd,
    displayDataset,
  };
}

export function buildManualReadModelFingerprints(args: {
  dataset: Record<string, unknown>;
  weatherHouseId: string;
}): {
  finalizedDailyRowsHash: string | null;
  displayTruthRevision: string | null;
  monthlyRowsHash: string | null;
  timeOfDayBucketsHash: string | null;
} {
  const fingerprint = buildPastWeatherInputFingerprint({
    dataset: args.dataset,
    weatherHouseId: args.weatherHouseId,
    forceComputedDisplayTruthRevision: true,
  });
  const userView = buildUserUsageDashboardViewModel({ dataset: args.dataset as never });
  const adminView = buildOnePathRunReadOnlyView({ dataset: args.dataset });
  const monthlyRowsParity =
    userView && adminView
      ? buildPastMonthlyRowsParityDebug({
          userDataset: args.dataset,
          adminDataset: args.dataset,
          userMonthlyRows: userView.derived.monthly,
          adminMonthlyRows: adminView.monthlyRows,
        })
      : null;
  return {
    finalizedDailyRowsHash: fingerprint.finalizedDailyRowsHash,
    displayTruthRevision: fingerprint.displayTruthRevision,
    monthlyRowsHash: monthlyRowsParity?.userMonthlyRowsHash ?? null,
    timeOfDayBucketsHash: stableManualProofHash(userView?.derived.timeOfDayBuckets ?? adminView?.summary.timeOfDayBuckets ?? []),
  };
}

export function buildUnavailableLeg(args: {
  legId: ManualCrossSurfaceProofLegId;
  reason: string;
  canonicalCoverage: { startDate: string; endDate: string };
}): ManualCrossSurfaceProofLeg {
  return {
    legId: args.legId,
    status: "not_available",
    unavailableReason: args.reason,
    canonicalCoverageStart: args.canonicalCoverage.startDate,
    canonicalCoverageEnd: args.canonicalCoverage.endDate,
    coverageWindowMatch: null,
  };
}

export function buildMissingLeg(args: {
  legId: ManualCrossSurfaceProofLegId;
  reason: string;
  canonicalCoverage: { startDate: string; endDate: string };
  partial?: Partial<ManualCrossSurfaceProofLeg>;
}): ManualCrossSurfaceProofLeg {
  return {
    ...buildUnavailableLeg({
      legId: args.legId,
      reason: args.reason,
      canonicalCoverage: args.canonicalCoverage,
    }),
    status: "missing_fixture",
    unavailableReason: args.reason,
    ...args.partial,
  };
}

export function aggregateManualCrossSurfaceProofViolations(args: {
  legs: ManualCrossSurfaceProofLeg[];
  auditManualMode: "MONTHLY" | "ANNUAL";
  auditGapfillMode: "MANUAL_MONTHLY" | "MONTHLY_FROM_SOURCE_INTERVALS" | "ANNUAL_FROM_SOURCE_INTERVALS";
  onePathFacadeParity?: Record<string, unknown> | null;
  manifest?: ManualFixtureManifest | null;
}): { violations: string[]; warnings: string[]; auditProofFamily: ManualFixtureFamily } {
  const violations: string[] = [];
  const warnings: string[] = [];
  const inScope = (leg: ManualCrossSurfaceProofLeg) => leg.status === "ok";
  const auditProofFamily = resolveAuditProofFamilyFromGapfillMode(args.auditGapfillMode);

  const inScopeLegIds = args.legs
    .filter((leg) => leg.status !== "not_available")
    .map((leg) => leg.legId);
  const manifestIsolation = validateManifestFixtureIsolation({
    manifest: args.manifest ?? null,
    auditManualMode: args.auditManualMode,
    auditGapfillMode: args.auditGapfillMode,
    inScopeLegIds,
  });
  violations.push(...manifestIsolation.violations);

  for (const leg of args.legs) {
    if (leg.status === "missing_fixture") {
      violations.push(`${leg.legId}: missing_fixture (${leg.unavailableReason ?? "unknown"})`);
      continue;
    }
    if (leg.status === "not_available") continue;

    const legFixtureFamily = leg.fixtureFamily ?? resolveManifestFixtureFamily(leg.legId);
    if (legFixtureFamily !== auditProofFamily && !leg.legId.startsWith("user_")) {
      violations.push(
        `${leg.legId}: fixture family ${legFixtureFamily} cannot be compared in ${auditProofFamily} proof run`
      );
    }

    if (leg.coverageWindowMatch === false) {
      violations.push(`${leg.legId}: coverage window mismatch (artifact vs display)`);
    }
    if (
      leg.artifactCoverageStart &&
      leg.artifactCoverageEnd &&
      leg.canonicalCoverageStart &&
      leg.canonicalCoverageEnd &&
      (leg.artifactCoverageStart !== leg.canonicalCoverageStart ||
        leg.artifactCoverageEnd !== leg.canonicalCoverageEnd)
    ) {
      violations.push(
        `${leg.legId}: artifact coverage ${leg.artifactCoverageStart}→${leg.artifactCoverageEnd} != canonical ${leg.canonicalCoverageStart}→${leg.canonicalCoverageEnd}`
      );
    }
    if (leg.readModelPath?.includes("usageSimulator/service.getSimulatedUsageForHouseScenario")) {
      violations.push(`${leg.legId}: legacy GapFill manual read path still hits usageSimulator/service`);
    }
    if (
      leg.validationResultHash &&
      leg.validationResultHash !== stableManualProofHash({ ok: true, error: null })
    ) {
      violations.push(`${leg.legId}: canonical manual validation failed for resolved payload`);
    }
    if (
      resolveManualProofComparisonFamily(leg.legId) === "gapfill_derived_payload_parity" &&
      auditProofFamily === "GAPFILL_DERIVED" &&
      !leg.gapfillActualComparison
    ) {
      violations.push(`${leg.legId}: gapfill actual comparison unavailable for source-interval-derived mode`);
    }
    if (
      leg.fixtureArtifactInputHash &&
      leg.artifactInputHash &&
      leg.fixtureArtifactInputHash !== leg.artifactInputHash
    ) {
      violations.push(
        `${leg.legId}: live artifactInputHash ${leg.artifactInputHash} != manifest-pinned ${leg.fixtureArtifactInputHash}`
      );
    }
  }

  const comparable = args.legs.filter(inScope);
  const userRefLegId = args.auditManualMode === "MONTHLY" ? "user_manual_monthly" : "user_manual_annual";
  const samePayloadAnchorIds: ManualCrossSurfaceProofLegId[] =
    args.auditManualMode === "MONTHLY"
      ? ["user_manual_monthly", "manual_monthly_lab", "one_path_admin_manual_monthly", "gapfill_manual_monthly"]
      : ["user_manual_annual", "one_path_admin_manual_annual"];
  const samePayloadAnchors =
    auditProofFamily === "SAME_PAYLOAD"
      ? comparable.filter((leg) => samePayloadAnchorIds.includes(leg.legId))
      : [];
  const anchorReference =
    samePayloadAnchors.find((leg) => leg.legId === userRefLegId) ??
    samePayloadAnchors.find((leg) => leg.legId.startsWith("user_")) ??
    samePayloadAnchors[0] ??
    null;
  const manifestAnchorHash = manifestIsolation.anchorNormalizedPayloadHash;

  if (auditProofFamily === "SAME_PAYLOAD" && anchorReference?.normalizedPayloadHash) {
    if (manifestAnchorHash && anchorReference.normalizedPayloadHash !== manifestAnchorHash) {
      violations.push(
        `same_payload_parity: ${anchorReference.legId}: normalizedPayloadHash != manifest samePayloadAnchor`
      );
    }
    for (const leg of samePayloadAnchors) {
      if (leg.legId === anchorReference.legId) continue;
      if (leg.normalizedPayloadHash && leg.normalizedPayloadHash !== anchorReference.normalizedPayloadHash) {
        violations.push(`same_payload_parity: ${leg.legId}: normalizedPayloadHash != ${anchorReference.legId}`);
      }
      if (
        leg.billPeriodHash &&
        anchorReference.billPeriodHash &&
        leg.billPeriodHash !== anchorReference.billPeriodHash
      ) {
        violations.push(`same_payload_parity: ${leg.legId}: billPeriodHash != ${anchorReference.legId}`);
      }
      if (
        leg.statementRangesHash &&
        anchorReference.statementRangesHash &&
        leg.statementRangesHash !== anchorReference.statementRangesHash
      ) {
        violations.push(`same_payload_parity: ${leg.legId}: statementRangesHash != ${anchorReference.legId}`);
      }
      if (
        leg.validationResultHash &&
        anchorReference.validationResultHash &&
        leg.validationResultHash !== anchorReference.validationResultHash
      ) {
        violations.push(`same_payload_parity: ${leg.legId}: validationResultHash != ${anchorReference.legId}`);
      }
    }
  }

  const gapfillManualLeg = samePayloadAnchors.find((leg) => leg.legId === "gapfill_manual_monthly");
  if (auditProofFamily === "SAME_PAYLOAD" && gapfillManualLeg && anchorReference?.normalizedPayloadHash) {
    if (gapfillManualLeg.normalizedPayloadHash !== anchorReference.normalizedPayloadHash) {
      violations.push("same_payload_parity: gapfill_manual_monthly normalizedPayloadHash != anchor");
    } else if (
      gapfillManualLeg.finalizedDailyRowsHash &&
      anchorReference.finalizedDailyRowsHash &&
      gapfillManualLeg.finalizedDailyRowsHash !== anchorReference.finalizedDailyRowsHash
    ) {
      violations.push(
        "same_payload_parity: gapfill_manual_monthly finalizedDailyRowsHash != user/lab anchor with same payload"
      );
    }
  }

  if (auditProofFamily === "SAME_PAYLOAD") {
    const samePayloadHashGroups = new Map<string, ManualCrossSurfaceProofLeg[]>();
    for (const leg of samePayloadAnchors) {
      if (!leg.normalizedPayloadHash) continue;
      const cohortKey = `${leg.normalizedPayloadHash}:${leg.applyAdminRemap === true ? "admin_remap" : "user_read"}`;
      const group = samePayloadHashGroups.get(cohortKey) ?? [];
      group.push(leg);
      samePayloadHashGroups.set(cohortKey, group);
    }
    const allSamePayloadDaily = new Set(samePayloadAnchors.map((leg) => leg.finalizedDailyRowsHash).filter(Boolean));
    if (allSamePayloadDaily.size > 1) {
      violations.push(
        `same_payload_parity: finalizedDailyRowsHash differs across same-payload legs (${samePayloadAnchors
          .map((leg) => `${leg.legId}:${leg.finalizedDailyRowsHash}`)
          .join(", ")})`
      );
    }
    for (const [cohortKey, group] of samePayloadHashGroups) {
      if (group.length < 2) continue;
      const uniqueMonthly = new Set(group.map((leg) => leg.monthlyRowsHash).filter(Boolean));
      if (uniqueMonthly.size > 1) {
        violations.push(`same_payload_parity: monthlyRowsHash differs for ${cohortKey}`);
      }
      const uniqueDisplayTruth = new Set(group.map((leg) => leg.displayTruthRevision).filter(Boolean));
      if (uniqueDisplayTruth.size > 1) {
        violations.push(`same_payload_parity: displayTruthRevision differs for ${cohortKey}`);
      }
    }
  }

  const derivedComparable = comparable.filter(
    (entry) => resolveManualProofComparisonFamily(entry.legId) === "gapfill_derived_payload_parity"
  );
  const userRef = comparable.find((leg) => leg.legId === userRefLegId);
  for (const leg of derivedComparable) {
    if (
      userRef?.normalizedPayloadHash &&
      leg.normalizedPayloadHash &&
      leg.normalizedPayloadHash === userRef.normalizedPayloadHash
    ) {
      warnings.push(
        `${leg.legId}: interval-derived payload normalized hash equals user-entered payload — verify derivation path`
      );
    }
    if (
      userRef?.normalizedPayloadHash &&
      leg.gapfillDerivedPayloadHash &&
      leg.gapfillDerivedPayloadHash !== userRef.normalizedPayloadHash
    ) {
      warnings.push(
        `${leg.legId}: gapfillDerivedPayloadHash differs from user-entered payload — expected for GAPFILL_DERIVED family`
      );
    }
    if (leg.gapfillActualComparison && (leg.gapfillActualComparison as { ok?: boolean }).ok === false) {
      violations.push(`${leg.legId}: gapfill actual comparison failed for derived payload`);
    }
  }

  if (derivedComparable.length > 1) {
    const uniqueDerivedDaily = new Set(derivedComparable.map((leg) => leg.finalizedDailyRowsHash).filter(Boolean));
    if (uniqueDerivedDaily.size > 1) {
      warnings.push("gapfill_derived_payload_parity: multiple derived-mode legs present with different read-model hashes");
    }
  }

  const facade = args.onePathFacadeParity ?? null;
  if (facade && facade.ok === false && Array.isArray(facade.mismatches) && facade.mismatches.length > 0) {
    violations.push(`onePathSim/manual* facade differs from manualUsage/* (${facade.mismatches.join("; ")})`);
  }

  if (args.auditManualMode === "MONTHLY") {
    const annualLegs = args.legs.filter((leg) => leg.payloadMode === "ANNUAL" && leg.status === "ok");
    if (annualLegs.length > 0) warnings.push("annual legs returned ok while AUDIT_MANUAL_MODE=MONTHLY");
  }

  return { violations: Array.from(new Set(violations)), warnings: Array.from(new Set(warnings)), auditProofFamily };
}

export async function runOnePathManualFacadeParityCheck(args: {
  samplePayloads: ManualUsagePayload[];
}): Promise<{ ok: boolean; checked: string[]; mismatches: string[] }> {
  const mismatches: string[] = [];
  const checked = ["validateManualUsagePayload", "buildManualBillPeriodTargets"];
  const liveValidation = await import("@/modules/manualUsage/validation");
  const forkValidation = await import("@/modules/onePathSim/manualValidation");
  const liveStatementRanges = await import("@/modules/manualUsage/statementRanges");
  const forkStatementRanges = await import("@/modules/onePathSim/manualStatementRanges");
  for (const payload of args.samplePayloads) {
    const live = liveValidation.validateManualUsagePayload(payload);
    const fork = forkValidation.validateManualUsagePayload(payload as never);
    if (live.ok !== fork.ok || (!live.ok && live.error !== (fork as { error?: string }).error)) {
      mismatches.push(
        `validateManualUsagePayload(${payload.mode}): live=${live.ok ? "ok" : live.error} fork=${fork.ok ? "ok" : (fork as { error?: string }).error}`
      );
    }
    const liveTargets = liveStatementRanges.buildManualBillPeriodTargets(payload);
    const forkTargets = forkStatementRanges.buildManualBillPeriodTargets(payload as never);
    if (stableManualProofHash(liveTargets) !== stableManualProofHash(forkTargets)) {
      mismatches.push(`buildManualBillPeriodTargets(${payload.mode}) hash mismatch`);
    }
  }
  return { ok: mismatches.length === 0, checked, mismatches };
}
