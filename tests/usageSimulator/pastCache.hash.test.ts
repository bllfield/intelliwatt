import { describe, expect, it } from "vitest";
import { computePastInputHash } from "@/modules/usageSimulator/pastCache";

describe("past cache hash invalidation", () => {
  const basePayload = {
    engineVersion: "production_past_stitched_v2",
    windowStartUtc: "2025-01-01",
    windowEndUtc: "2025-12-31",
    timezone: "America/Chicago",
    travelRanges: [{ startDate: "2025-07-01", endDate: "2025-07-10" }],
    buildInputs: { mode: "SMT_BASELINE", canonicalEndMonth: "2025-12" } as Record<string, unknown>,
    intervalDataFingerprint: "35136:1735689600000:hash_a",
    usageShapeProfileId: "profile_1",
    usageShapeProfileVersion: "8",
    usageShapeProfileDerivedAt: "2026-03-10T10:00:00.000Z",
    usageShapeProfileSimHash: "shape_hash_a",
    weatherIdentity: "weather_hash_a",
  };

  it("changes when interval fingerprint changes (value-only edits)", () => {
    const a = computePastInputHash(basePayload);
    const b = computePastInputHash({
      ...basePayload,
      intervalDataFingerprint: "35136:1735689600000:hash_b",
    });
    expect(a).not.toBe(b);
  });

  it("changes when usage-shape profile version changes", () => {
    const a = computePastInputHash(basePayload);
    const b = computePastInputHash({
      ...basePayload,
      usageShapeProfileVersion: "9",
    });
    expect(a).not.toBe(b);
  });

  it("changes when usage-shape profile sim hash changes", () => {
    const a = computePastInputHash(basePayload);
    const b = computePastInputHash({
      ...basePayload,
      usageShapeProfileSimHash: "shape_hash_b",
    });
    expect(a).not.toBe(b);
  });

  it("changes when weather identity changes", () => {
    const a = computePastInputHash(basePayload);
    const b = computePastInputHash({
      ...basePayload,
      weatherIdentity: "weather_hash_b",
    });
    expect(a).not.toBe(b);
  });

  it("does not change for test-selection-only fields outside shared identity", () => {
    const a = computePastInputHash(basePayload);
    const b = computePastInputHash({
      ...(basePayload as any),
      testDays: 21,
      testMode: "fixed",
      testRanges: [{ startDate: "2025-04-01", endDate: "2025-04-07" }],
      seed: "seed-1",
    } as any);
    expect(a).toBe(b);
  });
});

