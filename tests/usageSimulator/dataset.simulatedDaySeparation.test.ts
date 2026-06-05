import { describe, expect, it } from "vitest";
import { convertGreenButtonPersistedRowsToHome } from "@/lib/time/greenButtonPersistedIntervalConvert";
import { homeProjectedIntervalFromRecord } from "@/lib/time/actualIntervalCalendar";
import { buildSimulatedUsageDatasetFromCurve } from "@/modules/usageSimulator/dataset";
import type { SimulatedCurve } from "@/modules/simulatedUsage/types";

function makeUtcDayIntervals(dayIso: string, kwhPerInterval: number) {
  const out: Array<{ timestamp: string; consumption_kwh: number; interval_minutes: 15 }> = [];
  const start = new Date(`${dayIso}T00:00:00.000Z`);
  for (let i = 0; i < 96; i++) {
    out.push({
      timestamp: new Date(start.getTime() + i * 15 * 60 * 1000).toISOString(),
      consumption_kwh: kwhPerInterval,
      interval_minutes: 15 as const,
    });
  }
  return out;
}

describe("dataset simulated day separation", () => {
  it("keeps travel/vacant simulation distinct from test-day modeled simulation", () => {
    const intervals = [
      ...makeUtcDayIntervals("2025-08-10", 0.1),
      ...makeUtcDayIntervals("2025-08-11", 0.1),
      ...makeUtcDayIntervals("2025-08-12", 0.1),
    ];
    const curve: SimulatedCurve = {
      start: "2025-08-10",
      end: "2025-08-12",
      intervals,
      monthlyTotals: [],
      annualTotalKwh: 0,
      meta: { excludedDays: 0, renormalized: false },
    };

    const dataset = buildSimulatedUsageDatasetFromCurve(
      curve,
      {
        baseKind: "SMT_ACTUAL_BASELINE",
        mode: "SMT_BASELINE",
        canonicalEndMonth: "2025-08",
      },
      {
        simulatedDayResults: [
          { localDate: "2025-08-11", displayDayKwh: 9.9, simulatedReasonCode: "TRAVEL_VACANT" } as any,
          { localDate: "2025-08-12", displayDayKwh: 8.8, simulatedReasonCode: "TEST_MODELED_KEEP_REF" } as any,
        ],
      }
    );

    const byDate = new Map(dataset.daily.map((row) => [row.date, row]));
    expect(byDate.get("2025-08-10")).toMatchObject({ source: "ACTUAL", sourceDetail: "ACTUAL" });
    expect(byDate.get("2025-08-11")).toMatchObject({
      source: "SIMULATED",
      sourceDetail: "SIMULATED_TRAVEL_VACANT",
    });
    expect(byDate.get("2025-08-12")).toMatchObject({
      source: "SIMULATED",
      sourceDetail: "SIMULATED_TEST_DAY",
    });
    expect(dataset.meta.simulatedTravelVacantDateKeysLocal).toEqual(["2025-08-11"]);
    expect(dataset.meta.simulatedTestModeledDateKeysLocal).toEqual(["2025-08-12"]);
    const travelSet = new Set(dataset.meta.simulatedTravelVacantDateKeysLocal ?? []);
    for (const dk of dataset.meta.simulatedTestModeledDateKeysLocal ?? []) {
      expect(travelSet.has(dk)).toBe(false);
    }
  });

  it("maps FORCED_SELECTED_DAY producer results to SIMULATED_TEST_DAY (TEST category, not OTHER)", () => {
    const intervals = [...makeUtcDayIntervals("2025-09-01", 0.1), ...makeUtcDayIntervals("2025-09-02", 0.1)];
    const curve: SimulatedCurve = {
      start: "2025-09-01",
      end: "2025-09-02",
      intervals,
      monthlyTotals: [],
      annualTotalKwh: 0,
      meta: { excludedDays: 0, renormalized: false },
    };
    const dataset = buildSimulatedUsageDatasetFromCurve(
      curve,
      { baseKind: "SMT_ACTUAL_BASELINE", mode: "SMT_BASELINE", canonicalEndMonth: "2025-09" },
      {
        simulatedDayResults: [
          { localDate: "2025-09-02", displayDayKwh: 7.7, simulatedReasonCode: "FORCED_SELECTED_DAY" } as any,
        ],
      }
    );
    const byDate = new Map(dataset.daily.map((row) => [row.date, row]));
    expect(byDate.get("2025-09-02")).toMatchObject({
      source: "SIMULATED",
      sourceDetail: "SIMULATED_TEST_DAY",
    });
    expect(dataset.meta.simulatedTestModeledDateKeysLocal).toEqual(["2025-09-02"]);
    expect(dataset.meta.simulatedTravelVacantDateKeysLocal).toEqual([]);
  });

  it("maps incomplete, missing, and leading missing days to explicit subtypes (not TEST or TRAVEL/VACANT)", () => {
    const intervals = [
      ...makeUtcDayIntervals("2025-10-01", 0.1),
      ...makeUtcDayIntervals("2025-10-02", 0.1),
      ...makeUtcDayIntervals("2025-10-03", 0.1),
      ...makeUtcDayIntervals("2025-10-04", 0.1),
    ];
    const curve: SimulatedCurve = {
      start: "2025-10-01",
      end: "2025-10-04",
      intervals,
      monthlyTotals: [],
      annualTotalKwh: 0,
      meta: { excludedDays: 0, renormalized: false },
    };
    const dataset = buildSimulatedUsageDatasetFromCurve(
      curve,
      { baseKind: "SMT_ACTUAL_BASELINE", mode: "SMT_BASELINE", canonicalEndMonth: "2025-10" },
      {
        simulatedDayResults: [
          { localDate: "2025-10-02", displayDayKwh: 1, simulatedReasonCode: "INCOMPLETE_METER_DAY" } as any,
          { localDate: "2025-10-03", displayDayKwh: 2, simulatedReasonCode: "LEADING_MISSING_DAY" } as any,
          { localDate: "2025-10-04", displayDayKwh: 3, simulatedReasonCode: "DAILY_USAGE_MISSING_DAY" } as any,
        ],
      }
    );
    const byDate = new Map(dataset.daily.map((row) => [row.date, row]));
    expect(byDate.get("2025-10-02")?.sourceDetail).toBe("SIMULATED_INCOMPLETE_METER");
    expect(byDate.get("2025-10-03")?.sourceDetail).toBe("SIMULATED_LEADING_MISSING");
    expect(byDate.get("2025-10-04")?.sourceDetail).toBe("SIMULATED_DAILY_USAGE_MISSING");
    expect(dataset.meta.simulatedTestModeledDateKeysLocal).toEqual([]);
    expect(dataset.meta.simulatedTravelVacantDateKeysLocal).toEqual([]);
  });

  it("maps MANUAL_CONSTRAINED_DAY without leaking into travel or incomplete-meter ownership", () => {
    const intervals = [...makeUtcDayIntervals("2025-11-01", 0.1)];
    const curve: SimulatedCurve = {
      start: "2025-11-01",
      end: "2025-11-01",
      intervals,
      monthlyTotals: [],
      annualTotalKwh: 0,
      meta: { excludedDays: 0, renormalized: false },
    };
    const dataset = buildSimulatedUsageDatasetFromCurve(
      curve,
      { baseKind: "MANUAL", mode: "MANUAL_TOTALS", canonicalEndMonth: "2025-11" },
      {
        simulatedDayResults: [
          { localDate: "2025-11-01", displayDayKwh: 9.6, simulatedReasonCode: "MANUAL_CONSTRAINED_DAY" } as any,
        ],
      }
    );
    expect(dataset.daily[0]).toMatchObject({
      source: "SIMULATED",
      sourceDetail: "SIMULATED_MANUAL_CONSTRAINED",
    });
    expect(dataset.meta.simulatedTravelVacantDateKeysLocal).toEqual([]);
    expect(dataset.meta.simulatedTestModeledDateKeysLocal).toEqual(["2025-11-01"]);
    expect(dataset.meta.simulatedSourceDetailByDate?.["2025-11-01"]).toBe("SIMULATED_MANUAL_CONSTRAINED");
  });

  it("keeps TRAVEL_VACANT simulated on GB trusted home days", () => {
    const intervals = [
      ...makeUtcDayIntervals("2025-06-27", 0.8),
      ...makeUtcDayIntervals("2025-06-28", 0.1),
    ];
    const curve: SimulatedCurve = {
      start: "2025-06-27",
      end: "2025-06-28",
      intervals,
      monthlyTotals: [],
      annualTotalKwh: 0,
      meta: { excludedDays: 0, renormalized: false },
    };
    const dataset = buildSimulatedUsageDatasetFromCurve(
      curve,
      {
        baseKind: "SMT_ACTUAL_BASELINE",
        mode: "SMT_BASELINE",
        canonicalEndMonth: "2025-06",
      },
      {
        greenButtonTrustedHomeDateKeys: new Set(["2025-06-27", "2025-06-28"]),
        simulatedDayResults: [
          { localDate: "2025-06-27", displayDayKwh: 52.4, simulatedReasonCode: "TRAVEL_VACANT" } as any,
          { localDate: "2025-06-28", displayDayKwh: 48.1, simulatedReasonCode: "TRAVEL_VACANT" } as any,
        ],
      }
    );
    const byDate = new Map(dataset.daily.map((row) => [row.date, row]));
    expect(byDate.get("2025-06-27")).toMatchObject({
      source: "SIMULATED",
      sourceDetail: "SIMULATED_TRAVEL_VACANT",
      kwh: 52.4,
    });
    expect(byDate.get("2025-06-28")).toMatchObject({
      source: "SIMULATED",
      sourceDetail: "SIMULATED_TRAVEL_VACANT",
      kwh: 48.1,
    });
    expect(dataset.meta.simulatedTravelVacantDateKeysLocal).toEqual(["2025-06-27", "2025-06-28"]);
  });

  it("labels simulated days using homeDateKey when UTC timestamp day differs from engine localDate", () => {
    const utcGrid = Array.from({ length: 96 }, (_, slot) => ({
      timestamp: new Date(new Date("2026-05-14T00:00:00.000Z").getTime() + slot * 15 * 60 * 1000),
      consumptionKwh: 0.25,
    }));
    const projected = convertGreenButtonPersistedRowsToHome(utcGrid, "America/Chicago").intervals.map(
      homeProjectedIntervalFromRecord
    );
    const intervals = projected.map((row) => ({
      timestamp: row.timestamp,
      consumption_kwh: row.kwh,
      interval_minutes: 15 as const,
      homeDateKey: row.homeDateKey,
    }));
    const homeDate = String(projected[0]?.homeDateKey ?? "");
    expect(homeDate.length).toBeGreaterThan(0);
    expect(homeDate).not.toBe("2026-05-14");

    const curve: SimulatedCurve = {
      start: homeDate,
      end: homeDate,
      intervals,
      monthlyTotals: [],
      annualTotalKwh: 0,
      meta: { excludedDays: 0, renormalized: false },
    };
    const dataset = buildSimulatedUsageDatasetFromCurve(
      curve,
      { baseKind: "SMT_ACTUAL_BASELINE", mode: "SMT_BASELINE", canonicalEndMonth: "2026-05" },
      {
        simulatedDayResults: [
          { localDate: homeDate, displayDayKwh: 12.5, simulatedReasonCode: "TRAVEL_VACANT" } as any,
        ],
      }
    );
    const simulatedRow = dataset.daily.find((row) => row.date === homeDate);
    expect(simulatedRow).toMatchObject({
      date: homeDate,
      source: "SIMULATED",
      sourceDetail: "SIMULATED_TRAVEL_VACANT",
    });
  });

  it("reuses the stitched interval payload instead of cloning a second 15-minute object array", () => {
    const intervals = [...makeUtcDayIntervals("2025-12-01", 0.1)];
    const curve: SimulatedCurve = {
      start: "2025-12-01",
      end: "2025-12-01",
      intervals,
      monthlyTotals: [],
      annualTotalKwh: 0,
      meta: { excludedDays: 0, renormalized: false },
    };
    const dataset = buildSimulatedUsageDatasetFromCurve(
      curve,
      { baseKind: "MANUAL", mode: "MANUAL_TOTALS", canonicalEndMonth: "2025-12" },
      {}
    );
    expect(dataset.series.intervals15).toBe(curve.intervals as any);
    expect((dataset.series.intervals15?.[0] as any)?.kwh).toBe(intervals[0]!.consumption_kwh);
  });
});
