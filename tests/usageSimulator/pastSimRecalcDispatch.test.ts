import { beforeEach, describe, expect, it, vi } from "vitest";

const recalcSimulatorBuild = vi.fn();
const raceWithTimeout = vi.fn();
const shouldEnqueuePastSimRecalcRemote = vi.fn();
const enqueuePastSimRecalcDropletJob = vi.fn();
const logSimPipelineEvent = vi.fn();

vi.mock("@/modules/usageSimulator/service", () => ({
  recalcSimulatorBuild: (...args: any[]) => recalcSimulatorBuild(...args),
}));

vi.mock("@/modules/usageSimulator/promiseRaceTimeout", () => ({
  raceWithTimeout: (...args: any[]) => raceWithTimeout(...args),
}));

vi.mock("@/modules/usageSimulator/dropletSimWebhook", () => ({
  shouldEnqueuePastSimRecalcRemote: (...args: any[]) => shouldEnqueuePastSimRecalcRemote(...args),
}));

vi.mock("@/modules/usageSimulator/simDropletJob", () => ({
  enqueuePastSimRecalcDropletJob: (...args: any[]) => enqueuePastSimRecalcDropletJob(...args),
  PAST_SIM_RECALC_PAYLOAD_V: 1,
}));

vi.mock("@/modules/usageSimulator/simObservability", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/usageSimulator/simObservability")>();
  return {
    ...actual,
    createSimCorrelationId: () => "cid-1",
    logSimPipelineEvent: (...args: any[]) => logSimPipelineEvent(...args),
  };
});

import { dispatchPastSimRecalc } from "@/modules/usageSimulator/pastSimRecalcDispatch";
import { USER_PAST_SIM_RECALC_INLINE_TIMEOUT_MS } from "@/modules/usageSimulator/simObservability";

describe("dispatchPastSimRecalc", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    shouldEnqueuePastSimRecalcRemote.mockReturnValue(false);
    recalcSimulatorBuild.mockResolvedValue({ ok: true, houseId: "h1", buildInputsHash: "hash-1", dataset: {} });
    raceWithTimeout.mockImplementation(async (promise: Promise<unknown>) => await promise);
  });

  it("uses the shared extended inline timeout for inline recalc", async () => {
    const out = await dispatchPastSimRecalc({
      userId: "u1",
      houseId: "h1",
      esiid: "E1",
      mode: "SMT_BASELINE",
      scenarioId: "past-s1",
      persistPastSimBaseline: true,
    });

    expect(out.executionMode).toBe("inline");
    expect(raceWithTimeout).toHaveBeenCalledTimes(1);
    expect(raceWithTimeout.mock.calls[0]?.[1]).toBe(USER_PAST_SIM_RECALC_INLINE_TIMEOUT_MS);
    expect(USER_PAST_SIM_RECALC_INLINE_TIMEOUT_MS).toBe(240_000);
  });
});
