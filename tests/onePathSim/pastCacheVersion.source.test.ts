import { describe, expect, it } from "vitest";

import { PAST_ENGINE_VERSION } from "@/modules/onePathSim/usageSimulator/pastCache";

describe("One Path Past Sim cache version", () => {
  it("invalidates cached artifacts after Green Button simulation-pool curve correction", () => {
    expect(PAST_ENGINE_VERSION).toBe("production_past_stitched_v6");
  });
});
