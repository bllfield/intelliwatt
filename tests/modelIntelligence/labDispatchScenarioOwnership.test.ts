import { beforeEach, describe, expect, it, vi } from "vitest";

const scenarioFindFirst = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    usageSimulatorScenario: {
      findFirst: (...args: unknown[]) => scenarioFindFirst(...args),
    },
  },
}));

describe("labDispatchScenarioOwnership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    scenarioFindFirst.mockImplementation(async (query: { where?: Record<string, unknown> }) => {
      const id = String(query?.where?.id ?? "");
      if (id === "valid-lab-scenario") {
        return {
          id: "valid-lab-scenario",
          userId: "admin-owner",
          houseId: "29a3d820-2593-4673-9dd6-cd161bbd7f6f",
          name: "Model Intelligence · Monthly Masked",
        };
      }
      if (id === "stale-source-scenario") {
        return {
          id: "stale-source-scenario",
          userId: "admin-owner",
          houseId: "8a6fe8b9-601e-4f9d-aa3e-7ef0b4bddde8",
          name: "Past (Corrected)",
        };
      }
      return null;
    });
  });

  it("accepts a scenario owned by the dispatch house and owner", async () => {
    const { validateDispatchScenarioOwnership } = await import("@/lib/usage/labDispatchScenarioOwnership");
    const result = await validateDispatchScenarioOwnership({
      scenarioId: "valid-lab-scenario",
      dispatchHouseId: "29a3d820-2593-4673-9dd6-cd161bbd7f6f",
      ownerUserId: "admin-owner",
      expectedScenarioName: "Model Intelligence · Monthly Masked",
    });
    expect(result.ok).toBe(true);
  });

  it("rejects stale scenario IDs from a prior lab/source house", async () => {
    const { validateDispatchScenarioOwnership } = await import("@/lib/usage/labDispatchScenarioOwnership");
    const result = await validateDispatchScenarioOwnership({
      scenarioId: "stale-source-scenario",
      dispatchHouseId: "29a3d820-2593-4673-9dd6-cd161bbd7f6f",
      ownerUserId: "admin-owner",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errorCode).toBe("scenario_not_owned_by_dispatch_house");
    expect(result.providedScenarioId).toBe("stale-source-scenario");
    expect(result.dispatchHouseId).toBe("29a3d820-2593-4673-9dd6-cd161bbd7f6f");
    expect(result.actualScenarioHouseId).toBe("8a6fe8b9-601e-4f9d-aa3e-7ef0b4bddde8");
    expect(result.instruction).toContain("prepare_dispatch_step");
  });

  it("returns scenario_not_found when the scenario row is missing", async () => {
    const { validateDispatchScenarioOwnership } = await import("@/lib/usage/labDispatchScenarioOwnership");
    const result = await validateDispatchScenarioOwnership({
      scenarioId: "missing-scenario",
      dispatchHouseId: "29a3d820-2593-4673-9dd6-cd161bbd7f6f",
      ownerUserId: "admin-owner",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errorCode).toBe("scenario_not_found");
    expect(result.actualScenarioHouseId).toBeNull();
  });
});
