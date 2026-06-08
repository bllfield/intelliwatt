import { describe, expect, it } from "vitest";

import {
  buildStaleLabHomeSourceFamilyMessage,
  detectPastArtifactSourceFamilyFromDataset,
} from "@/lib/usage/labHomePastArtifactSourceFamily";

describe("labHomePastArtifactSourceFamily", () => {
  it("detects GREEN_BUTTON from artifact meta", () => {
    expect(
      detectPastArtifactSourceFamilyFromDataset({
        summary: { source: "GREEN_BUTTON" },
        meta: { actualSource: "GREEN_BUTTON" },
      })
    ).toBe("GREEN_BUTTON");
  });

  it("detects SMT from lockbox run context", () => {
    expect(
      detectPastArtifactSourceFamilyFromDataset({
        meta: { lockboxRunContext: { preferredActualSource: "SMT" } },
      })
    ).toBe("SMT");
  });

  it("builds required stale lab messages", () => {
    expect(
      buildStaleLabHomeSourceFamilyMessage({
        proofSourceType: "SMT",
        labArtifactSourceFamily: "GREEN_BUTTON",
      })
    ).toBe(
      "STALE_LAB_HOME_SOURCE_FAMILY: lab home currently contains GREEN_BUTTON artifacts; rerun SMT dual recalc before SMT proof."
    );
    expect(
      buildStaleLabHomeSourceFamilyMessage({
        proofSourceType: "GREEN_BUTTON",
        labArtifactSourceFamily: "SMT",
      })
    ).toBe(
      "STALE_LAB_HOME_SOURCE_FAMILY: lab home currently contains SMT artifacts; rerun Green Button dual recalc before Green Button proof."
    );
  });
});
