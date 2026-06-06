import { describe, expect, it } from "vitest";

import {
  auditIntervalReadModelInvariants,
  auditUserAdminPastReadModelParity,
  auditUserUsageHouseContractParity,
} from "@/lib/usage/intervalReadModelInvariants";
import { buildOnePathRunReadOnlyViewFromBaselineContract } from "@/modules/onePathSim/baselineReadOnlyView";
import { buildOnePathRunReadOnlyView } from "@/modules/onePathSim/runReadOnlyView";
import { buildSimulationVariableCopyPayload } from "@/modules/onePathSim/simulationVariablePresentation";
import { buildUserUsageDashboardViewModel } from "@/lib/usage/userUsageDashboardViewModel";
import {
  buildUsageParityAudit,
  buildValidationTargetsSnapshot,
} from "@/lib/usage/usageParityAudit";

function buildActualParityHouseContract() {
  return {
    houseId: "house-1",
    label: "Home",
    dataset: {
      summary: {
        source: "GREEN_BUTTON",
        intervalsCount: 35040,
        totalKwh: 14094.9,
        start: "2025-05-14",
        end: "2026-05-13",
      },
      meta: {
        actualSource: "GREEN_BUTTON",
        timezone: "America/Chicago",
      },
      daily: [{ date: "2025-05-14", kwh: 38.6, source: "ACTUAL" }],
      monthly: [{ month: "2025-05", kwh: 1200 }],
      series: {
        intervals15: [
          { timestamp: "2025-05-14T12:00:00.000Z", kwh: 0.22 },
          { timestamp: "2025-05-14T12:15:00.000Z", kwh: 0.22 },
        ],
      },
      insights: {
        fifteenMinuteAverages: [{ hhmm: "07:00", avgKw: 0.88 }],
        weekdayVsWeekend: { weekday: 8000, weekend: 6094.9 },
        timeOfDayBuckets: [
          { key: "overnight", label: "Overnight", kwh: 2948.3 },
          { key: "morning", label: "Morning", kwh: 2888.4 },
          { key: "afternoon", label: "Afternoon", kwh: 3892.3 },
          { key: "evening", label: "Evening", kwh: 4365.8 },
        ],
        baseload: 0.22,
        baseloadDaily: 13.33,
        baseloadMonthly: 714.19,
        peakDay: { date: "2025-08-01", kwh: 62.1 },
        peakHour: { hour: 17, kw: 4.2 },
      },
      totals: { importKwh: 14094.9, exportKwh: 0, netKwh: 14094.9 },
    },
    weatherSensitivityScore: {
      scoringMode: "INTERVAL_BASED",
      weatherEfficiencyScore0to100: 48,
      coolingSensitivityScore0to100: 95,
      heatingSensitivityScore0to100: 79,
      confidenceScore0to100: 100,
    },
  } as const;
}

function buildPastParityDataset() {
  return {
    summary: {
      source: "GREEN_BUTTON",
      intervalsCount: 35036,
      totalKwh: 12971.6,
      start: "2025-06-04",
      end: "2026-06-03",
    },
    meta: {
      datasetKind: "SIMULATED",
      actualSource: "GREEN_BUTTON",
      timezone: "America/Chicago",
      weatherSensitivityScore: {
        weatherEfficiencyScore0to100: 48,
        coolingSensitivityScore0to100: 92,
        heatingSensitivityScore0to100: 82,
        confidenceScore0to100: 100,
      },
    },
    daily: [
      { date: "2025-06-04", kwh: 35.5, source: "ACTUAL" },
      { date: "2025-06-27", kwh: 12.1, source: "SIMULATED", sourceDetail: "SIMULATED (TRAVEL/VACANT)" },
    ],
    monthly: [{ month: "2025-06", kwh: 1100 }],
    series: {
      intervals15: [
        { timestamp: "2025-06-04T12:00:00.000Z", kwh: 0.5 },
        { timestamp: "2025-06-04T12:15:00.000Z", kwh: 0.5 },
      ],
    },
    insights: {
      fifteenMinuteAverages: [{ hhmm: "07:00", avgKw: 0.75 }],
      weekdayVsWeekend: { weekday: 7000, weekend: 5971.6 },
      timeOfDayBuckets: [
        { key: "overnight", label: "Overnight", kwh: 2702.6 },
        { key: "morning", label: "Morning", kwh: 2658.6 },
        { key: "afternoon", label: "Afternoon", kwh: 3577.7 },
        { key: "evening", label: "Evening", kwh: 4032.7 },
      ],
      baseload: 0.22,
    },
    totals: { importKwh: 12971.6, exportKwh: 0, netKwh: 12971.6 },
  };
}

