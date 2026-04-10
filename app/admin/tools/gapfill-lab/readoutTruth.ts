type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function toFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function coalesceMeaningfulString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

export function formatIdentityReadout(value: unknown, missingLabel = "unavailable"): string {
  return coalesceMeaningfulString(value) ?? missingLabel;
}

function summarizeRanges(value: unknown): string {
  const list = asArray(value)
    .map((range) => {
      const record = asRecord(range);
      const start = coalesceMeaningfulString(record?.startDate);
      const end = coalesceMeaningfulString(record?.endDate);
      return start && end ? `${start} -> ${end}` : null;
    })
    .filter((value): value is string => Boolean(value));
  if (list.length === 0) return "none";
  return list.slice(0, 4).join(" | ") + (list.length > 4 ? ` | +${list.length - 4} more` : "");
}

function summarizeValidationKeys(value: unknown): string {
  const list = asArray(value)
    .map((entry) => String(entry ?? "").slice(0, 10))
    .filter((entry) => /^\d{4}-\d{2}-\d{2}$/.test(entry));
  if (list.length === 0) return "none";
  return `${list.length} key(s): ${list.slice(0, 6).join(", ")}${list.length > 6 ? ", ..." : ""}`;
}

export function buildPersistedHouseReadout(args: {
  dataset: any;
  sharedDiagnostics?: Record<string, unknown> | null;
  fallbackTravelRanges?: unknown;
  fallbackValidationKeys?: unknown;
  compareProjection?: { rows?: unknown } | null;
}) {
  const meta = asRecord(args.dataset?.meta);
  const lockboxInput = asRecord(meta?.lockboxInput);
  const perRunTrace = asRecord(meta?.lockboxPerRunTrace);
  const sourceContext = asRecord(lockboxInput?.sourceContext);
  const profileContext = asRecord(lockboxInput?.profileContext);
  const validationKeys = asRecord(lockboxInput?.validationKeys);
  const travelRanges = asRecord(lockboxInput?.travelRanges);
  const sharedDiagnostics = asRecord(args.sharedDiagnostics);
  const identityContext = asRecord(sharedDiagnostics?.identityContext);
  const sourceTruthContext = asRecord(sharedDiagnostics?.sourceTruthContext);
  const lockboxExecutionSummary = asRecord(sharedDiagnostics?.lockboxExecutionSummary);
  const projectionReadSummary = asRecord(sharedDiagnostics?.projectionReadSummary);
  const selectedMode =
    coalesceMeaningfulString(identityContext?.usageInputMode, lockboxInput?.mode, identityContext?.simulatorMode) ?? "—";
  const showSourceDerivedInputs =
    selectedMode === "MONTHLY_FROM_SOURCE_INTERVALS" || selectedMode === "ANNUAL_FROM_SOURCE_INTERVALS";
  const travelRangesFromLockbox = asArray(travelRanges?.ranges);
  const travelRangesFromShared = asArray(sourceTruthContext?.travelRangesUsed);
  const validationKeysFromLockbox = asArray(validationKeys?.localDateKeys);
  const validationKeysFromShared = asArray(sourceTruthContext?.validationTestKeysUsed);
  const travelRangeSource = travelRangesFromLockbox.length > 0
    ? travelRangesFromLockbox
    : travelRangesFromShared.length > 0
      ? travelRangesFromShared
      : args.fallbackTravelRanges;
  const validationKeySource = validationKeysFromLockbox.length > 0
    ? validationKeysFromLockbox
    : validationKeysFromShared.length > 0
      ? validationKeysFromShared
      : args.fallbackValidationKeys;
  const sourceDerivedMonthlyTotals =
    sourceContext?.sourceDerivedMonthlyTotalsKwhByMonth ?? sourceTruthContext?.sourceDerivedMonthlyTotalsKwhByMonth ?? null;
  const sourceDerivedAnnualTotal =
    toFiniteNumber(sourceContext?.sourceDerivedAnnualTotalKwh ?? sourceTruthContext?.sourceDerivedAnnualTotalKwh);
  const validationRowsCount =
    toFiniteNumber(projectionReadSummary?.validationRowsCount) ??
    (Array.isArray(args.compareProjection?.rows) ? args.compareProjection.rows.length : null);

  return {
    sourceHouseId:
      coalesceMeaningfulString(sourceContext?.sourceHouseId, perRunTrace?.sourceHouseId, identityContext?.sourceHouseId) ?? "—",
    profileHouseId:
      coalesceMeaningfulString(profileContext?.profileHouseId, perRunTrace?.profileHouseId, identityContext?.profileHouseId) ?? "—",
    mode: selectedMode,
    travelRanges:
      summarizeRanges(travelRangeSource) +
      (travelRangesFromLockbox.length === 0 && travelRangesFromShared.length === 0 && asArray(args.fallbackTravelRanges).length > 0
        ? " (fallback context only)"
        : ""),
    validationKeys:
      summarizeValidationKeys(validationKeySource) +
      (validationKeysFromLockbox.length === 0 && validationKeysFromShared.length === 0 && asArray(args.fallbackValidationKeys).length > 0
        ? " (fallback context only)"
        : ""),
    sourceDerivedMonthlyTotalsKwhByMonth: showSourceDerivedInputs ? JSON.stringify(sourceDerivedMonthlyTotals) : "—",
    sourceDerivedAnnualTotalKwh: (() => {
      return showSourceDerivedInputs && sourceDerivedAnnualTotal != null ? sourceDerivedAnnualTotal.toFixed(2) : "—";
    })(),
    intervalFingerprint: formatIdentityReadout(
      coalesceMeaningfulString(sourceContext?.intervalFingerprint, sourceTruthContext?.intervalSourceIdentity)
    ),
    weatherIdentity: formatIdentityReadout(
      coalesceMeaningfulString(sourceContext?.weatherIdentity, sourceTruthContext?.weatherDatasetIdentity)
    ),
    usageShapeProfileIdentity: formatIdentityReadout(
      coalesceMeaningfulString(profileContext?.usageShapeProfileIdentity, sourceTruthContext?.intervalUsageFingerprintIdentity)
    ),
    inputHash:
      coalesceMeaningfulString(perRunTrace?.inputHash, identityContext?.inputHash, lockboxExecutionSummary?.artifactInputHash) ?? "—",
    fullChainHash:
      coalesceMeaningfulString(meta?.fullChainHash, perRunTrace?.fullChainHash, identityContext?.fullChainHash) ?? "—",
    artifactEngineVersion: coalesceMeaningfulString(lockboxExecutionSummary?.artifactEngineVersion) ?? "—",
    compareRowsCount: validationRowsCount != null ? String(validationRowsCount) : "—",
  };
}

