import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const rawGreenButtonFindFirst = vi.fn();
const usageQueryRaw = vi.fn();

vi.mock("@/lib/db/usageClient", () => ({
  usagePrisma: {
    rawGreenButton: {
      findFirst: (...args: any[]) => rawGreenButtonFindFirst(...args),
    },
    $queryRaw: (...args: any[]) => usageQueryRaw(...args),
  },
}));

describe("green button full-day anchor", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv("USAGE_DATABASE_URL", "postgres://example.test/db");
    rawGreenButtonFindFirst.mockReset();
    usageQueryRaw.mockReset();
    rawGreenButtonFindFirst.mockResolvedValue({ id: "raw-1" });
  });

  it("uses the latest complete Chicago day instead of an incomplete latest upload day", async () => {
    usageQueryRaw
      .mockResolvedValueOnce([{ id: "raw-1", latestTimestamp: new Date("2026-04-21T05:00:00.000Z") }])
      .mockResolvedValueOnce([
        { bucket: new Date("2026-04-21T05:00:00.000Z"), intervalscount: 40 },
        { bucket: new Date("2026-04-20T05:00:00.000Z"), intervalscount: 96 },
      ]);

    const mod = await import("@/modules/realUsageAdapter/greenButton");
    const out = await mod.getLatestGreenButtonFullDayDateKey({ houseId: "house-1" });

    expect(out).toBe("2026-04-20");
  });

  it("accepts DST-short days when the interval count matches the expected local-day coverage", async () => {
    usageQueryRaw
      .mockResolvedValueOnce([{ id: "raw-1", latestTimestamp: new Date("2026-03-08T06:00:00.000Z") }])
      .mockResolvedValueOnce([{ bucket: new Date("2026-03-08T06:00:00.000Z"), intervalscount: 92 }]);

    const mod = await import("@/modules/realUsageAdapter/greenButton");
    const out = await mod.getLatestGreenButtonFullDayDateKey({ houseId: "house-1" });

    expect(out).toBe("2026-03-08");
  });

  it("falls back to the latest local interval day when no full day exists", async () => {
    usageQueryRaw
      .mockResolvedValueOnce([{ id: "raw-1", latestTimestamp: new Date("2025-12-01T23:00:00.000Z") }])
      .mockResolvedValueOnce([
        { bucket: new Date("2025-12-02T05:00:00.000Z"), intervalscount: 51 },
        { bucket: new Date("2025-12-01T05:00:00.000Z"), intervalscount: 53 },
      ]);

    const mod = await import("@/modules/realUsageAdapter/greenButton");
    const out = await mod.getLatestGreenButtonFullDayDateKey({ houseId: "house-1" });

    expect(out).toBe("2025-12-01");
  });

  it("rebases older Green Button intervals into the active coverage window", async () => {
    usageQueryRaw
      .mockResolvedValueOnce([{ id: "raw-1", latestTimestamp: new Date("2025-12-01T23:00:00.000Z") }])
      .mockResolvedValueOnce([{ id: "raw-1", latestTimestamp: new Date("2025-12-01T23:00:00.000Z") }])
      .mockResolvedValueOnce([{ bucket: new Date("2025-12-01T06:00:00.000Z"), intervalscount: 96 }])
      .mockResolvedValueOnce([
        { ts: new Date("2025-01-15T12:00:00.000Z"), kwh: 1.25 },
        { ts: new Date("2025-09-01T12:00:00.000Z"), kwh: 2.5 },
      ]);

    const mod = await import("@/modules/realUsageAdapter/greenButton");
    const out = await mod.fetchGreenButtonIntervalsForCoverageWindow({
      houseId: "house-1",
      coverageStartDate: "2025-05-03",
      coverageEndDate: "2026-05-02",
    });

    expect(out.intervals.map((row) => row.timestamp.slice(0, 10))).toEqual(["2025-09-01", "2026-01-15"]);
    expect(out.shiftedIntervalCount).toBe(1);
    expect(out.shiftedDateCount).toBe(1);
    expect(String(out.displayWindowNote ?? "")).toContain("shifted into the current coverage window");
    expect(out.sourceCoverageStart).toBe("2024-12-02");
    expect(out.sourceCoverageEnd).toBe("2025-12-01");
  });

  it("can normalize Green Button local-day intervals onto the Past Sim UTC day grid", async () => {
    const localDayIntervals = Array.from({ length: 96 }, (_, slot) => ({
      ts: new Date(new Date("2025-09-01T05:00:00.000Z").getTime() + slot * 15 * 60 * 1000),
      kwh: 0.5,
    }));
    usageQueryRaw
      .mockResolvedValueOnce([{ id: "raw-1", latestTimestamp: new Date("2025-09-02T04:45:00.000Z") }])
      .mockResolvedValueOnce([{ id: "raw-1", latestTimestamp: new Date("2025-09-02T04:45:00.000Z") }])
      .mockResolvedValueOnce([{ bucket: new Date("2025-09-01T05:00:00.000Z"), intervalscount: 96 }])
      .mockResolvedValueOnce(localDayIntervals);

    const mod = await import("@/modules/realUsageAdapter/greenButton");
    const out = await mod.fetchGreenButtonIntervalsForCoverageWindow({
      houseId: "house-1",
      coverageStartDate: "2025-09-01",
      coverageEndDate: "2025-09-01",
      timestampMode: "utcDayGrid",
    });

    expect(out.intervals).toHaveLength(96);
    expect(out.intervals[0]).toEqual({ timestamp: "2025-09-01T00:00:00.000Z", kwh: 0.5 });
    expect(out.intervals[95]).toEqual({ timestamp: "2025-09-01T23:45:00.000Z", kwh: 0.5 });
  });

  it("preserves original local slots when shifting Green Button days across DST boundaries", async () => {
    const sourceLocalDayIntervals = Array.from({ length: 96 }, (_, slot) => ({
      ts: new Date(new Date("2025-03-08T06:00:00.000Z").getTime() + slot * 15 * 60 * 1000),
      kwh: 0.25,
    }));
    usageQueryRaw
      .mockResolvedValueOnce([{ id: "raw-1", latestTimestamp: new Date("2025-03-09T05:45:00.000Z") }])
      .mockResolvedValueOnce([{ id: "raw-1", latestTimestamp: new Date("2025-03-09T05:45:00.000Z") }])
      .mockResolvedValueOnce([{ bucket: new Date("2025-03-08T06:00:00.000Z"), intervalscount: 96 }])
      .mockResolvedValueOnce(sourceLocalDayIntervals);

    const mod = await import("@/modules/realUsageAdapter/greenButton");
    const out = await mod.fetchGreenButtonIntervalsForCoverageWindow({
      houseId: "house-1",
      coverageStartDate: "2026-03-08",
      coverageEndDate: "2026-03-08",
      timestampMode: "utcDayGrid",
    });

    expect(out.intervals).toHaveLength(96);
    expect(out.intervals[0]).toEqual({ timestamp: "2026-03-08T00:00:00.000Z", kwh: 0.25 });
    expect(out.intervals[95]).toEqual({ timestamp: "2026-03-08T23:45:00.000Z", kwh: 0.25 });
    expect(out.shiftedIntervalCount).toBe(96);
    expect(out.shiftedDateCount).toBe(1);
  });
});
