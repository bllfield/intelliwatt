import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { dailyRowFieldsFromSourceRow } from "@/modules/usageSimulator/dailyRowFieldsFromDisplay";
import { shouldResetPastValidationCompareExpanded } from "@/modules/usageSimulator/pastCompareUiDefaults";
import { buildValidationCompareDisplay } from "@/components/usage/validationCompareDisplay";
import { resolvePastCompareSectionMode } from "@/components/usage/pastCompareSectionMode";
import { buildWeekdayWeekendBreakdownNote } from "@/components/usage/readoutTruth";
import {
  buildActualDiagnosticsHeaderReadout,
  buildNonValidationSimulatedBaselineReadout,
  buildPersistedHouseReadout,
  buildStageTimingReadout,
  formatIdentityReadout,
} from "@/app/admin/tools/gapfill-lab/readoutTruth";
import { buildSimulatorInputs } from "@/modules/usageSimulator/build";
import {
  buildSourceDerivedMonthlyTargetResolution,
  type MonthlyTargetConstructionDiagnostic,
  resolveManualMonthlyAnchorEndDateKey,
  resolveManualMonthlyTargetDiagnostics,
} from "@/modules/usageSimulator/monthlyTargetConstruction";
import { buildPastSimPerDayTrace } from "@/modules/usageSimulator/pastSimLockbox";
import { buildSharedPastSimDiagnostics } from "@/modules/usageSimulator/sharedDiagnostics";

vi.mock("server-only", () => ({}));

const {
  cookiesMock,
  prisma,
  getSimulatedUsageForHouseScenario,
  buildValidationCompareProjectionSidecar,
} = vi.hoisted(() => ({
  cookiesMock: vi.fn(),
  prisma: {
    user: { findUnique: vi.fn() },
    manualUsageInput: { findUnique: vi.fn() },
  } as any,
  getSimulatedUsageForHouseScenario: vi.fn(),
  buildValidationCompareProjectionSidecar: vi.fn((dataset: any) => ({
    rows: Array.isArray(dataset?.meta?.validationCompareRows) ? dataset.meta.validationCompareRows : [],
    metrics:
      dataset?.meta?.validationCompareMetrics && typeof dataset.meta.validationCompareMetrics === "object"
        ? dataset.meta.validationCompareMetrics
        : {},
  })),
}));

vi.mock("next/headers", () => ({
  cookies: () => cookiesMock(),
}));

vi.mock("@/lib/db", () => ({ prisma }));

vi.mock("@/modules/usageSimulator/service", () => ({
  getSimulatedUsageForHouseScenario: (...args: any[]) => getSimulatedUsageForHouseScenario(...args),
}));
vi.mock("@/modules/usageSimulator/compareProjection", () => ({
  buildValidationCompareProjectionSidecar: (dataset: any) => buildValidationCompareProjectionSidecar(dataset),
}));

vi.mock("@/lib/usage/resolveIntervalsLayer", () => ({
  resolveIntervalsLayer: vi.fn(),
}));

vi.mock("@/modules/usageShapeProfile/autoBuild", () => ({
  ensureUsageShapeProfileForUserHouse: vi.fn(),
}));

