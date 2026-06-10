import { beforeEach, describe, expect, it, vi } from "vitest";

const findManyScenarios = vi.fn();
const findManyEvents = vi.fn();
const findUniqueManual = vi.fn();
const transaction = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    usageSimulatorScenario: {
      findMany: (...args: unknown[]) => findManyScenarios(...args),
    },
    usageSimulatorScenarioEvent: {
      findMany: (...args: unknown[]) => findManyEvents(...args),
    },
    manualUsageInput: {
      findUnique: (...args: unknown[]) => findUniqueManual(...args),
    },
    $transaction: (...args: unknown[]) => transaction(...args),
  },
}));

describe("readTravelRangesForHouse", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findManyScenarios.mockResolvedValue([{ id: "scenario-1" }]);
    findManyEvents.mockResolvedValue([]);
    findUniqueManual.mockResolvedValue(null);
  });

  it("merges scenario travel events and manual payload travelRanges", async () => {
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
    const out = await readTravelRangesForHouse({ userId: "user-1", houseId: "house-1" });

    expect(out).toEqual([
      { startDate: "2025-08-14", endDate: "2025-08-16" },
      { startDate: "2025-11-26", endDate: "2025-11-28" },
    ]);
  });
});
