import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const transaction = vi.fn();
const houseAddressFindFirst = vi.fn();
const houseAddressUpdate = vi.fn();
const houseDailyWeatherDeleteMany = vi.fn();
const usageSimulatorBuildDeleteMany = vi.fn();
const usageSimulatorScenarioFindMany = vi.fn();
const usageSimulatorScenarioDeleteMany = vi.fn();
const usageSimulatorScenarioEventDeleteMany = vi.fn();
const usageSimulatorScenarioEventCreateMany = vi.fn();
const usageSimulatorScenarioCreate = vi.fn();
const usageSimulatorScenarioFindFirst = vi.fn();
const manualUsageInputDeleteMany = vi.fn();
const manualUsageInputFindUnique = vi.fn();
const pastSimulatedDatasetCacheDeleteMany = vi.fn();
const gapfillCompareRunSnapshotDeleteMany = vi.fn();
const greenButtonIntervalDeleteMany = vi.fn();
const rawGreenButtonDeleteMany = vi.fn();
const homeMonthlyUsageBucketDeleteMany = vi.fn();
const homeDailyUsageBucketDeleteMany = vi.fn();
const greenButtonUploadDeleteMany = vi.fn();
const manualUsageUploadDeleteMany = vi.fn();
const homeProfileUpsert = vi.fn();
const applianceProfileUpsert = vi.fn();
const getHomeProfileSimulatedByUserHouse = vi.fn();
const getApplianceProfileSimulatedByUserHouse = vi.fn();
const replacePastCorrectedScenarioTravelRanges = vi.fn();
const readTravelRangesForHouse = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    $transaction: (...args: unknown[]) => transaction(...args),
    houseAddress: {
      findFirst: (...args: unknown[]) => houseAddressFindFirst(...args),
      update: (...args: unknown[]) => houseAddressUpdate(...args),
    },
    houseDailyWeather: {
      deleteMany: (...args: unknown[]) => houseDailyWeatherDeleteMany(...args),
    },
    greenButtonUpload: {
      deleteMany: (...args: unknown[]) => greenButtonUploadDeleteMany(...args),
    },
    manualUsageUpload: {
      deleteMany: (...args: unknown[]) => manualUsageUploadDeleteMany(...args),
    },
    usageSimulatorScenario: {
      findFirst: (...args: unknown[]) => usageSimulatorScenarioFindFirst(...args),
      create: (...args: unknown[]) => usageSimulatorScenarioCreate(...args),
    },
    usageSimulatorScenarioEvent: {
      deleteMany: (...args: unknown[]) => usageSimulatorScenarioEventDeleteMany(...args),
      createMany: (...args: unknown[]) => usageSimulatorScenarioEventCreateMany(...args),
    },
  },
}));

vi.mock("@/lib/db/usageClient", () => ({
  usagePrisma: {
    pastSimulatedDatasetCache: {
      deleteMany: (...args: unknown[]) => pastSimulatedDatasetCacheDeleteMany(...args),
    },
    gapfillCompareRunSnapshot: {
      deleteMany: (...args: unknown[]) => gapfillCompareRunSnapshotDeleteMany(...args),
    },
    greenButtonInterval: {
      deleteMany: (...args: unknown[]) => greenButtonIntervalDeleteMany(...args),
    },
    rawGreenButton: {
      deleteMany: (...args: unknown[]) => rawGreenButtonDeleteMany(...args),
    },
    homeMonthlyUsageBucket: {
      deleteMany: (...args: unknown[]) => homeMonthlyUsageBucketDeleteMany(...args),
    },
    homeDailyUsageBucket: {
      deleteMany: (...args: unknown[]) => homeDailyUsageBucketDeleteMany(...args),
    },
  },
}));

vi.mock("@/lib/db/homeDetailsClient", () => ({
  homeDetailsPrisma: {
    homeProfileSimulated: {
      upsert: (...args: unknown[]) => homeProfileUpsert(...args),
    },
  },
}));

vi.mock("@/lib/db/appliancesClient", () => ({
  appliancesPrisma: {
    applianceProfileSimulated: {
      upsert: (...args: unknown[]) => applianceProfileUpsert(...args),
    },
  },
}));

vi.mock("@/lib/usage/aggregateMonthlyBuckets", () => ({
  ensureCoreMonthlyBuckets: vi.fn(),
}));

vi.mock("@/lib/usage/houseCommittedUsageSource", () => ({
  resolveHouseCommittedUsageSource: vi.fn(),
}));

vi.mock("@/modules/homeProfile/repo", () => ({
  getHomeProfileSimulatedByUserHouse: (...args: unknown[]) => getHomeProfileSimulatedByUserHouse(...args),
}));

