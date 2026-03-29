import { describe, expect, it } from "vitest";
import {
  gapfillFailureFieldsFromJson,
  gapfillPrimaryErrorLine,
} from "@/components/admin/gapfillLabAdminUi";

describe("gapfillFailureFieldsFromJson", () => {
  it("surfaces failureCode and failureMessage from attachFailureContract-shaped bodies", () => {
    const f = gapfillFailureFieldsFromJson({
      ok: false,
      error: "canonical_recalc_timeout",
      message: "Canonical recalc exceeded route timeout.",
      failureCode: "CANONICAL_RECALC_TIMEOUT",
      failureMessage: "Canonical recalc exceeded route timeout.",
    });
    expect(f.failureCode).toBe("CANONICAL_RECALC_TIMEOUT");
    expect(f.failureMessage).toContain("exceeded");
  });
});

describe("gapfillPrimaryErrorLine", () => {
  it("prefers failureMessage over error key", () => {
    expect(
      gapfillPrimaryErrorLine({
        failureMessage: "Detailed",
        error: "SHORT",
      })
    ).toBe("Detailed");
  });
});
