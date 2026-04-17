import { describe, expect, it } from "vitest";
import { buildOnePathBaselineParityAudit } from "@/modules/onePathSim/baselineParityAudit";

describe("buildOnePathBaselineParityAudit", () => {
  it("marks baseline truth as matched when only the daily owner split differs", () => {
    const audit = buildOnePathBaselineParityAudit({
      lookupActualDatasetSummary: {
        intervalsCount: 34823,
        totalKwh: 13539.41,
      },
      readModel: {
        dataset: {
          summary: {
            intervalsCount: 34823,
            totalKwh: 13539.41,
          },
          monthly: [{ month: "2026-04", kwh: 13539.41 }],
          daily: [{ date: "2026-04-15", kwh: 81 }],
        },
      },
    });

    expect(audit.parityStatus).toBe("baseline_truth_match_with_display_owner_split");
    expect(audit.intervalCountParity).toBe(true);
    expect(audit.totalKwhParity).toBe(true);
    expect(audit.monthlyParity).toBe(true);
    expect(audit.dailyParity).toBe(false);
    expect(audit.displayOwnerSplitInformational).toBe(true);
    expect(audit.displayOwnerSplitNote).toContain("display-owner split");
  });
});
