type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : null;
}

function toFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
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
