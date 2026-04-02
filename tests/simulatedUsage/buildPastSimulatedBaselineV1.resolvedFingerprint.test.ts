import { describe, expect, it } from "vitest";
import { buildPastSimulatedBaselineV1 } from "@/modules/simulatedUsage/engine";
import { dateKeyFromTimestamp, getDayGridTimestamps } from "@/modules/usageSimulator/pastStitchedCurve";
import { RESOLVED_SIM_FINGERPRINT_VERSION } from "@/modules/usageSimulator/resolveSimFingerprint";
import type { ResolvedSimFingerprint } from "@/modules/usageSimulator/resolvedSimFingerprintTypes";

function baseResolved(overrides: Partial<ResolvedSimFingerprint> = {}): ResolvedSimFingerprint {
  return {
    resolverVersion: RESOLVED_SIM_FINGERPRINT_VERSION,
    resolvedHash: "h",
    blendMode: "blended",
    underlyingSourceMix: "blended",
    manualTotalsConstraint: "none",
    resolutionNotes: [],
    wholeHomeHouseId: "h1",
    usageFingerprintHouseId: "h1",
    wholeHomeFingerprintArtifactId: "wh",
    usageFingerprintArtifactId: "us",
    wholeHomeStatus: "ready",
    usageStatus: "ready",
    wholeHomeSourceHash: "a",
    usageSourceHash: "b",
    usageBlendWeight: 0.5,
    ...overrides,
  };
}

