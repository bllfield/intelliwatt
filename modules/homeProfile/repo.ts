import { homeDetailsPrisma } from "@/lib/db/homeDetailsClient";
import { getApplianceProfileSimulatedByUserHouse } from "@/modules/applianceProfile/repo";
import { normalizeStoredApplianceProfile } from "@/modules/applianceProfile/validation";

export type HomeProfileSimulatedForSimulator = {
  homeAge: number;
  homeStyle: string;
  squareFeet: number;
  stories: number;
  insulationType: string;
  windowType: string;
  foundation: string;
  ledLights: boolean;
  smartThermostat: boolean;
  summerTemp: number;
  winterTemp: number;
  occupantsWork: number;
  occupantsSchool: number;
  occupantsHomeAllDay: number;
  fuelConfiguration: string;
  hvacType: string | null;
  heatingType: string | null;
  hasPool: boolean;
  poolPumpType: string | null;
  poolPumpHp: number | null;
  poolSummerRunHoursPerDay: number | null;
  poolWinterRunHoursPerDay: number | null;
  hasPoolHeater: boolean;
  poolHeaterType: string | null;
  ev?: import("@/modules/homeProfile/validation").HomeProfileEv;
};

const EV_SELECT = {
  evHasVehicle: true,
  evCount: true,
  evChargerType: true,
  evAvgMilesPerDay: true,
  evAvgKwhPerDay: true,
  evChargingBehavior: true,
  evPreferredStartHr: true,
  evPreferredEndHr: true,
  evSmartCharger: true,
} as const;

function recToEv(rec: Record<string, unknown> | null): import("@/modules/homeProfile/validation").HomeProfileEv | undefined {
  if (!rec || !rec.evHasVehicle) return undefined;
  return {
    hasVehicle: true,
    count: rec.evCount != null ? Number(rec.evCount) : undefined,
    chargerType: [ "level1", "level2", "fast" ].includes(String(rec.evChargerType ?? "")) ? (rec.evChargerType as "level1" | "level2" | "fast") : undefined,
    avgMilesPerDay: rec.evAvgMilesPerDay != null ? Number(rec.evAvgMilesPerDay) : undefined,
    avgKwhPerDay: rec.evAvgKwhPerDay != null ? Number(rec.evAvgKwhPerDay) : undefined,
    chargingBehavior: [ "every_night", "weekdays_only", "weekend_heavy", "random" ].includes(String(rec.evChargingBehavior ?? ""))
      ? (rec.evChargingBehavior as "every_night" | "weekdays_only" | "weekend_heavy" | "random")
      : undefined,
    preferredStartHr: rec.evPreferredStartHr != null ? Number(rec.evPreferredStartHr) : undefined,
    preferredEndHr: rec.evPreferredEndHr != null ? Number(rec.evPreferredEndHr) : undefined,
    smartCharger: rec.evSmartCharger != null ? Boolean(rec.evSmartCharger) : undefined,
  };
}

/** Map legacy EV appliance data to HomeDetails ev flat fields (for migration). */
function evApplianceDataToFlat(data: Record<string, any>): Record<string, unknown> {
  const charger = String(data?.charger_type ?? data?.chargerType ?? "").toLowerCase();
  const evChargerType = [ "level1", "level2", "fast" ].includes(charger) ? charger : null;
  const evChargingBehavior = [ "every_night", "weekdays_only", "weekend_heavy", "random" ].includes(String(data?.charging_behavior ?? data?.chargingBehavior ?? ""))
    ? (data?.charging_behavior ?? data?.chargingBehavior)
    : null;
  return {
    evHasVehicle: true,
    evCount: typeof data?.count === "number" ? data.count : 1,
    evChargerType,
    evAvgMilesPerDay: typeof data?.miles_per_day === "number" ? data.miles_per_day : (typeof data?.avgMilesPerDay === "number" ? data.avgMilesPerDay : null),
    evAvgKwhPerDay: typeof data?.avg_kwh_per_day === "number" ? data.avg_kwh_per_day : (typeof data?.avgKwhPerDay === "number" ? data.avgKwhPerDay : null),
    evChargingBehavior,
    evPreferredStartHr: typeof data?.preferred_start_hr === "number" ? data.preferred_start_hr : (typeof data?.preferredStartHr === "number" ? data.preferredStartHr : null),
    evPreferredEndHr: typeof data?.preferred_end_hr === "number" ? data.preferred_end_hr : (typeof data?.preferredEndHr === "number" ? data.preferredEndHr : null),
    evSmartCharger: typeof data?.smart_charger === "boolean" ? data.smart_charger : (typeof data?.smartCharger === "boolean" ? data.smartCharger : null),
  };
}

export async function getHomeProfileSimulatedByUserHouse(args: {
  userId: string;
  houseId: string;
}): Promise<HomeProfileSimulatedForSimulator | null> {
  try {
    const rec = await homeDetailsPrisma.homeProfileSimulated.findUnique({
      where: { userId_houseId: { userId: args.userId, houseId: args.houseId } },
      select: {
        homeAge: true,
        homeStyle: true,
        squareFeet: true,
        stories: true,
        insulationType: true,
        windowType: true,
        foundation: true,
        ledLights: true,
        smartThermostat: true,
        summerTemp: true,
        winterTemp: true,
        occupantsWork: true,
        occupantsSchool: true,
        occupantsHomeAllDay: true,
        fuelConfiguration: true,
        hvacType: true,
        heatingType: true,
        hasPool: true,
        poolPumpType: true,
        poolPumpHp: true,
        poolSummerRunHoursPerDay: true,
        poolWinterRunHoursPerDay: true,
        hasPoolHeater: true,
        poolHeaterType: true,
        ...EV_SELECT,
      },
    });

    if (rec && !(rec as any).evHasVehicle) {
      const appRec = await getApplianceProfileSimulatedByUserHouse({ userId: args.userId, houseId: args.houseId });
      const normalized = appRec?.appliancesJson ? normalizeStoredApplianceProfile(appRec.appliancesJson as any) : null;
      const evAppliance = normalized?.appliances?.find((a: any) => String(a?.type ?? "").toLowerCase() === "ev");
      if (evAppliance?.data) {
        const flat = evApplianceDataToFlat(evAppliance.data as Record<string, any>);
        try {
          await homeDetailsPrisma.homeProfileSimulated.update({
            where: { userId_houseId: { userId: args.userId, houseId: args.houseId } },
            data: flat as any,
          });
          if (process.env.NODE_ENV === "development" || process.env.VERCEL) {
            console.warn("[homeProfile] EV appliance detected — migrated to HomeDetails");
          }
          rec = { ...rec, ...flat } as typeof rec;
        } catch {
          // ignore update failure; return current rec
        }
      }
    }

    if (!rec) return null;
    const r = rec as any;
    return {
      ...r,
      ev: recToEv(r),
    } as HomeProfileSimulatedForSimulator;
  } catch {
    return null;
  }
}

