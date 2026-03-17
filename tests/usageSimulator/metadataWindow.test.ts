import { describe, expect, it } from "vitest";

import {
  boundDateKeysToCoverageWindow,
  resolveReportedCoverageWindow,
} from "@/modules/usageSimulator/metadataWindow";

describe("usageSimulator metadataWindow helpers", () => {
  it("prefers dataset summary window when present", () => {
    const out = resolveReportedCoverageWindow({
      dataset: { summary: { start: "2025-03-14", end: "2026-03-14" } },
      fallbackStartDate: "2025-03-15",
      fallbackEndDate: "2026-03-14",
    });
    expect(out).toEqual({ startDate: "2025-03-14", endDate: "2026-03-14" });
  });

  it("bounds date keys to inclusive coverage window", () => {
    const bounded = boundDateKeysToCoverageWindow(
      ["2025-03-01", "2025-03-14", "2025-03-20", "2026-03-14", "2026-03-15"],
      { startDate: "2025-03-14", endDate: "2026-03-14" }
    );
    expect(Array.from(bounded).sort()).toEqual(["2025-03-14", "2025-03-20", "2026-03-14"]);
  });
});