vi.mock("@/modules/applianceProfile/repo", () => ({
  getApplianceProfileSimulatedByUserHouse: (...args: unknown[]) => getApplianceProfileSimulatedByUserHouse(...args),
}));

vi.mock("@/lib/usage/pastSimTravelRanges", () => ({
  readTravelRangesForHouse: (...args: unknown[]) => readTravelRangesForHouse(...args),
  replacePastCorrectedScenarioTravelRanges: (...args: unknown[]) => replacePastCorrectedScenarioTravelRanges(...args),
}));

vi.mock("@/modules/usageSimulator/labTestHomeLink", () => ({
  getLabTestHomeLink: vi.fn(),
  getOnePathLabTestHomeLink: vi.fn(),
}));

const validHomeProfile = {
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
};

const validApplianceProfile = {
  version: 1,
  fuelConfiguration: "all_electric",
  appliances: [{ id: "wh-1", type: "water_heater", data: { fuel: "electric" } }],
};

describe("replaceGlobalLabTestHomeFromSource profile clone completeness", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    houseAddressFindFirst.mockImplementation(async (query: { where?: Record<string, unknown> }) => {
      const where = query?.where ?? {};
      if (where.id === "source-house-1") {
        return {
          id: "source-house-1",
          userId: "source-user-1",
          addressLine1: "123 Main",
          addressLine2: null,
          addressCity: "Dallas",
          addressState: "TX",
          addressZip5: "75001",
          addressZip4: null,
          addressCountry: "US",
          placeId: null,
          lat: 32.7,
          lng: -96.8,
          addressValidated: true,
          validationSource: "google",
          esiid: "10400511114390001",
          tdspSlug: "oncor",
          utilityName: "Oncor",
          utilityPhone: null,
        };
      }
      if (where.label === "GAPFILL_CANONICAL_LAB_TEST_HOME") {
        return {
          id: "lab-house-1",
          esiid: null,
          label: "GAPFILL_CANONICAL_LAB_TEST_HOME",
        };
      }
      return null;
    });

    transaction.mockImplementation(async (fn: (tx: unknown) => Promise<void>) => {
      const tx = {
        usageSimulatorBuild: { deleteMany: usageSimulatorBuildDeleteMany },
        usageSimulatorScenario: {
          findMany: usageSimulatorScenarioFindMany,
          deleteMany: usageSimulatorScenarioDeleteMany,
          findFirst: usageSimulatorScenarioFindFirst,
          create: usageSimulatorScenarioCreate,
        },
        usageSimulatorScenarioEvent: {
          findMany: vi.fn().mockResolvedValue([]),
          deleteMany: usageSimulatorScenarioEventDeleteMany,
          createMany: usageSimulatorScenarioEventCreateMany,
        },
        manualUsageInput: {
          deleteMany: manualUsageInputDeleteMany,
          findUnique: manualUsageInputFindUnique,
        },
        houseAddress: { update: houseAddressUpdate },
      };
      await fn(tx);
    });

    usageSimulatorScenarioFindMany.mockResolvedValue([]);
    manualUsageInputFindUnique.mockResolvedValue(null);
    pastSimulatedDatasetCacheDeleteMany.mockResolvedValue({});
    gapfillCompareRunSnapshotDeleteMany.mockResolvedValue({});
    greenButtonIntervalDeleteMany.mockResolvedValue({});
    rawGreenButtonDeleteMany.mockResolvedValue({});
    homeMonthlyUsageBucketDeleteMany.mockResolvedValue({});
    homeDailyUsageBucketDeleteMany.mockResolvedValue({});
    greenButtonUploadDeleteMany.mockResolvedValue({});
    manualUsageUploadDeleteMany.mockResolvedValue({});
    houseDailyWeatherDeleteMany.mockResolvedValue({});
    homeProfileUpsert.mockResolvedValue({});
    applianceProfileUpsert.mockResolvedValue({});
    replacePastCorrectedScenarioTravelRanges.mockResolvedValue(undefined);

    getHomeProfileSimulatedByUserHouse.mockImplementation(async (args: { houseId: string }) => {
      if (args.houseId === "source-house-1") return validHomeProfile;
      if (args.houseId === "lab-house-1") return validHomeProfile;
      return null;
    });
    getApplianceProfileSimulatedByUserHouse.mockImplementation(async (args: { houseId: string }) => {
      if (args.houseId === "source-house-1") return { appliancesJson: validApplianceProfile };
      if (args.houseId === "lab-house-1") return { appliancesJson: validApplianceProfile };
      return null;
    });

    readTravelRangesForHouse.mockImplementation(async (args: { userId: string; houseId: string }) => {
      if (args.houseId === "source-house-1") {
        return [
          { startDate: "2025-05-10", endDate: "2025-05-12" },
          { startDate: "2025-08-01", endDate: "2025-08-05" },
        ];
      }
      if (args.houseId === "lab-house-1" && args.userId === "lab-owner-1") {
        return [
          { startDate: "2025-05-10", endDate: "2025-05-12" },
          { startDate: "2025-08-01", endDate: "2025-08-05" },
        ];
      }
      return [];
    });
  });

  it("copies home profile, appliances, and travel ranges without copying source manual usage", async () => {
    const { replaceGlobalLabTestHomeFromSource } = await import("@/modules/usageSimulator/labTestHome");
    const result = await replaceGlobalLabTestHomeFromSource({
      ownerUserId: "lab-owner-1",
      sourceUserId: "source-user-1",
      sourceHouseId: "source-house-1",
    });

    if (!result.ok) {
      throw new Error(`replace failed: ${String(result.error)} ${String(result.message ?? "")}`);
    }
    expect(result.ok).toBe(true);
    expect(homeProfileUpsert).toHaveBeenCalled();
    expect(applianceProfileUpsert).toHaveBeenCalled();
    expect(replacePastCorrectedScenarioTravelRanges).toHaveBeenCalledWith({
      userId: "lab-owner-1",
      houseId: "lab-house-1",
      travelRanges: [
        { startDate: "2025-05-10", endDate: "2025-05-12" },
        { startDate: "2025-08-01", endDate: "2025-08-05" },
      ],
    });
    expect(manualUsageInputFindUnique).not.toHaveBeenCalled();
    expect(greenButtonIntervalDeleteMany).toHaveBeenCalledWith({ where: { homeId: "lab-house-1" } });
    expect(result.cloneSummary).toMatchObject({
      copiedHomeProfile: true,
      copiedAppliances: true,
      copiedTravelRanges: 2,
      copiedVacantRanges: 2,
      copiedActualUsage: false,
      copiedSourceIntervals: false,
      copiedSourceDailyRows: false,
      labHasRequiredHomeDetails: true,
      labHasRequiredAppliances: true,
      travelRangesPersistedToLab: true,
      copiedThermostatSettings: true,
      copiedHvacs: 1,
      copiedWaterHeaters: 1,
    });
  });

  it("does not copy source manual usage input into the lab home transaction", () => {
    const source = readFileSync(resolve(process.cwd(), "modules/usageSimulator/labTestHome.ts"), "utf8");
    const replaceBlock = source.slice(
      source.indexOf("export async function replaceGlobalLabTestHomeFromSource"),
      source.indexOf("export async function replaceGlobalManualMonthlyLabTestHomeFromSource")
    );
    expect(replaceBlock).not.toContain("copyManualUsageInput");
    expect(replaceBlock).toContain("clearOnePathActualUsageState");
    expect(replaceBlock).toContain("replacePastCorrectedScenarioTravelRanges");
  });

  it("uses extended Prisma transaction timeout for lab test-home replace", () => {
    const source = readFileSync(resolve(process.cwd(), "modules/usageSimulator/labTestHome.ts"), "utf8");
    expect(source).toContain("LAB_TEST_HOME_REPLACE_TX_OPTIONS");
    expect(source).toContain("runLabTestHomeReplaceTransaction");
    expect(source).toContain("timeout: 60_000");
    expect(source).not.toMatch(/\$transaction\(async \(tx: any\)/);
  });
});

describe("labTestHomeCloneSummary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("flags missing travel persistence when lab travel count is lower than source", async () => {
    getHomeProfileSimulatedByUserHouse.mockResolvedValue(validHomeProfile);
    getApplianceProfileSimulatedByUserHouse.mockResolvedValue({ appliancesJson: validApplianceProfile });

    const { buildLabTestHomeCloneSummary } = await import("@/modules/usageSimulator/labTestHomeCloneSummary");
    const summary = await buildLabTestHomeCloneSummary({
      ownerUserId: "lab-owner-1",
      labHouseId: "lab-house-1",
      sourceUserId: "source-user-1",
      sourceHouseId: "source-house-1",
      sourceTravelRanges: [{ startDate: "2025-05-10", endDate: "2025-05-12" }],
      labTravelRanges: [],
      copiedHomeProfile: true,
      copiedAppliances: true,
    });

    expect(summary.travelRangesPersistedToLab).toBe(false);
    expect(summary.sourceTravelRangeCount).toBe(1);
    expect(summary.labTravelRangeCount).toBe(0);
  });
});
