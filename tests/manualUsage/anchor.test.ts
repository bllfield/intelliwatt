import { describe, expect, it } from "vitest";
import { lastFullMonthChicago, monthsEndingAt } from "@/modules/manualUsage/anchor";

describe("manualUsage monthly anchor labeling", () => {
  it("lastFullMonthChicago returns previous month in Chicago", () => {
    // Feb 15, 2026 in UTC is still Feb 15 in Chicago.
    const now = new Date("2026-02-15T12:00:00.000Z");
    expect(lastFullMonthChicago(now)).toBe("2026-01");
  });

  it("monthsEndingAt returns 12 months ending at anchor", () => {
    const months = monthsEndingAt("2026-01", 12);
    expect(months[0]).toBe("2025-02");
    expect(months[11]).toBe("2026-01");
    expect(months).toHaveLength(12);
  });
});

