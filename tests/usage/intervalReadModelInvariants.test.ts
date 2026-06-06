import fs from "fs";
import path from "path";

import { describe, expect, it } from "vitest";

import { createHomeIntervalCalendar, localDateKey } from "@/lib/time/homeIntervalCalendar";
import { buildGreenButtonLoadCurveInsightsFromSeriesRows } from "@/lib/time/greenButtonPersistedIntervalConvert";
import { coverageWindowEndingOnDateKey } from "@/lib/usage/canonicalMetadataWindow";
import {
  auditIntervalReadModelInvariants,
  auditUserAdminPastReadModelParity,
} from "@/lib/usage/intervalReadModelInvariants";
import { buildUserUsageDashboardViewModel } from "@/lib/usage/userUsageDashboardViewModel";
import { runGreenButtonUsagePipeline } from "@/lib/usage/greenButtonUsagePipeline";
import {
  countDistinctLocalSlotsByDateKey,
  resolveLatestCompleteGreenButtonDateKeyFromSlotCounts,
} from "@/lib/usage/greenButtonLocalSlot";

const FIXTURE = path.join(process.cwd(), "docs", "GreenButtonDatanew.xml");
const hasFixture = fs.existsSync(FIXTURE);

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function buildPastSimDatasetWithTravelFill() {
  return {
    summary: {
      source: "GREEN_BUTTON",
      intervalsCount: 3,
      totalKwh: 4.1,
      start: "2026-06-01",
      end: "2026-06-03",
    },
    totals: { importKwh: 4.1, exportKwh: 0, netKwh: 4.1 },
    daily: [
      { date: "2026-06-01", kwh: 2, source: "ACTUAL" },
      { date: "2026-06-02", kwh: 2, source: "ACTUAL" },
      { date: "2026-06-03", kwh: 0.1, source: "SIMULATED", sourceDetail: "SIMULATED (TRAVEL/VACANT)" },
    ],
    monthly: [{ month: "2026-06", kwh: 4.1 }],
    series: {
      intervals15: [
        { timestamp: "2026-06-01T17:00:00.000Z", kwh: 2 },
        { timestamp: "2026-06-02T17:00:00.000Z", kwh: 2 },
        { timestamp: "2026-06-03T17:00:00.000Z", kwh: 0.1 },
      ],
    },
    meta: {
      datasetKind: "SIMULATED",
      actualSource: "GREEN_BUTTON",
      monthProvenanceByMonth: { "2026-06": "SIMULATED" },
      timezone: "America/Chicago",
      coverageStart: "2026-06-01",
      coverageEnd: "2026-06-03",
      greenButtonIntervalTimestampMode: "home_local",
    },
  };
}

describe("interval read model invariants", () => {
  it("keeps Past simulated-fill summary and buckets aligned with net usage", () => {
    const dataset = buildPastSimDatasetWithTravelFill();
    const viewModel = buildUserUsageDashboardViewModel({ dataset });
    expect(viewModel).not.toBeNull();

    const audit = auditIntervalReadModelInvariants({
      dataset,
      dailyRows: viewModel!.derived.daily,
      monthlyRows: viewModel!.derived.monthly,
      fifteenMinuteAverages: viewModel!.derived.fifteenCurve,
      weekdayKwh: viewModel!.derived.weekdayKwh,
      weekendKwh: viewModel!.derived.weekendKwh,
      timeOfDayBuckets: viewModel!.derived.timeOfDayBuckets,
      netUsageKwh: viewModel!.derived.totals.netKwh,
      avgDailyKwh: viewModel!.derived.avgDailyKwh,
      dailyRowCount: viewModel!.derived.daily.length,
    });

    expect(audit.ok).toBe(true);
    expect(audit.violations).toEqual([]);
    expect(audit.timeOfDayBucketTotalKwh).toBe(4.1);
  });

  it("matches user and admin Past read models for summary, buckets, and load curve", () => {
    const parity = auditUserAdminPastReadModelParity({
      dataset: buildPastSimDatasetWithTravelFill(),
      allowSameDatasetStructuralAudit: true,
    });
    expect(parity.ok).toBe(true);
    expect(parity.violations).toEqual([]);
  });

  it.skipIf(!hasFixture)(
    "keeps Green Button actual baseline invariants on fixture window",
    () => {
    const result = runGreenButtonUsagePipeline({
      buffer: fs.readFileSync(FIXTURE),
      filename: "GreenButtonDatanew.xml",
      windowDays: 365,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const anchor = resolveLatestCompleteGreenButtonDateKeyFromSlotCounts(
      countDistinctLocalSlotsByDateKey(result.trimmed.map((row) => ({ timestamp: new Date(row.timestamp) })))
    );
    expect(anchor).toBe("2026-05-13");
    const window = anchor ? coverageWindowEndingOnDateKey(anchor, 365) : null;
    expect(window).toEqual({ startDate: "2025-05-14", endDate: "2026-05-13" });

    const inWindowRows = result.trimmed
      .filter((row) => {
        const dk = new Date(row.timestamp).toISOString().slice(0, 10);
        return window && dk >= window.startDate && dk <= window.endDate;
      })
      .map((row) => ({
        timestamp: new Date(row.timestamp).toISOString(),
        kwh: row.consumptionKwh,
      }));

    const insights = buildGreenButtonLoadCurveInsightsFromSeriesRows(inWindowRows, {
      homeTimezone: "America/Chicago",
      meta: { greenButtonIntervalTimestampMode: "home_local", actualSource: "GREEN_BUTTON" },
    });
    const netUsageKwh = Number(inWindowRows.reduce((sum, row) => sum + row.kwh, 0).toFixed(1));
    const avgDailyKwh = Number((netUsageKwh / 365).toFixed(3));
    const loadCurveMeanKw =
      insights.fifteenMinuteAverages.reduce((sum, row) => sum + row.avgKw, 0) /
      insights.fifteenMinuteAverages.length;

    const audit = auditIntervalReadModelInvariants({
      dataset: {
        summary: { totalKwh: netUsageKwh },
        totals: { netKwh: netUsageKwh },
        insights,
      },
      dailyRows: [],
      monthlyRows: [],
      fifteenMinuteAverages: insights.fifteenMinuteAverages,
      timeOfDayBuckets: insights.timeOfDayBuckets,
      netUsageKwh,
      avgDailyKwh,
      dailyRowCount: 365,
    });

    expect(audit.timeOfDayBucketTotalKwh).not.toBeNull();
    expect(
      Math.abs((audit.timeOfDayBucketTotalKwh ?? 0) - netUsageKwh)
    ).toBeLessThanOrEqual(0.1);
    expect(Math.abs(loadCurveMeanKw * 24 - avgDailyKwh)).toBeLessThanOrEqual(0.1);
    expect(insights.fifteenMinuteAverages.length).toBeGreaterThanOrEqual(90);
    },
    60_000
  );
});
