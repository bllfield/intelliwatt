import { describe, expect, it } from "vitest";

import { deriveBaseloadFieldsFromDaily } from "@/lib/usage/baseloadDerivedFields";
import { buildManualUsageReadModel } from "@/modules/manualUsage/readModel";
import {
  buildManualValidationSummary,
  MANUAL_BILL_MATCH_TOLERANCE_KWH,
} from "@/modules/manualUsage/manualValidationSummary";
import { buildUserUsageDashboardViewModel } from "@/lib/usage/userUsageDashboardViewModel";

function buildMonthlyPayload(args: {
  count: number;
  anchorEndDate?: string;
  travelRanges?: Array<{ startDate: string; endDate: string }>;
}) {
  const anchorEndDate = args.anchorEndDate ?? "2025-12-31";
  const statementRanges = Array.from({ length: args.count }, (_, index) => {
    const end = new Date(`${anchorEndDate}T00:00:00.000Z`);
    end.setUTCMonth(end.getUTCMonth() - index);
    const endDate = end.toISOString().slice(0, 10);
    const start = new Date(end.getTime());
    start.setUTCDate(1);
    return {
      month: endDate.slice(0, 7),
      startDate: start.toISOString().slice(0, 10),
      endDate,
    };
  });
  return {
    mode: "MONTHLY" as const,
    anchorEndDate,
    monthlyKwh: statementRanges.map((range, index) => ({
      month: range.month,
      kwh: 1000 + index,
    })),
    statementRanges,
    travelRanges: args.travelRanges ?? [],
  };
}

function buildSidecarFromPayload(payload: ReturnType<typeof buildMonthlyPayload>) {
  const sidecar: Record<string, number> = {};
  for (const row of payload.monthlyKwh) {
    if (typeof row.kwh === "number") sidecar[row.month] = row.kwh;
  }
  return sidecar;
}

function buildDataset(sidecar: Record<string, number>) {
  return {
    meta: {
      manualCanonicalArtifactWindowVersion: "manual_canonical_artifact_v1",
      manualBillPeriodSimTotalsById: sidecar,
      filledMonths: [],
      manualMonthlyInputState: {
        inputKindByMonth: Object.fromEntries(
          Object.keys(sidecar).map((month) => [month, "entered_nonzero" as const])
        ),
      },
    },
    summary: {
      start: "2025-06-07",
      end: "2026-06-06",
      totalKwh: Object.values(sidecar).reduce((a, b) => a + b, 0),
    },
    daily: [{ date: "2025-06-07", kwh: 1 }],
  };
}