describe("user simulated house compare projection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cookiesMock.mockReturnValue({
      get: (name: string) =>
        name === "intelliwatt_user" ? { value: "brian@intellipath-solutions.com" } : undefined,
    });
    prisma.user.findUnique.mockResolvedValue({ id: "u1" });
    prisma.manualUsageInput.findUnique.mockResolvedValue(null);
    getSimulatedUsageForHouseScenario.mockResolvedValue({
      ok: true,
      houseId: "h1",
      scenarioKey: "past-s1",
      scenarioId: "past-s1",
      dataset: {
        summary: { source: "SIMULATED" },
        meta: {
          validationCompareRows: [
            {
              localDate: "2025-04-10",
              dayType: "weekday",
              actualDayKwh: 10,
              simulatedDayKwh: 9,
              errorKwh: -1,
              percentError: 10,
              weather: {
                tAvgF: 62,
                tMinF: 55,
                tMaxF: 70,
                hdd65: 3,
                cdd65: 1,
                source: "actual_cached",
                weatherMissing: false,
              },
            },
          ],
          validationCompareMetrics: { wape: 10, mae: 1, rmse: 1 },
        },
      },
    });
  });

  it("Past validation compare: reset predicate runs on entering Past tab, not when leaving", () => {
    expect(shouldResetPastValidationCompareExpanded("PAST")).toBe(true);
    expect(shouldResetPastValidationCompareExpanded("BASELINE")).toBe(false);
    expect(shouldResetPastValidationCompareExpanded("FUTURE")).toBe(false);
  });

  it("derived daily fallback: preserves ACTUAL source and sourceDetail from series-shaped rows", () => {
    expect(
      dailyRowFieldsFromSourceRow({
        date: "2026-01-02",
        kwh: 12,
        source: "ACTUAL",
        sourceDetail: "ACTUAL",
      })
    ).toEqual({
      date: "2026-01-02",
      kwh: 12,
      source: "ACTUAL",
      sourceDetail: "ACTUAL",
    });
  });

  it("derived daily fallback: preserves SIMULATED source and sourceDetail from series-shaped rows", () => {
    expect(
      dailyRowFieldsFromSourceRow({
        date: "2026-01-03",
        kwh: 4,
        source: "SIMULATED",
        sourceDetail: "SIMULATED_TRAVEL_VACANT",
      })
    ).toEqual({
      date: "2026-01-03",
      kwh: 4,
      source: "SIMULATED",
      sourceDetail: "SIMULATED_TRAVEL_VACANT",
    });
  });

  it("derived daily fallback: preserves projected validation ACTUAL_VALIDATION_TEST_DAY labeling", () => {
    expect(
      dailyRowFieldsFromSourceRow({
        date: "2026-01-01",
        kwh: 0.5,
        source: "ACTUAL",
        sourceDetail: "ACTUAL_VALIDATION_TEST_DAY",
      })
    ).toEqual({
      date: "2026-01-01",
      kwh: 0.5,
      source: "ACTUAL",
      sourceDetail: "ACTUAL_VALIDATION_TEST_DAY",
    });
  });

  it("returns compareProjection sidecar from canonical dataset family", async () => {
    const { GET } = await import("@/app/api/user/usage/simulated/house/route");
    const req = new NextRequest(
      "http://localhost/api/user/usage/simulated/house?houseId=h1&scenarioId=past-s1"
    );
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.compareProjection?.rows)).toBe(true);
    expect(body.compareProjection.rows[0]?.localDate).toBe("2025-04-10");
    expect(body.compareProjection.rows[0]?.weather?.tAvgF).toBe(62);
    expect(body.compareProjection.rows[0]?.weather?.weatherMissing).toBe(false);
    expect(body.compareProjection.metrics?.wape).toBe(10);
    expect(body.sharedDiagnostics?.identityContext?.callerType).toBe("user_past");
    expect(body.sharedDiagnostics?.projectionReadSummary?.validationRowsCount).toBe(1);
    expect(buildValidationCompareProjectionSidecar).toHaveBeenCalledTimes(1);
  });

  it("returns manual monthly statement-range reconciliation for monthly-manual Past runs", async () => {
    prisma.manualUsageInput.findUnique.mockResolvedValueOnce({
      payload: {
        mode: "MONTHLY",
        anchorEndDate: "2025-04-30",
        monthlyKwh: [{ month: "2025-04", kwh: 300 }],
        travelRanges: [],
      },
      updatedAt: new Date("2025-05-01T00:00:00.000Z"),
    });
    getSimulatedUsageForHouseScenario.mockResolvedValueOnce({
      ok: true,
      houseId: "h1",
      scenarioKey: "past-s1",
      scenarioId: "past-s1",
      dataset: {
        summary: { source: "SIMULATED" },
        meta: {
          mode: "MANUAL_TOTALS",
          manualMonthlyInputState: {
            enteredMonthKeys: ["2025-04"],
            missingMonthKeys: [
              "2024-05",
              "2024-06",
              "2024-07",
              "2024-08",
              "2024-09",
              "2024-10",
              "2024-11",
              "2024-12",
              "2025-01",
              "2025-02",
              "2025-03",
            ],
            explicitZeroMonthKeys: [],
            inputKindByMonth: {
              "2025-04": "entered_nonzero",
            },
          },
          filledMonths: [],
          validationCompareRows: [],
          validationCompareMetrics: {},
        },
        daily: Array.from({ length: 30 }, (_, idx) => ({
          date: `2025-04-${String(idx + 1).padStart(2, "0")}`,
          kwh: 10,
          source: "SIMULATED",
        })),
        monthly: [{ month: "2025-04", kwh: 300 }],
        series: { intervals15: [] },
      },
    });

    const { GET } = await import("@/app/api/user/usage/simulated/house/route");
    const req = new NextRequest("http://localhost/api/user/usage/simulated/house?houseId=h1&scenarioId=past-s1");
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.manualMonthlyReconciliation?.eligibleRangeCount).toBe(1);
    const aprilRow = body.manualMonthlyReconciliation?.rows?.find((row: any) => row.month === "2025-04");
    expect(aprilRow).toMatchObject({
      eligible: true,
      enteredStatementTotalKwh: 300,
      simulatedStatementTotalKwh: 300,
      deltaKwh: 0,
      status: "reconciled",
    });
  });

  it("shared compare display builder reuses sidecar rows for user and gapfill presentation", () => {
    const display = buildValidationCompareDisplay({
      compareProjection: {
        rows: [
          {
            localDate: "2025-04-10",
            dayType: "weekday",
            actualDayKwh: 10,
            freshCompareSimDayKwh: 9,
            actualVsFreshErrorKwh: -1,
            percentError: 10,
            weather: {
              tAvgF: 62,
              tMinF: 55,
              tMaxF: 70,
              hdd65: 3,
              cdd65: 1,
              source: "actual_cached",
              weatherMissing: false,
            },
          },
        ],
        metrics: { wape: 10, mae: 1, rmse: 1 },
      },
      dataset: {
        meta: {
          validationCompareRows: [],
          validationCompareMetrics: {},
        },
      },
    });

    expect(display.rows).toEqual([
      {
        localDate: "2025-04-10",
        dayType: "weekday",
        actualDayKwh: 10,
        simulatedDayKwh: 9,
        errorKwh: -1,
        percentError: 10,
        weather: {
          tAvgF: 62,
          tMinF: 55,
          tMaxF: 70,
          hdd65: 3,
          cdd65: 1,
          source: "actual_cached",
          weatherMissing: false,
        },
      },
    ]);
    expect(display.metrics).toMatchObject({ wape: 10, mae: 1, rmse: 1 });
  });

  it("shared compare display builder falls back to persisted dataset compare truth", () => {
    const display = buildValidationCompareDisplay({
      compareProjection: null,
      dataset: {
        meta: {
          validationCompareRows: [
            {
              localDate: "2025-04-11",
              dayType: "weekend",
              actualDayKwh: 11,
              simulatedDayKwh: 10,
              errorKwh: -1,
              percentError: 9.09,
            },
          ],
          validationCompareMetrics: { wape: 9.09, mae: 1, rmse: 1 },
        },
      },
    });

    expect(display.rows[0]).toMatchObject({
      localDate: "2025-04-11",
      dayType: "weekend",
      actualDayKwh: 11,
      simulatedDayKwh: 10,
      errorKwh: -1,
      percentError: 9.09,
    });
    expect(display.metrics).toMatchObject({ wape: 9.09, mae: 1, rmse: 1 });
  });

  it("switches monthly-manual Past display semantics to statement-range reconciliation only when reconciliation rows exist", () => {
    expect(resolvePastCompareSectionMode({ manualMonthlyReconciliation: null })).toBe("validation_compare");
    expect(
      resolvePastCompareSectionMode({
        manualMonthlyReconciliation: {
          anchorEndDate: "2025-04-30",
          eligibleRangeCount: 1,
          ineligibleRangeCount: 0,
          reconciledRangeCount: 1,
          deltaPresentRangeCount: 0,
          rows: [
            {
              month: "2025-04",
              startDate: "2025-04-01",
              endDate: "2025-04-30",
              inputKind: "entered_nonzero",
              enteredStatementTotalKwh: 300,
              simulatedStatementTotalKwh: 300,
              deltaKwh: 0,
              eligible: true,
              status: "reconciled",
              reason: null,
            },
          ],
        },
      })
    ).toBe("statement_range_reconciliation");
  });

  it("actual-house diagnostics header falls back to persisted shared read fields", () => {
    const readout = buildActualDiagnosticsHeaderReadout({
      pastSimSnapshot: {
        recalc: { executionMode: "inline", correlationId: "corr-1" },
        build: { mode: "ACTUAL_INTERVAL_BASELINE", buildInputsHash: "build-hash-1" },
        sharedDiagnostics: {
          sourceTruthContext: {
            weatherDatasetIdentity: "wx-shared",
            intervalSourceIdentity: "ifp-shared",
          },
        },
      },
      actualHouseBaselineDataset: {
        meta: {
          lockboxInput: {
            sourceContext: {
              weatherIdentity: "wx-dataset",
              intervalFingerprint: "ifp-dataset",
            },
          },
        },
      },
    });

    expect(readout.recalcExecutionMode).toBe("inline");
    expect(readout.recalcCorrelationId).toBe("corr-1");
    expect(readout.buildMode).toBe("ACTUAL_INTERVAL_BASELINE");
    expect(readout.weatherIdentity).toBe("wx-shared");
    expect(readout.intervalFingerprint).toBe("ifp-shared");
  });

  it("prefers shared actual-house diagnostics for persisted top-summary fields", () => {
    const readout = buildPersistedHouseReadout({
      dataset: {
        meta: {
          lockboxInput: {
            mode: "",
            sourceContext: {
              sourceHouseId: "",
              intervalFingerprint: "",
              weatherIdentity: "",
            },
            travelRanges: {
              ranges: [],
            },
            validationKeys: {
              localDateKeys: [],
            },
          },
          lockboxPerRunTrace: {
            inputHash: "",
            fullChainHash: "",
          },
        },
      },
      sharedDiagnostics: {
        identityContext: {
          sourceHouseId: "source-house-1",
          profileHouseId: "profile-house-1",
          simulatorMode: "ACTUAL_INTERVAL_BASELINE",
          inputHash: "input-hash-1",
          fullChainHash: "full-chain-hash-1",
        },
        sourceTruthContext: {
          travelRangesUsed: [{ startDate: "2025-04-01", endDate: "2025-04-03" }],
          validationTestKeysUsed: ["2025-04-10"],
          intervalSourceIdentity: "ifp-shared",
          weatherDatasetIdentity: "wx-shared",
        },
        lockboxExecutionSummary: {
          artifactEngineVersion: "engine-v1",
        },
        projectionReadSummary: {
          validationRowsCount: 2,
        },
      },
      compareProjection: {
        rows: [{ localDate: "2025-04-10" }],
      },
    });

    expect(readout).toMatchObject({
      sourceHouseId: "source-house-1",
      profileHouseId: "profile-house-1",
      mode: "ACTUAL_INTERVAL_BASELINE",
      intervalFingerprint: "ifp-shared",
      weatherIdentity: "wx-shared",
      inputHash: "input-hash-1",
      fullChainHash: "full-chain-hash-1",
      artifactEngineVersion: "engine-v1",
      compareRowsCount: "2",
    });
    expect(readout.travelRanges).toContain("2025-04-01 -> 2025-04-03");
    expect(readout.validationKeys).toContain("2025-04-10");
  });

  it("truthfully marks blank identities and zeroed artifact-only timings as unavailable", () => {
    expect(formatIdentityReadout("")).toBe("unavailable");
    expect(
      buildStageTimingReadout({
        stageTimings: [
          ["loadIntervals", 0],
          ["simulateDays", 0],
        ],
        artifactReadMode: "artifact_only",
      })
    ).toEqual({
      rows: [],
      emptyMessage: "Not available on artifact-only read.",
    });
  });

  it("truthfully relabels non-validation simulated baseline counts", () => {
    const readout = buildNonValidationSimulatedBaselineReadout({
      diagnosticsVerdict: {
        travelVacantSimulatedDatesInBaselineCount: 77,
      },
      sharedDiagnostics: {
        tuningSummary: {
          sourceDetailCountsByCategory: {
            SIMULATED_TRAVEL_VACANT: 69,
            SIMULATED_INCOMPLETE_METER: 8,
          },
        },
      },
    });

    expect(readout.label).toBe("nonValidationSimulatedDatesInBaselineCount");
    expect(readout.value).toBe("77");
    expect(readout.detail).toContain("travel/vacant=69");
    expect(readout.detail).toContain("incomplete meter=8");
  });

  it("clarifies when weekday/weekend breakdown totals differ from the summary total", () => {
    expect(
      buildWeekdayWeekendBreakdownNote({
        weekdayKwh: 10000,
        weekendKwh: 5259.3,
        summaryTotalKwh: 15196,
      })
    ).toBe(
      "Breakdown total 15259.3 kWh comes from the persisted weekday/weekend analytics buckets and may differ from the summary net-usage total 15196.0 kWh."
    );
  });

  it("builds travel-aware shared monthly anchors from non-travel source days", () => {
    const resolution = buildSourceDerivedMonthlyTargetResolution({
      canonicalMonths: ["2025-03"],
      anchorEndDate: "2025-03-31",
      dailyKwhByDateKey: {
        "2025-03-01": 10,
        "2025-03-02": 12,
        "2025-03-03": 14,
        "2025-03-04": 16,
        "2025-03-05": 18,
        "2025-03-10": 80,
        "2025-03-11": 90,
      },
      travelRanges: [{ startDate: "2025-03-10", endDate: "2025-03-11" }],
      fallbackMonthlyKwhByMonth: { "2025-03": 250 },
    });

    expect(resolution.monthlyKwhByMonth["2025-03"]).toBe(434);
    expect(resolution.trustedMonthlyAnchorsByMonth["2025-03"]).toBe(434);
    expect(resolution.diagnostics).toEqual([
      {
        month: "2025-03",
        rawMonthKwhFromSource: 240,
        travelVacantDayCountInMonth: 2,
        eligibleNonTravelDayCount: 5,
        eligibleNonTravelKwhTotal: 70,
        nonTravelDailyAverage: 14,
        normalizedMonthTarget: 434,
        monthlyTargetBuildMethod: "normalized_from_non_travel_days",
        trustedMonthlyAnchorUsed: true,
      },
    ]);
  });

  it("resolves legacy monthly manual billEndDay into the authoritative anchored end date", () => {
    expect(
      resolveManualMonthlyAnchorEndDateKey({
        anchorEndMonth: "2025-04",
        billEndDay: 15,
      })
    ).toBe("2025-04-15");
  });

  it("assigns month-edge source days to the anchored monthly manual period, not plain calendar months", () => {
    const resolution = buildSourceDerivedMonthlyTargetResolution({
      canonicalMonths: ["2025-03", "2025-04"],
      anchorEndDate: "2025-04-15",
      dailyKwhByDateKey: {
        "2025-03-31": 10,
        "2025-04-01": 20,
        "2025-04-02": 30,
        "2025-04-03": 40,
        "2025-04-04": 50,
      },
      travelRanges: [],
      fallbackMonthlyKwhByMonth: { "2025-03": 111, "2025-04": 222 },
    });

    expect(resolution.diagnostics[0]).toMatchObject({
      month: "2025-03",
      rawMonthKwhFromSource: null,
      trustedMonthlyAnchorUsed: false,
    });
    expect(resolution.diagnostics[1]).toMatchObject({
      month: "2025-04",
      rawMonthKwhFromSource: 150,
      eligibleNonTravelDayCount: 5,
      monthlyTargetBuildMethod: "normalized_from_non_travel_days",
      trustedMonthlyAnchorUsed: true,
    });
    expect(resolution.monthlyKwhByMonth["2025-04"]).toBe(930);
  });

  it("falls back to shared pool simulation when a source month lacks enough non-travel days", async () => {
    const canonicalMonths = [
      "2024-06",
      "2024-07",
      "2024-08",
      "2024-09",
      "2024-10",
      "2024-11",
      "2024-12",
      "2025-01",
      "2025-02",
      "2025-03",
      "2025-04",
      "2025-05",
    ];
    const resolution = buildSourceDerivedMonthlyTargetResolution({
      canonicalMonths: ["2025-04"],
      anchorEndDate: "2025-04-30",
      dailyKwhByDateKey: {
        "2025-04-01": 10,
        "2025-04-02": 11,
        "2025-04-03": 12,
        "2025-04-04": 13,
      },
      travelRanges: [{ startDate: "2025-04-03", endDate: "2025-04-04" }],
      fallbackMonthlyKwhByMonth: { "2025-04": 321.45 },
    });

    const built = await buildSimulatorInputs({
      mode: "MANUAL_TOTALS",
      manualUsagePayload: {
        mode: "MONTHLY",
        anchorEndDate: "2025-05-31",
        monthlyKwh: [{ month: "2025-04", kwh: 999 }],
        travelRanges: [],
      },
      manualMonthlySourceDerivedResolution: resolution,
      homeProfile: {} as any,
      applianceProfile: { fuelConfiguration: {} } as any,
      canonicalMonths,
    });

    expect(built.monthlyTotalsKwhByMonth["2025-04"]).toBe(321.45);
    expect(built.sourceDerivedTrustedMonthlyTotalsKwhByMonth).toBeNull();
    expect(
      (built.monthlyTargetConstructionDiagnostics as MonthlyTargetConstructionDiagnostic[]).find(
        (row) => row.month === "2025-04"
      )
    ).toEqual({
      month: "2025-04",
      rawMonthKwhFromSource: 46,
      travelVacantDayCountInMonth: 2,
      eligibleNonTravelDayCount: 2,
      eligibleNonTravelKwhTotal: 21,
      nonTravelDailyAverage: null,
      normalizedMonthTarget: null,
      monthlyTargetBuildMethod: "insufficient_non_travel_days_fallback_to_pool_sim",
      trustedMonthlyAnchorUsed: false,
    });
    expect(built.notes.join(" ")).toContain("fewer than 5 eligible non-travel days");
  });

  it("keeps explicit user monthly MANUAL_TOTALS values as manual and surfaces truthful diagnostics", async () => {
    const canonicalMonths = [
      "2024-06",
      "2024-07",
      "2024-08",
      "2024-09",
      "2024-10",
      "2024-11",
      "2024-12",
      "2025-01",
      "2025-02",
      "2025-03",
      "2025-04",
      "2025-05",
    ];
    const built = await buildSimulatorInputs({
      mode: "MANUAL_TOTALS",
      manualUsagePayload: {
        mode: "MONTHLY",
        anchorEndDate: "2025-05-31",
        monthlyKwh: [{ month: "2025-05", kwh: 456 }],
        travelRanges: [],
      },
      homeProfile: {} as any,
      applianceProfile: { fuelConfiguration: {} } as any,
      canonicalMonths,
    });

    expect(built.monthlyTotalsKwhByMonth["2025-05"]).toBe(456);
    const mayRow = (built.monthlyTargetConstructionDiagnostics as MonthlyTargetConstructionDiagnostic[]).find(
      (row) => row.month === "2025-05"
    );
    expect(mayRow).toMatchObject({
      month: "2025-05",
      monthlyTargetBuildMethod: "user_manual_month_value",
      trustedMonthlyAnchorUsed: true,
    });
    expect(built.sourceDerivedTrustedMonthlyTotalsKwhByMonth).toBeNull();
  });

  it("preserves blank vs explicit zero in Stage 1 manual monthly state and fills missing months later", async () => {
    const canonicalMonths = [
      "2025-03",
      "2025-04",
      "2025-05",
      "2025-06",
      "2025-07",
      "2025-08",
      "2025-09",
      "2025-10",
      "2025-11",
      "2025-12",
      "2026-01",
      "2026-02",
    ];
    const resolution = resolveManualMonthlyTargetDiagnostics({
      payload: {
        mode: "MONTHLY",
        anchorEndDate: "2025-05-31",
        monthlyKwh: [
          { month: "2025-03", kwh: 0 },
          { month: "2025-05", kwh: 456 },
        ],
        travelRanges: [],
      },
      canonicalMonths,
    });

    expect(resolution.monthlyKwhByMonth).toEqual({
      "2025-03": 0,
      "2025-05": 456,
    });
    expect(resolution.manualMonthlyInputState).toEqual({
      enteredMonthKeys: ["2025-03", "2025-05"],
      missingMonthKeys: [
        "2025-04",
        "2025-06",
        "2025-07",
        "2025-08",
        "2025-09",
        "2025-10",
        "2025-11",
        "2025-12",
        "2026-01",
        "2026-02",
      ],
      explicitZeroMonthKeys: ["2025-03"],
      inputKindByMonth: {
        "2025-03": "entered_zero",
        "2025-04": "missing",
        "2025-05": "entered_nonzero",
        "2025-06": "missing",
        "2025-07": "missing",
        "2025-08": "missing",
        "2025-09": "missing",
        "2025-10": "missing",
        "2025-11": "missing",
        "2025-12": "missing",
        "2026-01": "missing",
        "2026-02": "missing",
      },
    });
    expect(
      (resolution.diagnostics as MonthlyTargetConstructionDiagnostic[]).find((row) => row.month === "2025-04")
    ).toMatchObject({
      month: "2025-04",
      monthlyTargetBuildMethod: "missing_user_manual_month_fill_later",
      trustedMonthlyAnchorUsed: false,
    });

    const built = await buildSimulatorInputs({
      mode: "MANUAL_TOTALS",
      manualUsagePayload: {
        mode: "MONTHLY",
        anchorEndDate: "2025-05-31",
        monthlyKwh: [
          { month: "2025-03", kwh: 0 },
          { month: "2025-05", kwh: 456 },
        ],
        travelRanges: [],
      },
      homeProfile: {} as any,
      applianceProfile: { fuelConfiguration: {} } as any,
      canonicalMonths,
    });

    expect(built.manualMonthlyInputState).toEqual(resolution.manualMonthlyInputState);
    expect(built.filledMonths).toEqual([
      "2025-04",
      "2025-06",
      "2025-07",
      "2025-08",
      "2025-09",
      "2025-10",
      "2025-11",
      "2025-12",
      "2026-01",
      "2026-02",
    ]);
    expect(Object.prototype.hasOwnProperty.call(built.monthlyTotalsKwhByMonth, "2025-04")).toBe(true);
    expect(built.monthlyTotalsKwhByMonth["2025-03"]).toBe(0);
    expect(built.monthlyTotalsKwhByMonth["2025-05"]).toBe(456);
  });

  it("surfaces shared monthly target construction diagnostics on the read side", () => {
    const sharedDiagnostics = buildSharedPastSimDiagnostics({
      callerType: "user_past",
      dataset: {
        meta: {
          monthlyTargetConstructionDiagnostics: [
            {
              month: "2025-03",
              rawMonthKwhFromSource: 240,
              travelVacantDayCountInMonth: 2,
              eligibleNonTravelDayCount: 5,
              eligibleNonTravelKwhTotal: 70,
              nonTravelDailyAverage: 14,
              normalizedMonthTarget: 434,
              monthlyTargetBuildMethod: "normalized_from_non_travel_days",
              trustedMonthlyAnchorUsed: true,
            },
          ],
        },
      },
      scenarioId: "past-s1",
      compareProjection: null,
      readMode: "artifact_only",
      projectionMode: "baseline",
    });

    expect(sharedDiagnostics.sourceTruthContext.monthlyTargetConstructionDiagnostics).toEqual([
      {
        month: "2025-03",
        rawMonthKwhFromSource: 240,
        travelVacantDayCountInMonth: 2,
        eligibleNonTravelDayCount: 5,
        eligibleNonTravelKwhTotal: 70,
        nonTravelDailyAverage: 14,
        normalizedMonthTarget: 434,
        monthlyTargetBuildMethod: "normalized_from_non_travel_days",
        trustedMonthlyAnchorUsed: true,
      },
    ]);
    expect(sharedDiagnostics.sourceTruthContext.manualMonthlyInputState).toEqual({});
  });

  it("surfaces monthly constrained interval fingerprint diagnostics on the read side", () => {
    const sharedDiagnostics = buildSharedPastSimDiagnostics({
      callerType: "gapfill_test",
      dataset: {
        meta: {
          lockboxInput: {
            sourceContext: {},
            profileContext: {
              usageShapeProfileIdentity: "fp_123",
            },
            travelRanges: { ranges: [{ startDate: "2025-06-10", endDate: "2025-06-12" }] },
            validationKeys: { localDateKeys: [] },
          },
          trustedIntervalFingerprintDayCount: 22,
          excludedTravelVacantFingerprintDayCount: 3,
          excludedIncompleteMeterFingerprintDayCount: 1,
          excludedLeadingMissingFingerprintDayCount: 2,
          excludedOtherUntrustedFingerprintDayCount: 0,
          fingerprintMonthBucketsUsed: ["2025-06"],
          fingerprintWeekdayWeekendBucketsUsed: ["weekday", "weekend"],
          fingerprintWeatherBucketsUsed: ["heating", "neutral"],
          fingerprintShapeSummaryByMonthDayType: {
            "2025-06": {
              weekday: { overnight: 0.18, morning: 0.2, afternoon: 0.31, evening: 0.31 },
            },
          },
        },
      },
      scenarioId: "past-s1",
      compareProjection: null,
      readMode: "artifact_only",
      projectionMode: "baseline",
    });

    expect(sharedDiagnostics.sourceTruthContext.intervalUsageFingerprintIdentity).toBe("fp_123");
    expect(sharedDiagnostics.sourceTruthContext.intervalUsageFingerprintDiagnostics).toMatchObject({
      trustedIntervalFingerprintDayCount: 22,
      excludedTravelVacantFingerprintDayCount: 3,
      fingerprintMonthBucketsUsed: ["2025-06"],
    });
    expect(sharedDiagnostics.tuningSummary.fingerprintShapeSummaryByMonthDayType).toMatchObject({
      "2025-06": {
        weekday: { overnight: 0.18, morning: 0.2, afternoon: 0.31, evening: 0.31 },
      },
    });
  });

  it("preserves monthly constrained per-day template provenance in lockbox trace rows", () => {
    const trace = buildPastSimPerDayTrace([
      {
        localDate: "2025-06-15",
        source: "simulated_vacant_day",
        simulatedReasonCode: "MONTHLY_CONSTRAINED_NON_TRAVEL_DAY",
        intervals: [],
        intervals15: [],
        intervalSumKwh: 41.2,
        displayDayKwh: 41.2,
        rawDayKwh: 35,
        weatherAdjustedDayKwh: 39,
        profileSelectedDayKwh: 35,
        finalDayKwh: 41.2,
        weatherSeverityMultiplier: 1.12,
        weatherModeUsed: "cooling",
        auxHeatKwhAdder: 0,
        poolFreezeProtectKwhAdder: 0,
        dayClassification: "weather_scaled_day",
        fallbackLevel: "month_daytype_neighbor",
        clampApplied: false,
        shape96Used: Array.from({ length: 96 }, () => 1 / 96),
        dayTypeUsed: "weekday",
        weatherRegimeUsed: "cooling",
        shapeVariantUsed: "month_weekday_weather_cooling",
        templateSelectionKind: "monthly_manual_constrained_shared_day_template",
        selectedFingerprintBucketMonth: "2025-06",
        selectedFingerprintBucketDayType: "weekday",
        selectedFingerprintWeatherBucket: "cooling",
        selectedFingerprintIdentity: "fp_123",
        selectedReferencePoolCount: 7,
        weatherScalingCoefficientUsed: 1.12,
        dayTotalBeforeWeatherScale: 35,
        dayTotalAfterWeatherScale: 39,
        intervalShapeScalingMethod: "shape_variant:month_weekday_weather_cooling",
      },
    ]);

    expect(trace[0]).toMatchObject({
      simulatedReasonCode: "MONTHLY_CONSTRAINED_NON_TRAVEL_DAY",
      templateSelectionKind: "monthly_manual_constrained_shared_day_template",
      selectedFingerprintBucketMonth: "2025-06",
      selectedFingerprintBucketDayType: "weekday",
      selectedFingerprintWeatherBucket: "cooling",
      selectedFingerprintIdentity: "fp_123",
      selectedReferencePoolCount: 7,
      weatherScalingCoefficientUsed: 1.12,
      dayTotalBeforeWeatherScale: 35,
      dayTotalAfterWeatherScale: 39,
      intervalShapeScalingMethod: "shape_variant:month_weekday_weather_cooling",
    });
  });
});
