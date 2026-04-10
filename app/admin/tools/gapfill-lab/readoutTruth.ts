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
  const travelRangeSource =
    asArray(travelRanges?.ranges).length > 0
      ? travelRanges?.ranges
      : asArray(sourceTruthContext?.travelRangesUsed).length > 0
        ? sourceTruthContext?.travelRangesUsed
        : args.fallbackTravelRanges;
  const validationKeySource =
    asArray(validationKeys?.localDateKeys).length > 0
      ? validationKeys?.localDateKeys
      : asArray(sourceTruthContext?.validationTestKeysUsed).length > 0
        ? sourceTruthContext?.validationTestKeysUsed
        : args.fallbackValidationKeys;
  const validationRowsCount =
    toFiniteNumber(projectionReadSummary?.validationRowsCount) ??
    (Array.isArray(args.compareProjection?.rows) ? args.compareProjection.rows.length : null);

  return {
    sourceHouseId:
      coalesceMeaningfulString(sourceContext?.sourceHouseId, perRunTrace?.sourceHouseId, identityContext?.sourceHouseId) ?? "—",
    profileHouseId:
      coalesceMeaningfulString(profileContext?.profileHouseId, perRunTrace?.profileHouseId, identityContext?.profileHouseId) ?? "—",
    mode: coalesceMeaningfulString(lockboxInput?.mode, identityContext?.simulatorMode, identityContext?.usageInputMode) ?? "—",
    travelRanges: summarizeRanges(travelRangeSource),
    validationKeys: summarizeValidationKeys(validationKeySource),
    sourceDerivedMonthlyTotalsKwhByMonth: JSON.stringify(
      sourceContext?.sourceDerivedMonthlyTotalsKwhByMonth ?? sourceTruthContext?.sourceDerivedMonthlyTotalsKwhByMonth ?? null
    ),
    sourceDerivedAnnualTotalKwh: (() => {
      const value = toFiniteNumber(sourceContext?.sourceDerivedAnnualTotalKwh ?? sourceTruthContext?.sourceDerivedAnnualTotalKwh);
      return value != null ? value.toFixed(2) : "—";
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
