import { homeDetailsPrisma } from "@/lib/db/homeDetailsClient";

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
};

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
      },
    });
    return (rec as HomeProfileSimulatedForSimulator | null) ?? null;
  } catch {
    return null;
  }
}

