import { beforeEach, describe, expect, it, vi } from "vitest";

const runOnePathSimulatorBuild = vi.fn(async () => ({ ok: true }));

vi.mock("@/modules/onePathSim/serviceBridge", () => ({
  runOnePathSimulatorBuild,
}));

vi.mock("@/modules/usageSimulator/dropletSimWebhook", () => ({
  shouldEnqueuePastSimRecalcRemote: () => false,
}));

vi.mock("@/modules/usageSimulator/promiseRaceTimeout", () => ({
  raceWithTimeout: async (p: Promise<unknown>) => p,
}));

vi.mock("@/modules/usageSimulator/simObservability", () => ({
  createSimCorrelationId: () => "corr-test",
  logSimPipelineEvent: vi.fn(),
  USER_PAST_SIM_RECALC_INLINE_TIMEOUT_MS: 600_000,
}));

describe("user Past sim One Path cutover", () => {
  beforeEach(() => {
    runOnePathSimulatorBuild.mockClear();
  });

  it("dispatchPastSimRecalc calls runOnePathSimulatorBuild for SMT_BASELINE", async () => {
    const { dispatchPastSimRecalc } = await import("@/modules/usageSimulator/pastSimRecalcDispatch");
    const out = await dispatchPastSimRecalc({
      userId: "user-1",
      houseId: "house-1",
      esiid: "10400511114390001",
      mode: "SMT_BASELINE",
      scenarioId: "past-scenario-id",
      persistPastSimBaseline: true,
    });
    expect(out.executionMode).toBe("inline");
    expect(runOnePathSimulatorBuild).toHaveBeenCalledTimes(1);
    expect(runOnePathSimulatorBuild).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        houseId: "house-1",
        mode: "SMT_BASELINE",
        scenarioId: "past-scenario-id",
        persistPastSimBaseline: true,
      })
    );
  });
});
