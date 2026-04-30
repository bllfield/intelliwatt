import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const smtFindFirst = vi.fn();
const smtFindMany = vi.fn();
const prismaQueryRaw = vi.fn();
const prismaExecuteRaw = vi.fn();
const greenButtonAggregate = vi.fn();
const greenButtonFindFirst = vi.fn();
const greenButtonFindMany = vi.fn();
const usageQueryRaw = vi.fn();
const getLatestUsableRawGreenButtonIdForHouse = vi.fn();
const getLatestGreenButtonFullDayDateKey = vi.fn();
const buildUsageBucketsForEstimate = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    smtInterval: {
      findFirst: (...args: any[]) => smtFindFirst(...args),
      findMany: (...args: any[]) => smtFindMany(...args),
    },
    $queryRaw: (...args: any[]) => prismaQueryRaw(...args),
    $executeRaw: (...args: any[]) => prismaExecuteRaw(...args),
  },
}));

vi.mock("@/lib/db/usageClient", () => ({
  usagePrisma: {
    greenButtonInterval: {
      findFirst: (...args: any[]) => greenButtonFindFirst(...args),
      findMany: (...args: any[]) => greenButtonFindMany(...args),
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
    startDate: "2024-12-02",
    endDate: "2025-12-01",
  }),
}));

describe("actualDatasetForHouse source selection", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("USAGE_DATABASE_URL", "postgres://example.test/db");
    smtFindFirst.mockReset();
    smtFindMany.mockReset();
    prismaQueryRaw.mockReset();
    prismaExecuteRaw.mockReset();
    greenButtonAggregate.mockReset();
    greenButtonFindFirst.mockReset();
    greenButtonFindMany.mockReset();
    usageQueryRaw.mockReset();
    getLatestUsableRawGreenButtonIdForHouse.mockReset();
    getLatestGreenButtonFullDayDateKey.mockReset();
    buildUsageBucketsForEstimate.mockReset();

    smtFindFirst.mockResolvedValue({ ts: new Date("2025-12-01T23:45:00.000Z") });
    smtFindMany.mockResolvedValue([{ meter: "m1" }]);
    prismaExecuteRaw.mockResolvedValue(0);
    prismaQueryRaw
      .mockResolvedValueOnce([
        {
          intervalscount: 2,
          importkwh: 10,
          exportkwh: 0,
          start: new Date("2024-12-02T06:00:00.000Z"),
          end: new Date("2025-12-01T23:45:00.000Z"),
        },
      ])
      .mockResolvedValueOnce([
        { ts: new Date("2025-12-01T23:30:00.000Z"), kwh: 4 },
        { ts: new Date("2025-12-01T23:45:00.000Z"), kwh: 6 },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ bucket: new Date("2024-12-02T06:00:00.000Z"), kwh: 10 }])
      .mockResolvedValueOnce([{ bucket: new Date("2024-12-01T06:00:00.000Z"), kwh: 10 }])
      .mockResolvedValueOnce([{ bucket: new Date("2025-01-01T00:00:00.000Z"), kwh: 10 }]);

    getLatestUsableRawGreenButtonIdForHouse.mockResolvedValue("raw-1");
    getLatestGreenButtonFullDayDateKey.mockResolvedValue("2025-12-01");
    greenButtonFindFirst.mockResolvedValue({ timestamp: new Date("2025-12-01T23:45:00.000Z") });
    greenButtonAggregate.mockResolvedValue({
      _count: { _all: 96 },
      _sum: { consumptionKwh: 100 },
      _min: { timestamp: new Date("2024-12-02T06:00:00.000Z") },
      _max: { timestamp: new Date("2025-12-01T23:45:00.000Z") },
    });
    greenButtonFindMany.mockResolvedValue([
      { timestamp: new Date("2025-12-01T23:30:00.000Z"), consumptionKwh: 1 },
      { timestamp: new Date("2025-12-01T23:45:00.000Z"), consumptionKwh: 2 },
    ]);
    usageQueryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ bucket: new Date("2024-12-02T06:00:00.000Z"), kwh: 100 }])
      .mockResolvedValueOnce([{ bucket: new Date("2024-12-01T06:00:00.000Z"), kwh: 100 }])
      .mockResolvedValueOnce([{ bucket: new Date("2025-01-01T00:00:00.000Z"), kwh: 100 }]);

    buildUsageBucketsForEstimate.mockResolvedValue(null);
  });

  it("defaults to SMT dataset when both SMT and Green Button are available", async () => {
    const { getActualUsageDatasetForHouse } = await import("@/lib/usage/actualDatasetForHouse");

    const result = await getActualUsageDatasetForHouse("house-1", "esiid-1", {
      skipFullYearIntervalFetch: true,
    });

    expect(result.dataset?.summary.source).toBe("SMT");
    expect(result.dataset?.summary.totalKwh).toBe(10);
  });
});
