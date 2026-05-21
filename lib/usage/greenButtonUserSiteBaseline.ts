import {
  isGreenButtonUsageDataset,
  mergeGreenButtonChartInsightsOntoPassthroughDataset,
} from "@/lib/usage/greenButtonChartInsights";
import type {
  WeatherEfficiencyDerivedInput,
  WeatherSensitivityScore,
} from "@/modules/weatherSensitivity/shared";
import {
  adaptGreenButtonRawInput,
  runSharedSimulation,
} from "@/modules/onePathSim/onePathSim";

export type ResolvedUsageLayer = {
  dataset: unknown;
  alternatives: { smt: unknown; greenButton: unknown };
};

/** Weather score stamped on GB baseline passthrough datasets by the shared One Path producer. */
export function weatherSensitivityFromPassthroughDataset(
  dataset: unknown
): { score: WeatherSensitivityScore; derivedInput: WeatherEfficiencyDerivedInput | null } | null {
  if (dataset == null || typeof dataset !== "object") return null;
  const meta = (dataset as Record<string, unknown>).meta;
  if (meta == null || typeof meta !== "object") return null;
  const record = meta as Record<string, unknown>;
  if (record.baselinePassthrough !== true) return null;
  const score = record.weatherSensitivityScore;
  if (score == null || typeof score !== "object") return null;
  const persistedDerived = record.weatherEfficiencyDerivedInput;
  return {
    score: score as WeatherSensitivityScore,
    derivedInput:
      persistedDerived != null && typeof persistedDerived === "object"
        ? (persistedDerived as WeatherEfficiencyDerivedInput)
        : null,
  };
}

/**
 * Align user-site Green Button baseline with One Path baseline passthrough:
 * same adapt → runSharedSimulation(BASELINE) → merge chart insights from the full actual layer.
 */
export async function resolveGreenButtonBaselineUsageForUserSite(args: {
  userId: string;
  houseId: string;
  actualContextHouseId?: string | null;
  resolvedUsage: ResolvedUsageLayer;
}): Promise<ResolvedUsageLayer> {
  if (!isGreenButtonUsageDataset(args.resolvedUsage?.dataset)) {
    return args.resolvedUsage;
  }

  const houseId = String(args.houseId ?? "").trim();
  const userId = String(args.userId ?? "").trim();
  if (!houseId || !userId) return args.resolvedUsage;

  const actualContextHouseId = String(args.actualContextHouseId ?? houseId).trim() || houseId;

  const engineInput = await adaptGreenButtonRawInput({
    userId,
    houseId,
    actualContextHouseId,
    scenarioId: null,
  });
  const artifact = await runSharedSimulation(engineInput);
  const passthroughDataset = mergeGreenButtonChartInsightsOntoPassthroughDataset({
    passthroughDataset: artifact?.dataset ?? null,
    resolvedDataset: args.resolvedUsage.dataset,
  });

  return {
    dataset: passthroughDataset,
    alternatives: args.resolvedUsage.alternatives ?? { smt: null, greenButton: null },
  };
}
