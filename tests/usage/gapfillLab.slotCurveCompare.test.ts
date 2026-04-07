import { describe, expect, it } from "vitest";
import { buildDailyCurveCompareBySlot } from "@/lib/admin/gapfillLab";

describe("buildDailyCurveCompareBySlot", () => {
  it("builds 96-slot compare rows for selected local dates only", () => {
    const rows = buildDailyCurveCompareBySlot({
      timezone: "America/Chicago",
      selectedDateKeys: ["2025-04-10"],
      actual: [
        { timestamp: "2025-04-10T05:00:00.000Z", kwh: 1 },
        { timestamp: "2025-04-11T05:00:00.000Z", kwh: 9 },
      ],
      simulated: [
        { timestamp: "2025-04-10T05:00:00.000Z", kwh: 1.5 },
        { timestamp: "2025-04-11T05:00:00.000Z", kwh: 8 },
      ],
    });

    expect(rows).toHaveLength(96);
    expect(rows[0]).toMatchObject({
      slot: 0,
      actualMeanKwh: 1,
      simMeanKwh: 1.5,
      deltaMeanKwh: 0.5,
      actualCount: 1,
      simCount: 1,
    });
    expect(rows[1]).toMatchObject({
      slot: 1,
      actualMeanKwh: 0,
      simMeanKwh: 0,
    });
  });
});
