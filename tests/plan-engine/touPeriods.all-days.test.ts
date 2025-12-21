import { describe, expect, it } from "vitest";

import { extractDeterministicTouSchedule } from "@/lib/plan-engine/touPeriods";
import { requiredBucketsForRateStructure } from "@/lib/plan-engine/requiredBucketsForPlan";
import { extractFixedRepEnergyCentsPerKwh } from "@/lib/plan-engine/calculatePlanCostForUsage";

describe("TOU schedule extraction - all days (0..6)", () => {
  it("treats daysOfWeek [0..6] as dayType=all and produces window buckets", () => {
    const rs = {
      type: "TIME_OF_USE",
      // This field must NOT cause fixed-rate extraction for TOU.
      energyRateCents: 6.89,
      timeOfUsePeriods: [
        {
          label: "Off-Peak",
          startHour: 21,
          endHour: 6,
          daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
          rateCentsPerKwh: 6.89,
        },
        {
          label: "Peak",
          startHour: 6,
          endHour: 21,
          daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
          rateCentsPerKwh: 13.77,
        },
      ],
    };

    // Must extract deterministic schedule.
    const tou = extractDeterministicTouSchedule(rs);
    expect(tou.schedule).not.toBeNull();
    if (!tou.schedule) return;
    expect(tou.schedule.periods.every((p) => p.dayType === "all")).toBe(true);

    // Required buckets should include the two windows.
    const reqs = requiredBucketsForRateStructure({ rateStructure: rs });
    const keys = reqs.map((r) => r.key);
    expect(keys).toContain("kwh.m.all.2100-0600");
    expect(keys).toContain("kwh.m.all.0600-2100");

    // Fixed-rate extractor must fail-closed for TOU.
    expect(extractFixedRepEnergyCentsPerKwh(rs as any)).toBeNull();
  });
});