describe("buildPastSimulatedBaselineV1 resolvedSimFingerprint consumption", () => {
  it("whole_home_only skips usage-shape merge so day targets differ from usage-shape merge path", () => {
    const day1StartMs = new Date("2026-01-05T00:00:00.000Z").getTime();
    const day2StartMs = new Date("2026-01-06T00:00:00.000Z").getTime();
    const day1Grid = getDayGridTimestamps(day1StartMs);
    const day2Grid = getDayGridTimestamps(day2StartMs);
    const actualIntervals: Array<{ timestamp: string; kwh: number }> = [
      ...day1Grid.map((ts, idx) => ({ timestamp: ts, kwh: 0.3 + (idx % 20) * 0.01 })),
    ];
    const excludedDate = dateKeyFromTimestamp(day2Grid[0]!);
    const wx = { tAvgF: 45, tMinF: 35, tMaxF: 55, hdd65: 18, cdd65: 0 };
    const actualWxByDateKey = new Map<string, typeof wx>([
      [dateKeyFromTimestamp(day1Grid[0]!), wx],
      [excludedDate, wx],
    ]);
    const usageShapeProfile = {
      weekdayAvgByMonthKey: { "2026-01": 120 },
      weekendAvgByMonthKey: { "2026-01": 110 },
    };
    const common = {
      actualIntervals,
      canonicalDayStartsMs: [day1StartMs, day2StartMs],
      excludedDateKeys: new Set<string>([excludedDate]),
      dateKeyFromTimestamp,
      getDayGridTimestamps,
      collectSimulatedDayResults: true,
      actualWxByDateKey,
      usageShapeProfile,
      timezoneForProfile: "UTC",
    };

    const withMerge = buildPastSimulatedBaselineV1({
      ...common,
      resolvedSimFingerprint: baseResolved({ blendMode: "usage_only", usageBlendWeight: 1 }),
    });
    const wholeHomeOnly = buildPastSimulatedBaselineV1({
      ...common,
      resolvedSimFingerprint: baseResolved({ blendMode: "whole_home_only", usageBlendWeight: 0 }),
    });

    const mergedDay = withMerge.dayResults.find((r) => String(r.localDate).slice(0, 10) === excludedDate);
    const whDay = wholeHomeOnly.dayResults.find((r) => String(r.localDate).slice(0, 10) === excludedDate);
    expect(mergedDay?.targetDayKwhBeforeWeather).toBeDefined();
    expect(whDay?.targetDayKwhBeforeWeather).toBeDefined();
    expect(mergedDay!.targetDayKwhBeforeWeather).not.toBeCloseTo(whDay!.targetDayKwhBeforeWeather ?? 0, 1);
  });

  it("blended mode mixes reference and usage-shape profiles (differs from usage_only merge)", () => {
    const day1StartMs = new Date("2026-02-10T00:00:00.000Z").getTime();
    const day2StartMs = new Date("2026-02-11T00:00:00.000Z").getTime();
    const day1Grid = getDayGridTimestamps(day1StartMs);
    const day2Grid = getDayGridTimestamps(day2StartMs);
    const actualIntervals: Array<{ timestamp: string; kwh: number }> = [
      ...day1Grid.map((ts, idx) => ({ timestamp: ts, kwh: 0.25 + (idx % 15) * 0.012 })),
    ];
    const excludedDate = dateKeyFromTimestamp(day2Grid[0]!);
    const wx = { tAvgF: 48, tMinF: 38, tMaxF: 58, hdd65: 15, cdd65: 0 };
    const actualWxByDateKey = new Map<string, typeof wx>([
      [dateKeyFromTimestamp(day1Grid[0]!), wx],
      [excludedDate, wx],
    ]);
    const usageShapeProfile = {
      weekdayAvgByMonthKey: { "2026-02": 90 },
      weekendAvgByMonthKey: { "2026-02": 85 },
    };
    const common = {
      actualIntervals,
      canonicalDayStartsMs: [day1StartMs, day2StartMs],
      excludedDateKeys: new Set<string>([excludedDate]),
      dateKeyFromTimestamp,
      getDayGridTimestamps,
      collectSimulatedDayResults: true,
      actualWxByDateKey,
      usageShapeProfile,
      timezoneForProfile: "UTC",
    };

    const usageOnly = buildPastSimulatedBaselineV1({
      ...common,
      resolvedSimFingerprint: baseResolved({ blendMode: "usage_only", usageBlendWeight: 1 }),
    });
    const blended = buildPastSimulatedBaselineV1({
      ...common,
      resolvedSimFingerprint: baseResolved({ blendMode: "blended", usageBlendWeight: 0.5 }),
    });

    const u = usageOnly.dayResults.find((r) => String(r.localDate).slice(0, 10) === excludedDate);
    const b = blended.dayResults.find((r) => String(r.localDate).slice(0, 10) === excludedDate);
    expect(u?.targetDayKwhBeforeWeather).toBeDefined();
    expect(b?.targetDayKwhBeforeWeather).toBeDefined();
    expect(u!.targetDayKwhBeforeWeather).not.toBeCloseTo(b!.targetDayKwhBeforeWeather ?? 0, 0.5);
  });

  it("whole_home_only day totals follow homeProfile squareFeet (not meter reference averages)", () => {
    const day1StartMs = new Date("2026-04-07T00:00:00.000Z").getTime();
    const day2StartMs = new Date("2026-04-08T00:00:00.000Z").getTime();
    const day1Grid = getDayGridTimestamps(day1StartMs);
    const day2Grid = getDayGridTimestamps(day2StartMs);
    const actualIntervals: Array<{ timestamp: string; kwh: number }> = [
      ...day1Grid.map((ts, idx) => ({ timestamp: ts, kwh: 0.4 + (idx % 10) * 0.02 })),
    ];
    const excludedDate = dateKeyFromTimestamp(day2Grid[0]!);
    const wx = { tAvgF: 55, tMinF: 45, tMaxF: 65, hdd65: 10, cdd65: 0 };
    const actualWxByDateKey = new Map<string, typeof wx>([
      [dateKeyFromTimestamp(day1Grid[0]!), wx],
      [excludedDate, wx],
    ]);
    const usageShapeProfile = {
      weekdayAvgByMonthKey: { "2026-04": 95 },
      weekendAvgByMonthKey: { "2026-04": 90 },
    };
    const commonEngine = {
      actualIntervals,
      canonicalDayStartsMs: [day1StartMs, day2StartMs],
      excludedDateKeys: new Set<string>([excludedDate]),
      dateKeyFromTimestamp,
      getDayGridTimestamps,
      collectSimulatedDayResults: true,
      actualWxByDateKey,
      usageShapeProfile,
      timezoneForProfile: "UTC",
      resolvedSimFingerprint: baseResolved({ blendMode: "whole_home_only", usageBlendWeight: 0 }),
    };

    const smallHome = buildPastSimulatedBaselineV1({
      ...commonEngine,
      homeProfile: { squareFeet: 1200 },
    });
    const largeHome = buildPastSimulatedBaselineV1({
      ...commonEngine,
      homeProfile: { squareFeet: 9000 },
    });

    const s = smallHome.dayResults.find((r) => String(r.localDate).slice(0, 10) === excludedDate);
    const l = largeHome.dayResults.find((r) => String(r.localDate).slice(0, 10) === excludedDate);
    expect(s?.targetDayKwhBeforeWeather).toBeDefined();
    expect(l?.targetDayKwhBeforeWeather).toBeDefined();
    expect(l!.targetDayKwhBeforeWeather).toBeGreaterThan(s!.targetDayKwhBeforeWeather!);
  });

  it("whole_home_only does not use neighbor-day pool (fallbackLevel is never month_daytype_neighbor)", () => {
    const days: number[] = [];
    for (let d = 1; d <= 5; d++) {
      days.push(new Date(`2026-05-${String(d).padStart(2, "0")}T00:00:00.000Z`).getTime());
    }
    const grids = days.map((ms) => getDayGridTimestamps(ms));
    const actualIntervals: Array<{ timestamp: string; kwh: number }> = [];
    for (let i = 0; i < grids.length - 1; i++) {
      actualIntervals.push(...grids[i]!.map((ts, idx) => ({ timestamp: ts, kwh: 0.5 + (idx % 12) * 0.03 + i * 0.1 })));
    }
    const excludedDate = dateKeyFromTimestamp(grids[4]![0]!);
    const wx = { tAvgF: 58, tMinF: 48, tMaxF: 68, hdd65: 8, cdd65: 0 };
    const actualWxByDateKey = new Map<string, typeof wx>();
    for (let i = 0; i < 5; i++) {
      actualWxByDateKey.set(dateKeyFromTimestamp(grids[i]![0]!), wx);
    }
    const wholeHomeOnly = buildPastSimulatedBaselineV1({
      actualIntervals,
      canonicalDayStartsMs: days,
      excludedDateKeys: new Set<string>([excludedDate]),
      dateKeyFromTimestamp,
      getDayGridTimestamps,
      collectSimulatedDayResults: true,
      actualWxByDateKey,
      homeProfile: { squareFeet: 2200 },
      usageShapeProfile: { weekdayAvgByMonthKey: { "2026-05": 40 }, weekendAvgByMonthKey: { "2026-05": 38 } },
      resolvedSimFingerprint: baseResolved({ blendMode: "whole_home_only", usageBlendWeight: 0 }),
    });

    const whDay = wholeHomeOnly.dayResults.find((r) => String(r.localDate).slice(0, 10) === excludedDate);
    expect(whDay?.fallbackLevel).not.toBe("month_daytype_neighbor");
    expect(whDay?.fallbackLevel).toBe("month_daytype");
  });

  it("whole_home_only intraday shape is invariant to reference interval slot pattern (synthetic uniform)", () => {
    const day1StartMs = new Date("2026-07-01T00:00:00.000Z").getTime();
    const day2StartMs = new Date("2026-07-02T00:00:00.000Z").getTime();
    const day1Grid = getDayGridTimestamps(day1StartMs);
    const day2Grid = getDayGridTimestamps(day2StartMs);
    const mkIntervals = (scalePattern: (idx: number) => number) =>
      day1Grid.map((ts, idx) => ({ timestamp: ts, kwh: scalePattern(idx) }));
    const intervalsA = mkIntervals((idx) => 0.05 + (idx % 5) * 0.5);
    const intervalsB = mkIntervals((idx) => 2 + (idx % 17) * 0.02);
    const excludedDate = dateKeyFromTimestamp(day2Grid[0]!);
    const wx = { tAvgF: 70, tMinF: 62, tMaxF: 80, hdd65: 0, cdd65: 6 };
    const actualWxByDateKey = new Map<string, typeof wx>([
      [dateKeyFromTimestamp(day1Grid[0]!), wx],
      [excludedDate, wx],
    ]);
    const common = {
      canonicalDayStartsMs: [day1StartMs, day2StartMs],
      excludedDateKeys: new Set<string>([excludedDate]),
      dateKeyFromTimestamp,
      getDayGridTimestamps,
      collectSimulatedDayResults: true,
      actualWxByDateKey,
      homeProfile: { squareFeet: 2800 },
      resolvedSimFingerprint: baseResolved({ blendMode: "whole_home_only", usageBlendWeight: 0 }),
    };
    const outA = buildPastSimulatedBaselineV1({
      ...common,
      actualIntervals: intervalsA,
    });
    const outB = buildPastSimulatedBaselineV1({
      ...common,
      actualIntervals: intervalsB,
    });
    const a = outA.dayResults.find((r) => String(r.localDate).slice(0, 10) === excludedDate);
    const b = outB.dayResults.find((r) => String(r.localDate).slice(0, 10) === excludedDate);
    expect(a?.shape96Used).toEqual(b?.shape96Used);
    expect(a?.shapeVariantUsed).toBe(b?.shapeVariantUsed);
    expect(String(a?.shapeVariantUsed ?? "")).toMatch(/^month_/);
  });

  it("usage_only keeps reference-derived intraday shape (differs when reference interval shapes differ)", () => {
    const day1StartMs = new Date("2026-08-01T00:00:00.000Z").getTime();
    const day2StartMs = new Date("2026-08-02T00:00:00.000Z").getTime();
    const day1Grid = getDayGridTimestamps(day1StartMs);
    const day2Grid = getDayGridTimestamps(day2StartMs);
    const mkIntervals = (scalePattern: (idx: number) => number) =>
      day1Grid.map((ts, idx) => ({ timestamp: ts, kwh: scalePattern(idx) }));
    const intervalsA = mkIntervals((idx) => 0.05 + (idx % 5) * 0.5);
    const intervalsB = mkIntervals((idx) => 3 + (idx % 13) * 0.07);
    const excludedDate = dateKeyFromTimestamp(day2Grid[0]!);
    const wx = { tAvgF: 82, tMinF: 72, tMaxF: 92, hdd65: 0, cdd65: 10 };
    const actualWxByDateKey = new Map<string, typeof wx>([
      [dateKeyFromTimestamp(day1Grid[0]!), wx],
      [excludedDate, wx],
    ]);
    const common = {
      canonicalDayStartsMs: [day1StartMs, day2StartMs],
      excludedDateKeys: new Set<string>([excludedDate]),
      dateKeyFromTimestamp,
      getDayGridTimestamps,
      collectSimulatedDayResults: true,
      actualWxByDateKey,
      homeProfile: { squareFeet: 2800 },
      usageShapeProfile: { weekdayAvgByMonthKey: { "2026-08": 55 }, weekendAvgByMonthKey: { "2026-08": 50 } },
      resolvedSimFingerprint: baseResolved({ blendMode: "usage_only", usageBlendWeight: 1 }),
    };
    const outA = buildPastSimulatedBaselineV1({ ...common, actualIntervals: intervalsA });
    const outB = buildPastSimulatedBaselineV1({ ...common, actualIntervals: intervalsB });
    const a = outA.dayResults.find((r) => String(r.localDate).slice(0, 10) === excludedDate);
    const b = outB.dayResults.find((r) => String(r.localDate).slice(0, 10) === excludedDate);
    const l1 = (a?.shape96Used ?? []).reduce((s, v, i) => s + Math.abs(v - (b?.shape96Used?.[i] ?? 0)), 0);
    expect(l1).toBeGreaterThan(0.05);
  });

  it("keep-ref full-window runs simulatePastDay for every day (no ACTUAL passthrough dominance)", () => {
    const day1StartMs = new Date("2026-04-05T00:00:00.000Z").getTime();
    const day2StartMs = new Date("2026-04-06T00:00:00.000Z").getTime();
    const day1Grid = getDayGridTimestamps(day1StartMs);
    const day2Grid = getDayGridTimestamps(day2StartMs);
    const k1 = dateKeyFromTimestamp(day1Grid[0]!);
    const k2 = dateKeyFromTimestamp(day2Grid[0]!);
    const mkIntervals = (grid: string[]) => grid.map((ts, idx) => ({ timestamp: ts, kwh: 1.5 + (idx % 11) * 0.02 }));
    const actualIntervals = [...mkIntervals(day1Grid), ...mkIntervals(day2Grid)];

    const wx = { tAvgF: 55, tMinF: 45, tMaxF: 65, hdd65: 10, cdd65: 5 };
    const actualWxByDateKey = new Map<string, typeof wx>([
      [k1, wx],
      [k2, wx],
    ]);

    const dbg: {
      totalDays?: number;
      simulatedDays?: number;
      referenceDaysUsed?: number;
      dayDiagnostics?: Array<{ dayType?: string }>;
    } = {};
    buildPastSimulatedBaselineV1({
      actualIntervals,
      canonicalDayStartsMs: [day1StartMs, day2StartMs],
      excludedDateKeys: new Set<string>(),
      dateKeyFromTimestamp,
      getDayGridTimestamps,
      collectSimulatedDayResults: true,
      usageShapeProfile: {
        weekdayAvgByMonthKey: { "2026-04": 45 },
        weekendAvgByMonthKey: { "2026-04": 42 },
      },
      timezoneForProfile: "UTC",
      homeProfile: { squareFeet: 2200 },
      forceModeledOutputKeepReferencePoolDateKeys: new Set([k1, k2]),
      resolvedSimFingerprint: baseResolved({ blendMode: "usage_only", usageBlendWeight: 1 }),
      actualWxByDateKey,
      debug: { out: dbg as any, collectDayDiagnostics: true, maxDayDiagnostics: 10 },
    });

    expect(dbg.totalDays).toBe(2);
    expect(dbg.simulatedDays).toBe(2);
    expect(dbg.referenceDaysUsed).toBe(2);
    const actualPassthrough = (dbg.dayDiagnostics ?? []).filter((d) => d.dayType === "ACTUAL").length;
    expect(actualPassthrough).toBe(0);
    const keepRefReasons = (dbg.dayDiagnostics ?? []).map((d: any) => d.simulatedReason).filter(Boolean);
    expect(keepRefReasons.every((r: string) => r === "GAPFILL_MODELED_KEEP_REF")).toBe(true);
  });

  it("whole_home_only keep-ref runs skip the reference-day pool build", () => {
    const day1StartMs = new Date("2026-04-05T00:00:00.000Z").getTime();
    const day2StartMs = new Date("2026-04-06T00:00:00.000Z").getTime();
    const day1Grid = getDayGridTimestamps(day1StartMs);
    const day2Grid = getDayGridTimestamps(day2StartMs);
    const k1 = dateKeyFromTimestamp(day1Grid[0]!);
    const k2 = dateKeyFromTimestamp(day2Grid[0]!);
    const mkIntervals = (grid: string[]) => grid.map((ts, idx) => ({ timestamp: ts, kwh: 1.25 + (idx % 11) * 0.03 }));
    const actualIntervals = [...mkIntervals(day1Grid), ...mkIntervals(day2Grid)];

    const wx = { tAvgF: 55, tMinF: 45, tMaxF: 65, hdd65: 10, cdd65: 5 };
    const actualWxByDateKey = new Map<string, typeof wx>([
      [k1, wx],
      [k2, wx],
    ]);

    const dbg: {
      totalDays?: number;
      simulatedDays?: number;
      referenceDaysUsed?: number;
      dayDiagnostics?: Array<{ dayType?: string }>;
    } = {};
    buildPastSimulatedBaselineV1({
      actualIntervals,
      canonicalDayStartsMs: [day1StartMs, day2StartMs],
      excludedDateKeys: new Set<string>(),
      dateKeyFromTimestamp,
      getDayGridTimestamps,
      collectSimulatedDayResults: true,
      usageShapeProfile: {
        weekdayAvgByMonthKey: { "2026-04": 45 },
        weekendAvgByMonthKey: { "2026-04": 42 },
      },
      timezoneForProfile: "UTC",
      homeProfile: { squareFeet: 2200 },
      forceModeledOutputKeepReferencePoolDateKeys: new Set([k1, k2]),
      resolvedSimFingerprint: baseResolved({ blendMode: "whole_home_only", usageBlendWeight: 0 }),
      actualWxByDateKey,
      debug: { out: dbg as any, collectDayDiagnostics: true, maxDayDiagnostics: 10 },
    });

    expect(dbg.totalDays).toBe(2);
    expect(dbg.simulatedDays).toBe(2);
    expect(dbg.referenceDaysUsed).toBe(0);
    const actualPassthrough = (dbg.dayDiagnostics ?? []).filter((d) => d.dayType === "ACTUAL").length;
    expect(actualPassthrough).toBe(0);
  });

  it("constrained_monthly_totals with whole_home_only underlying mix reuses the whole-home-only engine path", () => {
    const day1StartMs = new Date("2026-04-05T00:00:00.000Z").getTime();
    const day2StartMs = new Date("2026-04-06T00:00:00.000Z").getTime();
    const day1Grid = getDayGridTimestamps(day1StartMs);
    const day2Grid = getDayGridTimestamps(day2StartMs);
    const excludedDate = dateKeyFromTimestamp(day2Grid[0]!);
    const actualIntervals = day1Grid.map((ts, idx) => ({ timestamp: ts, kwh: 1.25 + (idx % 11) * 0.03 }));

    const wx = { tAvgF: 55, tMinF: 45, tMaxF: 65, hdd65: 10, cdd65: 5 };
    const actualWxByDateKey = new Map<string, typeof wx>([
      [dateKeyFromTimestamp(day1Grid[0]!), wx],
      [excludedDate, wx],
    ]);

    const common = {
      actualIntervals,
      canonicalDayStartsMs: [day1StartMs, day2StartMs],
      excludedDateKeys: new Set<string>([excludedDate]),
      dateKeyFromTimestamp,
      getDayGridTimestamps,
      collectSimulatedDayResults: true,
      actualWxByDateKey,
      usageShapeProfile: {
        weekdayAvgByMonthKey: { "2026-04": 200 },
        weekendAvgByMonthKey: { "2026-04": 180 },
      },
      timezoneForProfile: "UTC",
      homeProfile: { squareFeet: 2200 },
    };

    const wholeHomeOnly = buildPastSimulatedBaselineV1({
      ...common,
      resolvedSimFingerprint: baseResolved({ blendMode: "whole_home_only", underlyingSourceMix: "whole_home_only", usageBlendWeight: 0 }),
    });
    const constrainedWholeHome = buildPastSimulatedBaselineV1({
      ...common,
      resolvedSimFingerprint: baseResolved({
        blendMode: "constrained_monthly_totals",
        underlyingSourceMix: "whole_home_only",
        manualTotalsConstraint: "monthly",
        usageBlendWeight: 0,
      }),
    });

    const whDay = wholeHomeOnly.dayResults.find((r) => String(r.localDate).slice(0, 10) === excludedDate);
    const constrainedDay = constrainedWholeHome.dayResults.find((r) => String(r.localDate).slice(0, 10) === excludedDate);
    expect(whDay?.targetDayKwhBeforeWeather).toBeDefined();
    expect(constrainedDay?.targetDayKwhBeforeWeather).toBeDefined();
    expect(constrainedDay!.targetDayKwhBeforeWeather).toBeCloseTo(whDay!.targetDayKwhBeforeWeather ?? 0, 6);
    expect(constrainedDay?.shape96Used).toEqual(whDay?.shape96Used);
  });

  it("travel/vacant excluded days remain modeled and labeled as SIMULATED/EXCLUDED", () => {
    const day1StartMs = new Date("2026-09-01T00:00:00.000Z").getTime();
    const day2StartMs = new Date("2026-09-02T00:00:00.000Z").getTime();
    const day1Grid = getDayGridTimestamps(day1StartMs);
    const day2Grid = getDayGridTimestamps(day2StartMs);
    const keptDate = dateKeyFromTimestamp(day1Grid[0]!);
    const excludedDate = dateKeyFromTimestamp(day2Grid[0]!);
    const actualIntervals = day1Grid.map((ts, idx) => ({ timestamp: ts, kwh: 1 + (idx % 7) * 0.03 }));
    const wx = { tAvgF: 76, tMinF: 70, tMaxF: 84, hdd65: 0, cdd65: 8 };
    const actualWxByDateKey = new Map<string, typeof wx>([
      [keptDate, wx],
      [excludedDate, wx],
    ]);
    const dbg: { dayDiagnostics?: Array<{ dateKey?: string; dayType?: string; simulatedReason?: string | null }> } = {};

    buildPastSimulatedBaselineV1({
      actualIntervals,
      canonicalDayStartsMs: [day1StartMs, day2StartMs],
      excludedDateKeys: new Set<string>([excludedDate]),
      dateKeyFromTimestamp,
      getDayGridTimestamps,
      collectSimulatedDayResults: true,
      actualWxByDateKey,
      usageShapeProfile: {
        weekdayAvgByMonthKey: { "2026-09": 48 },
        weekendAvgByMonthKey: { "2026-09": 44 },
      },
      timezoneForProfile: "UTC",
      homeProfile: { squareFeet: 2200 },
      resolvedSimFingerprint: baseResolved({ blendMode: "usage_only", usageBlendWeight: 1 }),
      debug: { out: dbg as any, collectDayDiagnostics: true, maxDayDiagnostics: 10 },
    });

    const excludedDiag = (dbg.dayDiagnostics ?? []).find((d) => d.dateKey === excludedDate);
    expect(excludedDiag).toMatchObject({
      dateKey: excludedDate,
      dayType: "SIMULATED",
      simulatedReason: "EXCLUDED",
    });
  });
});
