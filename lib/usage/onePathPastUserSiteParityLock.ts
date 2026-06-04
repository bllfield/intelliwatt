/**
 * Dirty-input detection for One Path lab Past builds.
 * Product goal: docs/ONE_PATH_DUAL_RUN_GOAL.md (dual-run, not artifact copy).
 */
import { createHash } from "crypto";

export type OnePathUserSiteParityLock = {
  sourceUserId: string;
  sourceHouseId: string;
  sourceScenarioId: string;
  testScenarioId: string;
  parityInputHash: string;
  parityBuildInputsSnapshotHash: string;
  syncedAt: string;
  sourceIntervalCount?: number;
  intervals15Count?: number;
};

export function stableParityBuildInputsSnapshot(
  buildInputs: Record<string, unknown>,
): string {
  const travelRanges = Array.isArray(buildInputs.travelRanges)
    ? (
        buildInputs.travelRanges as Array<{
          startDate?: string;
          endDate?: string;
        }>
      )
        .map((r) => ({
          startDate: String(r.startDate ?? "").slice(0, 10),
          endDate: String(r.endDate ?? "").slice(0, 10),
        }))
        .filter((r) => r.startDate && r.endDate)
        .sort((a, b) =>
          `${a.startDate}-${a.endDate}`.localeCompare(
            `${b.startDate}-${b.endDate}`,
          ),
        )
    : [];
  const validationKeys = Array.isArray(buildInputs.validationOnlyDateKeysLocal)
    ? (buildInputs.validationOnlyDateKeysLocal as unknown[])
        .map((v) => String(v ?? "").slice(0, 10))
        .filter((k) => /^\d{4}-\d{2}-\d{2}$/.test(k))
        .sort()
    : [];
  const canonical = {
    mode: String(buildInputs.mode ?? ""),
    weatherPreference: String(buildInputs.weatherPreference ?? ""),
    validationSelectionMode: String(
      buildInputs.effectiveValidationSelectionMode ??
        buildInputs.validationSelectionMode ??
        "",
    ),
    validationDayCount: Number(buildInputs.validationDayCount ?? 0) || 0,
    travelRanges,
    validationOnlyDateKeysLocal: validationKeys,
    resolvedSimFingerprintHash:
      buildInputs.resolvedSimFingerprint &&
      typeof buildInputs.resolvedSimFingerprint === "object"
        ? String(
            (buildInputs.resolvedSimFingerprint as { resolvedHash?: unknown })
              .resolvedHash ?? "",
          )
        : "",
  };
  return createHash("sha256")
    .update(JSON.stringify(canonical), "utf8")
    .digest("base64url")
    .slice(0, 22);
}

export function readOnePathUserSiteParityLock(
  buildInputs: Record<string, unknown> | null | undefined,
): OnePathUserSiteParityLock | null {
  const raw = buildInputs?.onePathUserSiteParity;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const p = raw as Record<string, unknown>;
  const parityInputHash = String(p.parityInputHash ?? "").trim();
  const sourceHouseId = String(p.sourceHouseId ?? "").trim();
  const sourceUserId = String(p.sourceUserId ?? "").trim();
  const sourceScenarioId = String(p.sourceScenarioId ?? "").trim();
  const testScenarioId = String(p.testScenarioId ?? "").trim();
  if (
    !parityInputHash ||
    !sourceHouseId ||
    !sourceUserId ||
    !sourceScenarioId ||
    !testScenarioId
  ) {
    return null;
  }
  return {
    sourceUserId,
    sourceHouseId,
    sourceScenarioId,
    testScenarioId,
    parityInputHash,
    parityBuildInputsSnapshotHash: String(
      p.parityBuildInputsSnapshotHash ?? "",
    ),
    syncedAt: String(p.syncedAt ?? ""),
    sourceIntervalCount:
      typeof p.sourceIntervalCount === "number"
        ? p.sourceIntervalCount
        : undefined,
    intervals15Count:
      typeof p.intervals15Count === "number" ? p.intervals15Count : undefined,
  };
}

export function isParityBuildInputsDirty(args: {
  currentBuildInputs: Record<string, unknown>;
  parity: OnePathUserSiteParityLock | null;
}): boolean {
  if (!args.parity?.parityBuildInputsSnapshotHash) return false;
  const current = stableParityBuildInputsSnapshot(args.currentBuildInputs);
  return current !== args.parity.parityBuildInputsSnapshotHash;
}

export function clearOnePathUserSiteParityFromBuildInputs(
  buildInputs: Record<string, unknown>,
): Record<string, unknown> {
  const next = { ...buildInputs };
  delete next.onePathUserSiteParity;
  return next;
}

export type PastParityVerification = {
  ok: boolean;
  parityInputHash: string | null;
  sourceIntervals15Count: number | null;
  testIntervals15Count: number | null;
  fifteenMinuteCurveMatch: boolean | null;
  message: string;
};

export function verifyPastDatasetParity(args: {
  sourceDataset: Record<string, unknown> | null;
  testDataset: Record<string, unknown> | null;
}): PastParityVerification {
  const sourceSeries = (args.sourceDataset?.series ?? {}) as {
    intervals15?: unknown;
  };
  const testSeries = (args.testDataset?.series ?? {}) as {
    intervals15?: unknown;
  };
  const sourceIntervals = Array.isArray(sourceSeries.intervals15)
    ? sourceSeries.intervals15
    : [];
  const testIntervals = Array.isArray(testSeries.intervals15)
    ? testSeries.intervals15
    : [];
  const sourceInsights = (args.sourceDataset?.insights ?? {}) as {
    fifteenMinuteAverages?: Array<{ hhmm: string; avgKw: number }>;
  };
  const testInsights = (args.testDataset?.insights ?? {}) as {
    fifteenMinuteAverages?: Array<{ hhmm: string; avgKw: number }>;
  };
  const sourceCurve = Array.isArray(sourceInsights.fifteenMinuteAverages)
    ? sourceInsights.fifteenMinuteAverages
    : [];
  const testCurve = Array.isArray(testInsights.fifteenMinuteAverages)
    ? testInsights.fifteenMinuteAverages
    : [];

  const curveMatch =
    sourceCurve.length > 0 && testCurve.length > 0
      ? JSON.stringify(sourceCurve) === JSON.stringify(testCurve)
      : sourceIntervals.length === testIntervals.length &&
        sourceIntervals.length > 0;

  return {
    ok: curveMatch,
    parityInputHash: null,
    sourceIntervals15Count: sourceIntervals.length,
    testIntervals15Count: testIntervals.length,
    fifteenMinuteCurveMatch: curveMatch,
    message: curveMatch
      ? "Past artifact parity OK (intervals / 15-minute curve)."
      : `Past artifact mismatch: source intervals=${sourceIntervals.length}, test intervals=${testIntervals.length}.`,
  };
}
