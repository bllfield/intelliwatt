import { beforeEach, describe, expect, it, vi } from "vitest";

const findFirst = vi.fn();
const resolveIntervalsLayer = vi.fn();
const requestUsageRefreshForUserHouse = vi.fn();

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

vi.mock("@/lib/usage/userUsageRefresh", () => ({
  requestUsageRefreshForUserHouse: (...args: any[]) => requestUsageRefreshForUserHouse(...args),
}));

describe("upstream usage truth for simulation", () => {
  beforeEach(() => {
    findFirst.mockReset();
    resolveIntervalsLayer.mockReset();
    requestUsageRefreshForUserHouse.mockReset();

    findFirst.mockImplementation(async ({ where }: any) => {
      if (where.id === "house-1") return { id: "house-1", esiid: "esiid-1" };
      if (where.id === "house-2") return { id: "house-2", esiid: "esiid-2" };
      return null;
    });
  });

  it("reads persisted usage truth through the shared usage layer when available", async () => {
    resolveIntervalsLayer.mockResolvedValue({
      dataset: { summary: { totalKwh: 123 } },
      alternatives: { smt: { totalKwh: 123 }, greenButton: null },
    });
    const { resolveUpstreamUsageTruthForSimulation } = await import(
      "@/modules/usageSimulator/upstreamUsageTruth"
    );

    const out = await resolveUpstreamUsageTruthForSimulation({
      userId: "user-1",
      houseId: "house-1",
      actualContextHouseId: "house-2",
      seedIfMissing: true,
    });

    expect(resolveIntervalsLayer).toHaveBeenCalledWith({
      userId: "user-1",
      houseId: "house-2",
      layerKind: "ACTUAL_USAGE_INTERVALS",
      scenarioId: null,
      esiid: "esiid-2",
    });
    expect(requestUsageRefreshForUserHouse).not.toHaveBeenCalled();
    expect(out.usageTruthSource).toBe("persisted_usage_output");
    expect(out.dataset).toEqual({ summary: { totalKwh: 123 } });
    expect(out.summary.currentRun.statusSummary).toEqual({
      usageTruthStatus: "existing_persisted_truth",
      downstreamSimulationAllowed: true,
      seedingAttempted: false,
      seedingResult: "not_needed",
    });
  });

  it("requests the existing usage refresh flow when persisted usage truth is missing", async () => {
    resolveIntervalsLayer
      .mockResolvedValueOnce({ dataset: null, alternatives: { smt: null, greenButton: null } })
      .mockResolvedValueOnce({
        dataset: { summary: { totalKwh: 456 } },
        alternatives: { smt: { totalKwh: 456 }, greenButton: null },
      });
    requestUsageRefreshForUserHouse.mockResolvedValue({
      ok: true,
      homeId: "house-2",
      message: "existing usage orchestration requested",
    });
    const { resolveUpstreamUsageTruthForSimulation } = await import(
      "@/modules/usageSimulator/upstreamUsageTruth"
    );

    const out = await resolveUpstreamUsageTruthForSimulation({
      userId: "user-1",
      houseId: "house-1",
      actualContextHouseId: "house-2",
      seedIfMissing: true,
    });

    expect(requestUsageRefreshForUserHouse).toHaveBeenCalledWith({
      userId: "user-1",
      houseId: "house-2",
    });
    expect(resolveIntervalsLayer).toHaveBeenCalledTimes(2);
    expect(out.usageTruthSource).toBe("seeded_via_existing_usage_orchestration");
    expect(out.seedResult).toEqual({
      ok: true,
      homeId: "house-2",
      message: "existing usage orchestration requested",
    });
    expect(out.dataset).toEqual({ summary: { totalKwh: 456 } });
    expect(out.summary.currentRun.statusSummary).toEqual({
      usageTruthStatus: "seeded_via_existing_refresh",
      downstreamSimulationAllowed: true,
      seedingAttempted: true,
      seedingResult: "success",
    });
  });
});
