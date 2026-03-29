/**
 * Gap-Fill Lab admin API serialization (plan §7, §13).
 * Routes may call these to attach authoritative visibility fields — no simulation math.
 */

/**
 * Serialized on `run_test_home_canonical_recalc` as `treatmentMode` today.
 *
 * This is the plan §24 **label** for what this route actually runs: SMT_BASELINE Past sim with
 * actual-interval context (see `simulatorMode: "SMT_BASELINE"` on the same response). It is not a
 * runtime switch and does **not** implement a future multi-row §24 admin treatment selector by itself.
 */
export const GAPFILL_CANONICAL_LAB_TREATMENT_MODE = "actual_data_fingerprint" as const;

export type FingerprintBuildFreshnessPayload = {
  /** High-level lifecycle when derivable from persisted artifact read metadata only. */
  state: "ready" | "stale" | "building" | "failed" | null;
  builtAt: string | null;
  staleReason: string | null;
  artifactHashMatch: boolean | null;
  artifactSourceMode: string | null;
  artifactRecomputed: boolean | null;
};

/**
 * Serialize fingerprint/build freshness from `dataset.meta` after canonical read.
 * Does not fabricate values: unknown fields remain null.
 */
export function serializeFingerprintBuildFreshnessFromDatasetMeta(
  meta: Record<string, unknown> | null | undefined
): FingerprintBuildFreshnessPayload | null {
  if (!meta || typeof meta !== "object") return null;
  const hasAny =
    "artifactHashMatch" in meta ||
    "artifactUpdatedAt" in meta ||
    "artifactSourceNote" in meta ||
    "artifactSourceMode" in meta ||
    "artifactRecomputed" in meta;
  if (!hasAny) return null;

  const artifactHashMatch =
    typeof meta.artifactHashMatch === "boolean" ? meta.artifactHashMatch : null;
  const artifactRecomputed =
    typeof meta.artifactRecomputed === "boolean" ? meta.artifactRecomputed : null;
  const artifactSourceMode =
    typeof meta.artifactSourceMode === "string" ? meta.artifactSourceMode : null;
  const builtAtRaw = meta.artifactUpdatedAt;
  const builtAt =
    typeof builtAtRaw === "string"
      ? builtAtRaw
      : builtAtRaw != null
        ? String(builtAtRaw)
        : null;
  const staleReason =
    typeof meta.artifactSourceNote === "string" ? meta.artifactSourceNote : null;

  let state: FingerprintBuildFreshnessPayload["state"] = null;
  if (artifactRecomputed === true) {
    state = "building";
  } else if (artifactHashMatch === true) {
    state = "ready";
  } else if (artifactHashMatch === false) {
    state = "stale";
  }

  return {
    state,
    builtAt,
    staleReason,
    artifactHashMatch,
    artifactSourceMode,
    artifactRecomputed,
  };
}

export function readEffectiveValidationFromBuildInputs(
  buildInputs: Record<string, unknown> | null | undefined,
  fallbackMode: string
): { effectiveValidationSelectionMode: string; fromBuildInputs: boolean } {
  if (!buildInputs || typeof buildInputs !== "object") {
    return { effectiveValidationSelectionMode: fallbackMode, fromBuildInputs: false };
  }
  const ev = buildInputs.effectiveValidationSelectionMode;
  if (typeof ev === "string" && ev.trim()) {
    return { effectiveValidationSelectionMode: ev.trim(), fromBuildInputs: true };
  }
  return { effectiveValidationSelectionMode: fallbackMode, fromBuildInputs: false };
}
