import { describe, expect, it } from "vitest";

import { normalizeTdspCode } from "@/lib/utility/tdspCode";

describe("normalizeTdspCode", () => {
  it("maps legacy AEP abbreviations to canonical codes", () => {
    expect(normalizeTdspCode("AEPNOR")).toBe("AEP_NORTH");
    expect(normalizeTdspCode("AEPCEN")).toBe("AEP_CENTRAL");
  });

  it("accepts common slugs", () => {
    expect(normalizeTdspCode("aep_n")).toBe("AEP_NORTH");
    expect(normalizeTdspCode("aep_c")).toBe("AEP_CENTRAL");
    expect(normalizeTdspCode("centerpoint")).toBe("CENTERPOINT");
    expect(normalizeTdspCode("tnmp")).toBe("TNMP");
  });
});

