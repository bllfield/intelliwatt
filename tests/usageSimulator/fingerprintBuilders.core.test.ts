import { describe, expect, it } from "vitest";
import {
  prebuildSimulatorFingerprints,
  ensureSimulatorFingerprintsForRecalc,
} from "@/modules/usageSimulator/fingerprintOrchestration";
import { fingerprintIsStaleForExpectedSourceHash } from "@/modules/usageSimulator/fingerprintFreshness";
import {
  computeWholeHomeSourceHashFromInputs,
  pickWholeHomeFingerprintInputs,
} from "@/modules/usageSimulator/wholeHomeFingerprintBuilder";
import { computeUsageFingerprintSourceHash } from "@/modules/usageSimulator/usageFingerprintBuilder";

describe("fingerprint builder entrypoints (Section 11 / Phase 2b)", () => {
  it("exposes the same function for prebuild and recalc orchestration", () => {
    expect(prebuildSimulatorFingerprints).toBe(ensureSimulatorFingerprintsForRecalc);
  });
});

describe("fingerprintFreshness", () => {
  it("treats missing row as stale", () => {
    expect(fingerprintIsStaleForExpectedSourceHash(null, "a")).toBe(true);
  });
  it("detects hash mismatch as stale", () => {
    expect(fingerprintIsStaleForExpectedSourceHash({ sourceHash: "old" }, "new")).toBe(true);
    expect(fingerprintIsStaleForExpectedSourceHash({ sourceHash: "same" }, "same")).toBe(false);
  });
});

describe("WholeHomeFingerprint builder hashing", () => {
  it("changes source hash when audited home fields change", () => {
    const a = pickWholeHomeFingerprintInputs({
      homeProfile: { squareFeet: 2000 },
      applianceProfile: { fuelConfiguration: "all_electric", appliances: [] },
    });
    const b = pickWholeHomeFingerprintInputs({
      homeProfile: { squareFeet: 2100 },
      applianceProfile: { fuelConfiguration: "all_electric", appliances: [] },
    });
    expect(computeWholeHomeSourceHashFromInputs(a)).not.toBe(computeWholeHomeSourceHashFromInputs(b));
  });
});

describe("UsageFingerprint source hash", () => {
  it("includes interval and weather identity in hash material", () => {
    const h1 = computeUsageFingerprintSourceHash({
      intervalDataFingerprint: "i1",
      weatherIdentity: "w1",
      windowStart: "2025-01-01",
      windowEnd: "2025-12-31",
    });
    const h2 = computeUsageFingerprintSourceHash({
      intervalDataFingerprint: "i2",
      weatherIdentity: "w1",
      windowStart: "2025-01-01",
      windowEnd: "2025-12-31",
    });
    expect(h1).not.toBe(h2);
  });
});
