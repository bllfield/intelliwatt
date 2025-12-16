import { describe, expect, test } from "vitest";

import { extractProviderAndPlanNameFromEflText } from "@/lib/efl/eflExtractor";

describe("eflExtractor - provider/plan header extraction", () => {
  test("extracts provider + plan name from common header layout (Frontier)", () => {
    const text = `
Electricity Facts Label (EFL)
Frontier Utilities
Light Saver 12+
Oncor Electric
Date:12/15/2025
`;

    const out = extractProviderAndPlanNameFromEflText(text);
    expect(out.providerName).toBe("Frontier Utilities");
    expect(out.planName).toBe("Light Saver 12+");
  });
});


