import {
  MODEL_INTELLIGENCE_ANNUAL_MASKED_SCENARIO_NAME,
  MODEL_INTELLIGENCE_MONTHLY_MASKED_SCENARIO_NAME,
  WORKSPACE_PAST_SCENARIO_NAME,
} from "@/lib/usage/canonicalPastArtifactScenario";
import { buildImmutablePastArtifactKey } from "@/lib/usage/pastArtifactIdentity";
import { createScenario, listScenarios } from "@/modules/usageSimulator/service";
import type { ModelIntelligenceRunMode } from "@/modules/modelIntelligence/types";

export { buildImmutablePastArtifactKey };
export {
  MODEL_INTELLIGENCE_ANNUAL_MASKED_SCENARIO_NAME,
  MODEL_INTELLIGENCE_MONTHLY_MASKED_SCENARIO_NAME,
};

type WorkspaceScenarioRow = { id: string; name: string };

export function scenarioNameForModelIntelligenceRunMode(
  runMode: ModelIntelligenceRunMode
): string | null {
  switch (runMode) {
    case "MONTHLY_MASKED":
      return MODEL_INTELLIGENCE_MONTHLY_MASKED_SCENARIO_NAME;
    case "ANNUAL_MASKED":
      return MODEL_INTELLIGENCE_ANNUAL_MASKED_SCENARIO_NAME;
    case "SMT_INTERVAL_TRUTH":
    case "GREEN_BUTTON_TRUTH":
      return WORKSPACE_PAST_SCENARIO_NAME;
    default:
      return null;
  }
}

async function resolveScenarioIdByName(args: {
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
  const existing = (listed.scenarios as WorkspaceScenarioRow[]).find((row) => row.name === args.name);
  return existing ? String(existing.id) : null;
}

/** One Past scenario per Model Intelligence dispatch mode so masked runs do not share a mutable build row. */
export async function ensureModelIntelligenceScenarioForRunMode(args: {
  userId: string;
  houseId: string;
  runMode: ModelIntelligenceRunMode;
}): Promise<string | null> {
  const userId = String(args.userId ?? "").trim();
  const houseId = String(args.houseId ?? "").trim();
  const name = scenarioNameForModelIntelligenceRunMode(args.runMode);
  if (!userId || !houseId || !name) return null;
  return resolveScenarioIdByName({ userId, houseId, name });
}
