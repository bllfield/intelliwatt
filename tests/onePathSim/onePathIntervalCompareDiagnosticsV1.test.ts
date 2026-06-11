import { describe, expect, it } from "vitest";
import {
  buildOnePathIntervalCompareDiagnosticsV1,
  buildOnePathIntervalDiagnosticsEnvelope,
  buildOnePathIntervalDiagnosticsForPastResponse,
  buildUnavailableOnePathIntervalDiagnosticsV1,
  extractValidationDayKeysFromCompareProjection,
  isOnePathIntervalDiagnosticsInputType,
} from "@/modules/onePathSim/onePathIntervalCompareDiagnosticsV1";

function makeDailyDataset(dates: Array<{ date: string; actual: number; simulated: number }>) {
  return {
    meta: { timezone: "America/Chicago" },
    daily: dates.map(({ date, actual, simulated }) => ({ date, kwh: actual })),
    dailyWeather: Object.fromEntries(
      dates.map(({ date }) => [date, { meanTempF: 88, tMaxF: 95, tMinF: 80, hdd: 0, cdd: 10, source: "fixture" }])
    ),
    series: { intervals15: [] as Array<{ timestamp: string; kwh: number }> },
    _simulatedDaily: dates.map(({ date, simulated }) => ({ date, kwh: simulated })),
  };
}

function withSimulatedDaily(actualDataset: Record<string, unknown>, simulatedDaily: Array<{ date: string; kwh: number }>) {
  return {
    meta: actualDataset.meta,
    daily: simulatedDaily,
    dailyWeather: actualDataset.dailyWeather,
    series: actualDataset.series,
    metaValidation: actualDataset.metaValidation,
  };
}

function slotTimestamp(date: string, slot: number): string {
  const hour = Math.floor(slot / 4);
  const minute = (slot % 4) * 15;
  return `${date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00.000-06:00`;
}

function makeSlotPattern(basePerSlot: number, peakSlot = 48, peakMultiplier = 3): number[] {
  return Array.from({ length: 96 }, (_, slot) => (slot === peakSlot ? basePerSlot * peakMultiplier : basePerSlot));
}

function makeIntervalSeries(date: string, pattern: number[]) {
  return pattern.map((kwh, slot) => ({ timestamp: slotTimestamp(date, slot), kwh }));
}

