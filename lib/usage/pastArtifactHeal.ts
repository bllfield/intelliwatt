/**
 * Heal stale Past cache rows when build identity hash no longer matches persisted cache.
 */
import { preferredActualSourceFromPastBuildInputs } from "@/lib/usage/pastSimValidationReadBackfill";
import { getLatestCachedPastDatasetByScenario } from "@/modules/usageSimulator/pastCache";
import type { SimulatorMode } from "@/modules/usageSimulator/requirements";
import { recalcSimulatorBuild as recalcSimulatorBuildUserSite } from "@/modules/usageSimulator/service";
import type { WeatherPreference } from "@/modules/weatherNormalization/normalizer";

type RecalcSimulatorBuildFn = typeof recalcSimulatorBuildUserSite;

function weatherPreferenceFromBuildInputs(
  buildInputs: Record<string, unknown>
): WeatherPreference {
  const raw = String(buildInputs.weatherPreference ?? "NONE");
  if (raw === "LAST_YEAR_WEATHER" || raw === "LONG_TERM_AVERAGE") return raw;
  return "NONE";
}

function simulatorModeFromBuildInputs(buildInputs: Record<string, unknown>): SimulatorMode {
  const mode = String(buildInputs.mode ?? "");
  if (mode === "MANUAL_TOTALS" || mode === "NEW_BUILD_ESTIMATE" || mode === "SMT_BASELINE") {
    return mode;
  }
  return "SMT_BASELINE";
}

export async function healPastArtifactIfIdentityMismatch(args: {
  userId: string;
  houseId: string;
  scenarioId: string;
  resolvedInputHash: string;
  buildInputs: Record<string, unknown>;
  houseEsiid: string | null;
  recalcSimulatorBuild?: RecalcSimulatorBuildFn;
}): Promise<{ healed: boolean; inputHash?: string; error?: string }> {
  const latest = await getLatestCachedPastDatasetByScenario({
    houseId: args.houseId,
    scenarioId: args.scenarioId,
  });
  if (!latest?.inputHash || latest.inputHash === args.resolvedInputHash) {
    return { healed: false };
  }

  const recalcFn = args.recalcSimulatorBuild ?? recalcSimulatorBuildUserSite;
  const recalc = await recalcFn({
    userId: args.userId,
    houseId: args.houseId,
    esiid: args.houseEsiid,
    mode: simulatorModeFromBuildInputs(args.buildInputs),
    scenarioId: args.scenarioId,
    weatherPreference: weatherPreferenceFromBuildInputs(args.buildInputs),
    persistPastSimBaseline: true,
    runContext: {
      callerLabel: "past_artifact_identity_heal",
      buildPathKind: "recalc",
      persistRequested: true,
      preferredActualSource: preferredActualSourceFromPastBuildInputs(args.buildInputs) ?? undefined,
    },
  });
  if (!recalc.ok) {
    return { healed: false, error: recalc.error ?? "past_artifact_identity_heal_failed" };
  }
  const inputHash =
    typeof recalc.canonicalArtifactInputHash === "string" && recalc.canonicalArtifactInputHash.trim()
      ? recalc.canonicalArtifactInputHash.trim()
      : args.resolvedInputHash;
  return { healed: true, inputHash };
}
