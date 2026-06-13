import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadCompactActualDatasetForCompareDiagnostics,
  resolveCompareDiagnosticsDateKeys,
} from "@/lib/usage/compareDiagnosticsActualIntervals";
import { buildOnePathIntervalDiagnosticsForPastResponse } from "@/modules/onePathSim/onePathIntervalCompareDiagnosticsV1";

const getActualIntervalsForRange = vi.fn();

vi.mock("@/lib/usage/actualDatasetForHouse", () => ({
  getActualIntervalsForRange: (...args: unknown[]) => getActualIntervalsForRange(...args),
}));

describe("compareDiagnosticsActualIntervals", () => {
  beforeEach(() => {
    getActualIntervalsForRange.mockReset();
  });

  it("prefers validation-flagged compare projection rows when present", () => {
    expect(
      resolveCompareDiagnosticsDateKeys({
        compareProjection: {
          rows: [{ localDate: "2025-07-02" }, { localDate: "2025-07-01", validationDay: true }],
        },
      })
    ).toEqual(["2025-07-01"]);
  });

  it("falls back to all compare projection dates when validation flags are absent", () => {
    expect(
      resolveCompareDiagnosticsDateKeys({
        compareProjection: {
          rows: [{ localDate: "2025-07-02" }, { localDate: "2025-07-01" }],
        },
      })
    ).toEqual(["2025-07-01", "2025-07-02"]);
  });

  it("loads only selected validation-day intervals into a compact diagnostics dataset", async () => {
    getActualIntervalsForRange.mockImplementation(async ({ startDate }: { startDate: string }) => [
      {
        timestamp: `${startDate}T12:00:00.000Z`,
        kwh: 1.25,
        homeDateKey: startDate,
        homeSlot: 48,
        homeSlotsExpected: 96,
      },
    ]);

    const compact = await loadCompactActualDatasetForCompareDiagnostics({
      userId: "user-1",
      actualContextHouseId: "house-1",
      esiid: "esiid-1",
      preferredActualSource: "SMT",
      compareProjection: {
        rows: [
          { localDate: "2025-07-01", errorKwh: 0.1 },
          { localDate: "2025-07-02", errorKwh: 0.2 },
        ],
      },
    });

    expect(getActualIntervalsForRange).toHaveBeenCalledTimes(2);
    expect(compact?.meta).toMatchObject({
      compareDiagnosticsCompactSlice: true,
      compactSliceDateKeys: ["2025-07-01", "2025-07-02"],
      source: "SMT",
    });
    expect((compact?.series as { intervals15: unknown[] })?.intervals15).toHaveLength(2);
    expect((compact?.series as { intervals15: unknown[] })?.intervals15).not.toHaveLength(35000);
  });

  it("populates interval diagnostics for INTERVAL readback using the compact actual slice", () => {
    const validationDates = ["2025-07-01", "2025-07-02"];
    const compareRows = validationDates.map((localDate) => ({
      localDate,
      errorKwh: 0,
      actualDayKwh: 10,
      simulatedDayKwh: 10,
    }));
    const slotTimestamp = (date: string, slot: number) => {
      const hour = Math.floor(slot / 4);
      const minute = (slot % 4) * 15;
      return `${date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00.000-06:00`;
    };
    const makeIntervalSeries = (date: string) =>
      Array.from({ length: 96 }, (_, slot) => ({
        timestamp: slotTimestamp(date, slot),
        kwh: 0.1,
      }));
    const compactActualDataset = {
      meta: { timezone: "America/Chicago", source: "SMT", compareDiagnosticsCompactSlice: true },
      daily: validationDates.map((date) => ({ date, kwh: 9.6 })),
      series: { intervals15: validationDates.flatMap((date) => makeIntervalSeries(date)) },
    };
    const simulatedDataset = {
      meta: { timezone: "America/Chicago" },
      daily: validationDates.map((date) => ({
        date,
        kwh: 9.6,
        sourceDetail: "ACTUAL_VALIDATION_TEST_DAY",
      })),
      series: { intervals15: validationDates.flatMap((date) => makeIntervalSeries(date)) },
    };

    const diagnostics = buildOnePathIntervalDiagnosticsForPastResponse({
      mode: "INTERVAL",
      preferredActualSource: "SMT",
      actualDataset: compactActualDataset,
      simulatedDataset,
      compareProjection: { rows: compareRows },
    });

    expect(diagnostics.available).toBe(true);
    expect(diagnostics.validationIntervalCurveDiagnostics.available).toBe(true);
    expect(diagnostics.validationIntervalCurveDiagnostics.selectedValidationDayCount).toBe(2);
    expect(diagnostics.validationIntervalCurveDiagnostics.actualIntervalRowsFound).toBeGreaterThan(0);
    expect(diagnostics.validationIntervalCurveDiagnostics.simulatedIntervalRowsFound).toBeGreaterThan(0);
    expect(diagnostics.validationIntervalCurveDiagnostics.days.length).toBeGreaterThan(0);
    expect(diagnostics.todBucketDiagnostics.available).toBe(true);
    expect(diagnostics.exactMatchDiagnostics.evaluatedDayCount).toBeGreaterThan(0);
    expect(diagnostics.intervalTruthInterpretation.runClassification).toBe("interval_truth_readback");
    expect(diagnostics.intervalTruthInterpretation.modelAccuracyTest).toBe(false);
    expect(diagnostics.intervalTruthInterpretation.intervalTruthPassthrough).toBe(true);
    expect(diagnostics.intervalTruthInterpretation.correctedTravelVacantReadback).toBe(true);
  });
});
