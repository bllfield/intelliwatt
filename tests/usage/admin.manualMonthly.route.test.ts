import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  lookupAdminHousesByEmail: vi.fn(),
  prisma: {
    user: { findFirst: vi.fn() },
    usageSimulatorScenario: { findFirst: vi.fn(), create: vi.fn() },
  } as any,
  getActualUsageDatasetForHouse: vi.fn(),
  getHomeProfileSimulatedByUserHouse: vi.fn(),
  getApplianceProfileSimulatedByUserHouse: vi.fn(),
  getManualUsageInputForUserHouse: vi.fn(),
  saveManualUsageInputForUserHouse: vi.fn(),
  replaceGlobalManualMonthlyLabTestHomeFromSource: vi.fn(),
  ensureGlobalManualMonthlyLabTestHomeHouse: vi.fn(),
  dispatchPastSimRecalc: vi.fn(),
  getUserDefaultValidationSelectionMode: vi.fn(),
  getSimulatedUsageForHouseScenario: vi.fn(),
  getTravelRangesFromDb: vi.fn(),
  resolveUserValidationPolicy: vi.fn(),
  resolveUserWeatherLogicSetting: vi.fn(),
  buildValidationCompareProjectionSidecar: vi.fn(),
  buildSharedPastSimDiagnostics: vi.fn(),
}));

vi.mock("@/lib/auth/admin", () => ({
  requireAdmin: (...args: any[]) => mocks.requireAdmin(...args),
}));
vi.mock("@/lib/admin/adminHouseLookup", () => ({
  lookupAdminHousesByEmail: (...args: any[]) => mocks.lookupAdminHousesByEmail(...args),
}));
vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/usage/actualDatasetForHouse", () => ({
  getActualUsageDatasetForHouse: (...args: any[]) => mocks.getActualUsageDatasetForHouse(...args),
}));
vi.mock("@/modules/homeProfile/repo", () => ({
  getHomeProfileSimulatedByUserHouse: (...args: any[]) => mocks.getHomeProfileSimulatedByUserHouse(...args),
}));
vi.mock("@/modules/applianceProfile/repo", () => ({
  getApplianceProfileSimulatedByUserHouse: (...args: any[]) => mocks.getApplianceProfileSimulatedByUserHouse(...args),
}));
vi.mock("@/modules/manualUsage/store", () => ({
  getManualUsageInputForUserHouse: (...args: any[]) => mocks.getManualUsageInputForUserHouse(...args),
  saveManualUsageInputForUserHouse: (...args: any[]) => mocks.saveManualUsageInputForUserHouse(...args),
}));
vi.mock("@/modules/usageSimulator/labTestHome", () => ({
  MANUAL_MONTHLY_LAB_TEST_HOME_LABEL: "MANUAL_MONTHLY_LAB_TEST_HOME",
  ensureGlobalManualMonthlyLabTestHomeHouse: (...args: any[]) => mocks.ensureGlobalManualMonthlyLabTestHomeHouse(...args),
  replaceGlobalManualMonthlyLabTestHomeFromSource: (...args: any[]) => mocks.replaceGlobalManualMonthlyLabTestHomeFromSource(...args),
}));
vi.mock("@/modules/usageSimulator/pastSimRecalcDispatch", () => ({
  dispatchPastSimRecalc: (...args: any[]) => mocks.dispatchPastSimRecalc(...args),
}));
vi.mock("@/modules/usageSimulator/service", () => ({
  getUserDefaultValidationSelectionMode: (...args: any[]) => mocks.getUserDefaultValidationSelectionMode(...args),
  getSimulatedUsageForHouseScenario: (...args: any[]) => mocks.getSimulatedUsageForHouseScenario(...args),
}));
vi.mock("@/app/api/admin/tools/gapfill-lab/gapfillLabRouteHelpers", () => ({
  getTravelRangesFromDb: (...args: any[]) => mocks.getTravelRangesFromDb(...args),
}));
vi.mock("@/modules/usageSimulator/pastSimPolicy", () => ({
  resolveUserValidationPolicy: (...args: any[]) => mocks.resolveUserValidationPolicy(...args),
}));
vi.mock("@/modules/usageSimulator/pastSimWeatherPolicy", () => ({
  resolveUserWeatherLogicSetting: (...args: any[]) => mocks.resolveUserWeatherLogicSetting(...args),
}));
vi.mock("@/modules/usageSimulator/compareProjection", () => ({
  buildValidationCompareProjectionSidecar: (...args: any[]) => mocks.buildValidationCompareProjectionSidecar(...args),
}));
vi.mock("@/modules/usageSimulator/sharedDiagnostics", () => ({
  buildSharedPastSimDiagnostics: (...args: any[]) => mocks.buildSharedPastSimDiagnostics(...args),
}));

