import { describe, expect, it } from "vitest";
import { isSimulatedDailySourceForCompare } from "@/lib/usage/dailySourceNotation";
import { attachValidationCompareProjection } from "@/modules/usageSimulator/compareProjection";

describe("dailySourceNotation", () => {
  it("treats SIMULATED (INCOMPLETE METER) rows as simulator-owned for compare", () => {
    expect(
      isSimulatedDailySourceForCompare({
        source: "SIMULATED (INCOMPLETE METER)",
        sourceDetail: "SIMULATED_INCOMPLETE_METER",
      })
    ).toBe(true);
  });

  it("attachValidationCompareProjection uses incomplete-meter daily rows for simulated totals", () => {
    const out = attachValidationCompareProjection({
      meta: {
        validationOnlyDateKeysLocal: ["2025-11-02"],
        validationActualDailyKwhByDateLocal: { "2025-11-02": 21.18 },
        timezone: "America/Chicago",
      },
      daily: [
        {
          date: "2025-11-02",
          kwh: 17.47,
          source: "SIMULATED (INCOMPLETE METER)",
          sourceDetail: "SIMULATED_INCOMPLETE_METER",
        },
      ],
      dailyWeather: {},
    });
    const rows = Array.isArray(out?.meta?.validationCompareRows) ? out.meta.validationCompareRows : [];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.localDate).toBe("2025-11-02");
    expect(rows[0]?.simulatedDayKwh).toBe(17.47);
    expect(rows[0]?.actualDayKwh).toBe(21.18);
  });
});
