import { beforeEach, describe, expect, it, vi } from "vitest";

const getActualIntervalsForRangeMock = vi.fn();
const loadGreenButtonPastProducerIntervalsMock = vi.fn();

vi.mock("@/lib/usage/actualDatasetForHouse", () => ({
  getActualIntervalsForRange: (...args: unknown[]) => getActualIntervalsForRangeMock(...args),
}));

vi.mock("@/lib/usage/greenButtonPastProducerLoad", () => ({
  loadGreenButtonPastProducerIntervals: (...args: unknown[]) =>
    loadGreenButtonPastProducerIntervalsMock(...args),
}));

describe("recalc interval preload context", () => {
  beforeEach(() => {
    getActualIntervalsForRangeMock.mockReset();
    loadGreenButtonPastProducerIntervalsMock.mockReset();
  });

  it("reuses full-window intervals for repeated same-window requests", async () => {
    getActualIntervalsForRangeMock.mockResolvedValue([
      { timestamp: "2025-01-01T00:00:00.000Z", kwh: 0.25 },
      { timestamp: "2025-01-01T00:15:00.000Z", kwh: 0.3 },
    ]);
    const { createRecalcIntervalPreloadContext } = await import(
      "@/modules/usageSimulator/recalcIntervalPreload"
    );
    const ctx = createRecalcIntervalPreloadContext({
      houseId: "h1",
      esiid: "e1",
      correlationId: "cid-1",
      source: "test",
    });

    const first = await ctx.getIntervals({ startDate: "2025-01-01", endDate: "2025-12-31" });
    const second = await ctx.getIntervals({ startDate: "2025-01-01", endDate: "2025-12-31" });

    expect(first.cacheHit).toBe(false);
    expect(second.cacheHit).toBe(true);
    expect(first.intervals.length).toBe(2);
    expect(second.intervals.length).toBe(2);
    expect(getActualIntervalsForRangeMock).toHaveBeenCalledTimes(1);
    expect(getActualIntervalsForRangeMock).toHaveBeenCalledWith(
      expect.objectContaining({ preferredSource: null })
    );
    expect(ctx.getStats()).toMatchObject({
      fetchCount: 1,
      reuseCount: 1,
      cachedWindowCount: 1,
    });
  });

  it("loads again when window differs", async () => {
    getActualIntervalsForRangeMock.mockResolvedValue([]);
    const { createRecalcIntervalPreloadContext } = await import(
      "@/modules/usageSimulator/recalcIntervalPreload"
    );
    const ctx = createRecalcIntervalPreloadContext({
      houseId: "h1",
      esiid: null,
      source: "test",
    });

    await ctx.getIntervals({ startDate: "2025-01-01", endDate: "2025-12-31" });
    await ctx.getIntervals({ startDate: "2025-02-01", endDate: "2026-01-31" });

    expect(getActualIntervalsForRangeMock).toHaveBeenCalledTimes(2);
    expect(ctx.getStats()).toMatchObject({
      fetchCount: 2,
      reuseCount: 0,
      cachedWindowCount: 2,
    });
  });

  it("avoids a second load when validation and simulation share one aligned window", async () => {
    getActualIntervalsForRangeMock.mockResolvedValue([
      { timestamp: "2025-03-14T00:00:00.000Z", kwh: 0.2 },
    ]);
    const { createRecalcIntervalPreloadContext } = await import(
      "@/modules/usageSimulator/recalcIntervalPreload"
    );
    const ctx = createRecalcIntervalPreloadContext({
      houseId: "h1",
      esiid: "e1",
      source: "test",
    });
    const alignedWindow = { startDate: "2025-03-14", endDate: "2026-03-13" };

    const validationLoad = await ctx.getIntervals(alignedWindow);
    const simulationLoad = await ctx.getIntervals(alignedWindow);

    expect(validationLoad.cacheHit).toBe(false);
    expect(simulationLoad.cacheHit).toBe(true);
    expect(getActualIntervalsForRangeMock).toHaveBeenCalledTimes(1);
  });

  it("reuses Green Button producer loads across getIntervals and getGreenButtonPastProducerLoad", async () => {
    loadGreenButtonPastProducerIntervalsMock.mockResolvedValue({
      engineSourceIntervals: [
        { timestamp: "2026-01-01T00:00:00.000Z", kwh: 0.4, homeDateKey: "2026-01-01", homeSlot: 0 },
      ],
      trustedHomeDateKeys: new Set(["2026-01-01"]),
      trustedUtcDateKeys: ["2026-01-01"],
      sourceDateByTargetDate: {},
      sourceIntervals: [],
      displayWindowNote: null,
      shiftedIntervalCount: 0,
      shiftedDateCount: 0,
      sourceCoverageStart: "2026-01-01",
      sourceCoverageEnd: "2026-01-01",
    });
    const { createRecalcIntervalPreloadContext } = await import(
      "@/modules/usageSimulator/recalcIntervalPreload"
    );
    const ctx = createRecalcIntervalPreloadContext({
      houseId: "h1",
      esiid: "e1",
      preferredSource: "GREEN_BUTTON",
      timezone: "America/Chicago",
      travelRanges: [{ startDate: "2026-06-27", endDate: "2026-07-11" }],
      source: "test",
    });
    const window = { startDate: "2026-01-01", endDate: "2026-12-31" };

    const producerFirst = await ctx.getGreenButtonPastProducerLoad(window);
    const intervalSecond = await ctx.getIntervals(window);

    expect(producerFirst.cacheHit).toBe(false);
    expect(intervalSecond.cacheHit).toBe(true);
    expect(intervalSecond.intervals).toEqual([{ timestamp: "2026-01-01T00:00:00.000Z", kwh: 0.4 }]);
    expect(loadGreenButtonPastProducerIntervalsMock).toHaveBeenCalledTimes(1);
    expect(loadGreenButtonPastProducerIntervalsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        houseId: "h1",
        coverageStartDate: "2026-01-01",
        coverageEndDate: "2026-12-31",
        travelRanges: [{ startDate: "2026-06-27", endDate: "2026-07-11" }],
      })
    );
    expect(getActualIntervalsForRangeMock).not.toHaveBeenCalled();
    expect(ctx.getStats()).toMatchObject({
      greenButtonProducerFetchCount: 1,
      greenButtonProducerReuseCount: 1,
      fetchCount: 0,
      reuseCount: 1,
      cachedWindowCount: 1,
    });
  });
});
