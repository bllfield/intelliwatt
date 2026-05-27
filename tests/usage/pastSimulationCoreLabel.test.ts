import { describe, expect, it } from "vitest";
import { formatSharedPastSimulationCoreLabel } from "@/lib/usage/pastSimulationCoreLabel";

describe("pastSimulationCoreLabel", () => {
  it("includes shared core, day-sim, engine, and validation revision stamps", () => {
    const label = formatSharedPastSimulationCoreLabel();
    expect(label).toContain("shared_past_day_simulator");
    expect(label).toContain("day-sim 1.1.0");
    expect(label).toContain("engine production_past_stitched_v12");
    expect(label).toContain("validation unified_stratified_14_v1");
  });
});
