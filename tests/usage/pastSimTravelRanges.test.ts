import { beforeEach, describe, expect, it, vi } from "vitest";

const findFirstScenario = vi.fn();
const findManyEvents = vi.fn();
const findUniqueManual = vi.fn();
const findFirstBuild = vi.fn();
const transaction = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    usageSimulatorScenario: {
      findFirst: (...args: unknown[]) => findFirstScenario(...args),
      findMany: (...args: unknown[]) => findFirstScenario(...args),
    },
    usageSimulatorScenarioEvent: {
      findMany: (...args: unknown[]) => findManyEvents(...args),
    },
    manualUsageInput: {
      findUnique: (...args: unknown[]) => findUniqueManual(...args),
    },
    usageSimulatorBuild: {
      findFirst: (...args: unknown[]) => findFirstBuild(...args),
    },
    $transaction: (...args: unknown[]) => transaction(...args),
  },
}));

const CANONICAL_WINDOW = { startDate: "2025-06-10", endDate: "2026-06-09" };

describe("pastSimTravelRanges", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findFirstScenario.mockResolvedValue({ id: "scenario-1" });
    findManyEvents.mockResolvedValue([]);
    findUniqueManual.mockResolvedValue(null);
    findFirstBuild.mockResolvedValue(null);
  });

  it("filterTravelRangesToCoverageWindow drops out-of-window ranges and clips overlap", async () => {
    const { filterTravelRangesToCoverageWindow } = await import("@/lib/usage/pastSimTravelRanges");
    expect(
      filterTravelRangesToCoverageWindow(
        [
          { startDate: "2025-02-18", endDate: "2025-05-26" },
          { startDate: "2025-08-13", endDate: "2025-08-17" },
          { startDate: "2025-06-01", endDate: "2025-06-20" },
        ],
        CANONICAL_WINDOW
      )
    ).toEqual([
      { startDate: "2025-06-10", endDate: "2025-06-20" },
      { startDate: "2025-08-13", endDate: "2025-08-17" },
    ]);
  });

  it("archives fully before-window ranges using final-day rule", async () => {
    const { classifyTravelRangeForCoverageWindow } = await import("@/lib/usage/pastSimTravelRanges");
    const out = classifyTravelRangeForCoverageWindow(
      { startDate: "2025-02-18", endDate: "2025-05-26" },
      CANONICAL_WINDOW
    );
    expect(out.archivedHistorical).toBe(true);
    expect(out.beforeWindowHistorical).toBe(true);
    expect(out.activeForCurrentWindow).toBe(false);
    expect(out.futureOutsideCurrentWindow).toBe(false);
    expect(out.filteredOutOfCurrentWindow).toBe(true);
    expect(out.clippedOperationalOverlap).toBeNull();
  });

  it("keeps pre-window partial overlap active with clipped operational overlap", async () => {
    const { classifyTravelRangeForCoverageWindow } = await import("@/lib/usage/pastSimTravelRanges");
    const out = classifyTravelRangeForCoverageWindow(
      { startDate: "2025-06-01", endDate: "2025-06-15" },
      CANONICAL_WINDOW
    );
    expect(out.archivedHistorical).toBe(false);
    expect(out.activeForCurrentWindow).toBe(true);
    expect(out.futureOutsideCurrentWindow).toBe(false);
    expect(out.clippedOperationalOverlap).toEqual({
      startDate: "2025-06-10",
      endDate: "2025-06-15",
    });
  });

  it("keeps post-window partial overlap active with clipped operational overlap", async () => {
    const { classifyTravelRangeForCoverageWindow } = await import("@/lib/usage/pastSimTravelRanges");
    const out = classifyTravelRangeForCoverageWindow(
      { startDate: "2026-06-01", endDate: "2026-06-20" },
      CANONICAL_WINDOW
    );
    expect(out.archivedHistorical).toBe(false);
    expect(out.activeForCurrentWindow).toBe(true);
    expect(out.futureOutsideCurrentWindow).toBe(false);
    expect(out.clippedOperationalOverlap).toEqual({
      startDate: "2026-06-01",
      endDate: "2026-06-09",
    });
  });

  it("treats future outside-window ranges as filtered but not archived historical", async () => {
    const { classifyTravelRangeForCoverageWindow } = await import("@/lib/usage/pastSimTravelRanges");
    const out = classifyTravelRangeForCoverageWindow(
      { startDate: "2026-07-01", endDate: "2026-07-05" },
      CANONICAL_WINDOW
    );
    expect(out.archivedHistorical).toBe(false);
    expect(out.beforeWindowHistorical).toBe(false);
    expect(out.activeForCurrentWindow).toBe(false);
    expect(out.futureOutsideCurrentWindow).toBe(true);
    expect(out.filteredOutOfCurrentWindow).toBe(true);
    expect(out.clippedOperationalOverlap).toBeNull();
  });

  it("matches user timeline visibility by overlap rather than clipped stored keys", async () => {
    const { travelRangeIsActiveForCoverageWindow } = await import("@/lib/usage/pastSimTravelRanges");
    expect(travelRangeIsActiveForCoverageWindow({ startDate: "2025-06-01", endDate: "2025-06-15" }, CANONICAL_WINDOW)).toBe(
      true
    );
    expect(travelRangeIsActiveForCoverageWindow({ startDate: "2026-06-01", endDate: "2026-06-20" }, CANONICAL_WINDOW)).toBe(
      true
    );
    expect(travelRangeIsActiveForCoverageWindow({ startDate: "2025-02-18", endDate: "2025-05-26" }, CANONICAL_WINDOW)).toBe(
      false
    );
    expect(travelRangeIsActiveForCoverageWindow({ startDate: "2026-07-01", endDate: "2026-07-05" }, CANONICAL_WINDOW)).toBe(
      false
    );
  });

  it("summarizeTravelRangesForCoverageWindow separates active, archived, and future counts", async () => {
    const { summarizeTravelRangesForCoverageWindow } = await import("@/lib/usage/pastSimTravelRanges");
    const summary = summarizeTravelRangesForCoverageWindow(
      [
        { startDate: "2025-02-18", endDate: "2025-05-26" },
        { startDate: "2025-03-14", endDate: "2025-06-01" },
        { startDate: "2025-08-13", endDate: "2025-08-17" },
        { startDate: "2026-07-01", endDate: "2026-07-05" },
      ],
      CANONICAL_WINDOW
    );
    expect(summary.storedCount).toBe(4);
    expect(summary.archivedHistoricalCount).toBe(2);
    expect(summary.activeCurrentWindowCount).toBe(1);
    expect(summary.futureOutsideCurrentWindowCount).toBe(1);
    expect(summary.filteredOutOfCurrentWindowCount).toBe(3);
    expect(summary.clippedOperationalRanges).toEqual([{ startDate: "2025-08-13", endDate: "2025-08-17" }]);
  });

  it("resolvePastSimTravelRangesForRecalc drops archived historical travel before sim", async () => {
    const { resolvePastSimTravelRangesForRecalc } = await import("@/lib/usage/pastSimTravelRanges");
    const out = await resolvePastSimTravelRangesForRecalc({
      prisma: {},
      userId: "user-1",
      houseId: "house-1",
      actualContextHouseId: "house-1",
      pastScenarioName: "Past (Corrected)",
      scenarioTravelRanges: [
        { startDate: "2025-02-18", endDate: "2025-05-26" },
        { startDate: "2025-08-13", endDate: "2025-08-17" },
      ],
    });
    expect(out).toEqual([{ startDate: "2025-08-13", endDate: "2025-08-17" }]);
  });

  it("readTravelRangesForHouse merges Past Corrected travel events and manual payload travelRanges", async () => {
    findManyEvents.mockResolvedValueOnce([
      {
        kind: "TRAVEL_RANGE",
        payloadJson: { startDate: "2025-08-14", endDate: "2025-08-16" },
      },
    ]);
    findUniqueManual.mockResolvedValueOnce({
      payload: {
        mode: "MONTHLY",
        travelRanges: [{ startDate: "2025-11-26", endDate: "2025-11-28" }],
      },
    });

    const { readTravelRangesForHouse } = await import("@/lib/usage/pastSimTravelRanges");
    const out = await readTravelRangesForHouse({
      userId: "user-1",
      houseId: "house-1",
      coverageWindow: CANONICAL_WINDOW,
    });

    expect(out).toEqual([
      { startDate: "2025-08-14", endDate: "2025-08-16" },
      { startDate: "2025-11-26", endDate: "2025-11-28" },
    ]);
    expect(findFirstScenario).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ name: "Past (Corrected)" }),
      })
    );
  });
});
