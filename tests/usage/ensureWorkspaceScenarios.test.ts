import { describe, expect, it, vi, beforeEach } from "vitest";

const createScenario = vi.fn();

vi.mock("@/modules/usageSimulator/service", () => ({
  createScenario: (...args: unknown[]) => createScenario(...args),
}));

import {
  WORKSPACE_FUTURE_SCENARIO_NAME,
  WORKSPACE_PAST_SCENARIO_NAME,
  ensureWorkspaceScenariosForHouse,
} from "@/lib/usage/ensureWorkspaceScenarios";

describe("ensureWorkspaceScenariosForHouse", () => {
  beforeEach(() => {
    createScenario.mockReset();
  });

  it("creates Past and Future workspace scenarios when missing", async () => {
    createScenario
      .mockResolvedValueOnce({ ok: true, scenario: { id: "past-1", name: WORKSPACE_PAST_SCENARIO_NAME } })
      .mockResolvedValueOnce({ ok: true, scenario: { id: "future-1", name: WORKSPACE_FUTURE_SCENARIO_NAME } });

    const out = await ensureWorkspaceScenariosForHouse({ userId: "user-1", houseId: "house-1" });

    expect(createScenario).toHaveBeenCalledTimes(2);
    expect(createScenario).toHaveBeenCalledWith({
      userId: "user-1",
      houseId: "house-1",
      name: WORKSPACE_PAST_SCENARIO_NAME,
    });
    expect(createScenario).toHaveBeenCalledWith({
      userId: "user-1",
      houseId: "house-1",
      name: WORKSPACE_FUTURE_SCENARIO_NAME,
    });
    expect(out).toEqual({ pastScenarioId: "past-1", futureScenarioId: "future-1" });
  });
});
