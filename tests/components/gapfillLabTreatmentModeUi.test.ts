import { describe, expect, it } from "vitest";

/**
 * GapFillLabCanonicalClient maps `result.treatmentMode` to visibility only (no client-side treatment logic).
 * This test documents that contract without importing the full client bundle.
 */
function treatmentModeFromApiOnly(r: { treatmentMode?: string | null } | null): string | null {
  if (!r) return null;
  return r.treatmentMode ?? null;
}

describe("GapFillLabCanonicalClient treatmentMode visibility", () => {
  it("uses API treatmentMode only — does not infer a mode", () => {
    expect(treatmentModeFromApiOnly(null)).toBeNull();
    expect(treatmentModeFromApiOnly({})).toBeNull();
    expect(treatmentModeFromApiOnly({ treatmentMode: null })).toBeNull();
    expect(treatmentModeFromApiOnly({ treatmentMode: "actual_data_fingerprint" })).toBe("actual_data_fingerprint");
  });
});
