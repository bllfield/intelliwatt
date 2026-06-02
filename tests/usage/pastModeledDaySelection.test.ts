import { describe, expect, it } from "vitest";
import { resolvePastSimulatedModeledDaySelectionStrategy } from "@/lib/usage/pastModeledDaySelection";

describe("resolvePastSimulatedModeledDaySelectionStrategy", () => {
  it("uses weather donors for Green Button and SMT interval-backed Past", () => {
    expect(
      resolvePastSimulatedModeledDaySelectionStrategy({
        buildMode: "GREEN_BUTTON_BASELINE",
        intervalActualSource: "GREEN_BUTTON",
      })
    ).toBe("weather_donor_first");
    expect(
      resolvePastSimulatedModeledDaySelectionStrategy({
        buildMode: "SMT_BASELINE",
        intervalActualSource: "SMT",
      })
    ).toBe("weather_donor_first");
  });

  it("keeps calendar_first for manual totals", () => {
    expect(
      resolvePastSimulatedModeledDaySelectionStrategy({
        buildMode: "MANUAL_TOTALS",
        intervalActualSource: "GREEN_BUTTON",
      })
    ).toBe("calendar_first");
  });
});
