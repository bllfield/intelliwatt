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

  it("returns null when no complete local day exists in the recent upload tail", async () => {
    usageQueryRaw
      .mockResolvedValueOnce([{ id: "raw-1", latestTimestamp: new Date("2025-12-01T23:00:00.000Z") }])
      .mockResolvedValueOnce([
        { bucket: new Date("2025-12-02T05:00:00.000Z"), intervalscount: 51 },
        { bucket: new Date("2025-12-01T05:00:00.000Z"), intervalscount: 53 },
      ]);

    const mod = await import("@/modules/realUsageAdapter/greenButton");
    const out = await mod.getLatestGreenButtonFullDayDateKey({ houseId: "house-1" });

    expect(out).toBeNull();
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
    expect(String(out.displayWindowNote ?? "")).toContain("matching source-day weather");
    expect(out.sourceDateByTargetDate?.["2026-01-15"]).toBe("2025-01-15");
    expect(out.sourceCoverageStart).toBe("2024-12-02");
    expect(out.sourceCoverageEnd).toBe("2025-12-01");
  });

  it("keeps complete Green Button UTC-grid days actual for Past Sim", async () => {
    const utcGridDayIntervals = Array.from({ length: 96 }, (_, slot) => ({
      ts: new Date(new Date("2025-09-01T00:00:00.000Z").getTime() + slot * 15 * 60 * 1000),
      kwh: 0.5,
    }));
    usageQueryRaw
      .mockResolvedValueOnce([{ id: "raw-1", latestTimestamp: new Date("2025-09-02T04:45:00.000Z") }])
      .mockResolvedValueOnce([{ id: "raw-1", latestTimestamp: new Date("2025-09-02T04:45:00.000Z") }])
      .mockResolvedValueOnce([{ bucket: new Date("2025-09-01T05:00:00.000Z"), intervalscount: 96 }])
      .mockResolvedValueOnce(utcGridDayIntervals);

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

  it("repairs duplicate Green Button UTC-grid timestamps into adjacent missing Past Sim slots", async () => {
    const utcGridDayStartMs = new Date("2026-05-13T00:00:00.000Z").getTime();
    const utcGridDayIntervals = [
      { ts: new Date(utcGridDayStartMs), kwh: 0.1 },
      { ts: new Date(utcGridDayStartMs), kwh: 0.2 },
      ...Array.from({ length: 94 }, (_, index) => ({
        ts: new Date(utcGridDayStartMs + (index + 2) * 15 * 60 * 1000),
        kwh: 0.5,
      })),
    ];
    usageQueryRaw
      .mockResolvedValueOnce([{ id: "raw-1", latestTimestamp: new Date("2026-05-13T23:45:00.000Z") }])
      .mockResolvedValueOnce([{ id: "raw-1", latestTimestamp: new Date("2026-05-13T23:45:00.000Z") }])
      .mockResolvedValueOnce([{ bucket: new Date("2026-05-13T05:00:00.000Z"), intervalscount: 96 }])
      .mockResolvedValueOnce(utcGridDayIntervals);

    const mod = await import("@/modules/realUsageAdapter/greenButton");
    const out = await mod.fetchGreenButtonIntervalsForCoverageWindow({
      houseId: "house-1",
      coverageStartDate: "2026-05-13",
      coverageEndDate: "2026-05-13",
      timestampMode: "utcDayGrid",
    });

    expect(out.intervals).toHaveLength(96);
    expect(out.repairedDuplicateIntervalCount).toBe(1);
    expect(out.repairedDuplicateDateCount).toBe(1);
    expect(out.paddedIntervalCount).toBe(0);
    expect(out.intervals[0]).toEqual({ timestamp: "2026-05-13T00:00:00.000Z", kwh: 0.1 });
    expect(out.intervals[1]).toEqual({ timestamp: "2026-05-13T00:15:00.000Z", kwh: 0.2 });
  });

  it("preserves original UTC-grid slots when shifting Green Button days across DST boundaries", async () => {
    const sourceUtcGridDayIntervals = Array.from({ length: 96 }, (_, slot) => ({
      ts: new Date(new Date("2025-03-08T00:00:00.000Z").getTime() + slot * 15 * 60 * 1000),
      kwh: 0.25,
    }));
    usageQueryRaw
      .mockResolvedValueOnce([{ id: "raw-1", latestTimestamp: new Date("2025-03-09T05:45:00.000Z") }])
      .mockResolvedValueOnce([{ id: "raw-1", latestTimestamp: new Date("2025-03-09T05:45:00.000Z") }])
      .mockResolvedValueOnce([{ bucket: new Date("2025-03-08T06:00:00.000Z"), intervalscount: 96 }])
      .mockResolvedValueOnce(sourceUtcGridDayIntervals);

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
    expect(out.sourceDateByTargetDate?.["2026-03-08"]).toBe("2025-03-08");
  });

  it("prefers shifted complete Green Button UTC-grid days over trailing partial current-year days", async () => {
    const shiftedSourceDayIntervals = Array.from({ length: 96 }, (_, slot) => ({
      ts: new Date(new Date("2025-05-14T00:00:00.000Z").getTime() + slot * 15 * 60 * 1000),
      kwh: 0.25,
    }));
    const trailingPartialCurrentYearDay = [{ ts: new Date("2026-05-14T00:00:00.000Z"), kwh: 10 }];
    usageQueryRaw
      .mockResolvedValueOnce([{ id: "raw-1", latestTimestamp: new Date("2026-05-14T00:00:00.000Z") }])
      .mockResolvedValueOnce([{ id: "raw-1", latestTimestamp: new Date("2026-05-14T00:00:00.000Z") }])
      .mockResolvedValueOnce([
        { bucket: new Date("2026-05-14T05:00:00.000Z"), intervalscount: 1 },
        { bucket: new Date("2026-05-13T05:00:00.000Z"), intervalscount: 96 },
      ])
      .mockResolvedValueOnce([...shiftedSourceDayIntervals, ...trailingPartialCurrentYearDay]);

    const mod = await import("@/modules/realUsageAdapter/greenButton");
    const out = await mod.fetchGreenButtonIntervalsForCoverageWindow({
      houseId: "house-1",
      coverageStartDate: "2025-05-17",
      coverageEndDate: "2026-05-16",
      timestampMode: "utcDayGrid",
    });

    const targetDayRows = out.intervals.filter((row) => row.timestamp.startsWith("2026-05-14T"));
    expect(targetDayRows).toHaveLength(96);
    expect(targetDayRows[0]).toEqual({ timestamp: "2026-05-14T00:00:00.000Z", kwh: 0.25 });
    expect(out.shiftedIntervalCount).toBe(96);
    expect(out.shiftedDateCount).toBe(1);
    expect(out.sourceDateByTargetDate?.["2026-05-14"]).toBe("2025-05-14");
  });

  it("pads trusted shifted Green Button UTC-grid days and keeps current-year partials from downgrading them", async () => {
    const shiftedSourceDayIntervals = Array.from({ length: 96 }, (_, slot) => ({
      ts: new Date(new Date("2025-05-14T00:00:00.000Z").getTime() + slot * 15 * 60 * 1000),
      kwh: 0.25,
    }));
    const trailingPartialCurrentYearDay = [{ ts: new Date("2026-05-14T23:45:00.000Z"), kwh: 10 }];
    usageQueryRaw
      .mockResolvedValueOnce([{ id: "raw-1", latestTimestamp: new Date("2026-05-20T23:45:00.000Z") }])
      .mockResolvedValueOnce([{ id: "raw-1", latestTimestamp: new Date("2026-05-20T23:45:00.000Z") }])
      .mockResolvedValueOnce([{ bucket: new Date("2026-05-20T05:00:00.000Z"), intervalscount: 96 }])
      .mockResolvedValueOnce([...shiftedSourceDayIntervals, ...trailingPartialCurrentYearDay]);

    const mod = await import("@/modules/realUsageAdapter/greenButton");
    const out = await mod.fetchGreenButtonIntervalsForCoverageWindow({
      houseId: "house-1",
      coverageStartDate: "2025-05-17",
      coverageEndDate: "2026-05-16",
      timestampMode: "utcDayGrid",
    });

    const targetDayRows = out.intervals.filter((row) => row.timestamp.startsWith("2026-05-14T"));
    expect(targetDayRows).toHaveLength(96);
    expect(targetDayRows[94]).toEqual({ timestamp: "2026-05-14T23:30:00.000Z", kwh: 0.25 });
    expect(targetDayRows[95]).toEqual({ timestamp: "2026-05-14T23:45:00.000Z", kwh: 0.25 });
    expect(out.shiftedIntervalCount).toBe(96);
    expect(out.shiftedDateCount).toBe(1);
    expect(out.paddedIntervalCount).toBe(0);
    expect(out.paddedDateCount).toBe(0);
    expect(out.sourceDateByTargetDate?.["2026-05-14"]).toBe("2025-05-14");
    expect(String(out.displayWindowNote ?? "")).toContain("matching source-day weather");
  });

  it("regresses v8 live failure: trusted shifted 2026-05-14 stays actual-backed through engine", async () => {
    const shiftedSourceDayIntervals = Array.from({ length: 96 }, (_, slot) => ({
      ts: new Date(new Date("2025-05-14T00:00:00.000Z").getTime() + slot * 15 * 60 * 1000),
      kwh: slot === 0 ? 1.706 : 0.25,
    }));
    const trailingPartialCurrentYearDay: Array<{ ts: Date; kwh: number }> = [];
    usageQueryRaw
      .mockResolvedValueOnce([{ id: "raw-1", latestTimestamp: new Date("2026-05-13T04:45:00.000Z") }])
      .mockResolvedValueOnce([{ id: "raw-1", latestTimestamp: new Date("2026-05-13T04:45:00.000Z") }])
      .mockResolvedValueOnce([{ bucket: new Date("2026-05-12T05:00:00.000Z"), intervalscount: 96 }])
      .mockResolvedValueOnce([...shiftedSourceDayIntervals, ...trailingPartialCurrentYearDay]);

    const greenButton = await import("@/modules/realUsageAdapter/greenButton");
    const adapterOut = await greenButton.fetchGreenButtonIntervalsForCoverageWindow({
      houseId: "house-1",
      coverageStartDate: "2025-05-15",
      coverageEndDate: "2026-05-14",
      timestampMode: "utcDayGrid",
    });
    const engine = await import("@/modules/onePathSim/simulatedUsage/engine");
    const stitchedCurve = await import("@/modules/onePathSim/usageSimulator/pastStitchedCurve");
    const dayStartMs = new Date("2026-05-14T00:00:00.000Z").getTime();
    const trustedActualDateKeys = new Set(adapterOut.trustedActualDateKeys ?? []);
    const homeTimezone = "America/Chicago";
    const engineArgs = {
      canonicalDayStartsMs: [dayStartMs],
      excludedDateKeys: new Set<string>(),
      dateKeyFromTimestamp: (ts: string) => stitchedCurve.dateKeyFromTimestamp(ts, homeTimezone),
      getDayGridTimestamps: (ms: number) => stitchedCurve.getDayGridTimestamps(ms, homeTimezone),
      collectSimulatedDayResults: true,
    };

    const targetDayRows = adapterOut.intervals.filter((row) => row.timestamp.startsWith("2026-05-14T"));
    expect(targetDayRows).toHaveLength(96);
    expect(targetDayRows[0]).toEqual({ timestamp: "2026-05-14T00:00:00.000Z", kwh: 1.706 });
    expect(targetDayRows[1]).toEqual({ timestamp: "2026-05-14T00:15:00.000Z", kwh: 0.25 });
    expect(adapterOut.paddedIntervalCount).toBe(0);
    expect(adapterOut.paddedDateCount).toBe(0);
    expect(adapterOut.sourceDateByTargetDate?.["2026-05-14"]).toBe("2025-05-14");
    expect(trustedActualDateKeys.has("2026-05-14")).toBe(true);

    const trustedDebugOut: Record<string, unknown> = {};
    const trustedOut = engine.buildPastSimulatedBaselineV1({
      ...engineArgs,
      actualIntervals: adapterOut.intervals,
      trustedActualDateKeys,
      debug: { out: trustedDebugOut as any },
    });
    expect(trustedOut.dayResults.find((row) => row.localDate === "2026-05-14")?.simulatedReasonCode).not.toBe(
      "INCOMPLETE_METER_DAY"
    );
    expect(trustedDebugOut.excludedIncompleteMeterFingerprintDayCount).toBe(0);

    // Mirrors the live v8 artifact: padded target day exists, but engine only sees fewer than 96 SMT slots.
    const thinnedIntervals = adapterOut.intervals.filter((row) => {
      if (!row.timestamp.startsWith("2026-05-14T")) return true;
      const slotIndex = Math.round(
        (new Date(row.timestamp).getTime() - dayStartMs) / (15 * 60 * 1000)
      );
      return slotIndex < 76;
    });
    expect(
      thinnedIntervals.filter((row) => row.timestamp.startsWith("2026-05-14T")).length
    ).toBe(76);

    const untrustedDebugOut: Record<string, unknown> = {};
    const untrustedOut = engine.buildPastSimulatedBaselineV1({
      ...engineArgs,
      actualIntervals: thinnedIntervals,
      debug: { out: untrustedDebugOut as any },
    });
    expect(untrustedOut.dayResults.find((row) => row.localDate === "2026-05-14")?.simulatedReasonCode).toBe(
      "INCOMPLETE_METER_DAY"
    );
    expect(untrustedDebugOut.excludedIncompleteMeterFingerprintDayCount).toBe(1);

    const thinnedTrustedDebugOut: Record<string, unknown> = {};
    const thinnedTrustedOut = engine.buildPastSimulatedBaselineV1({
      ...engineArgs,
      actualIntervals: thinnedIntervals,
      trustedActualDateKeys,
      debug: { out: thinnedTrustedDebugOut as any },
    });
    expect(
      thinnedTrustedOut.dayResults.find((row) => row.localDate === "2026-05-14")?.simulatedReasonCode
    ).not.toBe("INCOMPLETE_METER_DAY");
    expect(thinnedTrustedDebugOut.excludedIncompleteMeterFingerprintDayCount).toBe(0);
  });

  it("prefers a trusted current-year UTC-grid day over a shifted prior-year day for the same target date", async () => {
    const shiftedSourceDayIntervals = Array.from({ length: 96 }, (_, slot) => ({
      ts: new Date(new Date("2025-05-14T00:00:00.000Z").getTime() + slot * 15 * 60 * 1000),
      kwh: 0.25,
    }));
    const trustedCurrentYearDayIntervals = Array.from({ length: 96 }, (_, slot) => ({
      ts: new Date(new Date("2026-05-14T00:00:00.000Z").getTime() + slot * 15 * 60 * 1000),
      kwh: 0.75,
    }));
    usageQueryRaw
      .mockResolvedValueOnce([{ id: "raw-1", latestTimestamp: new Date("2026-05-20T23:45:00.000Z") }])
      .mockResolvedValueOnce([{ id: "raw-1", latestTimestamp: new Date("2026-05-20T23:45:00.000Z") }])
      .mockResolvedValueOnce([{ bucket: new Date("2026-05-20T05:00:00.000Z"), intervalscount: 96 }])
      .mockResolvedValueOnce([...shiftedSourceDayIntervals, ...trustedCurrentYearDayIntervals]);

    const mod = await import("@/modules/realUsageAdapter/greenButton");
    const out = await mod.fetchGreenButtonIntervalsForCoverageWindow({
      houseId: "house-1",
      coverageStartDate: "2025-05-17",
      coverageEndDate: "2026-05-16",
      timestampMode: "utcDayGrid",
    });

    const targetDayRows = out.intervals.filter((row) => row.timestamp.startsWith("2026-05-14T"));
    expect(targetDayRows).toHaveLength(96);
    expect(targetDayRows.every((row) => row.kwh === 0.75)).toBe(true);
    expect(out.sourceDateByTargetDate?.["2026-05-14"]).toBe("2026-05-14");
    expect(out.paddedDateCount).toBe(0);
  });

  it("marks padded trusted shifted Green Button days in trustedActualDateKeys", async () => {
    const shiftedSourceDayIntervals = Array.from({ length: 96 }, (_, slot) => ({
      ts: new Date(new Date("2025-05-14T00:00:00.000Z").getTime() + slot * 15 * 60 * 1000),
      kwh: slot < 95 ? 0.25 : 0,
    }));
    usageQueryRaw
      .mockResolvedValueOnce([{ id: "raw-1", latestTimestamp: new Date("2026-05-20T23:45:00.000Z") }])
      .mockResolvedValueOnce([{ id: "raw-1", latestTimestamp: new Date("2026-05-20T23:45:00.000Z") }])
      .mockResolvedValueOnce([{ bucket: new Date("2026-05-20T05:00:00.000Z"), intervalscount: 96 }])
      .mockResolvedValueOnce(shiftedSourceDayIntervals);

    const mod = await import("@/modules/realUsageAdapter/greenButton");
    const out = await mod.fetchGreenButtonIntervalsForCoverageWindow({
      houseId: "house-1",
      coverageStartDate: "2025-05-17",
      coverageEndDate: "2026-05-16",
      timestampMode: "utcDayGrid",
    });

    const targetDayRows = out.intervals.filter((row) => row.timestamp.startsWith("2026-05-14T"));
    expect(targetDayRows).toHaveLength(96);
    expect(targetDayRows[95]).toEqual({ timestamp: "2026-05-14T23:45:00.000Z", kwh: 0 });
    expect(out.trustedActualDateKeys).toContain("2026-05-14");
    expect(out.paddedIntervalCount).toBe(0);
    expect(out.sourceDateByTargetDate?.["2026-05-14"]).toBe("2025-05-14");
  });

  it("pads complete DST-short Green Button days onto the Past Sim 96-slot grid", async () => {
    const dstShortUtcGridDayIntervals = Array.from({ length: 92 }, (_, slot) => ({
      ts: new Date(new Date("2025-03-09T00:00:00.000Z").getTime() + slot * 15 * 60 * 1000),
      kwh: 0.25,
    }));
    usageQueryRaw
      .mockResolvedValueOnce([{ id: "raw-1", latestTimestamp: new Date("2025-03-10T04:45:00.000Z") }])
      .mockResolvedValueOnce([{ id: "raw-1", latestTimestamp: new Date("2025-03-10T04:45:00.000Z") }])
      .mockResolvedValueOnce([{ bucket: new Date("2025-03-09T06:00:00.000Z"), intervalscount: 92 }])
      .mockResolvedValueOnce(dstShortUtcGridDayIntervals);

    const mod = await import("@/modules/realUsageAdapter/greenButton");
    const out = await mod.fetchGreenButtonIntervalsForCoverageWindow({
      houseId: "house-1",
      coverageStartDate: "2026-03-09",
      coverageEndDate: "2026-03-09",
      timestampMode: "utcDayGrid",
    });

    expect(out.intervals).toHaveLength(96);
    expect(out.paddedIntervalCount).toBe(4);
    expect(out.paddedDateCount).toBe(1);
    expect(out.intervals.slice(92, 96)).toEqual([
      { timestamp: "2026-03-09T23:00:00.000Z", kwh: 0 },
      { timestamp: "2026-03-09T23:15:00.000Z", kwh: 0 },
      { timestamp: "2026-03-09T23:30:00.000Z", kwh: 0 },
      { timestamp: "2026-03-09T23:45:00.000Z", kwh: 0 },
    ]);
  });
});