describe("usage parity regression", () => {
  it("keeps Energy Usage, Simulator Usage, and Admin GB Baseline read models aligned", () => {
    const contract = buildActualParityHouseContract();
    const energyUsageVm = buildUserUsageDashboardViewModel(contract);
    const simulatorUsageVm = buildUserUsageDashboardViewModel(contract);
    const adminBaselineView = buildOnePathRunReadOnlyViewFromBaselineContract({ houseContract: contract as any });

    expect(energyUsageVm).not.toBeNull();
    expect(simulatorUsageVm).not.toBeNull();
    expect(adminBaselineView).not.toBeNull();

    const contractParity = auditUserUsageHouseContractParity({
      left: contract as any,
      right: contract as any,
    });
    expect(contractParity.ok).toBe(true);

    expect(adminBaselineView?.summary.totals.netKwh).toBe(energyUsageVm?.derived.totals.netKwh);
    expect(adminBaselineView?.summary.timeOfDayBuckets).toEqual(energyUsageVm?.derived.timeOfDayBuckets);
    expect(adminBaselineView?.weatherScore?.weatherEfficiencyScore0to100).toBe(48);
    expect(energyUsageVm?.displayTotals?.datasetTotalsNetKwh).toBe(14094.9);
  });

  it("keeps Usage Simulator Past and Admin GB Past read models aligned", () => {
    const dataset = {
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
      insights: {
        fifteenMinuteAverages: [{ hhmm: "12:00", avgKw: 1.2 }],
        weekdayVsWeekend: { weekday: 4, weekend: 0.1 },
        timeOfDayBuckets: [
          { key: "overnight", label: "Overnight", kwh: 1 },
          { key: "morning", label: "Morning", kwh: 1 },
          { key: "afternoon", label: "Afternoon", kwh: 1.1 },
          { key: "evening", label: "Evening", kwh: 1 },
        ],
      },
      meta: {
        datasetKind: "SIMULATED",
        actualSource: "GREEN_BUTTON",
        timezone: "America/Chicago",
        pastDisplayWeatherSensitivityScore: {
          scoringMode: "INTERVAL_BASED",
          weatherEfficiencyScore0to100: 48,
          coolingSensitivityScore0to100: 92,
          heatingSensitivityScore0to100: 82,
          confidenceScore0to100: 100,
          excludedSimulatedDayCount: 0,
        },
      },
    };
    const userVm = buildUserUsageDashboardViewModel({
      dataset,
      weatherSensitivityScore: (dataset.meta as { pastDisplayWeatherSensitivityScore: unknown })
        .pastDisplayWeatherSensitivityScore as never,
    });
    const adminView = buildOnePathRunReadOnlyView({ dataset, readModel: { compareProjection: { metrics: { wape: 16.73, mae: 9.5, rmse: 14.46 } } } });

    expect(userVm).not.toBeNull();
    expect(adminView).not.toBeNull();
    expect(adminView?.summary.timeOfDayBuckets).toEqual(userVm?.derived.timeOfDayBuckets);
    expect(adminView?.weatherScore?.coolingSensitivityScore0to100).toBe(92);
    expect(adminView?.weatherScore?.heatingSensitivityScore0to100).toBe(82);

    const parity = auditUserAdminPastReadModelParity({ dataset });
    expect(parity.ok, parity.violations.join("; ")).toBe(true);
  });

  it("rejects zero time-of-day buckets for interval-backed past usage", () => {
    const dataset = {
      ...buildPastParityDataset(),
      insights: {
        ...buildPastParityDataset().insights,
        timeOfDayBuckets: [
          { key: "overnight", label: "Overnight", kwh: 0 },
          { key: "morning", label: "Morning", kwh: 0 },
          { key: "afternoon", label: "Afternoon", kwh: 0 },
          { key: "evening", label: "Evening", kwh: 0 },
        ],
      },
    };
    const audit = auditIntervalReadModelInvariants({ dataset });
    expect(audit.ok).toBe(false);
    expect(audit.violations.some((v) => v.includes("time-of-day buckets are zero"))).toBe(true);
  });

  it("documents rounded monthly display totals separately from canonical totals", () => {
    const contract = buildActualParityHouseContract();
    const vm = buildUserUsageDashboardViewModel(contract);
    expect(vm?.displayTotals?.datasetTotalsNetKwh).toBe(14094.9);
    expect(vm?.displayTotals?.monthlyDisplayRowsAreRounded).toBe(true);
    expect(vm?.displayTotals?.monthlyRawTotalKwh).toBe(1200);
  });

  it("includes parityAudit, performanceAudit, and validationTargets in AI payload when includeSimRunAudit is true", () => {
    const contract = buildActualParityHouseContract();
    const pastDataset = buildPastParityDataset();
    const payload = buildSimulationVariableCopyPayload({
      mode: "GREEN_BUTTON",
      response: { familyMeta: {}, defaults: {}, effectiveByMode: { GREEN_BUTTON: {} }, overrides: {} },
      includeSimRunAudit: true,
      loadedSourceContext: { userUsagePageBaselineContract: contract },
      readModel: {
        dataset: pastDataset,
        compareProjection: { metrics: { wape: 16.73, mae: 9.5, rmse: 14.46 } },
        performanceAudit: {
          totalDurationMs: 1200,
          stageDurationsMs: { adapt_green_button_raw_input: 120 },
        },
      },
      runDisplayView: buildOnePathRunReadOnlyView({
        dataset: pastDataset,
        readModel: { compareProjection: { metrics: { wape: 16.73, mae: 9.5, rmse: 14.46 } } },
      }) as any,
      sandboxSummary: { runStatus: { runType: "PAST_SIM" } },
      engineInput: { inputType: "GREEN_BUTTON", scenarioId: "past-1" },
    } as any);

    expect((payload.aiPayloadMeta as any).includesDashboardViewModel).toBe(true);
    expect((payload.aiPayloadMeta as any).includesParitySections).toBe(true);
    expect(payload).toHaveProperty("parityAudit");
    expect(payload).toHaveProperty("performanceAudit");
    expect(payload).toHaveProperty("validationTargets");
    expect((payload.validationTargets as any).wape.pass).toBe(false);
    expect((payload.validationTargets as any).mae.pass).toBe(true);
    expect((payload.validationTargets as any).rmse.pass).toBe(true);
  });

  it("builds parity audit snapshots with aligned actual surfaces", () => {
    const contract = buildActualParityHouseContract();
    const audit = buildUsageParityAudit({
      userUsagePageBaselineContract: contract as any,
      runDisplayView: buildOnePathRunReadOnlyViewFromBaselineContract({ houseContract: contract as any }),
    });
    expect(audit.actualUserVsSimulatorUsage.pass).toBe(true);
    expect(audit.actualUserVsAdminBaseline.pass).toBe(true);
  });

  it("exposes validation pass/fail without tuning WAPE thresholds", () => {
    const targets = buildValidationTargetsSnapshot({ wape: 16.73, mae: 9.5, rmse: 14.46 });
    expect(targets.wape).toEqual({ actual: 16.73, max: 15, pass: false });
    expect(targets.mae.pass).toBe(true);
    expect(targets.rmse.pass).toBe(true);
  });
});
