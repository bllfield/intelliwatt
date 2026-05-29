import { createScenario } from "@/modules/usageSimulator/service";

export const WORKSPACE_PAST_SCENARIO_NAME = "Past (Corrected)";
export const WORKSPACE_FUTURE_SCENARIO_NAME = "Future (What-if)";

/**
 * Ensures the standard usage-simulator workspace scenarios exist on a house.
 * One Path Past/Future presets resolve scenarios by name hint against this pair.
 */
export async function ensureWorkspaceScenariosForHouse(args: {
  userId: string;
  houseId: string;
}): Promise<{ pastScenarioId: string | null; futureScenarioId: string | null }> {
  const userId = String(args.userId ?? "").trim();
  const houseId = String(args.houseId ?? "").trim();
  if (!userId || !houseId) {
    return { pastScenarioId: null, futureScenarioId: null };
  }

  const [pastResult, futureResult] = await Promise.all([
    createScenario({ userId, houseId, name: WORKSPACE_PAST_SCENARIO_NAME }),
    createScenario({ userId, houseId, name: WORKSPACE_FUTURE_SCENARIO_NAME }),
  ]);

  return {
    pastScenarioId: pastResult.ok ? String(pastResult.scenario.id) : null,
    futureScenarioId: futureResult.ok ? String(futureResult.scenario.id) : null,
  };
}