function buildRequest(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/admin/tools/manual-monthly", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-admin-token": "token",
    },
    body: JSON.stringify(body),
  });
}

describe("admin manual monthly route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.requireAdmin.mockReturnValue({ ok: true, status: 200, body: { ok: true } });
    mocks.lookupAdminHousesByEmail.mockResolvedValue({
      ok: true,
      email: "user@example.com",
      userId: "source-user-1",
      houses: [
        {
          id: "source-house-1",
          label: "Source House",
          esiid: "E1",
          addressLine1: "123 Main",
          addressCity: "Austin",
          addressState: "TX",
        },
      ],
    });
    mocks.prisma.user.findFirst.mockResolvedValue({ id: "admin-owner-1" });
    mocks.prisma.usageSimulatorScenario.findFirst.mockResolvedValue(null);
    mocks.prisma.usageSimulatorScenario.create.mockResolvedValue({ id: "past-lab-s1" });
    mocks.ensureGlobalManualMonthlyLabTestHomeHouse.mockResolvedValue({
      id: "lab-home-1",
      esiid: null,
      label: "MANUAL_MONTHLY_LAB_TEST_HOME",
    });
    mocks.replaceGlobalManualMonthlyLabTestHomeFromSource.mockResolvedValue({
      ok: true,
      testHomeHouseId: "lab-home-1",
      sourceHouseId: "source-house-1",
    });
    mocks.getManualUsageInputForUserHouse.mockImplementation(async ({ userId, houseId }: any) => {
      if (userId === "source-user-1" && houseId === "source-house-1") {
        return {
          payload: null,
          updatedAt: null,
        };
      }
      if (userId === "admin-owner-1" && houseId === "lab-home-1") {
        return {
          payload: {
            mode: "MONTHLY",
            anchorEndDate: "2025-04-30",
            monthlyKwh: [{ month: "2025-04", kwh: 300 }],
            travelRanges: [],
          },
          updatedAt: "2025-05-01T00:00:00.000Z",
        };
      }
      return { payload: null, updatedAt: null };
    });
    mocks.saveManualUsageInputForUserHouse.mockImplementation(async ({ payload }: any) => ({
      ok: true,
      updatedAt: "2025-05-01T00:00:00.000Z",
      payload,
    }));
    mocks.getActualUsageDatasetForHouse.mockResolvedValue({
      dataset: {
        summary: {
          source: "SMT",
          intervalsCount: 96,
          totalKwh: 3650,
          start: "2025-01-01",
          end: "2025-12-31",
          latest: "2025-12-31T23:45:00.000Z",
        },
        daily: Array.from({ length: 365 }, (_, idx) => ({
          date: `2025-${String(Math.floor(idx / 30) + 1).padStart(2, "0")}-${String((idx % 30) + 1).padStart(2, "0")}`,
          kwh: 10,
        })),
        monthly: [{ month: "2025-01", kwh: 310 }],
        series: {
          intervals15: [{ timestamp: "2025-01-01T00:00:00.000Z", kwh: 0.4 }],
          hourly: [{ timestamp: "2025-01-01T00:00:00.000Z", kwh: 1.6 }],
          daily: [{ date: "2025-01-01", kwh: 10 }],
          monthly: [{ month: "2025-01", kwh: 310 }],
          annual: [{ year: 2025, kwh: 3650 }],
        },
        insights: {
          fifteenMinuteAverages: [{ slot: 0, kwh: 0.4 }],
          timeOfDayBuckets: [{ label: "overnight", kwh: 12 }],
        },
        totals: { importKwh: 3650, exportKwh: 0, netKwh: 3650 },
        dailyWeather: {
          "2025-01-01": { tAvgF: 45, hdd65: 20, cdd65: 0 },
          "2025-12-31": { tAvgF: 48, hdd65: 17, cdd65: 0 },
        },
      },
    });
    mocks.getHomeProfileSimulatedByUserHouse.mockResolvedValue({ squareFeet: 2200, hvacType: "central" });
    mocks.getApplianceProfileSimulatedByUserHouse.mockResolvedValue({
      fuelConfiguration: "all_electric",
      appliancesJson: { appliances: [] },
    });
    mocks.getUserDefaultValidationSelectionMode.mockResolvedValue("stratified_weather_balanced");
    mocks.resolveUserValidationPolicy.mockReturnValue({
      selectionMode: "stratified_weather_balanced",
      validationDayCount: 21,
    });
    mocks.resolveUserWeatherLogicSetting.mockReturnValue({ weatherPreference: "LAST_YEAR_WEATHER" });
    mocks.dispatchPastSimRecalc.mockResolvedValue({
      executionMode: "inline",
      correlationId: "cid-1",
      result: { ok: true, canonicalArtifactInputHash: "artifact-hash-1" },
    });
    mocks.getSimulatedUsageForHouseScenario.mockResolvedValue({
      ok: true,
      dataset: {
        meta: {
          mode: "MANUAL_TOTALS",
          manualMonthlyInputState: {
            inputKindByMonth: { "2025-04": "entered_nonzero" },
          },
          filledMonths: [],
        },
        daily: Array.from({ length: 30 }, (_, idx) => ({
          date: `2025-04-${String(idx + 1).padStart(2, "0")}`,
          kwh: 10,
          source: "SIMULATED",
        })),
      },
    });
    mocks.buildValidationCompareProjectionSidecar.mockReturnValue({ rows: [], metrics: {} });
    mocks.buildSharedPastSimDiagnostics.mockReturnValue({
      identityContext: {},
      sourceTruthContext: {},
      lockboxExecutionSummary: { sharedProducerPathUsed: true },
      projectionReadSummary: {},
      tuningSummary: {},
    });
    mocks.getTravelRangesFromDb.mockResolvedValue([]);
  });

  it("lookup returns source-house selection quickly without loading heavy source or readback context", async () => {
    const { POST } = await import("@/app/api/admin/tools/manual-monthly/route");
    const res = await POST(buildRequest({ action: "lookup", email: "user@example.com" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.selectedSourceHouse.id).toBe("source-house-1");
    expect(body.labHome.id).toBe("lab-home-1");
    expect(body.sourceUsageHouse).toBeUndefined();
    expect(body.sourceSeed).toBeUndefined();
    expect(body.currentResult).toBeUndefined();
    expect(mocks.getActualUsageDatasetForHouse).not.toHaveBeenCalled();
    expect(mocks.getHomeProfileSimulatedByUserHouse).not.toHaveBeenCalled();
    expect(mocks.getApplianceProfileSimulatedByUserHouse).not.toHaveBeenCalled();
    expect(mocks.getManualUsageInputForUserHouse).not.toHaveBeenCalled();
    expect(mocks.getSimulatedUsageForHouseScenario).not.toHaveBeenCalled();
  });

  it("load resets and seeds only the isolated lab home", async () => {
    mocks.prisma.usageSimulatorScenario.findFirst.mockImplementation(async ({ where }: any) => {
      if (where?.userId === "admin-owner-1" && where?.houseId === "lab-home-1") return null;
      if (where?.userId === "source-user-1" && where?.houseId === "source-house-1") return { id: "past-source-s1" };
      return null;
    });
    const { POST } = await import("@/app/api/admin/tools/manual-monthly/route");
    const res = await POST(buildRequest({ action: "load", email: "user@example.com", houseId: "source-house-1" }));
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(body.selectedSourceHouse.id).toBe("source-house-1");
    expect(body.labHome.id).toBe("lab-home-1");
    expect(body.sourceUsageHouse.houseId).toBe("source-house-1");
    expect(body.sourceHomeProfile).toMatchObject({ squareFeet: 2200, hvacType: "central" });
    expect(body.sourceApplianceProfile).toMatchObject({ fuelConfiguration: "all_electric" });
    expect(body.sourceUsageHouse.dataset.daily).toEqual([]);
    expect(body.sourceUsageHouse.dataset.series.hourly).toEqual([]);
    expect(body.sourceUsageHouse.dataset.series.daily).toEqual([]);
    expect(body.sourceUsageHouse.dataset.dailyWeather).toEqual({
      redacted: true,
      count: 2,
      startDate: "2025-01-01",
      endDate: "2025-12-31",
    });
    expect(mocks.replaceGlobalManualMonthlyLabTestHomeFromSource).toHaveBeenCalledWith({
      ownerUserId: "admin-owner-1",
      sourceUserId: "source-user-1",
      sourceHouseId: "source-house-1",
    });
    expect(mocks.saveManualUsageInputForUserHouse).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "admin-owner-1",
        houseId: "lab-home-1",
      })
    );
    expect(mocks.saveManualUsageInputForUserHouse).not.toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "source-user-1",
        houseId: "source-house-1",
      })
    );
    expect(body.seed.monthly.anchorEndDate).toBe("2025-12-31");
    expect(body.seed.monthly.statementRanges[0]).toMatchObject({
      month: "2025-12",
      endDate: "2025-12-31",
    });
    expect(body.payload.statementRanges[0]).toMatchObject({
      month: "2025-12",
      endDate: "2025-12-31",
    });
    expect(typeof body.seed.annual.annualKwh).toBe("number");
    expect(body.readResult.ok).toBe(true);
    expect(body.readResult.dataset.daily).toHaveLength(30);
    expect(body.readResult.manualMonthlyReconciliation?.rows?.[0]?.actualIntervalTotalKwh).toBe(300);
    expect(body.readResult.manualParitySummary).toMatchObject({
      stage1_contract: expect.objectContaining({
        anchorEndDate: "2025-04-30",
      }),
      parity_verdicts: expect.objectContaining({
        stage2PathParity: true,
      }),
    });
    expect(mocks.getSimulatedUsageForHouseScenario).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "source-user-1",
        houseId: "source-house-1",
        scenarioId: "past-source-s1",
        readMode: "artifact_only",
        projectionMode: "baseline",
      })
    );
  });

  it("routes shared Stage 1 monthly/annual seed resolution through manualUsage/prefill on load", async () => {
    const prefill = await import("@/modules/manualUsage/prefill");
    const contractSpy = vi.spyOn(prefill, "resolveSharedManualStageOneContract");
    const { POST } = await import("@/app/api/admin/tools/manual-monthly/route");

    const res = await POST(buildRequest({ action: "load", email: "user@example.com", houseId: "source-house-1" }));
    expect(res.status).toBe(200);
    expect(contractSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "MONTHLY",
        sourcePayload: null,
        actualEndDate: "2025-12-31",
        dailyRows: expect.any(Array),
      })
    );
  });

  it("load falls back to actual-derived monthly totals when source monthly payload has no numeric entries", async () => {
    mocks.getManualUsageInputForUserHouse.mockImplementation(async ({ userId, houseId }: any) => {
      if (userId === "source-user-1" && houseId === "source-house-1") {
        return {
          payload: {
            mode: "MONTHLY",
            anchorEndDate: "2025-12-31",
            monthlyKwh: [{ month: "2025-12", kwh: "" }],
            travelRanges: [],
          },
          updatedAt: "2025-05-01T00:00:00.000Z",
        };
      }
      if (userId === "admin-owner-1" && houseId === "lab-home-1") {
        return {
          payload: {
            mode: "MONTHLY",
            anchorEndDate: "2025-04-30",
            monthlyKwh: [{ month: "2025-04", kwh: 300 }],
            travelRanges: [],
          },
          updatedAt: "2025-05-01T00:00:00.000Z",
        };
      }
      return { payload: null, updatedAt: null };
    });

    const { POST } = await import("@/app/api/admin/tools/manual-monthly/route");
    const res = await POST(buildRequest({ action: "load", email: "user@example.com", houseId: "source-house-1" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.seed.monthly.anchorEndDate).toBe("2025-12-31");
    expect(body.seed.sourceMode).toBe("ACTUAL_INTERVALS_MONTHLY_PREFILL");
    expect(body.payload.mode).toBe("MONTHLY");
    expect(body.payload.monthlyKwh.some((row: any) => typeof row.kwh === "number")).toBe(true);
    expect(body.payload.statementRanges[0]).toMatchObject({
      month: "2025-12",
      endDate: "2025-12-31",
    });
    expect(mocks.saveManualUsageInputForUserHouse).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "admin-owner-1",
        houseId: "lab-home-1",
        payload: expect.objectContaining({
          mode: "MONTHLY",
        }),
      })
    );
  });

  it("load prefers canonical source travel ranges over stale source-payload travel ranges for derived lab payloads", async () => {
    mocks.getManualUsageInputForUserHouse.mockImplementation(async ({ userId, houseId }: any) => {
      if (userId === "source-user-1" && houseId === "source-house-1") {
        return {
          payload: {
            mode: "MONTHLY",
            anchorEndDate: "2025-12-31",
            monthlyKwh: [{ month: "2025-12", kwh: "" }],
            travelRanges: [{ startDate: "2025-02-18", endDate: "2025-05-26" }],
          },
          updatedAt: "2025-05-01T00:00:00.000Z",
        };
      }
      return { payload: null, updatedAt: null };
    });
    mocks.getTravelRangesFromDb.mockResolvedValue([
      { startDate: "2025-03-14", endDate: "2025-06-01" },
      { startDate: "2025-08-13", endDate: "2025-08-17" },
    ]);

    const { POST } = await import("@/app/api/admin/tools/manual-monthly/route");
    const res = await POST(buildRequest({ action: "load", email: "user@example.com", houseId: "source-house-1" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.payload.travelRanges).toEqual([
      { startDate: "2025-03-14", endDate: "2025-06-01" },
      { startDate: "2025-08-13", endDate: "2025-08-17" },
    ]);
    expect(mocks.saveManualUsageInputForUserHouse).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "admin-owner-1",
        houseId: "lab-home-1",
        payload: expect.objectContaining({
          travelRanges: [
            { startDate: "2025-03-14", endDate: "2025-06-01" },
            { startDate: "2025-08-13", endDate: "2025-08-17" },
          ],
        }),
      })
    );
  });

  it("load fails closed when derived lab-home prefill persistence fails", async () => {
    mocks.saveManualUsageInputForUserHouse.mockResolvedValueOnce({
      ok: false,
      error: "anchorEndDate_invalid",
    });

    const { POST } = await import("@/app/api/admin/tools/manual-monthly/route");
    const res = await POST(buildRequest({ action: "load", email: "user@example.com", houseId: "source-house-1" }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body).toMatchObject({
      ok: false,
      action: "load",
      error: "anchorEndDate_invalid",
    });
    expect(body.seed).toBeUndefined();
    expect(body.payload).toBeUndefined();
  });

  it("save and recalc stay on the isolated lab home runtime path and return a fast readback handoff", async () => {
    const { POST } = await import("@/app/api/admin/tools/manual-monthly/route");

    const saveRes = await POST(
      buildRequest({
        action: "save",
        email: "user@example.com",
        houseId: "source-house-1",
        payload: {
          mode: "MONTHLY",
          anchorEndDate: "2025-04-30",
          monthlyKwh: [{ month: "2025-04", kwh: 300 }],
          travelRanges: [],
        },
      })
    );
    const saveBody = await saveRes.json();
    expect(saveBody.ok).toBe(true);
    expect(mocks.saveManualUsageInputForUserHouse).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "admin-owner-1", houseId: "lab-home-1" })
    );

    const recalcRes = await POST(
      buildRequest({
        action: "recalc",
        email: "user@example.com",
        houseId: "source-house-1",
        weatherPreference: "LAST_YEAR_WEATHER",
      })
    );
    const recalcBody = await recalcRes.json();
    expect(recalcBody.ok).toBe(true);
    expect(recalcBody.executionMode).toBe("inline");
    expect(recalcBody.readbackPending).toBe(true);
    expect(recalcBody.canonicalArtifactInputHash).toBe("artifact-hash-1");
    expect(recalcBody.readResult).toBeNull();
    expect(mocks.dispatchPastSimRecalc).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "admin-owner-1",
        houseId: "lab-home-1",
        esiid: null,
        mode: "MANUAL_TOTALS",
        scenarioId: "past-lab-s1",
      })
    );
    expect(mocks.getSimulatedUsageForHouseScenario).not.toHaveBeenCalled();
  });

  it("returns a recalc failure directly instead of masking it behind a later read_result error", async () => {
    mocks.dispatchPastSimRecalc.mockResolvedValueOnce({
      executionMode: "inline",
      correlationId: "cid-fail",
      result: { ok: false, error: "requirements_unmet", missingItems: ["manual usage totals"] },
    });

    const { POST } = await import("@/app/api/admin/tools/manual-monthly/route");
    const recalcRes = await POST(
      buildRequest({
        action: "recalc",
        email: "user@example.com",
        houseId: "source-house-1",
        weatherPreference: "LAST_YEAR_WEATHER",
      })
    );
    const recalcBody = await recalcRes.json();

    expect(recalcRes.status).toBe(500);
    expect(recalcBody).toMatchObject({
      ok: false,
      action: "recalc",
      executionMode: "inline",
      correlationId: "cid-fail",
      error: "requirements_unmet",
      failureCode: "SIMULATION_RUNTIME_ERROR",
      failureMessage: "manual usage totals",
      detail: "manual usage totals",
      result: {
        ok: false,
        error: "requirements_unmet",
      },
    });
  });

  it("surfaces Prisma pool exhaustion details for admin manual recalc failures", async () => {
    mocks.dispatchPastSimRecalc.mockResolvedValueOnce({
      executionMode: "inline",
      correlationId: "cid-pool",
      result: {
        ok: false,
        error: "manual_monthly_shared_producer_no_dataset",
        missingItems: ["P2024: Timed out fetching a new connection from the connection pool. connection limit: 1"],
      },
    });

    const { POST } = await import("@/app/api/admin/tools/manual-monthly/route");
    const recalcRes = await POST(
      buildRequest({
        action: "recalc",
        email: "user@example.com",
        houseId: "source-house-1",
        weatherPreference: "LAST_YEAR_WEATHER",
      })
    );
    const recalcBody = await recalcRes.json();

    expect(recalcRes.status).toBe(500);
    expect(recalcBody.failureCode).toBe("PRISMA_POOL_EXHAUSTION");
    expect(recalcBody.failureMessage).toContain("P2024");
    expect(recalcBody.detail).toContain("connection limit: 1");
  });

  it("returns a non-2xx status when read_result fails on the shared read path", async () => {
    mocks.getSimulatedUsageForHouseScenario.mockResolvedValueOnce({
      ok: false,
      code: "COMPARE_TRUTH_INCOMPLETE",
      message: "Missing canonical simulated-day totals.",
    });

    const { POST } = await import("@/app/api/admin/tools/manual-monthly/route");
    const readRes = await POST(
      buildRequest({
        action: "read_result",
        email: "user@example.com",
        houseId: "source-house-1",
        correlationId: "cid-read",
        exactArtifactInputHash: "artifact-hash-1",
      })
    );
    const readBody = await readRes.json();

    expect(readRes.status).toBe(409);
    expect(readBody).toMatchObject({
      ok: false,
      action: "read_result",
      error: "COMPARE_TRUTH_INCOMPLETE",
      failureCode: "COMPARE_TRUTH_INCOMPLETE",
      failureMessage: "Missing canonical simulated-day totals.",
    });
    expect(mocks.getSimulatedUsageForHouseScenario).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "admin-owner-1",
        houseId: "lab-home-1",
        scenarioId: "past-lab-s1",
        readMode: "artifact_only",
        correlationId: "cid-read",
        exactArtifactInputHash: "artifact-hash-1",
        requireExactArtifactMatch: true,
      })
    );
  });

  it("keeps manual compare actual-reference reads artifact-only so readback does not rebuild source truth", async () => {
    mocks.prisma.usageSimulatorScenario.findFirst.mockImplementation(async ({ where }: any) => {
      if (where?.userId === "admin-owner-1" && where?.houseId === "lab-home-1") return { id: "past-lab-s1" };
      if (where?.userId === "source-user-1" && where?.houseId === "source-house-1") return { id: "past-source-s1" };
      return null;
    });
    mocks.getSimulatedUsageForHouseScenario
      .mockResolvedValueOnce({
        ok: true,
        dataset: {
          meta: {
            mode: "MANUAL_TOTALS",
            manualMonthlyInputState: {
              inputKindByMonth: { "2025-04": "entered_nonzero" },
            },
            filledMonths: [],
          },
          daily: Array.from({ length: 30 }, (_, idx) => ({
            date: `2025-04-${String(idx + 1).padStart(2, "0")}`,
            kwh: 10,
            source: "SIMULATED",
          })),
        },
      })
      .mockResolvedValueOnce({
        ok: false,
        code: "NO_BUILD",
        message: "No persisted source artifact.",
      });

    const { POST } = await import("@/app/api/admin/tools/manual-monthly/route");
    const res = await POST(
      buildRequest({
        action: "read_result",
        email: "user@example.com",
        houseId: "source-house-1",
        correlationId: "cid-artifact-only",
        exactArtifactInputHash: "artifact-hash-1",
      })
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.readResult.ok).toBe(true);
    expect(body.readResult.manualMonthlyReconciliation?.rows?.[0]?.actualIntervalTotalKwh).toBeNull();
    expect(mocks.getSimulatedUsageForHouseScenario).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        userId: "source-user-1",
        houseId: "source-house-1",
        scenarioId: "past-source-s1",
        readMode: "artifact_only",
        projectionMode: "baseline",
      })
    );
  });

  it("read_result exposes shared pure-manual travel donor truth from persisted artifact diagnostics", async () => {
    mocks.buildSharedPastSimDiagnostics.mockReturnValueOnce({
      identityContext: {},
      sourceTruthContext: {
        manualTravelVacantDonorSource: "same_run_simulated_non_travel_days",
        manualTravelVacantDonorDayCount: 19,
      },
      lockboxExecutionSummary: { sharedProducerPathUsed: true },
      projectionReadSummary: {},
      tuningSummary: {},
    });
    mocks.getSimulatedUsageForHouseScenario.mockResolvedValueOnce({
      ok: true,
      dataset: {
        meta: {
          mode: "MANUAL_TOTALS",
          manualTravelVacantDonorSource: "same_run_simulated_non_travel_days",
          manualTravelVacantDonorDayCount: 19,
          lockboxInput: { mode: "MANUAL_MONTHLY" },
          lockboxPerDayTrace: [],
          filledMonths: [],
        },
        daily: [{ date: "2025-04-10", kwh: 10, source: "SIMULATED", sourceDetail: "SIMULATED_TRAVEL_VACANT" }],
      },
    });

    const { POST } = await import("@/app/api/admin/tools/manual-monthly/route");
    const res = await POST(
      buildRequest({
        action: "read_result",
        email: "user@example.com",
        houseId: "source-house-1",
        exactArtifactInputHash: "artifact-hash-1",
      })
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.readResult.sharedDiagnostics.sourceTruthContext.manualTravelVacantDonorSource).toBe(
      "same_run_simulated_non_travel_days"
    );
    expect(body.readResult.sharedDiagnostics.sourceTruthContext.manualTravelVacantDonorDayCount).toBe(19);
  });

  it("read_result returns the active lab-home manual payload so Stage 1 can match the shared run contract", async () => {
    mocks.getManualUsageInputForUserHouse.mockImplementation(async ({ userId, houseId }: any) => {
      if (userId === "source-user-1" && houseId === "source-house-1") {
        return {
          payload: {
            mode: "MONTHLY",
            anchorEndDate: "2025-04-30",
            monthlyKwh: [{ month: "2025-04", kwh: 13540.1 }],
            travelRanges: [{ startDate: "2025-02-18", endDate: "2025-05-26" }],
          },
          updatedAt: null,
        };
      }
      return {
        payload: {
          mode: "MONTHLY",
          anchorEndDate: "2025-08-31",
          monthlyKwh: [{ month: "2025-08", kwh: 15000.2 }],
          statementRanges: [{ month: "2025-08", startDate: "2025-08-01", endDate: "2025-08-31" }],
          travelRanges: [
            { startDate: "2025-03-14", endDate: "2025-06-01" },
            { startDate: "2025-08-13", endDate: "2025-08-17" },
          ],
        },
        updatedAt: "2025-08-18T00:00:00.000Z",
      };
    });
    mocks.getSimulatedUsageForHouseScenario.mockResolvedValueOnce({
      ok: true,
      dataset: {
        meta: {
          mode: "MANUAL_TOTALS",
          lockboxInput: { mode: "MANUAL_MONTHLY" },
          lockboxPerDayTrace: [],
          filledMonths: [],
        },
        daily: [{ date: "2025-08-14", kwh: 12, source: "SIMULATED", sourceDetail: "SIMULATED_TRAVEL_VACANT" }],
      },
    });

    const { POST } = await import("@/app/api/admin/tools/manual-monthly/route");
    const res = await POST(
      buildRequest({
        action: "read_result",
        email: "user@example.com",
        houseId: "source-house-1",
        exactArtifactInputHash: "artifact-hash-1",
      })
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.readResult.payload).toMatchObject({
      mode: "MONTHLY",
      monthlyKwh: [{ month: "2025-08", kwh: 15000.2 }],
      travelRanges: [
        { startDate: "2025-03-14", endDate: "2025-06-01" },
        { startDate: "2025-08-13", endDate: "2025-08-17" },
      ],
    });
  });
});
