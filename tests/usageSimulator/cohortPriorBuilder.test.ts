import { describe, expect, it } from "vitest";
import { buildCohortPriorV1, COHORT_PRIOR_VERSION } from "@/modules/usageSimulator/cohortPriorBuilder";

describe("buildCohortPriorV1 (§18 cohort prior, no single-house copy)", () => {
  it("produces deterministic archetype keys from audited features only", () => {
    const a = buildCohortPriorV1({
      homeProfile: { squareFeet: 2000, insulationType: "average", fuelConfiguration: "all_electric" },
      applianceProfile: { fuelConfiguration: "all_electric", appliances: [] },
    });
    const b = buildCohortPriorV1({
      homeProfile: { squareFeet: 2000, insulationType: "average", fuelConfiguration: "all_electric" },
      applianceProfile: { fuelConfiguration: "all_electric", appliances: [] },
    });
    expect(a.archetypeKey).toBe(b.archetypeKey);
    expect(a.cohortPriorVersion).toBe(COHORT_PRIOR_VERSION);
    expect(a.confidence).toBeGreaterThan(0);
    expect(a.confidence).toBeLessThanOrEqual(0.92);
  });

  it("changes archetype when envelope features change (not a neighbor-house copy)", () => {
    const a = buildCohortPriorV1({
      homeProfile: { squareFeet: 2000 },
      applianceProfile: {},
    });
    const b = buildCohortPriorV1({
      homeProfile: { squareFeet: 4000 },
      applianceProfile: {},
    });
    expect(a.archetypeKey).not.toBe(b.archetypeKey);
  });
});
