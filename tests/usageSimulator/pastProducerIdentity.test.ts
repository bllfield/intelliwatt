import { describe, expect, it } from "vitest";
import { computePastInputHash } from "@/modules/usageSimulator/pastCache";
import { normalizePastProducerBuildPathKind } from "@/modules/simulatedUsage/pastProducerBuildPath";

describe("past producer identity (architecture contract)", () => {
  it("normalizes cold_build to the same producer path kind as recalc", () => {
    expect(normalizePastProducerBuildPathKind("cold_build")).toBe("recalc");
    expect(normalizePastProducerBuildPathKind("recalc")).toBe("recalc");
    expect(normalizePastProducerBuildPathKind("lab_validation")).toBe("lab_validation");
  });

  it("changes Past input hash when validation test-day selection changes so cached rows cannot mix old TEST outputs", () => {
    const shared = {
      engineVersion: "production_past_stitched_v2",
      windowStartUtc: "2026-01-01",
      windowEndUtc: "2026-12-31",
      timezone: "America/Chicago",
      travelRanges: [] as Array<{ startDate: string; endDate: string }>,
      intervalDataFingerprint: "fp",
      usageShapeProfileId: null as string | null,
      usageShapeProfileVersion: null as string | null,
      usageShapeProfileDerivedAt: null as string | null,
      usageShapeProfileSimHash: null as string | null,
      weatherIdentity: "wx",
    };
    const h1 = computePastInputHash({
      ...shared,
      buildInputs: {
        version: 1,
        mode: "SMT_BASELINE",
        validationOnlyDateKeysLocal: ["2026-06-01"],
      } as Record<string, unknown>,
    });
    const h2 = computePastInputHash({
      ...shared,
      buildInputs: {
        version: 1,
        mode: "SMT_BASELINE",
        validationOnlyDateKeysLocal: ["2026-06-02"],
      } as Record<string, unknown>,
    });
    expect(h1).not.toBe(h2);
  });

  it("changes Past input hash when travel/vacant ranges change so cached rows cannot mix old TRAVEL_VACANT outputs", () => {
    const shared = {
      engineVersion: "production_past_stitched_v2",
      windowStartUtc: "2026-01-01",
      windowEndUtc: "2026-12-31",
      timezone: "America/Chicago",
      buildInputs: { version: 1, mode: "SMT_BASELINE" } as Record<string, unknown>,
      intervalDataFingerprint: "fp",
      usageShapeProfileId: null as string | null,
      usageShapeProfileVersion: null as string | null,
      usageShapeProfileDerivedAt: null as string | null,
      usageShapeProfileSimHash: null as string | null,
      weatherIdentity: "wx",
    };
    const h1 = computePastInputHash({
      ...shared,
      travelRanges: [{ startDate: "2026-03-01", endDate: "2026-03-05" }],
    });
    const h2 = computePastInputHash({
      ...shared,
      travelRanges: [{ startDate: "2026-03-02", endDate: "2026-03-06" }],
    });
    expect(h1).not.toBe(h2);
  });

  it("changes Past input hash when engineVersion identity changes so calculation-version outputs cannot mix in cache", () => {
    const shared = {
      windowStartUtc: "2026-01-01",
      windowEndUtc: "2026-12-31",
      timezone: "America/Chicago",
      travelRanges: [] as Array<{ startDate: string; endDate: string }>,
      buildInputs: { mode: "SMT_BASELINE" } as Record<string, unknown>,
      intervalDataFingerprint: "fp",
      usageShapeProfileId: null as string | null,
      usageShapeProfileVersion: null as string | null,
      usageShapeProfileDerivedAt: null as string | null,
      usageShapeProfileSimHash: null as string | null,
      weatherIdentity: "wx",
    };
    const h1 = computePastInputHash({ ...shared, engineVersion: "production_past_stitched_v2" });
    const h2 = computePastInputHash({ ...shared, engineVersion: "production_past_stitched_v3" });
    expect(h1).not.toBe(h2);
  });
});
