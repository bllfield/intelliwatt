import { describe, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  lookupAdminHousesByEmail: vi.fn(),
  prisma: {
    usageSimulatorScenario: { findFirst: vi.fn() },
  } as any,
  getManualUsageInputForUserHouse: vi.fn(),
  saveManualUsageInputForUserHouse: vi.fn(),
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
vi.mock("@/modules/manualUsage/store", () => ({
  getManualUsageInputForUserHouse: (...args: any[]) => mocks.getManualUsageInputForUserHouse(...args),
  saveManualUsageInputForUserHouse: (...args: any[]) => mocks.saveManualUsageInputForUserHouse(...args),
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
    vi.clearAllMocks();
    mocks.requireAdmin.mockReturnValue({ ok: true, status: 200, body: { ok: true } });
    mocks.lookupAdminHousesByEmail.mockResolvedValue({
      ok: true,
      email: "user@example.com",
      userId: "u1",
      houses: [
        {
          id: "h1",
          label: "House One",
          esiid: "E1",
          addressLine1: "123 Main",
          addressCity: "Austin",
          addressState: "TX",
        },
      ],
    });
    mocks.prisma.usageSimulatorScenario.findFirst.mockResolvedValue({ id: "past-s1" });
    mocks.getManualUsageInputForUserHouse.mockResolvedValue({
      payload: {
        mode: "MONTHLY",
        anchorEndDate: "2025-04-30",
        monthlyKwh: [{ month: "2025-04", kwh: 300 }],
        travelRanges: [],
      },
      updatedAt: "2025-05-01T00:00:00.000Z",
    });
    mocks.saveManualUsageInputForUserHouse.mockResolvedValue({
      ok: true,
      updatedAt: "2025-05-01T00:00:00.000Z",
      payload: {
        mode: "MONTHLY",
        anchorEndDate: "2025-04-30",
        monthlyKwh: [{ month: "2025-04", kwh: 300 }],
        travelRanges: [],
      },
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
      lockboxExecutionSummary: {},
      projectionReadSummary: {},
      tuningSummary: {},
    });
  });

  it("lookup/load/read_result use the real shared save-read runtime seams", async () => {
    const { POST } = await import("@/app/api/admin/tools/manual-monthly/route");

    const lookupRes = await POST(buildRequest({ action: "lookup", email: "user@example.com" }));
    const lookupBody = await lookupRes.json();
    expect(lookupRes.status).toBe(200);
    expect(lookupBody.selectedHouse.id).toBe("h1");
    expect(lookupBody.currentResult.ok).toBe(true);

    const loadRes = await POST(buildRequest({ action: "load", email: "user@example.com", houseId: "h1" }));
    const loadBody = await loadRes.json();
    expect(loadBody.readResult.ok).toBe(true);

    const readRes = await POST(buildRequest({ action: "read_result", email: "user@example.com", houseId: "h1" }));
    const readBody = await readRes.json();
    expect(readBody.readResult.ok).toBe(true);
    expect(mocks.getSimulatedUsageForHouseScenario).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "u1",
        houseId: "h1",
        scenarioId: "past-s1",
        readMode: "allow_rebuild",
      })
    );
    expect(readBody.readResult.manualMonthlyReconciliation.eligibleRangeCount).toBe(1);
  });

  it("save and recalc stay on the shared customer runtime path", async () => {
    const { POST } = await import("@/app/api/admin/tools/manual-monthly/route");

    const saveRes = await POST(
      buildRequest({
        action: "save",
        email: "user@example.com",
        houseId: "h1",
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
      expect.objectContaining({ userId: "u1", houseId: "h1" })
    );

    const recalcRes = await POST(
      buildRequest({
        action: "recalc",
        email: "user@example.com",
        houseId: "h1",
        weatherPreference: "LAST_YEAR_WEATHER",
      })
    );
    const recalcBody = await recalcRes.json();
    expect(recalcBody.ok).toBe(true);
    expect(mocks.dispatchPastSimRecalc).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "u1",
        houseId: "h1",
        mode: "MANUAL_TOTALS",
        scenarioId: "past-s1",
      })
    );
  });
});
