import { describe, expect, it } from "vitest";
import { PAST_VALIDATION_COMPARE_DEFAULT_EXPANDED } from "@/modules/usageSimulator/pastCompareUiDefaults";

describe("pastCompareUiDefaults", () => {
  it("Past validation compare section defaults to collapsed (expand for table)", () => {
    expect(PAST_VALIDATION_COMPARE_DEFAULT_EXPANDED).toBe(false);
  });
});
