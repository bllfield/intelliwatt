import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { dailyRowFieldsFromSourceRow } from "@/modules/usageSimulator/dailyRowFieldsFromDisplay";
import { shouldResetPastValidationCompareExpanded } from "@/modules/usageSimulator/pastCompareUiDefaults";
import { buildValidationCompareDisplay } from "@/components/usage/validationCompareDisplay";
import { buildWeekdayWeekendBreakdownNote } from "@/components/usage/readoutTruth";
import {
  buildActualDiagnosticsHeaderReadout,
  buildNonValidationSimulatedBaselineReadout,
  buildStageTimingReadout,
  formatIdentityReadout,
} from "@/app/admin/tools/gapfill-lab/readoutTruth";

vi.mock("server-only", () => ({}));

const cookiesMock = vi.fn();
const prisma: any = {
  user: { findUnique: vi.fn() },
};
const getSimulatedUsageForHouseScenario = vi.fn();
const buildValidationCompareProjectionSidecar = vi.fn((dataset: any) => ({
  rows: Array.isArray(dataset?.meta?.validationCompareRows) ? dataset.meta.validationCompareRows : [],
  metrics:
    dataset?.meta?.validationCompareMetrics && typeof dataset.meta.validationCompareMetrics === "object"
      ? dataset.meta.validationCompareMetrics
      : {},
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
});
