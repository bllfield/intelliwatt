import { describe, expect, it } from "vitest";
import { resolveWindowFromBuildInputsForPastIdentity } from "@/modules/usageSimulator/windowIdentity";

describe("resolveWindowFromBuildInputsForPastIdentity", () => {
  it("uses first/last valid canonical periods and ignores invalid edges", () => {
    const out = resolveWindowFromBuildInputsForPastIdentity({
      canonicalPeriods: [
        { startDate: "", endDate: "2026-01-31" }, // invalid start
        { startDate: "2026-02-01", endDate: "2026-02-28" }, // valid
        { startDate: "2026-03-01", endDate: "2026-03-31" }, // valid
        { startDate: "2026-04-01", endDate: "" }, // invalid end
      ],
      canonicalMonths: ["2026-02", "2026-03"],
    } as Record<string, unknown>);

    expect(out).toEqual({
      startDate: "2026-02-01",
      endDate: "2026-03-31",
    });
  });
});

