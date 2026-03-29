/**
 * Shared cohort/archetype prior (UNIFIED_SIM_FINGERPRINT_PLAN §18).
 * Deterministic bucketing from audited home/appliance features — not single-house copy.
 */

import { resolveCanonicalUsage365CoverageWindow } from "@/modules/usageSimulator/metadataWindow";
import { sha256HexUtf8, stableStringify } from "@/modules/usageSimulator/fingerprintHash";
import { pickWholeHomeFingerprintInputs } from "@/modules/usageSimulator/wholeHomeFingerprintInputs";

export const COHORT_PRIOR_VERSION = "cohort_prior_v1";
export const SIMILARITY_FEATURE_VECTOR_VERSION = "sfv_v1";

export type CohortPriorV1 = {
  cohortPriorVersion: typeof COHORT_PRIOR_VERSION;
  similarityFeatureVectorVersion: typeof SIMILARITY_FEATURE_VECTOR_VERSION;
  climateWindowIdentity: {
    startDate: string;
    endDate: string;
    source: "canonical_usage_365";
  };
  /** Stable id for this archetype bucket (hash of binned features + versions). */
  archetypeKey: string;
  /** Hash of binned feature vector (auditable identity). */
  featureVectorHash: string;
  priorComponents: {
    baselineLoadKwhPerDayHint: number;
    hvacSensitivityHint: number;
    poolLoadShareHint: number;
    evLoadShareHint: number;
  };
  /** 0–1; reduced when inputs are sparse. */
  confidence: number;
  confidenceNotes: string[];
};

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function str(v: unknown): string {
  return String(v ?? "").trim();
}

/** Bin envelope scale for archetype clustering (no per-house copy). */
function binSquareFeet(sqft: number | null): string {
  if (sqft == null || sqft <= 0) return "unknown";
  if (sqft < 1200) return "s_lt_1200";
  if (sqft < 2000) return "s_1200_2000";
  if (sqft < 3000) return "s_2000_3000";
  if (sqft < 4500) return "s_3000_4500";
  return "s_ge_4500";
}

function binStories(st: unknown): string {
  const n = num(st);
  if (n == null || n <= 0) return "unknown";
  if (n <= 1) return "one";
  if (n <= 2) return "two";
  return "three_plus";
}

function catKey(prefix: string, v: unknown): string {
  const s = str(v);
  if (!s) return `${prefix}:empty`;
  return `${prefix}:${s.slice(0, 48)}`;
}

/**
 * Build deterministic cohort prior from home + appliance snapshots.
 * Uses canonical 365 coverage window as climate scope identity only (shared-window rules).
 */
export function buildCohortPriorV1(args: {
  homeProfile: Record<string, unknown> | null | undefined;
  applianceProfile: Record<string, unknown> | null | undefined;
}): CohortPriorV1 {
  const picked = pickWholeHomeFingerprintInputs(args);
  const win = resolveCanonicalUsage365CoverageWindow();

  const sqft = num(picked.squareFeet);
  const bins = {
    squareFeetBin: binSquareFeet(sqft),
    storiesBin: binStories(picked.stories),
    insulation: catKey("ins", picked.insulationType),
    window: catKey("win", picked.windowType),
    foundation: catKey("found", picked.foundation),
    fuel: catKey("fuel", picked.fuelConfiguration),
    hvac: catKey("hvac", picked.hvacType),
    heat: catKey("heat", picked.heatingType),
    occWork: catKey("ow", picked.occupantsWork),
    occSchool: catKey("os", picked.occupantsSchool),
    occHome: catKey("oh", picked.occupantsHomeAllDay),
    pool: picked.hasPool === true ? "pool_y" : "pool_n",
    ev: picked.evHasVehicle === true ? "ev_y" : "ev_n",
  };

  const featureVectorHash = sha256HexUtf8(
    stableStringify({
      v: SIMILARITY_FEATURE_VECTOR_VERSION,
      bins,
      climate: { start: win.startDate, end: win.endDate },
    })
  );

  const archetypeKey = sha256HexUtf8(
    stableStringify({
      cohortPriorVersion: COHORT_PRIOR_VERSION,
      featureVectorHash,
    })
  );

  const sqftMid =
    sqft != null && sqft > 0
      ? sqft
      : picked.squareFeet != null
        ? 2000
        : 1800;
  const baselineLoadKwhPerDayHint = Math.min(80, Math.max(8, sqftMid / 220));

  const insStr = str(picked.insulationType).toLowerCase();
  let hvacSensitivityHint = 0.85;
  if (insStr.includes("poor") || insStr.includes("minimal")) hvacSensitivityHint = 1.15;
  else if (insStr.includes("good") || insStr.includes("excellent")) hvacSensitivityHint = 0.7;

  const poolLoadShareHint = picked.hasPool === true ? 0.08 : 0.02;
  const evLoadShareHint = picked.evHasVehicle === true ? 0.12 : 0.02;

  const auditedKeys = [
    "squareFeet",
    "stories",
    "insulationType",
    "fuelConfiguration",
    "hvacType",
    "heatingType",
    "occupantsHomeAllDay",
    "hasPool",
    "evHasVehicle",
  ] as const;
  let filled = 0;
  for (const k of auditedKeys) {
    const val = picked[k];
    if (val !== null && val !== undefined && str(val) !== "") filled += 1;
  }
  const coverage = filled / auditedKeys.length;
  const confidence = Math.min(0.92, 0.35 + coverage * 0.55);
  const confidenceNotes: string[] = [];
  if (coverage < 0.5) confidenceNotes.push("sparse_home_fields");
  if (sqft == null || sqft <= 0) confidenceNotes.push("square_feet_missing_using_default_scale");

  return {
    cohortPriorVersion: COHORT_PRIOR_VERSION,
    similarityFeatureVectorVersion: SIMILARITY_FEATURE_VECTOR_VERSION,
    climateWindowIdentity: {
      startDate: win.startDate,
      endDate: win.endDate,
      source: "canonical_usage_365",
    },
    archetypeKey,
    featureVectorHash,
    priorComponents: {
      baselineLoadKwhPerDayHint,
      hvacSensitivityHint,
      poolLoadShareHint,
      evLoadShareHint,
    },
    confidence,
    confidenceNotes,
  };
}
