import { describe, expect, it } from "vitest";

import { inferTdspTerritoryFromEflText } from "@/lib/efl/eflValidator";

describe("inferTdspTerritoryFromEflText - TNMP", () => {
  it("detects TNMP from 'Texas New Mexico Power Service Area' wording", () => {
    const rawText = `
ELECTRICITY FACTS LABEL (EFL)
12 Month - prepaid
Texas New Mexico Power Service Area effective as of December 7, 2025
`;
    expect(inferTdspTerritoryFromEflText(rawText)).toBe("TNMP");
  });
});

