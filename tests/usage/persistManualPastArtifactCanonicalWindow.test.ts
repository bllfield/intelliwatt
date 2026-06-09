import { describe, expect, it } from "vitest";

import { resolveCanonicalUsage365CoverageWindow } from "@/lib/usage/canonicalMetadataWindow";
import {
  isCanonicalManualPastArtifact,
  MANUAL_CANONICAL_ARTIFACT_WINDOW_VERSION,
  projectManualPastDatasetToCanonicalWindow,
  UnsupportedManualPastDatasetError,
} from "@/lib/usage/persistManualPastArtifactCanonicalWindow";

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

function buildManualDataset(args: {
  startDate: string;
  endDate: string;
  dailyKwh?: number;
  anchorEndDate?: string;
  usageInputMode?: string;
}) {
  const dates = enumerateDateKeysInclusive(args.startDate, args.endDate);
  const dailyKwh = args.dailyKwh ?? 1;
  const totalKwh = dates.length * dailyKwh;
  return {
    summary: {
      start: args.startDate,
      end: args.endDate,
      totalKwh,
    },
    meta: {
      usageInputMode: args.usageInputMode ?? "MANUAL_MONTHLY",
      ...(args.anchorEndDate ? { anchorEndDate: args.anchorEndDate } : {}),
    },
    totals: {
      importKwh: totalKwh,
      exportKwh: 0,
      netKwh: totalKwh,
    },
    monthly: [{ month: args.endDate.slice(0, 7), kwh: totalKwh }],
    daily: dates.map((date) => ({ date, kwh: dailyKwh, source: "SIMULATED" })),
    dailyWeather: Object.fromEntries(
      dates.slice(0, 3).map((date) => [
        date,
        { tAvgF: 50, tMinF: 40, tMaxF: 60, hdd65: 15, cdd65: 0, source: "OPEN_METEO_CACHE" },
      ])
    ),
    insights: {
      timeOfDayBuckets: [
        { key: "overnight", label: "Overnight (12am–6am)", kwh: totalKwh * 0.1 },
        { key: "morning", label: "Morning (6am–12pm)", kwh: totalKwh * 0.2 },
        { key: "afternoon", label: "Afternoon (12pm–6pm)", kwh: totalKwh * 0.3 },
        { key: "evening", label: "Evening (6pm–12am)", kwh: totalKwh * 0.4 },
      ],
    },
    series: {
      intervals15: dates.map((date) => ({
        timestamp: `${date}T00:00:00.000Z`,
        kwh: dailyKwh,
      })),
    },
  };
}

