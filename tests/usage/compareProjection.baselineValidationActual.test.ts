import { describe, expect, it } from "vitest";
import { projectBaselineFromCanonicalDataset } from "@/modules/usageSimulator/compareProjection";

describe("projectBaselineFromCanonicalDataset", () => {
  it("keeps validation/test days ACTUAL in baseline projection", () => {
    const dataset = {
      daily: [
        { date: "2025-08-10", kwh: 40, source: "ACTUAL" },
        { date: "2025-08-11", kwh: 12, source: "SIMULATED" },
        { date: "2025-08-12", kwh: 14, source: "SIMULATED" },
      ],
      monthly: [{ month: "2025-08", kwh: 66 }],
      summary: { totalKwh: 66, timezone: "America/Chicago" },
      totals: { importKwh: 66, exportKwh: 0, netKwh: 66 },
      meta: {
        validationOnlyDateKeysLocal: ["2025-08-11", "2025-08-12"],
      },
    } as any;

    const actualDailyByDate = new Map<string, number>([
      ["2025-08-11", 51],
      ["2025-08-12", 49],
    ]);

    const projected = projectBaselineFromCanonicalDataset(dataset, "America/Chicago", actualDailyByDate);
    expect(projected.daily[0]).toMatchObject({ date: "2025-08-10", kwh: 40, source: "ACTUAL" });
    expect(projected.daily[1]).toMatchObject({ date: "2025-08-11", kwh: 51, source: "ACTUAL" });
    expect(projected.daily[2]).toMatchObject({ date: "2025-08-12", kwh: 49, source: "ACTUAL" });
    expect(projected.monthly[0]).toMatchObject({ month: "2025-08", kwh: 140 });
    expect(projected.summary.totalKwh).toBe(140);
    expect(projected.totals.netKwh).toBe(140);
    expect(projected.meta.validationCompareAvailable).toBe(true);
  });
});
