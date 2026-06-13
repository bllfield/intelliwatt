import { createScenario, listScenarios } from "@/modules/usageSimulator/service";
import { WORKSPACE_PAST_SCENARIO_NAME } from "@/lib/usage/canonicalPastArtifactScenario";

export { WORKSPACE_PAST_SCENARIO_NAME };

export const WORKSPACE_FUTURE_SCENARIO_NAME = "Future (What-if)";

type WorkspaceScenarioRow = { id: string; name: string };

async function resolveWorkspaceScenarioId(args: {
  userId: string;
  houseId: string;
  name: string;
}): Promise<string | null> {
  const created = await createScenario({
    userId: args.userId,
    houseId: args.houseId,
    name: args.name,
  });
  if (created.ok) return String(created.scenario.id);

  if (created.error !== "name_not_unique") return null;

  const listed = await listScenarios({ userId: args.userId, houseId: args.houseId }).catch(() => ({
    ok: false as const,
    scenarios: [] as WorkspaceScenarioRow[],
  }));
  if (!listed.ok) return null;
  const scenarios = listed.scenarios as WorkspaceScenarioRow[];
  const existing = scenarios.find((row) => row.name === args.name);
  return existing ? String(existing.id) : null;
}

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

  const [pastScenarioId, futureScenarioId] = await Promise.all([
    resolveWorkspaceScenarioId({ userId, houseId, name: WORKSPACE_PAST_SCENARIO_NAME }),
    resolveWorkspaceScenarioId({ userId, houseId, name: WORKSPACE_FUTURE_SCENARIO_NAME }),
  ]);

  return { pastScenarioId, futureScenarioId };
}
