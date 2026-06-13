export const WORKSPACE_PAST_SCENARIO_NAME = "Past (Corrected)";

export const MODEL_INTELLIGENCE_MONTHLY_MASKED_SCENARIO_NAME =
  "Model Intelligence · Monthly Masked";
export const MODEL_INTELLIGENCE_ANNUAL_MASKED_SCENARIO_NAME =
  "Model Intelligence · Annual Masked";

const CANONICAL_PAST_ARTIFACT_SCENARIO_NAMES: ReadonlySet<string> = new Set([
  WORKSPACE_PAST_SCENARIO_NAME,
  MODEL_INTELLIGENCE_MONTHLY_MASKED_SCENARIO_NAME,
  MODEL_INTELLIGENCE_ANNUAL_MASKED_SCENARIO_NAME,
]);

export function isCanonicalPastArtifactScenarioName(name: string | null | undefined): boolean {
  const trimmed = String(name ?? "").trim();
  return trimmed.length > 0 && CANONICAL_PAST_ARTIFACT_SCENARIO_NAMES.has(trimmed);
}

export function shouldPersistCanonicalPastArtifactForScenario(args: {
  persistPastSimBaseline?: boolean | null;
  scenarioName: string | null | undefined;
  simMode: string | null | undefined;
}): boolean {
  if (args.persistPastSimBaseline !== true) return false;
  if (!isCanonicalPastArtifactScenarioName(args.scenarioName)) return false;
  const mode = String(args.simMode ?? "").trim();
  return mode === "SMT_BASELINE" || mode === "MANUAL_TOTALS" || mode === "NEW_BUILD_ESTIMATE";
}
