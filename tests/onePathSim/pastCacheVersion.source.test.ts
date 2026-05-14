import { describe, expect, it } from "vitest";

import { PAST_ENGINE_VERSION } from "@/modules/onePathSim/usageSimulator/pastCache";

describe("One Path Past Sim cache version", () => {
  it("invalidates cached artifacts after Green Button unit and completeness repair", () => {
    expect(PAST_ENGINE_VERSION).toBe("production_past_stitched_v5");
  });
});