describe("buildManualValidationSummary", () => {
  it("passes 12/12 no-travel manual monthly from sidecar with total delta within tolerance", () => {
    const payload = buildMonthlyPayload({ count: 12 });
    const sidecar = buildSidecarFromPayload(payload);
    const readModel = buildManualUsageReadModel({ payload, dataset: buildDataset(sidecar), actualDataset: null });
    const summary = buildManualValidationSummary({
      manualReadModel: readModel,
      dataset: buildDataset(sidecar),
      inputType: "MANUAL_MONTHLY",
    });

    expect(summary?.billMatchVerification.status).toBe("pass");
    expect(summary?.billMatchVerification.source).toBe("manualBillPeriodSimTotalsById");
    expect(summary?.billMatchVerification.eligiblePeriodCount).toBe(12);
    expect(summary?.billMatchVerification.excludedPeriodCount).toBe(0);
    expect(summary?.billMatchVerification.exactMatchPeriodCount).toBe(12);
    expect(summary?.billMatchVerification.toleranceKwh).toBe(MANUAL_BILL_MATCH_TOLERANCE_KWH);
    expect(Math.abs(summary?.billMatchVerification.deltaKwh ?? 0)).toBeLessThanOrEqual(
      MANUAL_BILL_MATCH_TOLERANCE_KWH
    );
  });

  it("excludes one travel-overlapped period without forcing sidecar reconciliation", () => {
    const payload = {
      mode: "MONTHLY" as const,
      anchorEndDate: "2025-05-31",
      monthlyKwh: [
        { month: "2025-05", kwh: 1000 },
        { month: "2025-04", kwh: 1001 },
      ],
      statementRanges: [
        { month: "2025-05", startDate: "2025-05-01", endDate: "2025-05-31" },
        { month: "2025-04", startDate: "2025-04-01", endDate: "2025-04-30" },
      ],
      travelRanges: [{ startDate: "2025-05-10", endDate: "2025-05-12" }],
    };
    const sidecar = { "2025-04": 1001, "2025-05": 999 };
    const readModel = buildManualUsageReadModel({
      payload,
      dataset: buildDataset(sidecar),
      actualDataset: null,
    });
    const summary = buildManualValidationSummary({
      manualReadModel: readModel,
      dataset: buildDataset(sidecar),
      inputType: "MANUAL_MONTHLY",
    });
    const may = summary?.billMatchVerification.rows.find((row) => row.periodId === "2025-05");

    expect(summary?.billMatchVerification.eligiblePeriodCount).toBe(1);
    expect(summary?.billMatchVerification.excludedPeriodCount).toBe(1);
    expect(summary?.billMatchVerification.exactMatchPeriodCount).toBe(1);
    expect(may).toMatchObject({
      eligible: false,
      exclusionReason: "travel_overlap",
      simulatedKwh: 999,
      deltaKwh: null,
    });
  });

  it("excludes two travel-overlapped periods while remaining eligible periods reconcile", () => {
    const payload = buildMonthlyPayload({
      count: 3,
      anchorEndDate: "2025-03-31",
      travelRanges: [
        { startDate: "2025-03-01", endDate: "2025-03-05" },
        { startDate: "2025-02-01", endDate: "2025-02-05" },
      ],
    });
    const sidecar = buildSidecarFromPayload(payload);
    const readModel = buildManualUsageReadModel({ payload, dataset: buildDataset(sidecar), actualDataset: null });
    const summary = buildManualValidationSummary({
      manualReadModel: readModel,
      dataset: buildDataset(sidecar),
      inputType: "MANUAL_MONTHLY",
    });

    expect(summary?.billMatchVerification.eligiblePeriodCount).toBe(1);
    expect(summary?.billMatchVerification.excludedPeriodCount).toBe(2);
    expect(summary?.billMatchVerification.exactMatchPeriodCount).toBe(1);
    expect(summary?.billMatchVerification.rows.filter((row) => row.exclusionReason === "travel_overlap")).toHaveLength(2);
  });

  it("falls back to legacy daily sums when sidecar is absent and dates align", () => {
    const payload = {
      mode: "MONTHLY" as const,
      anchorEndDate: "2025-04-30",
      monthlyKwh: [{ month: "2025-04", kwh: 300 }],
      statementRanges: [{ month: "2025-04", startDate: "2025-04-01", endDate: "2025-04-30" }],
      travelRanges: [],
    };
    const dataset = {
      meta: {
        filledMonths: [],
        manualMonthlyInputState: { inputKindByMonth: { "2025-04": "entered_nonzero" } },
      },
      daily: Array.from({ length: 30 }, (_, idx) => ({
        date: `2025-04-${String(idx + 1).padStart(2, "0")}`,
        kwh: 10,
      })),
    };
    const readModel = buildManualUsageReadModel({ payload, dataset, actualDataset: null });
    const summary = buildManualValidationSummary({
      manualReadModel: readModel,
      dataset,
      inputType: "MANUAL_MONTHLY",
    });

    expect(summary?.billMatchVerification.source).toBe("legacy_daily_sum");
    expect(summary?.billMatchVerification.rows[0]?.simulatedKwh).toBe(300);
  });

  it("keeps excluded entered and simulated totals visible separately from eligible pass/fail totals", () => {
    const payload = {
      mode: "MONTHLY" as const,
      anchorEndDate: "2025-05-31",
      monthlyKwh: [
        { month: "2025-05", kwh: 1000 },
        { month: "2025-04", kwh: 1001 },
      ],
      statementRanges: [
        { month: "2025-05", startDate: "2025-05-01", endDate: "2025-05-31" },
        { month: "2025-04", startDate: "2025-04-01", endDate: "2025-04-30" },
      ],
      travelRanges: [{ startDate: "2025-05-10", endDate: "2025-05-12" }],
    };
    const sidecar = { "2025-04": 1001, "2025-05": 999 };
    const readModel = buildManualUsageReadModel({
      payload,
      dataset: buildDataset(sidecar),
      actualDataset: null,
    });
    const summary = buildManualValidationSummary({
      manualReadModel: readModel,
      dataset: buildDataset(sidecar),
      inputType: "MANUAL_MONTHLY",
    });

    expect(summary?.billMatchVerification.totalScope).toBe("eligible_periods_only");
    expect(summary?.billMatchVerification.eligibleEnteredTotalKwh).toBe(1001);
    expect(summary?.billMatchVerification.excludedEnteredTotalKwh).toBe(1000);
    expect(summary?.billMatchVerification.allEnteredTotalKwh).toBe(2001);
    expect(summary?.billMatchVerification.excludedSimulatedTotalKwh).toBe(999);
    expect(summary?.billMatchVerification.enteredTotalKwh).toBe(summary?.billMatchVerification.eligibleEnteredTotalKwh);
  });

  it("marks manual-only confidence as estimated without interval accuracy claim", () => {
    const payload = buildMonthlyPayload({ count: 1 });
    const sidecar = buildSidecarFromPayload(payload);
    const readModel = buildManualUsageReadModel({ payload, dataset: buildDataset(sidecar), actualDataset: null });
    const summary = buildManualValidationSummary({
      manualReadModel: readModel,
      dataset: buildDataset(sidecar),
      inputType: "MANUAL_MONTHLY",
    });

    expect(summary?.manualSimulationConfidence.intervalAccuracyClaim).toBe("estimated");
    expect(summary?.manualSimulationConfidence.basis).toBe("manual_bills_weather_fit");
    expect(summary?.manualSimulationConfidence.adminDiagnostics.unconstrainedOrHoldoutAvailable).toBe(false);
    expect(summary?.intervalShape.accuracyClaim).toBe("estimated");
    expect(summary?.manualSimulationConfidence.userFacingSummary).toContain("Your bill totals were matched");
    expect(summary?.manualSimulationConfidence.userFacingSummary).toContain("15-minute timing is estimated");
    expect(summary?.manualSimulationConfidence.userFacingSummary).toContain("Connect Smart Meter Texas");
  });

  it("marks SMT actual source confidence as measured only when compare rows compare actual vs simulated days", () => {
    const payload = buildMonthlyPayload({ count: 1 });
    const sidecar = buildSidecarFromPayload(payload);
    const readModel = buildManualUsageReadModel({ payload, dataset: buildDataset(sidecar), actualDataset: null });
    const summary = buildManualValidationSummary({
      manualReadModel: readModel,
      dataset: buildDataset(sidecar),
      inputType: "MONTHLY_FROM_SOURCE_INTERVALS",
      actualComparison: {
        meta: { preferredActualSource: "SMT" },
        series: { intervals15: [{ timestamp: "2025-01-01T06:00:00.000Z", kwh: 1 }] },
      },
      compareProjection: {
        rows: [{ localDate: "2025-01-01", actualDayKwh: 10, simulatedDayKwh: 9.5 }],
        metrics: { wape: 12 },
      },
      includeAdminMetrics: true,
    });

    expect(summary?.manualSimulationConfidence.intervalAccuracyClaim).toBe("measured");
    expect(summary?.manualSimulationConfidence.basis).toBe("smt_interval_truth");
    expect(summary?.manualSimulationConfidence.adminDiagnostics.actualIntervalTruthAvailable).toBe(true);
    expect(summary?.manualSimulationConfidence.adminDiagnostics.intervalComparisonAvailable).toBe(true);
    expect(summary?.intervalShape.accuracyClaim).toBe("measured");
  });

  it("keeps source-interval homes estimated when actual intervals exist but compare rows are absent", () => {
    const payload = buildMonthlyPayload({ count: 1 });
    const sidecar = buildSidecarFromPayload(payload);
    const readModel = buildManualUsageReadModel({ payload, dataset: buildDataset(sidecar), actualDataset: null });
    const summary = buildManualValidationSummary({
      manualReadModel: readModel,
      dataset: buildDataset(sidecar),
      inputType: "MONTHLY_FROM_SOURCE_INTERVALS",
      actualComparison: {
        meta: { preferredActualSource: "SMT" },
        series: { intervals15: [{ timestamp: "2025-01-01T06:00:00.000Z", kwh: 1 }] },
      },
      compareProjection: { rows: [], metrics: {} },
      includeAdminMetrics: true,
    });

    expect(summary?.manualSimulationConfidence.intervalAccuracyClaim).toBe("estimated");
    expect(summary?.manualSimulationConfidence.basis).toBe("actual_source_backed_not_compared");
    expect(summary?.manualSimulationConfidence.adminDiagnostics.actualIntervalTruthAvailable).toBe(true);
    expect(summary?.manualSimulationConfidence.adminDiagnostics.intervalComparisonAvailable).toBe(false);
    expect(summary?.intervalShape.accuracyClaim).toBe("estimated");
  });

  it("returns identical validation objects for user and admin decoration owners", () => {
    const payload = buildMonthlyPayload({ count: 2 });
    const sidecar = buildSidecarFromPayload(payload);
    const dataset = buildDataset(sidecar);
    const readModel = buildManualUsageReadModel({ payload, dataset, actualDataset: null });
    const userSummary = buildManualValidationSummary({
      manualReadModel: readModel,
      dataset,
      inputType: "MANUAL_MONTHLY",
      includeAdminMetrics: false,
    });
    const adminSummary = buildManualValidationSummary({
      manualReadModel: readModel,
      dataset,
      inputType: "MANUAL_MONTHLY",
      includeAdminMetrics: true,
    });

    expect(userSummary?.billMatchVerification).toEqual(adminSummary?.billMatchVerification);
    expect(userSummary?.intervalShape).toEqual(adminSummary?.intervalShape);
    expect(userSummary?.manualSimulationConfidence.status).toEqual(adminSummary?.manualSimulationConfidence.status);
    expect(userSummary?.manualSimulationConfidence.intervalAccuracyClaim).toEqual(
      adminSummary?.manualSimulationConfidence.intervalAccuracyClaim
    );
  });
});

describe("deriveBaseloadFieldsFromDaily", () => {
  it("derives 15-minute kWh and average kW from daily baseload", () => {
    expect(deriveBaseloadFieldsFromDaily(24)).toEqual({
      baseload15MinKwh: 0.25,
      baseloadAvgKw: 1,
    });
  });

  it("populates dashboard baseload when daily baseload exists", () => {
    const viewModel = buildUserUsageDashboardViewModel({
      dataset: {
        insights: { baseloadDaily: 24, baseloadMonthly: 720 },
        daily: [{ date: "2025-01-01", kwh: 30 }],
        monthly: [{ month: "2025-01", kwh: 900 }],
      },
    } as any);
    expect(viewModel).not.toBeNull();
    expect(viewModel!.derived.baseloadDaily).toBe(24);
    expect(viewModel!.derived.baseload).toBe(0.25);
  });
});
