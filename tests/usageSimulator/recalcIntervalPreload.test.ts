import { beforeEach, describe, expect, it, vi } from "vitest";

const getActualIntervalsForRangeMock = vi.fn();

vi.mock("@/lib/usage/actualDatasetForHouse", () => ({
  getActualIntervalsForRange: (...args: unknown[]) => getActualIntervalsForRangeMock(...args),
}));

describe("recalc interval preload context", () => {
  beforeEach(() => {
    getActualIntervalsForRangeMock.mockReset();
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
});

