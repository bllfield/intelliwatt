import { beforeEach, describe, expect, it, vi } from "vitest";

const findFirst = vi.fn();
const resolveIntervalsLayer = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    houseAddress: {
      findFirst: (...args: any[]) => findFirst(...args),
    },
  },
}));

vi.mock("@/lib/usage/resolveIntervalsLayer", () => ({
  resolveIntervalsLayer: (...args: any[]) => resolveIntervalsLayer(...args),
}));

vi.mock("@/lib/usage/ensureSmtCoverage", () => ({
  ensureSmtCoverageForHouse: vi.fn(),
}));

describe("one path upstream usage truth actual context house", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findFirst.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
      if (where.id === "test-home-1" && where.userId === "owner-1") {
        return { id: "test-home-1", esiid: null };
      }
      if (where.id === "source-house-1" && where.userId === "owner-1") {
        return null;
      }
      if (where.id === "source-house-1" && where.archivedAt === null && where.userId === undefined) {
        return { id: "source-house-1", esiid: "esiid-src", userId: "customer-1" };
      }
      return null;
    });
    resolveIntervalsLayer.mockResolvedValue({
      dataset: { summary: { totalKwh: 100 }, meta: { actualSource: "GREEN_BUTTON" } },
      alternatives: { smt: null, greenButton: { totalKwh: 100 } },
    });
  });

  it("reads persisted usage from the source-house owner when lab test home differs", async () => {
    const { resolveUpstreamUsageTruthForSimulation } = await import("@/modules/onePathSim/upstreamUsageTruth");

    const out = await resolveUpstreamUsageTruthForSimulation({
      userId: "owner-1",
      houseId: "test-home-1",
      actualContextHouseId: "source-house-1",
      smtSourceEsiid: "esiid-src",
      seedIfMissing: false,
      preferredActualSource: "GREEN_BUTTON",
    });

    expect(resolveIntervalsLayer).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "customer-1",
        houseId: "source-house-1",
        preferredActualSource: "GREEN_BUTTON",
      })
    );
    expect(out.actualContextHouse.id).toBe("source-house-1");
    expect(out.selectedHouse.id).toBe("test-home-1");
    expect(out.dataset).toEqual({ summary: { totalKwh: 100 }, meta: { actualSource: "GREEN_BUTTON" } });
  });
});
