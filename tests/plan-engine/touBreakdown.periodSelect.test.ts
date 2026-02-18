import { describe, expect, it } from "vitest";
import { pickTouPeriodForMonth } from "@/lib/plan-engine/touBreakdown";

describe("pickTouPeriodForMonth (seasonal TOU breakdown)", () => {
  it("selects the period matching the target month when bucket keys are shared", () => {
    const periods = [
      {
        dayType: "all",
        startHHMM: "0000",
        endHHMM: "2400",
        months: [1, 2, 3, 4, 5, 10, 11, 12],
        repEnergyCentsPerKwh: 16.26,
      },
      {
        dayType: "all",
        startHHMM: "0000",
        endHHMM: "2400",
        months: [6, 7, 8, 9],
        repEnergyCentsPerKwh: 8.13,
      },
    ];

    const bucketKey = "kwh.m.all.total";

    expect(
      pickTouPeriodForMonth({ periods, bucketKey, monthOfYear: 7 })?.repEnergyCentsPerKwh,
    ).toBe(8.13);

    expect(
      pickTouPeriodForMonth({ periods, bucketKey, monthOfYear: 1 })?.repEnergyCentsPerKwh,
    ).toBe(16.26);
  });

  it("falls back to an all-month period when monthOfYear is null", () => {
    const periods = [
      {
        dayType: "all",
        startHHMM: "0000",
        endHHMM: "2400",
        repEnergyCentsPerKwh: 12.34,
      },
    ];
    expect(pickTouPeriodForMonth({ periods, bucketKey: "kwh.m.all.total", monthOfYear: null })?.repEnergyCentsPerKwh).toBe(
      12.34,
    );
  });
});

