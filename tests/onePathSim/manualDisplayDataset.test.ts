import { describe, expect, it } from "vitest";

import { remapManualDisplayDatasetToCanonicalWindow } from "@/modules/onePathSim/manualDisplayDataset";

function addDays(dateKey: string, days: number): string {
  const dt = new Date(`${dateKey}T00:00:00.000Z`);
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function enumerateDateKeysInclusive(startDate: string, endDate: string): string[] {
  const out: string[] = [];
  for (let current = startDate; current <= endDate; current = addDays(current, 1)) out.push(current);
  return out;
}

describe("manual display dataset remap", () => {
  it("re-dates the manual sim window onto the customer display window without changing totals", () => {
    const dataset = {
      summary: {
        start: "2025-03-17",
        end: "2025-03-19",
        totalKwh: 18,
      },
      meta: {
        weatherNote: "Weather integrated in shared past path (actual_only).",
      },
      totals: {
        importKwh: 18,
        exportKwh: 0,
        netKwh: 18,
      },
      monthly: [{ month: "2025-03", kwh: 18 }],
      daily: [
        { date: "2025-03-17", kwh: 5, source: "SIMULATED" },
        { date: "2025-03-18", kwh: 6, source: "SIMULATED" },
        { date: "2025-03-19", kwh: 7, source: "SIMULATED" },
      ],
      dailyWeather: {
        "2025-03-17": { tAvgF: 50, tMinF: 40, tMaxF: 60, hdd65: 15, cdd65: 0, source: "OPEN_METEO_CACHE" },
        "2025-03-18": { tAvgF: 51, tMinF: 41, tMaxF: 61, hdd65: 14, cdd65: 0, source: "OPEN_METEO_CACHE" },
        "2025-03-19": { tAvgF: 52, tMinF: 42, tMaxF: 62, hdd65: 13, cdd65: 0, source: "OPEN_METEO_CACHE" },
      },
      series: {
        intervals15: [
          { timestamp: "2025-03-17T00:00:00.000Z", kwh: 1.25 },
          { timestamp: "2025-03-17T00:15:00.000Z", kwh: 3.75 },
          { timestamp: "2025-03-18T00:00:00.000Z", kwh: 6 },
          { timestamp: "2025-03-19T00:00:00.000Z", kwh: 7 },
        ],
      },
    };

    const out = remapManualDisplayDatasetToCanonicalWindow({
      dataset,
      usageInputMode: "MANUAL_MONTHLY",
      displayWindowEndDate: "2026-04-20",
    });

    expect(out.summary.start).toBe("2026-04-18");
    expect(out.summary.end).toBe("2026-04-20");
    expect(out.daily.map((row: any) => row.date)).toEqual(["2026-04-18", "2026-04-19", "2026-04-20"]);
    expect(Object.keys(out.dailyWeather)).toEqual(["2026-04-18", "2026-04-19", "2026-04-20"]);
    expect(out.series.intervals15.map((row: any) => row.timestamp.slice(0, 10))).toEqual([
      "2026-04-18",
      "2026-04-18",
      "2026-04-19",
      "2026-04-20",
    ]);
    expect(out.monthly).toHaveLength(12);
    expect(out.monthly[out.monthly.length - 1]).toEqual({ month: "2026-04", kwh: 18 });
    expect(out.totals).toEqual({
      importKwh: 18,
      exportKwh: 0,
      netKwh: 18,
    });
    expect(out.insights.stitchedMonth).toBeNull();
    expect(String(out.meta.manualDisplayWindowNote ?? "")).toContain("post-anchor");
    expect(String(out.meta.weatherNote ?? "")).toContain("standard customer view");
  });

  it("drops intervals outside the mapped display window from display totals", () => {
    const dataset = {
      summary: {
        start: "2025-03-17",
        end: "2025-03-19",
        totalKwh: 19,
      },
      totals: {
        importKwh: 19,
        exportKwh: 0,
        netKwh: 19,
      },
      daily: [
        { date: "2025-03-16", kwh: 1, source: "SIMULATED" },
        { date: "2025-03-17", kwh: 5, source: "SIMULATED" },
        { date: "2025-03-18", kwh: 6, source: "SIMULATED" },
        { date: "2025-03-19", kwh: 7, source: "SIMULATED" },
      ],
      series: {
        intervals15: [
          { timestamp: "2025-03-16T00:00:00.000Z", kwh: 1 },
          { timestamp: "2025-03-17T00:00:00.000Z", kwh: 5 },
          { timestamp: "2025-03-18T00:00:00.000Z", kwh: 6 },
          { timestamp: "2025-03-19T00:00:00.000Z", kwh: 7 },
        ],
      },
    };

    const out = remapManualDisplayDatasetToCanonicalWindow({
      dataset,
      usageInputMode: "MANUAL_MONTHLY",
      displayWindowEndDate: "2026-04-20",
    });

    expect(out.summary.totalKwh).toBe(18);
    expect(out.totals).toEqual({
      importKwh: 18,
      exportKwh: 0,
      netKwh: 18,
    });
    expect(out.daily.map((row: any) => row.date)).toEqual(["2026-04-18", "2026-04-19", "2026-04-20"]);
    expect(out.series.intervals15).toHaveLength(3);
  });

  it("carries only the dropped leading display days into the trailing month total", () => {
    const dates = enumerateDateKeysInclusive("2025-03-17", "2026-03-15");
    const dataset = {
      summary: {
        start: "2025-03-17",
        end: "2026-03-15",
        totalKwh: dates.length,
      },
      totals: {
        importKwh: dates.length,
        exportKwh: 0,
        netKwh: dates.length,
      },
      daily: dates.map((date) => ({ date, kwh: 1, source: "SIMULATED" })),
      series: {
        intervals15: dates.map((date) => ({ timestamp: `${date}T00:00:00.000Z`, kwh: 1 })),
      },
    };

    const out = remapManualDisplayDatasetToCanonicalWindow({
      dataset,
      usageInputMode: "MANUAL_MONTHLY",
      displayWindowEndDate: "2026-04-21",
    });

    const monthlySum = out.monthly.reduce((sum: number, row: { kwh: number }) => sum + row.kwh, 0);
    expect(monthlySum).toBe(dates.length);
    expect(out.monthly[out.monthly.length - 1]).toEqual({ month: "2026-04", kwh: 29 });
    expect(out.insights.stitchedMonth).toBeNull();
  });
});
