import { beforeEach, describe, expect, it, vi } from "vitest";
import { prevCalendarDayDateKey } from "@/lib/time/chicago";

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
    smtAuthorization: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    houseAddress: {
      findFirst: vi.fn().mockResolvedValue({ esiid: "esiid-1" }),
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

vi.mock("@/lib/usage/smtCanonicalAvailability", () => ({
  hasSmtIntervalsInCanonicalWindow: vi.fn().mockResolvedValue(true),
}));

vi.mock("@/lib/time/loadHouseTimezone", () => ({
  loadHomeTimezoneForHouseId: vi.fn().mockResolvedValue("America/Chicago"),
}));

vi.mock("@/modules/usageSimulator/labTestHome", () => ({
  getOnePathLabTestHomeLink: vi.fn().mockResolvedValue({ testHomeHouseId: "test-home-1" }),
}));

vi.mock("@/lib/usage/canonicalMetadataWindow", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/usage/canonicalMetadataWindow")>();
  return {
    ...actual,
    resolveCanonicalUsage365CoverageWindow: () => ({
      startDate: "2024-12-02",
      endDate: "2025-12-01",
    }),
    buildUtcRangeForChicagoLocalDateRange: () => ({
      startInclusive: new Date("2024-12-02T06:00:00.000Z"),
      endInclusive: new Date("2025-12-02T05:59:59.999Z"),
    }),
  };
});

vi.mock("@/lib/usage/greenButtonHouseCleanup", () => ({
  clearGreenButtonSupersededBySmtForHouse: vi.fn().mockResolvedValue(false),
  clearGreenButtonUsageForHouse: vi.fn().mockResolvedValue(undefined),
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
    const smtAggRow = [
      {
        intervalscount: 2,
        importkwh: 10,
        exportkwh: 0,
        start: new Date("2024-12-02T06:00:00.000Z"),
        end: new Date("2025-12-01T23:45:00.000Z"),
      },
    ];
    prismaQueryRaw.mockImplementation(async (query: unknown) => {
      const sql = String((query as { strings?: string[] })?.strings?.join?.("") ?? query ?? "");
      if (sql.includes("SmtInterval") && sql.includes("COUNT(*)")) {
        return smtAggRow;
      }
      if (sql.includes('SELECT DISTINCT ON ("ts")')) {
        return [
          { ts: new Date("2025-12-01T23:30:00.000Z"), kwh: 4 },
          { ts: new Date("2025-12-01T23:45:00.000Z"), kwh: 6 },
        ];
      }
      if (sql.includes("date_trunc('hour'")) {
        return [{ bucket: new Date("2024-12-02T06:00:00.000Z"), kwh: 10 }];
      }
      if (sql.includes("to_char") && sql.includes("YYYY-MM-DD")) {
        return [{ date: "2025-12-01", kwh: 10 }];
      }
      if (sql.includes("date_trunc('month'")) {
        return [{ bucket: new Date("2025-01-01T00:00:00.000Z"), kwh: 10 }];
      }
      if (sql.includes("date_trunc('year'")) {
        return [{ bucket: new Date("2025-01-01T00:00:00.000Z"), kwh: 10 }];
      }
      return [];
    });

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

  it("falls back to Green Button when SMT is preferred but canonical intervals are missing", async () => {
    prismaQueryRaw.mockImplementation(async (query: unknown) => {
      const sql = String((query as { strings?: string[] })?.strings?.join?.("") ?? query ?? "");
      if (sql.includes("SmtInterval") && sql.includes("COUNT(*)")) {
        return [
          {
            intervalscount: 0,
            importkwh: 0,
            exportkwh: 0,
            start: null,
            end: null,
          },
        ];
      }
      return [];
    });

    const { getActualUsageDatasetForHouse } = await import("@/lib/usage/actualDatasetForHouse");
    const result = await getActualUsageDatasetForHouse("house-1", "esiid-1", {
      preferredSource: "SMT",
      skipFullYearIntervalFetch: true,
      userUsageDashboardLoad: true,
    });

    expect(result.dataset?.summary.source).toBe("GREEN_BUTTON");
    expect(Number(result.dataset?.summary.totalKwh ?? 0)).toBeGreaterThan(0);
  });

  it("anchors GREEN_BUTTON baseline display to the uploaded file window, not the SMT canonical lag window", async () => {
    const anchorEnd = "2026-05-14";
    const anchorStart = prevCalendarDayDateKey(anchorEnd, 365 - 1);
    getLatestGreenButtonFullDayDateKey.mockResolvedValue(anchorEnd);
    greenButtonFindFirst.mockResolvedValue({ timestamp: new Date(`${anchorEnd}T12:00:00.000Z`) });
    greenButtonAggregate.mockResolvedValue({
      _count: { _all: 96 },
      _sum: { consumptionKwh: 14082 },
      _min: { timestamp: new Date(`${anchorStart}T06:00:00.000Z`) },
      _max: { timestamp: new Date(`${anchorEnd}T23:45:00.000Z`) },
    });

    const { getActualUsageDatasetForHouse } = await import("@/lib/usage/actualDatasetForHouse");
    const result = await getActualUsageDatasetForHouse("house-1", "esiid-1", {
      preferredSource: "GREEN_BUTTON",
      skipFullYearIntervalFetch: true,
    });

    expect(result.dataset?.summary.source).toBe("GREEN_BUTTON");
    expect(result.dataset?.summary.start).toBe(anchorStart);
    expect(result.dataset?.summary.end).toBe(anchorEnd);
    expect(result.dataset?.meta?.coverageStart).toBe(anchorStart);
    expect(result.dataset?.meta?.coverageEnd).toBe(anchorEnd);
    expect(result.dataset?.summary.start).not.toBe("2024-12-02");
    expect(result.dataset?.summary.end).not.toBe("2025-12-01");
    expect(result.dataset?.daily?.some((row) => row.date === anchorEnd)).toBe(true);
    expect(result.dataset?.daily?.some((row) => row.date === "2026-05-19")).toBe(false);
  });

  it("uses canonicalCoverageWindowUtcBounds for production dataset and interval range scans", async () => {
    const canonicalModule = await import("@/lib/usage/canonicalMetadataWindow");
    const boundsSpy = vi.spyOn(canonicalModule, "canonicalCoverageWindowUtcBounds");

    const { getActualUsageDatasetForHouse, getActualIntervalsForRange } = await import(
      "@/lib/usage/actualDatasetForHouse"
    );

    await getActualIntervalsForRange({
      houseId: "house-1",
      esiid: "esiid-1",
      startDate: "2025-12-01",
      endDate: "2025-12-01",
      preferredSource: "SMT",
    });

    await getActualUsageDatasetForHouse("house-1", "esiid-1", { preferredSource: "SMT" });

    expect(boundsSpy).toHaveBeenCalledWith(
      expect.objectContaining({ startDate: "2024-12-02", endDate: "2025-12-01" })
    );
    const tailBounds = canonicalModule.canonicalCoverageWindowUtcBounds({
      startDate: "2025-12-01",
      endDate: "2025-12-01",
    });
    expect(tailBounds.rangeEndInclusive.toISOString()).toBe("2025-12-02T05:59:59.999Z");
    expect(tailBounds.rangeEndInclusive.toISOString()).not.toBe(
      new Date("2025-12-01T23:59:59.999Z").toISOString()
    );

    boundsSpy.mockRestore();
  });
});
