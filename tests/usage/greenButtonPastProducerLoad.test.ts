import { describe, expect, it, vi, beforeEach } from "vitest";

const getActualIntervalsForRangeWithSource = vi.fn();
const fetchGreenButtonIntervalsForCoverageWindow = vi.fn();

vi.mock("@/lib/usage/actualDatasetForHouse", () => ({
  getActualIntervalsForRangeWithSource: (...args: unknown[]) => getActualIntervalsForRangeWithSource(...args),
}));

vi.mock("@/modules/realUsageAdapter/greenButton", () => ({
  fetchGreenButtonIntervalsForCoverageWindow: (...args: unknown[]) =>
    fetchGreenButtonIntervalsForCoverageWindow(...args),
}));

import { loadGreenButtonPastProducerIntervals } from "@/lib/usage/greenButtonPastProducerLoad";

describe("loadGreenButtonPastProducerIntervals", () => {
  beforeEach(() => {
    getActualIntervalsForRangeWithSource.mockReset();
    fetchGreenButtonIntervalsForCoverageWindow.mockReset();
  });

  it("merges home-local intervals with prior-year shifted trailing days", async () => {
    const homeLocal = Array.from({ length: 96 }, (_, slot) => ({
      timestamp: new Date(new Date("2026-05-13T00:00:00.000Z").getTime() + slot * 15 * 60 * 1000).toISOString(),
      kwh: 0.25,
      homeDateKey: "2026-05-13",
      homeSlot: slot,
    }));
    const shiftedTargetDay = Array.from({ length: 96 }, (_, slot) => ({
      timestamp: new Date(new Date("2026-05-14T00:00:00.000Z").getTime() + slot * 15 * 60 * 1000).toISOString(),
      kwh: 0.36,
    }));

    getActualIntervalsForRangeWithSource.mockResolvedValue({ source: "GREEN_BUTTON", intervals: homeLocal });
    fetchGreenButtonIntervalsForCoverageWindow.mockResolvedValue({
      intervals: [...homeLocal.map((row) => ({ timestamp: row.timestamp, kwh: row.kwh })), ...shiftedTargetDay],
      intervalsCount: homeLocal.length + shiftedTargetDay.length,
      sourceCoverageStart: "2025-05-14",
      sourceCoverageEnd: "2026-05-13",
      shiftedIntervalCount: 96,
      shiftedDateCount: 1,
      sourceDateByTargetDate: { "2026-05-14": "2025-05-14", "2026-05-13": "2026-05-13" },
      trustedActualDateKeys: [],
      displayWindowNote:
        "Historical Green Button intervals and their matching source-day weather were shifted into the current coverage window so available actual data stays in the Past Sim pool up to the current date. Travel/Vacant dates remain excluded.",
    });

    const loaded = await loadGreenButtonPastProducerIntervals({
      houseId: "house-1",
      esiid: null,
      coverageStartDate: "2026-05-01",
      coverageEndDate: "2026-05-30",
      timezone: "America/Chicago",
    });

    expect(fetchGreenButtonIntervalsForCoverageWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        houseId: "house-1",
        timestampMode: "raw",
      })
    );
    expect(loaded.shiftedDateCount).toBe(1);
    expect(loaded.sourceDateByTargetDate["2026-05-14"]).toBe("2025-05-14");
    expect(loaded.displayWindowNote).toContain("shifted into the current coverage window");
    const may14 = loaded.engineSourceIntervals.filter((row) => row.homeDateKey === "2026-05-14");
    expect(may14.length).toBeGreaterThan(0);
    expect(may14.every((row) => row.kwh === 0.36)).toBe(true);
  });
});
