import { createHash } from "crypto";
import { describe, expect, it } from "vitest";

import * as liveBillingPeriods from "@/modules/manualUsage/billingPeriods";
import * as livePrefill from "@/modules/manualUsage/prefill";
import * as liveReadModel from "@/modules/manualUsage/readModel";
import * as liveStatementRanges from "@/modules/manualUsage/statementRanges";
import * as liveValidation from "@/modules/manualUsage/validation";
import * as forkBillingPeriods from "@/modules/onePathSim/manualBillingPeriods";
import * as forkPrefill from "@/modules/onePathSim/manualPrefill";
import * as forkReadModel from "@/modules/onePathSim/manualReadModel";
import * as forkStatementRanges from "@/modules/onePathSim/manualStatementRanges";
import * as forkValidation from "@/modules/onePathSim/manualValidation";
import type { ManualUsagePayload } from "@/modules/simulatedUsage/types";

function stableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("base64url").slice(0, 22);
}

function expectFacadeEqual<T>(live: T, fork: T) {
  expect(stableHash(fork)).toBe(stableHash(live));
  expect(fork).toEqual(live);
}

describe("onePathSim/manual* facade parity vs modules/manualUsage/*", () => {
  const monthlyPayload: ManualUsagePayload = {
    mode: "MONTHLY",
    anchorEndDate: "2026-05-31",
    monthlyKwh: [
      { month: "2026-04", kwh: 390 },
      { month: "2026-05", kwh: 420 },
    ],
    statementRanges: [
      { month: "2026-05", startDate: "2026-05-01", endDate: "2026-05-31" },
      { month: "2026-04", startDate: "2026-04-01", endDate: "2026-04-30" },
    ],
    travelRanges: [{ startDate: "2026-04-10", endDate: "2026-04-12" }],
  };

  const annualPayload: ManualUsagePayload = {
    mode: "ANNUAL",
    anchorEndDate: "2026-05-31",
    annualKwh: 5000,
    travelRanges: [{ startDate: "2026-04-10", endDate: "2026-04-12" }],
  };

  const partialMonthsPayload: ManualUsagePayload = {
    mode: "MONTHLY",
    anchorEndDate: "2026-05-31",
    monthlyKwh: [
      { month: "2026-05", kwh: 420 },
      { month: "2026-04", kwh: "" },
      { month: "2026-03", kwh: 300 },
    ],
    statementRanges: [
      { month: "2026-05", startDate: "2026-05-01", endDate: "2026-05-31" },
      { month: "2026-04", startDate: "2026-04-01", endDate: "2026-04-30" },
      { month: "2026-03", startDate: "2026-03-01", endDate: "2026-03-31" },
    ],
    travelRanges: [],
  };

  const missingMonthsPayload: ManualUsagePayload = {
    mode: "MONTHLY",
    anchorEndDate: "2026-05-31",
    monthlyKwh: [
      { month: "2026-05", kwh: 420 },
      { month: "2026-04", kwh: "" },
    ],
    statementRanges: [
      { month: "2026-05", startDate: "2026-05-01", endDate: "2026-05-31" },
      { month: "2026-04", startDate: "2026-04-01", endDate: "2026-04-30" },
    ],
    travelRanges: [],
  };

  const autoFilledPayload: ManualUsagePayload = {
    mode: "MONTHLY",
    anchorEndDate: "2026-05-31",
    monthlyKwh: [
      { month: "2026-05", kwh: 420 },
      { month: "2026-04", kwh: 390 },
    ],
    travelRanges: [],
  };

  it("matches monthly payload validation", () => {
    expectFacadeEqual(
      liveValidation.validateManualUsagePayload(monthlyPayload),
      forkValidation.validateManualUsagePayload(monthlyPayload)
    );
  });

  it("matches annual payload validation", () => {
    expectFacadeEqual(
      liveValidation.validateManualUsagePayload(annualPayload),
      forkValidation.validateManualUsagePayload(annualPayload)
    );
  });

  it("matches partial-month payload validation and bill-period targets", () => {
    expectFacadeEqual(
      liveValidation.validateManualUsagePayload(partialMonthsPayload),
      forkValidation.validateManualUsagePayload(partialMonthsPayload)
    );
    expectFacadeEqual(
      liveStatementRanges.buildManualBillPeriodTargets(partialMonthsPayload),
      forkStatementRanges.buildManualBillPeriodTargets(partialMonthsPayload)
    );
  });

  it("matches missing-month payload validation and bill-period targets", () => {
    expectFacadeEqual(
      liveValidation.validateManualUsagePayload(missingMonthsPayload),
      forkValidation.validateManualUsagePayload(missingMonthsPayload)
    );
    expectFacadeEqual(
      liveStatementRanges.buildManualBillPeriodTargets(missingMonthsPayload),
      forkStatementRanges.buildManualBillPeriodTargets(missingMonthsPayload)
    );
  });

  it("matches travel/vacant range normalization and annual travel exclusion", () => {
    expectFacadeEqual(
      liveStatementRanges.normalizeTravelRanges(monthlyPayload.travelRanges),
      forkStatementRanges.normalizeTravelRanges(monthlyPayload.travelRanges)
    );
    expectFacadeEqual(
      liveStatementRanges.buildManualBillPeriodTargets(annualPayload),
      forkStatementRanges.buildManualBillPeriodTargets(annualPayload)
    );
  });

  it("matches auto-filled statement ranges from monthly payload", () => {
    expectFacadeEqual(
      liveStatementRanges.deriveStatementRangesFromMonthlyPayload(autoFilledPayload),
      forkStatementRanges.deriveStatementRangesFromMonthlyPayload(autoFilledPayload)
    );
    expectFacadeEqual(
      liveStatementRanges.buildStatementRowsFromMonthlyPayload(autoFilledPayload),
      forkStatementRanges.buildStatementRowsFromMonthlyPayload(autoFilledPayload)
    );
  });

  it("matches monthly and annual statement range builders", () => {
    expectFacadeEqual(
      liveStatementRanges.buildManualBillPeriodTargets(monthlyPayload),
      forkStatementRanges.buildManualBillPeriodTargets(monthlyPayload)
    );
    expectFacadeEqual(
      liveStatementRanges.buildManualMonthlyStageOneRows(monthlyPayload),
      forkStatementRanges.buildManualMonthlyStageOneRows(monthlyPayload)
    );
    expectFacadeEqual(
      liveStatementRanges.buildManualAnnualStageOneSummary(annualPayload),
      forkStatementRanges.buildManualAnnualStageOneSummary(annualPayload)
    );
    expectFacadeEqual(
      liveBillingPeriods.billingPeriodsEndingAt("2026-05-31", 12),
      forkBillingPeriods.billingPeriodsEndingAt("2026-05-31", 12)
    );
  });

  it("matches manual read model shape for monthly and annual payloads", () => {
    const monthlyDataset = {
      meta: {
        filledMonths: [],
        manualMonthlyInputState: {
          inputKindByMonth: {
            "2026-04": "entered_nonzero",
            "2026-05": "entered_nonzero",
          },
        },
      },
      daily: [
        { date: "2026-04-01", kwh: 12 },
        { date: "2026-05-01", kwh: 13 },
      ],
    };
    const actualDataset = {
      daily: [
        { date: "2026-04-01", kwh: 11 },
        { date: "2026-05-01", kwh: 14 },
      ],
    };
    expectFacadeEqual(
      liveReadModel.buildManualUsageReadModel({
        payload: monthlyPayload,
        dataset: monthlyDataset,
        actualDataset,
      }),
      forkReadModel.buildManualUsageReadModel({
        payload: monthlyPayload,
        dataset: monthlyDataset,
        actualDataset,
      })
    );
    expectFacadeEqual(
      liveReadModel.buildManualUsageReadModel({
        payload: annualPayload,
        dataset: {
          meta: { filledMonths: [] },
          daily: [{ date: "2025-06-01", kwh: 5000 }],
        },
        actualDataset: { summary: { totalKwh: 4800 } },
      }),
      forkReadModel.buildManualUsageReadModel({
        payload: annualPayload,
        dataset: {
          meta: { filledMonths: [] },
          daily: [{ date: "2025-06-01", kwh: 5000 }],
        },
        actualDataset: { summary: { totalKwh: 4800 } },
      })
    );
  });

  it("matches shared prefill contract and admin interval-derived seeds", () => {
    const dailyRows = [
      { date: "2025-03-16", kwh: 10 },
      { date: "2025-03-17", kwh: 10 },
      { date: "2025-04-14", kwh: 20 },
      { date: "2025-04-15", kwh: 20 },
    ];
    const seedArgs = {
      sourcePayload: null,
      actualEndDate: "2025-04-15",
      travelRanges: [],
      dailyRows,
    };
    expectFacadeEqual(
      livePrefill.buildManualUsageStageOneResolvedSeeds(seedArgs),
      forkPrefill.buildManualUsageStageOneResolvedSeeds(seedArgs)
    );
    expectFacadeEqual(
      livePrefill.resolveSharedManualStageOneContract({
        mode: "MONTHLY",
        sourcePayload: null,
        testHomePayload: null,
        actualEndDate: "2025-04-15",
        travelRanges: [],
        dailyRows,
      }),
      forkPrefill.resolveSharedManualStageOneContract({
        mode: "MONTHLY",
        sourcePayload: null,
        testHomePayload: null,
        actualEndDate: "2025-04-15",
        travelRanges: [],
        dailyRows,
      })
    );
    expectFacadeEqual(
      livePrefill.resolveSharedManualStageOneContract({
        mode: "ANNUAL",
        sourcePayload: null,
        testHomePayload: null,
        actualEndDate: "2025-04-15",
        travelRanges: [],
        dailyRows,
      }),
      forkPrefill.resolveSharedManualStageOneContract({
        mode: "ANNUAL",
        sourcePayload: null,
        testHomePayload: null,
        actualEndDate: "2025-04-15",
        travelRanges: [],
        dailyRows,
      })
    );
    const liveMonthlySeed = livePrefill.deriveMonthlySeedFromActual({
      anchorEndDate: "2025-04-15",
      sourcePayload: null,
      travelRanges: [],
      dailyRows,
    });
    const forkMonthlySeed = forkPrefill.deriveMonthlySeedFromActual({
      anchorEndDate: "2025-04-15",
      sourcePayload: null,
      travelRanges: [],
      dailyRows,
    });
    expectFacadeEqual(liveMonthlySeed, forkMonthlySeed);
    expectFacadeEqual(
      livePrefill.deriveAnnualSeed({
        anchorEndDate: "2025-04-15",
        sourcePayload: null,
        travelRanges: [],
        dailyRows,
        monthlySeed: liveMonthlySeed,
      }),
      forkPrefill.deriveAnnualSeed({
        anchorEndDate: "2025-04-15",
        sourcePayload: null,
        travelRanges: [],
        dailyRows,
        monthlySeed: forkMonthlySeed,
      })
    );
  });
});
