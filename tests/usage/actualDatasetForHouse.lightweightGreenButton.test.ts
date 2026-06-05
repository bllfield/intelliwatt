import { beforeEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.USAGE_DATABASE_URL = "postgres://example.test/db";
});

vi.mock("server-only", () => ({}));

const greenButtonAggregate = vi.fn();
const greenButtonFindFirst = vi.fn();
const usageQueryRaw = vi.fn();
const getLatestUsableRawGreenButtonIdForHouse = vi.fn();
const getLatestGreenButtonFullDayDateKey = vi.fn();
const buildUsageBucketsForEstimate = vi.fn();
const ensureHouseWeatherBackfill = vi.fn();
const getHouseWeatherDays = vi.fn();
const queryPersistedGreenButtonIntervalRows = vi.fn();

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

vi.mock("@/lib/usage/canonicalMetadataWindow", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/usage/canonicalMetadataWindow")>();
  return {
    ...actual,
    resolveCanonicalUsage365CoverageWindow: () => ({
      startDate: "2025-04-15",
      endDate: "2026-04-14",
    }),
  };
});

vi.mock("@/modules/weather/backfill", () => ({
  ensureHouseWeatherBackfill: (...args: any[]) => ensureHouseWeatherBackfill(...args),
}));

vi.mock("@/modules/weather/repo", () => ({
  getHouseWeatherDays: (...args: any[]) => getHouseWeatherDays(...args),
}));

vi.mock("@/lib/usage/loadPersistedGreenButtonIntervals", () => ({
  queryPersistedGreenButtonIntervalRows: (...args: any[]) =>
    queryPersistedGreenButtonIntervalRows(...args),
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
    ensureHouseWeatherBackfill.mockReset();
    getHouseWeatherDays.mockReset();
    queryPersistedGreenButtonIntervalRows.mockReset();
    getLatestUsableRawGreenButtonIdForHouse.mockResolvedValue("raw-1");
    getLatestGreenButtonFullDayDateKey.mockResolvedValue("2026-04-14");
    ensureHouseWeatherBackfill.mockResolvedValue({ fetched: 1, stubbed: 0 });
    getHouseWeatherDays.mockResolvedValue(
      new Map([
        [
          "2026-04-14",
          {
            tAvgF: 70,
            tMinF: 60,
            tMaxF: 80,
            hdd65: 0,
            cdd65: 5,
            source: "open-meteo",
          },
        ],
      ]),
    );
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
      .mockResolvedValueOnce([{ baseload: 0.65 }])
      .mockResolvedValueOnce([{ weekdaykwh: 70, weekendkwh: 30 }]);
    queryPersistedGreenButtonIntervalRows.mockResolvedValue([
      { timestamp: new Date("2026-04-14T18:00:00.000Z"), consumptionKwh: 1.55 },
      { timestamp: new Date("2026-04-14T18:15:00.000Z"), consumptionKwh: 1.65 },
    ]);
  });

  it("recomputes lightweight green button insight readouts with the anchored local window", async () => {
    const { getActualUsageDatasetForHouse } = await import("@/lib/usage/actualDatasetForHouse");

    const result = await getActualUsageDatasetForHouse("house-1", null, {
      preferredSource: "GREEN_BUTTON",
      skipFullYearIntervalFetch: true,
    });

    expect(result.skippedFullYearIntervalFetch).toBe(true);
    expect(buildUsageBucketsForEstimate).not.toHaveBeenCalled();
    expect(result.dataset?.insights?.timeOfDayBuckets).toEqual([
      { key: "overnight", label: "Overnight (12am–6am)", kwh: 0 },
      { key: "morning", label: "Morning (6am–12pm)", kwh: 0 },
      { key: "afternoon", label: "Afternoon (12pm–6pm)", kwh: 3.2 },
      { key: "evening", label: "Evening (6pm–12am)", kwh: 0 },
    ]);
    expect(result.dataset?.insights?.fifteenMinuteAverages).toEqual([
      { hhmm: "13:00", avgKw: 6.2 },
      { hhmm: "13:15", avgKw: 6.6 },
    ]);
    expect(result.dataset?.insights?.peakHour).toEqual({ hour: 13, kw: 6.6 });
    expect(ensureHouseWeatherBackfill).toHaveBeenCalledWith(
      expect.objectContaining({
        houseId: "house-1",
        startDate: "2025-04-15",
        endDate: "2026-04-14",
        allowOutsideCanonicalCoverage: true,
      }),
    );
    expect(result.dataset?.dailyWeather).toEqual({
      "2026-04-14": {
        tAvgF: 70,
        tMinF: 60,
        tMaxF: 80,
        hdd65: 0,
        cdd65: 5,
        source: "open-meteo",
      },
    });
    expect(result.dataset?.meta?.weatherSourceSummary).toBe("actual_only");
  });

  it("still loads the 15-minute load curve when lightweight insight recompute is skipped", async () => {
    const { getActualUsageDatasetForHouse } = await import("@/lib/usage/actualDatasetForHouse");

    const result = await getActualUsageDatasetForHouse("house-1", null, {
      preferredSource: "GREEN_BUTTON",
      skipFullYearIntervalFetch: true,
      skipLightweightInsightRecompute: true,
    });

    expect(result.dataset?.insights?.fifteenMinuteAverages).toEqual([
      { hhmm: "13:00", avgKw: 6.2 },
      { hhmm: "13:15", avgKw: 6.6 },
    ]);
  });
});
