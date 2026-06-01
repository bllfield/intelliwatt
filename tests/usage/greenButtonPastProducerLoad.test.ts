import { describe, expect, it, vi, beforeEach } from "vitest";

const getActualIntervalsForRangeWithSource = vi.fn();

vi.mock("@/lib/usage/actualDatasetForHouse", () => ({
  getActualIntervalsForRangeWithSource: (...args: unknown[]) => getActualIntervalsForRangeWithSource(...args),
}));

import { loadGreenButtonPastProducerIntervals } from "@/lib/usage/greenButtonPastProducerLoad";

describe("loadGreenButtonPastProducerIntervals", () => {
  beforeEach(() => {
    getActualIntervalsForRangeWithSource.mockReset();
  });

  it("uses home-local Green Button intervals and builds a multi-day trusted pool", async () => {
    const intervals = Array.from({ length: 96 * 5 }, (_, index) => {
      const dayOffset = Math.floor(index / 96);
      const slot = index % 96;
      const date = `2026-03-${String(3 + dayOffset).padStart(2, "0")}`;
      const hour = Math.floor((slot * 15) / 60);
      const minute = (slot * 15) % 60;
      return {
        timestamp: `${date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00.000Z`,
        kwh: 0.25,
        homeDateKey: date,
        homeSlot: slot,
      };
    });
    getActualIntervalsForRangeWithSource.mockResolvedValue({ source: "GREEN_BUTTON", intervals });

    const loaded = await loadGreenButtonPastProducerIntervals({
      houseId: "house-1",
      esiid: null,
      coverageStartDate: "2026-03-03",
      coverageEndDate: "2026-03-07",
      timezone: "America/Chicago",
    });

    expect(getActualIntervalsForRangeWithSource).toHaveBeenCalledWith(
      expect.objectContaining({
        houseId: "house-1",
        preferredSource: "GREEN_BUTTON",
        startDate: "2026-03-03",
        endDate: "2026-03-07",
      })
    );
    expect(loaded.engineSourceIntervals.length).toBe(intervals.length);
    expect(loaded.trustedHomeDateKeys.size).toBeGreaterThanOrEqual(5);
    expect(loaded.trustedUtcDateKeys).toEqual([]);
    expect(loaded.shiftedIntervalCount).toBe(0);
  });
});
