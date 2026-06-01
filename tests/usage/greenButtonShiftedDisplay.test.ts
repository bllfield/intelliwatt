import { describe, expect, it } from "vitest";
import {
  buildGreenButtonWeatherLookupDateByDisplayDate,
  isGreenButtonPriorYearShiftedDisplayDate,
} from "@/lib/usage/greenButtonShiftedDisplay";

describe("greenButtonShiftedDisplay", () => {
  it("maps display dates to source dates for weather lookup", () => {
    const lookup = buildGreenButtonWeatherLookupDateByDisplayDate({
      displayDateKeys: ["2026-05-14", "2026-05-15", "2026-05-13"],
      sourceDateByTargetDate: {
        "2026-05-14": "2025-05-14",
        "2026-05-15": "2025-05-15",
      },
    });
    expect(lookup.get("2026-05-14")).toBe("2025-05-14");
    expect(lookup.get("2026-05-15")).toBe("2025-05-15");
    expect(lookup.get("2026-05-13")).toBe("2026-05-13");
  });

  it("flags prior-year shifted display days from meta", () => {
    const meta = {
      greenButtonSourceDateByTargetDate: {
        "2026-05-14": "2025-05-14",
      },
    };
    expect(isGreenButtonPriorYearShiftedDisplayDate("2026-05-14", meta)).toBe(true);
    expect(isGreenButtonPriorYearShiftedDisplayDate("2025-05-14", meta)).toBe(false);
  });
});
