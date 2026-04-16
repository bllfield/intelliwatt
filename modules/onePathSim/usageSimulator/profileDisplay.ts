import { getHomeProfileSimulatedByUserHouse } from "@/modules/homeProfile/repo";
import { getApplianceProfileSimulatedByUserHouse } from "@/modules/applianceProfile/repo";
import { normalizeStoredApplianceProfile } from "@/modules/applianceProfile/validation";

export type DisplayProfileSnapshot = {
  homeProfile: any | null;
  applianceProfile: any | null;
};

export function homeProfileDisplaySnapshot(rec: any | null): any | null {
  if (!rec) return null;
  const o = rec as Record<string, unknown>;
  return {
    homeAge: o.homeAge,
    homeStyle: o.homeStyle,
    squareFeet: o.squareFeet,
    stories: o.stories,
    insulation: o.insulationType,
    insulationType: o.insulationType,
    windows: o.windowType,
    windowType: o.windowType,
    foundation: o.foundation,
    fuelConfiguration: o.fuelConfiguration,
    hvacType: o.hvacType,
    heatingType: o.heatingType,
    thermostatSummerF: o.summerTemp,
    thermostatWinterF: o.winterTemp,
    summerTemp: o.summerTemp,
    winterTemp: o.winterTemp,
    ledLights: o.ledLights,
    smartThermostat: o.smartThermostat,
    pool: {
      hasPool: o.hasPool,
      pumpType: o.poolPumpType,
      pumpHp: o.poolPumpHp,
      summerRunHoursPerDay: o.poolSummerRunHoursPerDay,
      winterRunHoursPerDay: o.poolWinterRunHoursPerDay,
      heaterInstalled: o.hasPoolHeater,
      poolHeaterType: o.poolHeaterType,
    },
    occupants: {
      work: o.occupantsWork,
      school: o.occupantsSchool,
      homeAllDay: o.occupantsHomeAllDay,
      total: Number(o.occupantsWork ?? 0) + Number(o.occupantsSchool ?? 0) + Number(o.occupantsHomeAllDay ?? 0),
    },
    ev: o.ev ?? undefined,
  };
}

export function applianceProfileDisplaySnapshotFromStored(appliancesJson: any | null): any | null {
  if (!appliancesJson) return null;
  const normalized = normalizeStoredApplianceProfile(appliancesJson as any);
  return {
    version: normalized.version,
    fuelConfiguration: normalized.fuelConfiguration,
    appliances: normalized.appliances,
    applianceCount: normalized.appliances?.length ?? 0,
  };
}

export async function loadDisplayProfilesForHouse(args: { userId: string; houseId: string }): Promise<DisplayProfileSnapshot> {
  const [homeProfileRec, applianceProfileRec] = await Promise.all([
    getHomeProfileSimulatedByUserHouse({ userId: args.userId, houseId: args.houseId }),
    getApplianceProfileSimulatedByUserHouse({ userId: args.userId, houseId: args.houseId }),
  ]);

  return {
    homeProfile: homeProfileDisplaySnapshot(homeProfileRec),
    applianceProfile: applianceProfileDisplaySnapshotFromStored((applianceProfileRec?.appliancesJson as any) ?? null),
  };
}

export function displayProfilesFromModelMeta(meta: any): DisplayProfileSnapshot {
  const snapshots = (meta as any)?.snapshots ?? {};
  const homeFromMeta = snapshots?.homeProfile ?? null;
  const applianceFromMeta = snapshots?.applianceProfile ?? null;
  return {
    homeProfile: homeProfileDisplaySnapshot(homeFromMeta),
    applianceProfile: applianceProfileDisplaySnapshotFromStored(applianceFromMeta),
  };
}

