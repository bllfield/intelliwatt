import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const greenButtonAggregate = vi.fn();
const greenButtonFindFirst = vi.fn();
const usageQueryRaw = vi.fn();
const getLatestUsableRawGreenButtonIdForHouse = vi.fn();
const getLatestGreenButtonFullDayDateKey = vi.fn();
const buildUsageBucketsForEstimate = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {},
}));

vi.mock("@/lib/db/usageClient", () => ({
  usagePrisma: {
    greenButtonInterval: {
      findFirst: (...args: any[]) => greenButtonFindFirst(...args),
      aggregate: (...args: any[]) => greenButtonAggregate(...args),
    },
    $queryRaw: (...args: any[]) => usageQueryRaw(...args),
  },
}));

vi.mock("@/lib/usage/buildUsageBucketsForEstimate", () => ({
  buildUsageBucketsForEstimate: (...args: any[]) => buildUsageBucketsForEstimate(...args),
}));

vi.mock("@/modules/realUsageAdapter/greenButton", () => ({
  getLatestUsableRawGreenButtonIdForHouse: (...args: any[]) => getLatestUsableRawGreenButtonIdForHouse(...args),
  getLatestGreenButtonFullDayDateKey: (...args: any[]) => getLatestGreenButtonFullDayDateKey(...args),
}));

vi.mock("@/modules/usageSimulator/metadataWindow", () => ({
  resolveCanonicalUsage365CoverageWindow: () => ({
    startDate: "2025-04-15",
    endDate: "2026-04-14",
  }),
}));

describe("actualDatasetForHouse lightweight green button", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("USAGE_DATABASE_URL", "postgres://example.test/db");
    greenButtonAggregate.mockReset();
    greenButtonFindFirst.mockReset();
    usageQueryRaw.mockReset();
    getLatestUsableRawGreenButtonIdForHouse.mockReset();
    getLatestGreenButtonFullDayDateKey.mockReset();
    buildUsageBucketsForEstimate.mockReset();
    getLatestUsableRawGreenButtonIdForHouse.mockResolvedValue("raw-1");
    getLatestGreenButtonFullDayDateKey.mockResolvedValue("2026-04-14");
    greenButtonFindFirst.mockResolvedValue({ timestamp: new Date("2026-04-15T04:45:00.000Z") });
    greenButtonAggregate.mockResolvedValue({
      _count: { _all: 96 },
      _sum: { consumptionKwh: 100 },
      _min: { timestamp: new Date("2026-04-14T05:00:00.000Z") },
      _max: { timestamp: new Date("2026-04-15T04:45:00.000Z") },
    });
    usageQueryRaw
      .mockResolvedValueOnce([{ bucket: new Date("2026-04-14T05:00:00.000Z"), kwh: 100 }])
      .mockResolvedValueOnce([{ bucket: new Date("2026-04-01T05:00:00.000Z"), kwh: 100 }])
      .mockResolvedValueOnce([
        { key: "overnight", label: "Overnight (12am–6am)", sort: 1, kwh: 25 },
        { key: "morning", label: "Morning (6am–12pm)", sort: 2, kwh: 25 },
        { key: "afternoon", label: "Afternoon (12pm–6pm)", sort: 3, kwh: 25 },
        { key: "evening", label: "Evening (6pm–12am)", sort: 4, kwh: 25 },
      ]);
  });

  it("preserves lightweight green button time-of-day buckets without full insight recompute", async () => {
    const { getActualUsageDatasetForHouse } = await import("@/lib/usage/actualDatasetForHouse");

    const result = await getActualUsageDatasetForHouse("house-1", null, {
      preferredSource: "GREEN_BUTTON",
      skipFullYearIntervalFetch: true,
    });

    expect(result.skippedFullYearIntervalFetch).toBe(true);
    expect(buildUsageBucketsForEstimate).not.toHaveBeenCalled();
    expect(result.dataset?.insights?.timeOfDayBuckets).toEqual([
      { key: "overnight", label: "Overnight (12am–6am)", kwh: 25 },
      { key: "morning", label: "Morning (6am–12pm)", kwh: 25 },
      { key: "afternoon", label: "Afternoon (12pm–6pm)", kwh: 25 },
      { key: "evening", label: "Evening (6pm–12am)", kwh: 25 },
    ]);
  });
});
