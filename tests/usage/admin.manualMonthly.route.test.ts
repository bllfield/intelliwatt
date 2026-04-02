import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

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
        series: { intervals15: [], hourly: [], daily: [], monthly: [], annual: [] },
        insights: null,
        totals: { importKwh: 3650, exportKwh: 0, netKwh: 3650 },
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
      result: { ok: true },
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
  });

  it("lookup returns source usage context while reading current result from the isolated lab home", async () => {
    const { POST } = await import("@/app/api/admin/tools/manual-monthly/route");
    const res = await POST(buildRequest({ action: "lookup", email: "user@example.com" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.selectedSourceHouse.id).toBe("source-house-1");
    expect(body.labHome.id).toBe("lab-home-1");
    expect(body.sourceUsageHouse.houseId).toBe("source-house-1");
    expect(body.currentResult.ok).toBe(true);
    expect(body.currentResult.houseId).toBe("lab-home-1");
    expect(mocks.getSimulatedUsageForHouseScenario).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "admin-owner-1",
        houseId: "lab-home-1",
        scenarioId: "past-lab-s1",
        readMode: "artifact_only",
      })
    );
  });

  it("load resets and seeds only the isolated lab home", async () => {
    const { POST } = await import("@/app/api/admin/tools/manual-monthly/route");
    const res = await POST(buildRequest({ action: "load", email: "user@example.com", houseId: "source-house-1" }));
    const body = await res.json();

    expect(body.ok).toBe(true);
    expect(body.selectedSourceHouse.id).toBe("source-house-1");
    expect(body.labHome.id).toBe("lab-home-1");
    expect(body.sourceUsageHouse.houseId).toBe("source-house-1");
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

  it("save, recalc, and read_result stay on the isolated lab home runtime path", async () => {
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
    expect(mocks.dispatchPastSimRecalc).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "admin-owner-1",
        houseId: "lab-home-1",
        esiid: null,
        mode: "MANUAL_TOTALS",
        scenarioId: "past-lab-s1",
      })
    );

    const readRes = await POST(buildRequest({ action: "read_result", email: "user@example.com", houseId: "source-house-1" }));
    const readBody = await readRes.json();
    expect(readBody.readResult.ok).toBe(true);
    expect(mocks.getSimulatedUsageForHouseScenario).toHaveBeenLastCalledWith(
      expect.objectContaining({
        userId: "admin-owner-1",
        houseId: "lab-home-1",
        scenarioId: "past-lab-s1",
        readMode: "allow_rebuild",
      })
    );
  });
});
