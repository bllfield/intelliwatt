import { PAST_VALIDATION_POLICY_REVISION } from "@/lib/usage/pastValidationPolicy";
import { PAST_ENGINE_VERSION } from "@/modules/onePathSim/usageSimulator/pastCache";
import {
  PAST_DAY_SIMULATOR_VERSION,
  SOURCE_OF_DAY_SIMULATION_CORE,
} from "@/modules/onePathSim/simulatedUsage/pastDaySimulatorTypes";

/** Shared Past sim identity string for user site and One Path admin read models. */
export function formatSharedPastSimulationCoreLabel(): string {
  return `${SOURCE_OF_DAY_SIMULATION_CORE} · day-sim ${PAST_DAY_SIMULATOR_VERSION} · engine ${PAST_ENGINE_VERSION} · validation ${PAST_VALIDATION_POLICY_REVISION}`;
}

export function stampSharedPastSimulationCoreMeta(meta: Record<string, unknown>): void {
  meta.sourceOfDaySimulationCore = formatSharedPastSimulationCoreLabel();
  meta.pastValidationPolicyRevision = PAST_VALIDATION_POLICY_REVISION;
}

export function readPastValidationPolicyRevisionFromMeta(meta: unknown): string | null {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
  const value = (meta as Record<string, unknown>).pastValidationPolicyRevision;
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}
