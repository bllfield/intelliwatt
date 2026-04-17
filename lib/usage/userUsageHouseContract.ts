import { resolveIntervalsLayer } from "@/lib/usage/resolveIntervalsLayer";
import { getApplianceProfileSimulatedByUserHouse } from "@/modules/applianceProfile/repo";
import { normalizeStoredApplianceProfile } from "@/modules/applianceProfile/validation";
import { getHomeProfileSimulatedByUserHouse } from "@/modules/homeProfile/repo";
import { getManualUsageInputForUserHouse } from "@/modules/manualUsage/store";
import { IntervalSeriesKind } from "@/modules/usageSimulator/kinds";
import { toPublicHouseLabel } from "@/modules/usageSimulator/houseLabel";
import {
  resolveSharedWeatherSensitivityEnvelope,
  type WeatherEfficiencyDerivedInput,
  type WeatherSensitivityScore,
} from "@/modules/weatherSensitivity/shared";

export type UserUsageHouseSelection = {
  id: string;
  label?: string | null;
  addressLine1?: string | null;
  addressCity?: string | null;
  addressState?: string | null;
  esiid?: string | null;
};

export type UserUsageHouseContract = {
  houseId: string;
  label: string | null;
  address: {
    line1: string;
    city: string | null;
    state: string | null;
  };
  esiid: string | null;
  dataset: any | null;
  alternatives: {
    smt: any;
    greenButton: any;
  };
  datasetError: {
    code: string;
    explanation: string;
  } | null;
  weatherSensitivityScore: WeatherSensitivityScore | null;
  weatherEfficiencyDerivedInput: WeatherEfficiencyDerivedInput | null;
};

type ResolvedUsageLayer = {
  dataset: any | null;
  alternatives: {
    smt: any;
    greenButton: any;
  };
};

export async function buildUserUsageHouseContract(args: {
  userId: string;
  house: UserUsageHouseSelection;
  resolvedUsage?: ResolvedUsageLayer | null;
  homeProfile?: unknown;
  applianceProfileRecord?: { appliancesJson?: unknown } | null;
  manualUsageRecord?: { payload?: unknown } | null;
  weatherSensitivity?: {
    score: WeatherSensitivityScore | null;
    derivedInput: WeatherEfficiencyDerivedInput | null;
  } | null;
}): Promise<UserUsageHouseContract> {
  const resolvedUsage =
    args.resolvedUsage ??
    (await resolveIntervalsLayer({
      userId: args.userId,
      houseId: args.house.id,
      layerKind: IntervalSeriesKind.ACTUAL_USAGE_INTERVALS,
      esiid: args.house.esiid ?? null,
    }).catch(() => ({ dataset: null, alternatives: { smt: null, greenButton: null } })));
  const [homeProfile, applianceProfileRecord, manualUsageRecord] = await Promise.all([
    args.homeProfile !== undefined
      ? args.homeProfile
      : getHomeProfileSimulatedByUserHouse({ userId: args.userId, houseId: args.house.id }).catch(() => null),
    args.applianceProfileRecord !== undefined
      ? args.applianceProfileRecord
      : getApplianceProfileSimulatedByUserHouse({ userId: args.userId, houseId: args.house.id }).catch(() => null),
    args.manualUsageRecord !== undefined
      ? args.manualUsageRecord
      : getManualUsageInputForUserHouse({ userId: args.userId, houseId: args.house.id }).catch(() => ({ payload: null })),
  ]);
  const applianceProfile = normalizeStoredApplianceProfile((applianceProfileRecord?.appliancesJson as any) ?? null);
  const weatherSensitivity =
    args.weatherSensitivity ??
    (await resolveSharedWeatherSensitivityEnvelope({
      actualDataset: resolvedUsage?.dataset ?? null,
      manualUsagePayload: (manualUsageRecord?.payload as any) ?? null,
      homeProfile,
      applianceProfile,
      weatherHouseId: args.house.id,
    }).catch(() => ({ score: null, derivedInput: null })));

  return {
    houseId: args.house.id,
    label: toPublicHouseLabel({
      label: args.house.label ?? null,
      addressLine1: args.house.addressLine1 ?? null,
      fallbackId: args.house.id,
    }),
    address: {
      line1: args.house.addressLine1 ?? "",
      city: args.house.addressCity ?? null,
      state: args.house.addressState ?? null,
    },
    esiid: args.house.esiid ?? null,
    dataset: resolvedUsage?.dataset ?? null,
    alternatives: resolvedUsage?.alternatives ?? { smt: null, greenButton: null },
    datasetError:
      resolvedUsage?.dataset == null
        ? {
            code: "ACTUAL_DATA_UNAVAILABLE",
            explanation:
              "We could not load interval usage for this home right now. This can happen when SMT/Green Button data is still syncing or temporarily unavailable.",
          }
        : null,
    weatherSensitivityScore: weatherSensitivity?.score ?? null,
    weatherEfficiencyDerivedInput: weatherSensitivity?.derivedInput ?? null,
  };
}
