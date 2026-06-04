/**
 * Heal stale Past cache rows when build identity hash no longer matches persisted cache.
 * Recalc uses the same dispatch entry as One Path admin Past runs (not a parallel recalc stack).
 */
import { travelRangesFromPastBuildInputs } from "@/lib/usage/pastArtifactIdentity";
import {
  preferredActualSourceFromPastBuildInputs,
} from "@/lib/usage/pastSimValidationReadBackfill";
import { resolvePastSmtValidationPolicy } from "@/lib/usage/pastValidationPolicy";
import { getLatestCachedPastDatasetByScenario } from "@/modules/usageSimulator/pastCache";
import { dispatchPastSimRecalc } from "@/modules/usageSimulator/pastSimRecalcDispatch";
import type { SimulatorMode } from "@/modules/usageSimulator/requirements";
import type { WeatherPreference } from "@/modules/weatherNormalization/normalizer";

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

function recalcCallerLabelFromBuildInputs(
  buildInputs: Record<string, unknown>
): string {
  const preferred = preferredActualSourceFromPastBuildInputs(buildInputs);
  if (preferred === "GREEN_BUTTON") return "one_path_admin_gb_past_run";
  if (preferred === "SMT") return "one_path_admin_past_run";
  return "past_artifact_identity_heal";
}

export async function healPastArtifactIfIdentityMismatch(args: {
  userId: string;
  houseId: string;
  scenarioId: string;
  resolvedInputHash: string;
  buildInputs: Record<string, unknown>;
  houseEsiid: string | null;
}): Promise<{ healed: boolean; inputHash?: string; error?: string }> {
  const latest = await getLatestCachedPastDatasetByScenario({
    houseId: args.houseId,
    scenarioId: args.scenarioId,
  });
  if (!latest?.inputHash || latest.inputHash === args.resolvedInputHash) {
    return { healed: false };
  }

  const actualContextHouseId =
    typeof args.buildInputs.actualContextHouseId === "string" &&
    String(args.buildInputs.actualContextHouseId).trim()
      ? String(args.buildInputs.actualContextHouseId).trim()
      : args.houseId;
  const preferredActualSource = preferredActualSourceFromPastBuildInputs(args.buildInputs);
  const callerLabel = recalcCallerLabelFromBuildInputs(args.buildInputs);
  const validationPolicy = resolvePastSmtValidationPolicy({
    surface: callerLabel.startsWith("one_path_admin") ? "admin_lab" : "user_site",
  });

  const dispatched = await dispatchPastSimRecalc({
    userId: args.userId,
    houseId: args.houseId,
    esiid: args.houseEsiid,
    mode: simulatorModeFromBuildInputs(args.buildInputs),
    scenarioId: args.scenarioId,
    weatherPreference: weatherPreferenceFromBuildInputs(args.buildInputs),
    persistPastSimBaseline: true,
    actualContextHouseId,
    preLockboxTravelRanges: travelRangesFromPastBuildInputs(args.buildInputs),
    validationDaySelectionMode: validationPolicy.selectionMode,
    validationDayCount: validationPolicy.validationDayCount,
    runContext: {
      callerLabel,
      buildPathKind: "recalc",
      persistRequested: true,
      preferredActualSource: preferredActualSource ?? undefined,
    },
  });

  if (dispatched.executionMode === "droplet_async") {
    return { healed: false, error: "past_artifact_identity_heal_async_unsupported" };
  }

  const recalc = dispatched.result;
  if (!recalc.ok) {
    return { healed: false, error: recalc.error ?? "past_artifact_identity_heal_failed" };
  }
  const inputHash =
    typeof recalc.canonicalArtifactInputHash === "string" && recalc.canonicalArtifactInputHash.trim()
      ? recalc.canonicalArtifactInputHash.trim()
      : args.resolvedInputHash;
  return { healed: true, inputHash };
}
