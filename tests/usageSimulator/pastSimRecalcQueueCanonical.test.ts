import { beforeEach, describe, expect, it, vi } from "vitest";

const runOnePathSimulatorBuild = vi.fn();

vi.mock("@/modules/onePathSim/serviceBridge", () => ({
  runOnePathSimulatorBuild: (...args: unknown[]) => runOnePathSimulatorBuild(...args),
}));

const findUnique = vi.fn();
const update = vi.fn().mockResolvedValue({});

vi.mock("@/lib/db/usageClient", () => ({
  usagePrisma: {
    simDropletJob: {
      findUnique: (...args: unknown[]) => findUnique(...args),
      update: (...args: unknown[]) => update(...args),
      create: vi.fn(),
    },
  },
}));

import { runPastSimRecalcQueuedWorker } from "@/modules/usageSimulator/pastSimRecalcQueuedWorker";

/**
 * Slice 12 / plan §4: droplet worker must call the same One Path build as inline execution
 * (no alternate simulator module). correlationId must flow from queued payload (plan §6).
 */
describe("runPastSimRecalcQueuedWorker", () => {
  beforeEach(() => {
    runOnePathSimulatorBuild.mockReset();
    findUnique.mockReset();
    update.mockClear();
  });

  it("invokes runOnePathSimulatorBuild with payload fields including correlationId (canonical single path)", async () => {
    const cid = "aaaaaaaa-bbbb-4ccc-dddd-eeeeeeeeeeee";
    findUnique.mockResolvedValue({
      jobKind: "past_sim_recalc",
      payloadJson: {
        v: 1,
        userId: "u1",
        houseId: "h1",
        esiid: null,
        mode: "SMT_BASELINE",
        scenarioId: null,
        persistPastSimBaseline: false,
        correlationId: cid,
      },
    });
    runOnePathSimulatorBuild.mockResolvedValue({
      ok: true,
      houseId: "h1",
      buildInputsHash: "hash",
      dataset: {},
    });

    await runPastSimRecalcQueuedWorker("job-1");

    expect(runOnePathSimulatorBuild).toHaveBeenCalledTimes(1);
    expect(runOnePathSimulatorBuild.mock.calls[0][0]).toMatchObject({
      userId: "u1",
      houseId: "h1",
      mode: "SMT_BASELINE",
      correlationId: cid,
    });
  });

  it("marks job failed and does not call runOnePathSimulatorBuild when payload is missing", async () => {
    findUnique.mockResolvedValue(null);

    await runPastSimRecalcQueuedWorker("missing");

    expect(runOnePathSimulatorBuild).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalled();
    const failedCall = update.mock.calls.find(
      (c) => c[0]?.data?.status === "failed" || c[0]?.data?.failureMessage != null
    );
    expect(failedCall).toBeDefined();
  });
});