export function buildStageTimingReadout(args: {
  stageTimings: Array<[string, unknown]>;
  artifactReadMode?: unknown;
}): {
  rows: Array<{ key: string; value: string }>;
  emptyMessage: string;
} {
  const rows = Array.isArray(args.stageTimings)
    ? args.stageTimings.map(([key, rawValue]) => ({
        key,
        rawValue,
      }))
    : [];
  const numericValues = rows
    .map((row) => toFiniteNumber(row.rawValue))
    .filter((value): value is number => value != null);
  const hasNonZeroTiming = numericValues.some((value) => Math.abs(value) > 0.0001);
  const artifactOnly = String(args.artifactReadMode ?? "").trim() === "artifact_only";

  if (rows.length === 0) {
    return {
      rows: [],
      emptyMessage: artifactOnly
        ? "Not available on artifact-only read."
        : "No stage timings were attached to this persisted read.",
    };
  }

  if (!hasNonZeroTiming) {
    return {
      rows: [],
      emptyMessage: artifactOnly
        ? "Not available on artifact-only read."
        : "This persisted read only contains zeroed timing placeholders.",
    };
  }

  return {
    rows: rows.map((row) => ({
      key: row.key,
      value:
        typeof row.rawValue === "number" && Number.isFinite(row.rawValue)
          ? `${row.rawValue} ms`
          : String(row.rawValue),
    })),
    emptyMessage: "",
  };
}

export function buildActualDiagnosticsHeaderReadout(args: {
  pastSimSnapshot: Record<string, unknown> | null;
  actualHouseBaselineDataset: any;
}) {
  const snapshot = asRecord(args.pastSimSnapshot);
  const recalc = asRecord(snapshot?.recalc);
  const build = asRecord(snapshot?.build);
  const engineIdentity = asRecord(asRecord(snapshot?.engineContext)?.identity);
  const sharedDiagnostics = asRecord(snapshot?.sharedDiagnostics);
  const sourceTruthContext = asRecord(sharedDiagnostics?.sourceTruthContext);
  const datasetMeta = asRecord(args.actualHouseBaselineDataset?.meta);
  const lockboxInput = asRecord(datasetMeta?.lockboxInput);
  const sourceContext = asRecord(lockboxInput?.sourceContext);

  return {
    recalcExecutionMode: String(recalc?.executionMode ?? "—"),
    recalcCorrelationId: String(recalc?.correlationId ?? "—"),
    buildMode: String(build?.mode ?? "—"),
    buildInputsHash: String(build?.buildInputsHash ?? "—"),
    weatherIdentity: formatIdentityReadout(
      coalesceMeaningfulString(
        engineIdentity?.weatherIdentity,
        sourceTruthContext?.weatherDatasetIdentity,
        sourceContext?.weatherIdentity,
        datasetMeta?.weatherDatasetIdentity
      )
    ),
    intervalFingerprint: formatIdentityReadout(
      coalesceMeaningfulString(
        engineIdentity?.intervalDataFingerprint,
        sourceTruthContext?.intervalSourceIdentity,
        sourceContext?.intervalFingerprint
      )
    ),
  };
}

export function buildNonValidationSimulatedBaselineReadout(args: {
  diagnosticsVerdict?: Record<string, unknown> | null;
  sharedDiagnostics?: Record<string, unknown> | null;
}): {
  label: string;
  value: string;
  detail: string | null;
} {
  const verdict = asRecord(args.diagnosticsVerdict);
  const sharedDiagnostics = asRecord(args.sharedDiagnostics);
  const tuningSummary = asRecord(sharedDiagnostics?.tuningSummary);
  const sourceCounts = asRecord(tuningSummary?.sourceDetailCountsByCategory);
  const total = toFiniteNumber(verdict?.travelVacantSimulatedDatesInBaselineCount) ?? 0;
  const travelVacant = toFiniteNumber(sourceCounts?.SIMULATED_TRAVEL_VACANT);
  const incompleteMeter = toFiniteNumber(sourceCounts?.SIMULATED_INCOMPLETE_METER);

  const detailParts: string[] = [];
  if (travelVacant != null) detailParts.push(`travel/vacant=${travelVacant}`);
  if (incompleteMeter != null) detailParts.push(`incomplete meter=${incompleteMeter}`);

  const accountedFor =
    (travelVacant ?? 0) +
    (incompleteMeter ?? 0);
  if (detailParts.length > 0 && total > accountedFor) {
    detailParts.push(`other simulated=${total - accountedFor}`);
  }

  return {
    label: "nonValidationSimulatedDatesInBaselineCount",
    value: String(total),
    detail: detailParts.length > 0 ? `Includes ${detailParts.join(", ")}.` : null,
  };
}
