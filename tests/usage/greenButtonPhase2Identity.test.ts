import { readFileSync } from "fs";
import { resolve } from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const smtFindMany = vi.fn();
const greenButtonFindMany = vi.fn();
const usageBucketDefinitionUpsert = vi.fn();
const monthlyBucketUpsert = vi.fn();
const dailyBucketUpsert = vi.fn();
const usageTransaction = vi.fn();
const getLatestUsableRawGreenButtonIdForHouse = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    smtInterval: {
      findMany: (...args: any[]) => smtFindMany(...args),
    },
  },
}));

vi.mock("@/lib/db/usageClient", () => ({
  usagePrisma: {
    greenButtonInterval: {
      findMany: (...args: any[]) => greenButtonFindMany(...args),
    },
    usageBucketDefinition: {
      upsert: (...args: any[]) => usageBucketDefinitionUpsert(...args),
    },
    homeMonthlyUsageBucket: {
      upsert: (...args: any[]) => monthlyBucketUpsert(...args),
    },
    homeDailyUsageBucket: {
      upsert: (...args: any[]) => dailyBucketUpsert(...args),
    },
    $transaction: (...args: any[]) => usageTransaction(...args),
  },
}));

vi.mock("@/modules/realUsageAdapter/greenButton", () => ({
  getLatestUsableRawGreenButtonIdForHouse: (...args: any[]) => getLatestUsableRawGreenButtonIdForHouse(...args),
}));

const ROOT = process.cwd();

function readRepoFile(relativePath: string): string {
  return readFileSync(resolve(ROOT, relativePath), "utf8");
}

const allDayBucket = {
  key: "kwh.m.all.total",
  label: "All usage",
  rule: {
    v: 1,
    tz: "America/Chicago",
    dayType: "ALL",
    window: { startHHMM: "0000", endHHMM: "2400" },
  },
};

describe("Green Button Phase 2 raw identity alignment", () => {
  beforeEach(() => {
    smtFindMany.mockReset();
    greenButtonFindMany.mockReset();
    usageBucketDefinitionUpsert.mockReset().mockResolvedValue(null);
    monthlyBucketUpsert.mockReset().mockResolvedValue(null);
    dailyBucketUpsert.mockReset().mockResolvedValue(null);
    usageTransaction.mockReset().mockImplementation(async (ops: any[]) => Promise.all(ops));
    getLatestUsableRawGreenButtonIdForHouse.mockReset().mockResolvedValue("raw-resolved");
  });

  it("raw-scopes Green Button interval reads in ensureCoreMonthlyBuckets", async () => {
    greenButtonFindMany.mockResolvedValue([
      { timestamp: new Date("2025-04-01T06:00:00.000Z"), consumptionKwh: "1.25" },
    ]);

    const { ensureCoreMonthlyBuckets } = await import("@/lib/usage/aggregateMonthlyBuckets");

    const result = await ensureCoreMonthlyBuckets({
      homeId: "home-1",
      rawId: "raw-selected",
      rangeStart: new Date("2025-04-01T00:00:00.000Z"),
      rangeEnd: new Date("2025-04-02T00:00:00.000Z"),
      source: "GREENBUTTON",
      intervalSource: "GREENBUTTON",
      bucketDefs: [allDayBucket],
    } as any);

    expect(result.intervalRowsRead).toBe(1);
    expect(greenButtonFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          homeId: "home-1",
          rawId: "raw-selected",
        }),
      }),
    );
    expect(getLatestUsableRawGreenButtonIdForHouse).not.toHaveBeenCalled();
  });

  it("resolves the shared latest usable raw id when a Green Button bucket caller omits rawId", async () => {
    greenButtonFindMany.mockResolvedValue([]);

    const { ensureCoreMonthlyBuckets } = await import("@/lib/usage/aggregateMonthlyBuckets");

    await ensureCoreMonthlyBuckets({
      homeId: "home-1",
      rangeStart: new Date("2025-04-01T00:00:00.000Z"),
      rangeEnd: new Date("2025-04-02T00:00:00.000Z"),
      source: "GREENBUTTON",
      intervalSource: "GREENBUTTON",
      bucketDefs: [allDayBucket],
    } as any);

    expect(getLatestUsableRawGreenButtonIdForHouse).toHaveBeenCalledWith("home-1");
    expect(greenButtonFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          homeId: "home-1",
          rawId: "raw-resolved",
        }),
      }),
    );
  });

  it("threads selected raw identity through upload, estimate, dashboard, detail, compare, and pipeline callers", () => {
    const uploadRoute = readRepoFile("app/api/green-button/upload/route.ts");
    const buildBuckets = readRepoFile("lib/usage/buildUsageBucketsForEstimate.ts");
    const sharedEstimate = readRepoFile("app/api/plan-engine/_shared/estimate.ts");
    const detailRoute = readRepoFile("app/api/dashboard/plans/detail/route.ts");
    const dashboardRoute = readRepoFile("app/api/dashboard/plans/route.ts");
    const compareRoute = readRepoFile("app/api/dashboard/plans/compare/route.ts");
    const pipeline = readRepoFile("lib/plan-engine/runPlanPipelineForHome.ts");

    expect(uploadRoute).toContain("rawId: rawRecord.id");
    expect(buildBuckets).toContain('rawId: args.usageSource === "GREEN_BUTTON" ? (args.rawId ?? null) : null');

    expect(sharedEstimate).toContain("getLatestUsableRawGreenButtonIdForHouse(homeId)");
    expect(sharedEstimate).toContain("where: { homeId, rawId: greenButtonRawId }");
    expect(sharedEstimate).toContain('rawId: intervalSource === "GREENBUTTON" ? greenButtonRawId : null');

    expect(detailRoute).toContain("getLatestUsableRawGreenButtonIdForHouse(houseId)");
    expect(detailRoute).not.toContain("rawGreenButton.findFirst");

    expect(dashboardRoute).toContain("selectedGreenButtonRawId = await getLatestUsableRawGreenButtonIdForHouse(house.id)");
    expect(dashboardRoute).toContain('usageSource: selectedUsageSource');
    expect(dashboardRoute).toContain('rawId: selectedUsageSource === "GREEN_BUTTON" ? selectedGreenButtonRawId : null');

    expect(compareRoute).toContain("gbRawId = await getLatestUsableRawGreenButtonIdForHouse(house.id)");
    expect(compareRoute).toContain('usageSource === "GREEN_BUTTON" ? windowEnd');
    expect(compareRoute).toContain('rawId: usageSource === "GREEN_BUTTON" ? gbRawId : null');

    expect(pipeline).toContain("gbRawId = await getLatestUsableRawGreenButtonIdForHouse(homeId)");
    expect(pipeline).toContain("where: { homeId, rawId: gbRawId }");
  });
});