describe("onePathIntervalCompareDiagnosticsV1", () => {
  it("is available only for SMT/GB interval sources", () => {
    expect(isOnePathIntervalDiagnosticsInputType("INTERVAL")).toBe(true);
    expect(isOnePathIntervalDiagnosticsInputType("GREEN_BUTTON")).toBe(true);
    expect(isOnePathIntervalDiagnosticsInputType("MANUAL_MONTHLY")).toBe(false);
    expect(isOnePathIntervalDiagnosticsInputType("MANUAL_ANNUAL")).toBe(false);

    const smt = buildOnePathIntervalDiagnosticsEnvelope({
      inputType: "INTERVAL",
      preferredActualSource: "SMT",
      actualDataset: { daily: [{ date: "2025-07-01", kwh: 10 }] },
      simulatedDataset: { daily: [{ date: "2025-07-01", kwh: 11 }] },
      compareProjection: { rows: [{ localDate: "2025-07-01" }] },
    });
    expect(smt.available).toBe(true);
    expect(smt.sourceType).toBe("SMT");
  });

  it("is unavailable for manual sources", () => {
    const monthly = buildOnePathIntervalDiagnosticsForPastResponse({
      mode: "MANUAL_MONTHLY",
      preferredActualSource: null,
      actualDataset: { daily: [{ date: "2025-07-01", kwh: 10 }] },
      simulatedDataset: { daily: [{ date: "2025-07-01", kwh: 11 }] },
    });
    expect(monthly.available).toBe(false);
    expect(monthly.unavailableReason).toBe("manual_input_type");

    const annual = buildUnavailableOnePathIntervalDiagnosticsV1({ unavailableReason: "manual_input_type" });
    expect(annual.guardrails.validationPolicyMutated).toBe(false);
  });

  it("computes all-day WAPE/bias without mutating guardrails", () => {
    const actualDataset = makeDailyDataset([
      { date: "2025-07-01", actual: 100, simulated: 90 },
      { date: "2025-07-02", actual: 80, simulated: 88 },
    ]);
    const simulatedDataset = withSimulatedDaily(actualDataset, [
      { date: "2025-07-01", kwh: 90 },
      { date: "2025-07-02", kwh: 88 },
    ]);
    const out = buildOnePathIntervalCompareDiagnosticsV1({
      sourceType: "SMT",
      actualDataset,
      simulatedDataset,
      validationDayKeys: ["2025-07-01"],
      validationHoldoutProofOk: true,
    });

    expect(out.guardrails.simulationMutated).toBe(false);
    expect(out.guardrails.validationPolicyMutated).toBe(false);
    expect(out.dailyCompare.summaryBuckets.all_days.wape).toBe(0.1);
    expect(out.dailyCompare.summaryBuckets.all_days.percentBias).toBe(-1.11);
  });

  it("returns weather bucket summaries when weather is present", () => {
    const actualDataset = {
      meta: { timezone: "America/Chicago" },
      daily: [
        { date: "2025-07-01", kwh: 100 },
        { date: "2025-01-10", kwh: 80 },
      ],
      dailyWeather: {
        "2025-07-01": { meanTempF: 92, hdd: 0, cdd: 10 },
        "2025-01-10": { meanTempF: 35, hdd: 20, cdd: 0 },
      },
    };
    const simulatedDataset = {
      daily: [
        { date: "2025-07-01", kwh: 90 },
        { date: "2025-01-10", kwh: 85 },
      ],
    };
    const out = buildOnePathIntervalCompareDiagnosticsV1({
      sourceType: "GREEN_BUTTON",
      actualDataset,
      simulatedDataset,
    });

    expect(out.weatherMissDiagnostics.weatherDiagnosticsAvailable).toBe(true);
    expect(out.weatherMissDiagnostics.extremeHotDayBias).not.toBeNull();
    expect(out.weatherMissDiagnostics.coldDayBias).not.toBeNull();
    expect(out.dailyCompare.summaryBuckets.extreme_hot_days.dayCount).toBe(1);
    expect(out.dailyCompare.summaryBuckets.cold_days.dayCount).toBe(1);
  });

  it("gracefully returns weather unavailable when weather is missing", () => {
    const out = buildOnePathIntervalCompareDiagnosticsV1({
      sourceType: "SMT",
      actualDataset: { daily: [{ date: "2025-07-01", kwh: 10 }] },
      simulatedDataset: { daily: [{ date: "2025-07-01", kwh: 11 }] },
    });
    expect(out.weatherMissDiagnostics.weatherDiagnosticsAvailable).toBe(false);
    expect(out.weatherMissDiagnostics.missingWeatherFields).toContain("dailyWeather");
  });

  it("includes only selected validation days in interval curve diagnostics by default", () => {
    const validationDate = "2025-07-01";
    const otherDate = "2025-07-02";
    const pattern = makeSlotPattern(1);
    const actualDataset = {
      meta: { timezone: "America/Chicago" },
      daily: [
        { date: validationDate, kwh: 96 },
        { date: otherDate, kwh: 96 },
      ],
      series: {
        intervals15: [
          ...makeIntervalSeries(validationDate, pattern),
          ...makeIntervalSeries(otherDate, pattern),
        ],
      },
    };
    const simulatedDataset = {
      meta: { timezone: "America/Chicago" },
      daily: [
        { date: validationDate, kwh: 90 },
        { date: otherDate, kwh: 90 },
      ],
      series: {
        intervals15: [
          ...makeIntervalSeries(validationDate, pattern.map((value) => value * 0.9)),
          ...makeIntervalSeries(otherDate, pattern.map((value) => value * 0.9)),
        ],
      },
    };
    const out = buildOnePathIntervalCompareDiagnosticsV1({
      sourceType: "SMT",
      actualDataset,
      simulatedDataset,
      validationDayKeys: [validationDate],
    });

    expect(out.validationIntervalCurveDiagnostics.selectedValidationDayCount).toBe(1);
    expect(out.validationIntervalCurveDiagnostics.days.map((day) => day.date)).toEqual([validationDate]);
    expect(out.validationIntervalCurveDiagnostics.includedPosthocDayCount).toBe(0);
  });

  it("separates normalized shape error from raw interval WAPE", () => {
    const date = "2025-07-01";
    const actualPattern = makeSlotPattern(1, 48, 4);
    const simulatedPattern = makeSlotPattern(2, 48, 4);
    const actualDataset = {
      meta: { timezone: "America/Chicago" },
      daily: [{ date, kwh: actualPattern.reduce((sum, value) => sum + value, 0) }],
      series: { intervals15: makeIntervalSeries(date, actualPattern) },
    };
    const simulatedDataset = {
      meta: { timezone: "America/Chicago" },
      daily: [{ date, kwh: simulatedPattern.reduce((sum, value) => sum + value, 0) }],
      series: { intervals15: makeIntervalSeries(date, simulatedPattern) },
    };
    const out = buildOnePathIntervalCompareDiagnosticsV1({
      sourceType: "SMT",
      actualDataset,
      simulatedDataset,
      validationDayKeys: [date],
    });
    const day = out.validationIntervalCurveDiagnostics.days[0]!;
    expect(day.rawIntervalWape).toBeGreaterThan(0.4);
    expect(day.normalizedShapeError).toBe(0);
  });

  it("computes TOD bucket actual/sim/delta on validation days", () => {
    const date = "2025-01-15";
    const actualPattern = Array.from({ length: 96 }, (_, slot) => (slot < 24 ? 1 : slot < 48 ? 2 : slot < 72 ? 3 : 4));
    const simulatedPattern = actualPattern.map((value) => value + 0.5);
    const out = buildOnePathIntervalCompareDiagnosticsV1({
      sourceType: "GREEN_BUTTON",
      actualDataset: {
        meta: { timezone: "America/Chicago" },
        daily: [{ date, kwh: actualPattern.reduce((sum, value) => sum + value, 0) }],
        series: { intervals15: makeIntervalSeries(date, actualPattern) },
      },
      simulatedDataset: {
        meta: { timezone: "America/Chicago" },
        daily: [{ date, kwh: simulatedPattern.reduce((sum, value) => sum + value, 0) }],
        series: { intervals15: makeIntervalSeries(date, simulatedPattern) },
      },
      validationDayKeys: [date],
    });
    const overnight = out.todBucketDiagnostics.buckets.find((bucket) => bucket.bucket === "overnight");
    expect(overnight?.bucketActualKwh).toBe(24);
    expect(overnight?.bucketSimulatedKwh).toBe(36);
    expect(overnight?.bucketDeltaKwh).toBe(12);
  });

  it("keeps optional posthoc top-miss interval compare off by default", () => {
    const out = buildOnePathIntervalCompareDiagnosticsV1({
      sourceType: "SMT",
      actualDataset: {
        daily: [
          { date: "2025-07-01", kwh: 100 },
          { date: "2025-07-02", kwh: 50 },
        ],
      },
      simulatedDataset: {
        daily: [
          { date: "2025-07-01", kwh: 60 },
          { date: "2025-07-02", kwh: 49 },
        ],
      },
      validationDayKeys: ["2025-07-01"],
    });
    expect(out.validationIntervalCurveDiagnostics.includePosthocTopMissIntervalCurves).toBe(false);
    expect(out.validationIntervalCurveDiagnostics.includedPosthocDayCount).toBe(0);
  });

  it("includes posthoc top misses when explicitly enabled", () => {
    const out = buildOnePathIntervalCompareDiagnosticsV1({
      sourceType: "SMT",
      actualDataset: {
        daily: [
          { date: "2025-07-01", kwh: 100 },
          { date: "2025-07-02", kwh: 50 },
        ],
      },
      simulatedDataset: {
        daily: [
          { date: "2025-07-01", kwh: 60 },
          { date: "2025-07-02", kwh: 49 },
        ],
      },
      validationDayKeys: ["2025-07-01"],
      includePosthocTopMissIntervalCurves: true,
      posthocTopMissDayCount: 1,
    });
    expect(out.validationIntervalCurveDiagnostics.includePosthocTopMissIntervalCurves).toBe(true);
    expect(out.validationIntervalCurveDiagnostics.includedPosthocDayCount).toBe(1);
    const posthocDay = out.dailyCompare.days.find((day) => day.date === "2025-07-01");
    expect(posthocDay?.diagnosticConfidence).toBe("posthoc_diagnostic");
  });

  it("flags exact/near-exact interval curve matches diagnostically only", () => {
    const date = "2025-07-01";
    const pattern = makeSlotPattern(1.25);
    const out = buildOnePathIntervalCompareDiagnosticsV1({
      sourceType: "SMT",
      actualDataset: {
        meta: { timezone: "America/Chicago" },
        daily: [{ date, kwh: 120 }],
        series: { intervals15: makeIntervalSeries(date, pattern) },
      },
      simulatedDataset: {
        meta: { timezone: "America/Chicago" },
        daily: [{ date, kwh: 120 }],
        series: { intervals15: makeIntervalSeries(date, pattern) },
      },
      validationDayKeys: [date],
      validationHoldoutProofOk: true,
    });
    const day = out.validationIntervalCurveDiagnostics.days[0]!;
    expect(day.exactCurveMatchFlag).toBe(true);
    expect(out.exactMatchDiagnostics.exactCurveMatchDayCount).toBe(1);
    expect(out.guardrails.userFacingResultMutated).toBe(false);
  });

  it("does not mutate validation policy or production artifact guardrails", () => {
    const out = buildOnePathIntervalDiagnosticsEnvelope({
      inputType: "INTERVAL",
      preferredActualSource: "SMT",
      actualDataset: { daily: [{ date: "2025-07-01", kwh: 10 }] },
      simulatedDataset: { daily: [{ date: "2025-07-01", kwh: 10 }] },
      compareProjection: { rows: [{ localDate: "2025-07-01" }] },
    });
    expect(out.guardrails.validationPolicyMutated).toBe(false);
    expect(out.guardrails.planRankingMutated).toBe(false);
    expect(out.guardrails.userFacingResultMutated).toBe(false);
    expect(out.guardrails.diagnosticOnly).toBe(true);
  });

  it("extracts validation day keys from compare projection rows", () => {
    expect(
      extractValidationDayKeysFromCompareProjection({
        rows: [{ localDate: "2025-07-02" }, { date: "2025-07-01" }],
      })
    ).toEqual(["2025-07-01", "2025-07-02"]);
  });
});