describe("persistManualPastArtifactCanonicalWindow", () => {
  const annualProofNow = new Date("2026-06-08T18:00:00.000Z");
  const canonicalAnnual = resolveCanonicalUsage365CoverageWindow(annualProofNow);

  it("projects a monthly manual dataset onto the canonical coverage window", () => {
    const dataset = buildManualDataset({
      startDate: "2025-06-05",
      endDate: "2026-06-04",
      usageInputMode: "MANUAL_MONTHLY",
    });
    const out = projectManualPastDatasetToCanonicalWindow(dataset, {
      usageInputMode: "MANUAL_MONTHLY",
      now: annualProofNow,
    });

    expect(out.summary.start).toBe(canonicalAnnual.startDate);
    expect(out.summary.end).toBe(canonicalAnnual.endDate);
    expect(out.meta.coverageStart).toBe(canonicalAnnual.startDate);
    expect(out.meta.coverageEnd).toBe(canonicalAnnual.endDate);
    expect(out.summary.coverageStart).toBe(canonicalAnnual.startDate);
    expect(out.summary.coverageEnd).toBe(canonicalAnnual.endDate);
  });

  it("projects annual manual datasets from 2025-06-05..2026-06-04 to 2025-06-07..2026-06-06", () => {
    const dataset = buildManualDataset({
      startDate: "2025-06-05",
      endDate: "2026-06-04",
      usageInputMode: "MANUAL_ANNUAL",
      anchorEndDate: "2026-06-06",
    });

    const out = projectManualPastDatasetToCanonicalWindow(dataset, {
      usageInputMode: "MANUAL_ANNUAL",
      now: annualProofNow,
    });

    expect(out.summary.start).toBe("2025-06-07");
    expect(out.summary.end).toBe("2026-06-06");
    expect(out.daily[0]?.date).toBe("2025-06-07");
    expect(out.daily[out.daily.length - 1]?.date).toBe("2026-06-06");
    expect(out.daily).toHaveLength(365);
  });

  it("preserves total daily kWh across the remap", () => {
    const dataset = buildManualDataset({
      startDate: "2025-06-05",
      endDate: "2026-06-04",
      dailyKwh: 2.5,
      usageInputMode: "MANUAL_ANNUAL",
    });
    const sourceDailyTotal = dataset.daily.reduce((sum, row) => sum + row.kwh, 0);

    const out = projectManualPastDatasetToCanonicalWindow(dataset, {
      usageInputMode: "MANUAL_ANNUAL",
      now: annualProofNow,
    });
    const remappedDailyTotal = out.daily.reduce((sum: number, row: { kwh: number }) => sum + row.kwh, 0);

    expect(remappedDailyTotal).toBe(sourceDailyTotal);
    expect(out.summary.totalKwh).toBe(sourceDailyTotal);
    expect(out.totals.netKwh).toBe(sourceDailyTotal);
  });

  it("recomputes monthly rows from canonical-dated daily rows", () => {
    const dataset = buildManualDataset({
      startDate: "2025-06-05",
      endDate: "2026-06-04",
      dailyKwh: 1,
      usageInputMode: "MANUAL_ANNUAL",
    });

    const out = projectManualPastDatasetToCanonicalWindow(dataset, {
      usageInputMode: "MANUAL_ANNUAL",
      now: annualProofNow,
    });

    const monthlySum = out.monthly.reduce((sum: number, row: { kwh: number }) => sum + row.kwh, 0);
    expect(monthlySum).toBe(365);
    expect(out.monthly).toHaveLength(12);
    expect(out.monthly[out.monthly.length - 1]).toEqual({ month: "2026-06", kwh: 30 });
  });

  it("shifts intervals15 dates consistently with daily rows", () => {
    const dataset = buildManualDataset({
      startDate: "2025-03-17",
      endDate: "2025-03-19",
      usageInputMode: "MANUAL_MONTHLY",
    });

    const out = projectManualPastDatasetToCanonicalWindow(dataset, {
      usageInputMode: "MANUAL_MONTHLY",
      now: annualProofNow,
    });

    expect(out.series.intervals15.map((row: any) => row.timestamp.slice(0, 10))).toEqual(
      out.daily.map((row: any) => row.date)
    );
  });

  it("shifts dailyWeather dates consistently when present", () => {
    const dataset = buildManualDataset({
      startDate: "2025-03-17",
      endDate: "2025-03-19",
      usageInputMode: "MANUAL_MONTHLY",
    });

    const out = projectManualPastDatasetToCanonicalWindow(dataset, {
      usageInputMode: "MANUAL_MONTHLY",
      now: annualProofNow,
    });

    expect(Object.keys(out.dailyWeather).sort()).toEqual(out.daily.map((row: any) => row.date).sort());
  });

  it("preserves manualBillPeriodWindow diagnostics for the original bill/input window", () => {
    const dataset = buildManualDataset({
      startDate: "2025-06-05",
      endDate: "2026-06-04",
      usageInputMode: "MANUAL_ANNUAL",
      anchorEndDate: "2026-06-06",
    });

    const out = projectManualPastDatasetToCanonicalWindow(dataset, {
      usageInputMode: "MANUAL_ANNUAL",
      now: annualProofNow,
    });

    expect(out.meta.manualBillPeriodWindow).toMatchObject({
      startDate: "2025-06-05",
      endDate: "2026-06-04",
      simulationWindowStart: "2025-06-05",
      simulationWindowEnd: "2026-06-04",
      source: "bill_period_input",
      anchorEndDate: "2026-06-06",
    });
  });

  it("persists pre-projection bill-period sim totals for reconciliation readback", () => {
    const dataset = buildManualDataset({
      startDate: "2025-03-17",
      endDate: "2025-04-15",
      dailyKwh: 10,
      usageInputMode: "MANUAL_MONTHLY",
    });
    dataset.meta.manualBillPeriods = [
      { id: "2025-03", month: "2025-03", startDate: "2025-03-17", endDate: "2025-03-31" },
      { id: "2025-04", month: "2025-04", startDate: "2025-04-01", endDate: "2025-04-15" },
    ];

    const out = projectManualPastDatasetToCanonicalWindow(dataset, {
      usageInputMode: "MANUAL_MONTHLY",
      now: annualProofNow,
    });

    expect(out.meta.manualBillPeriodSimTotalsById).toEqual({
      "2025-03": 150,
      "2025-04": 150,
    });
    expect(out.summary.start).not.toBe("2025-03-17");
  });

  it("stamps manualCanonicalArtifactWindowVersion", () => {
    const dataset = buildManualDataset({
      startDate: "2025-03-17",
      endDate: "2025-03-19",
      usageInputMode: "MANUAL_MONTHLY",
    });

    const out = projectManualPastDatasetToCanonicalWindow(dataset, {
      usageInputMode: "MANUAL_MONTHLY",
      now: annualProofNow,
    });

    expect(out.meta.manualCanonicalArtifactWindowVersion).toBe(MANUAL_CANONICAL_ARTIFACT_WINDOW_VERSION);
    expect(isCanonicalManualPastArtifact(out)).toBe(true);
  });

  it("is idempotent once the canonical artifact version is stamped", () => {
    const dataset = buildManualDataset({
      startDate: "2025-06-05",
      endDate: "2026-06-04",
      usageInputMode: "MANUAL_ANNUAL",
    });

    const first = projectManualPastDatasetToCanonicalWindow(dataset, {
      usageInputMode: "MANUAL_ANNUAL",
      now: annualProofNow,
    });
    const second = projectManualPastDatasetToCanonicalWindow(first, {
      usageInputMode: "MANUAL_ANNUAL",
      now: new Date("2027-01-01T12:00:00.000Z"),
    });

    expect(second).toBe(first);
    expect(second.summary.start).toBe("2025-06-07");
    expect(second.summary.end).toBe("2026-06-06");
  });

  it("does not silently mutate unsupported datasets", () => {
    const dataset = {
      summary: { start: "2025-03-17", end: "2025-03-19", totalKwh: 10 },
      meta: { sourceMode: "SMT_BASELINE" },
      series: { intervals15: [] },
    };

    const out = projectManualPastDatasetToCanonicalWindow(dataset);
    expect(out).toBe(dataset);
    expect(out.summary.start).toBe("2025-03-17");
  });

  it("throws clearly for unsupported datasets when strict mode is enabled", () => {
    const dataset = {
      summary: { start: "2025-03-17", end: "2025-03-19", totalKwh: 10 },
      meta: { sourceMode: "SMT_BASELINE" },
      series: { intervals15: [] },
    };

    expect(() => projectManualPastDatasetToCanonicalWindow(dataset, { strict: true })).toThrow(
      UnsupportedManualPastDatasetError
    );
  });

  it("recomputes timeOfDayBuckets from canonical intervals", () => {
    const dataset = buildManualDataset({
      startDate: "2025-03-17",
      endDate: "2025-03-19",
      dailyKwh: 4,
      usageInputMode: "MANUAL_MONTHLY",
    });

    const out = projectManualPastDatasetToCanonicalWindow(dataset, {
      usageInputMode: "MANUAL_MONTHLY",
      now: annualProofNow,
    });

    const bucketTotal = out.insights.timeOfDayBuckets.reduce(
      (sum: number, row: { kwh: number }) => sum + row.kwh,
      0
    );
    expect(bucketTotal).toBe(out.summary.totalKwh);
    expect(out.insights.stitchedMonth).toBeNull();
  });
});
