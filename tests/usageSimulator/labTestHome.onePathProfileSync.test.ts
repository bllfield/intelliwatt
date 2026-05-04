import { beforeEach, describe, expect, it, vi } from "vitest";

const homeProfileUpsert = vi.fn();
const applianceProfileUpsert = vi.fn();
const getHomeProfileSimulatedByUserHouse = vi.fn();
const getApplianceProfileSimulatedByUserHouse = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {},
}));

vi.mock("@/lib/db/usageClient", () => ({
  usagePrisma: {},
}));

vi.mock("@/lib/db/homeDetailsClient", () => ({
  homeDetailsPrisma: {
    homeProfileSimulated: {
      upsert: (...args: any[]) => homeProfileUpsert(...args),
    },
  },
}));

vi.mock("@/lib/db/appliancesClient", () => ({
  appliancesPrisma: {
    applianceProfileSimulated: {
      upsert: (...args: any[]) => applianceProfileUpsert(...args),
    },
  },
}));

vi.mock("@/lib/usage/aggregateMonthlyBuckets", () => ({
  ensureCoreMonthlyBuckets: vi.fn(),
}));

vi.mock("@/modules/homeProfile/repo", () => ({
  getHomeProfileSimulatedByUserHouse: (...args: any[]) => getHomeProfileSimulatedByUserHouse(...args),
}));

vi.mock("@/modules/applianceProfile/repo", () => ({
  getApplianceProfileSimulatedByUserHouse: (...args: any[]) => getApplianceProfileSimulatedByUserHouse(...args),
}));

describe("syncOnePathMissingProfilesFromSource", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    homeProfileUpsert.mockResolvedValue({});
    applianceProfileUpsert.mockResolvedValue({});
  });

  it("persists a flattened home profile payload during one-path sync", async () => {
    getHomeProfileSimulatedByUserHouse
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        homeAge: 12,
        homeStyle: "brick",
        squareFeet: 2200,
        stories: 2,
        insulationType: "fiberglass",
        windowType: "double_pane",
        foundation: "slab",
        ledLights: true,
        smartThermostat: true,
        summerTemp: 73,
        winterTemp: 68,
        occupantsWork: 1,
        occupantsSchool: 1,
        occupantsHomeAllDay: 0,
        fuelConfiguration: "all_electric",
        hvacType: "central",
        heatingType: "heat_pump",
        hasPool: false,
        poolPumpType: null,
        poolPumpHp: null,
        poolSummerRunHoursPerDay: null,
        poolWinterRunHoursPerDay: null,
        hasPoolHeater: false,
        poolHeaterType: null,
        ev: {
          hasVehicle: true,
          count: 1,
          chargerType: "level2",
          avgMilesPerDay: 30,
          avgKwhPerDay: 12,
          chargingBehavior: "every_night",
          preferredStartHr: 22,
          preferredEndHr: 6,
          smartCharger: true,
        },
      });
    getApplianceProfileSimulatedByUserHouse.mockResolvedValue(null);

    const { syncOnePathMissingProfilesFromSource } = await import("@/modules/usageSimulator/labTestHome");

    await syncOnePathMissingProfilesFromSource({
      ownerUserId: "owner-1",
      sourceUserId: "source-1",
      sourceHouseId: "source-house-1",
      testHomeHouseId: "test-home-1",
      overwriteExisting: true,
    });

    expect(homeProfileUpsert).toHaveBeenCalledTimes(1);
    const payload = homeProfileUpsert.mock.calls[0]?.[0];
    expect(payload.create).toMatchObject({
      userId: "owner-1",
      houseId: "test-home-1",
      evHasVehicle: true,
      evCount: 1,
      evChargerType: "level2",
      evAvgMilesPerDay: 30,
      evAvgKwhPerDay: 12,
      evChargingBehavior: "every_night",
      evPreferredStartHr: 22,
      evPreferredEndHr: 6,
      evSmartCharger: true,
    });
    expect(payload.create).not.toHaveProperty("ev");
    expect(payload.update).not.toHaveProperty("ev");
  });

  it("does not overwrite a valid test-home profile with an invalid source profile during lookup refresh", async () => {
    getHomeProfileSimulatedByUserHouse
      .mockResolvedValueOnce({
        homeAge: 8,
        homeStyle: "brick",
        squareFeet: 2100,
        stories: 2,
        insulationType: "fiberglass",
        windowType: "double_pane",
        foundation: "slab",
        ledLights: true,
        smartThermostat: true,
        summerTemp: 73,
        winterTemp: 68,
        occupantsWork: 2,
        occupantsSchool: 0,
        occupantsHomeAllDay: 0,
        fuelConfiguration: "all_electric",
        hvacType: "central",
        heatingType: "heat_pump",
        hasPool: false,
        poolPumpType: null,
        poolPumpHp: null,
        poolSummerRunHoursPerDay: null,
        poolWinterRunHoursPerDay: null,
        hasPoolHeater: false,
        poolHeaterType: null,
      })
      .mockResolvedValueOnce({
        homeAge: 8,
        homeStyle: "brick",
        squareFeet: 2100,
        stories: 2,
        insulationType: "fiberglass",
        windowType: "double_pane",
        foundation: "slab",
        ledLights: true,
        smartThermostat: true,
        summerTemp: 73,
        winterTemp: 68,
        occupantsWork: 0,
        occupantsSchool: 0,
        occupantsHomeAllDay: 0,
        fuelConfiguration: "all_electric",
        hvacType: "central",
        heatingType: "heat_pump",
        hasPool: false,
        poolPumpType: null,
        poolPumpHp: null,
        poolSummerRunHoursPerDay: null,
        poolWinterRunHoursPerDay: null,
        hasPoolHeater: false,
        poolHeaterType: null,
      });
    getApplianceProfileSimulatedByUserHouse.mockResolvedValue(null);

    const { syncOnePathMissingProfilesFromSource } = await import("@/modules/usageSimulator/labTestHome");

    const result = await syncOnePathMissingProfilesFromSource({
      ownerUserId: "owner-1",
      sourceUserId: "source-1",
      sourceHouseId: "source-house-1",
      testHomeHouseId: "test-home-1",
      overwriteExisting: true,
    });

    expect(homeProfileUpsert).not.toHaveBeenCalled();
    expect(result.homeProfile).toMatchObject({
      occupantsWork: 2,
      occupantsSchool: 0,
      occupantsHomeAllDay: 0,
    });
  });
});
