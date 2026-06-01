import { describe, expect, it, vi, beforeEach } from "vitest";

const createScenario = vi.fn();

const listScenarios = vi.fn();

vi.mock("@/modules/usageSimulator/service", () => ({
  createScenario: (...args: unknown[]) => createScenario(...args),
  listScenarios: (...args: unknown[]) => listScenarios(...args),
}));

import {
  WORKSPACE_FUTURE_SCENARIO_NAME,
  WORKSPACE_PAST_SCENARIO_NAME,
  ensureWorkspaceScenariosForHouse,
} from "@/lib/usage/ensureWorkspaceScenarios";

describe("ensureWorkspaceScenariosForHouse", () => {
  beforeEach(() => {
    createScenario.mockReset();
    listScenarios.mockReset();
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

  it("returns existing scenario ids when create hits the unique constraint", async () => {
    createScenario
      .mockResolvedValueOnce({ ok: false, error: "name_not_unique" })
      .mockResolvedValueOnce({ ok: false, error: "name_not_unique" });
    listScenarios.mockResolvedValue({
      ok: true,
      scenarios: [
        { id: "past-existing", name: WORKSPACE_PAST_SCENARIO_NAME },
        { id: "future-existing", name: WORKSPACE_FUTURE_SCENARIO_NAME },
      ],
    });

    const out = await ensureWorkspaceScenariosForHouse({ userId: "user-1", houseId: "house-1" });

    expect(listScenarios).toHaveBeenCalledWith({ userId: "user-1", houseId: "house-1" });
    expect(out).toEqual({ pastScenarioId: "past-existing", futureScenarioId: "future-existing" });
  });
});
