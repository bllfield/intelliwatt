import { describe, expect, it } from "vitest";
import {
  GAPFILL_CANONICAL_LAB_TREATMENT_MODE,
  readEffectiveValidationFromBuildInputs,
  serializeFingerprintBuildFreshnessFromDatasetMeta,
} from "@/lib/api/gapfillLabAdminSerialization";

describe("serializeFingerprintBuildFreshnessFromDatasetMeta", () => {
  it("returns null when meta has no artifact keys", () => {
    expect(serializeFingerprintBuildFreshnessFromDatasetMeta({})).toBeNull();
  });

  it("maps hash match to ready state", () => {
    const s = serializeFingerprintBuildFreshnessFromDatasetMeta({
      artifactHashMatch: true,
      artifactUpdatedAt: "2026-01-01T00:00:00.000Z",
      artifactSourceNote: "note",
      artifactRecomputed: false,
    });
    expect(s?.state).toBe("ready");
    expect(s?.builtAt).toBe("2026-01-01T00:00:00.000Z");
    expect(s?.staleReason).toBe("note");
  });
});

describe("readEffectiveValidationFromBuildInputs", () => {
  it("reads effective mode from build inputs when present", () => {
    const r = readEffectiveValidationFromBuildInputs(
      { effectiveValidationSelectionMode: "stratified_weather_balanced" },
      "manual"
    );
    expect(r.effectiveValidationSelectionMode).toBe("stratified_weather_balanced");
    expect(r.fromBuildInputs).toBe(true);
  });

  it("falls back without fabricating", () => {
    const r = readEffectiveValidationFromBuildInputs({}, "manual");
    expect(r.effectiveValidationSelectionMode).toBe("manual");
    expect(r.fromBuildInputs).toBe(false);
  });
});

describe("GAPFILL_CANONICAL_LAB_TREATMENT_MODE", () => {
  it("is the serialized treatmentMode for run_test_home_canonical_recalc today (fixed key; not a multi-mode selector)", () => {
    expect(GAPFILL_CANONICAL_LAB_TREATMENT_MODE).toBe("actual_data_fingerprint");
  });
});
