import { describe, expect, it } from "vitest";

import { uniquePastArtifactInputHashCandidates } from "@/modules/onePathSim/usageSimulator/pastCache";

describe("past artifact cache load helpers", () => {
  it("dedupes hash candidates in order", () => {
    expect(uniquePastArtifactInputHashCandidates("a", "b", "a", "", "b", "c")).toEqual(["a", "b", "c"]);
  });
});
