import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

const requireAdmin = vi.fn();
const lookupAdminHousesByEmail = vi.fn();
const resolveAdminHouseSelection = vi.fn();
const listScenarios = vi.fn();
const getActualUsageDatasetForHouse = vi.fn();
const getManualUsageInputForUserHouse = vi.fn();
const saveManualUsageInputForUserHouse = vi.fn();
const getHomeProfileSimulatedByUserHouse = vi.fn();
const getApplianceProfileSimulatedByUserHouse = vi.fn();
const normalizeStoredApplianceProfile = vi.fn();
const resolveSharedWeatherSensitivityEnvelope = vi.fn();
const getTravelRangesFromDb = vi.fn();
const adaptIntervalRawInput = vi.fn();
const adaptManualMonthlyRawInput = vi.fn();
const adaptManualAnnualRawInput = vi.fn();
const adaptNewBuildRawInput = vi.fn();
const runSharedSimulation = vi.fn();
const buildSharedSimulationReadModel = vi.fn();

vi.mock("@/lib/auth/admin", () => ({
  requireAdmin: (...args: any[]) => requireAdmin(...args),
}));

vi.mock("@/lib/admin/adminHouseLookup", () => ({
  lookupAdminHousesByEmail: (...args: any[]) => lookupAdminHousesByEmail(...args),
  resolveAdminHouseSelection: (...args: any[]) => resolveAdminHouseSelection(...args),
}));

vi.mock("@/modules/usageSimulator/service", () => ({
  listScenarios: (...args: any[]) => listScenarios(...args),
}));

vi.mock("@/lib/usage/actualDatasetForHouse", () => ({
  getActualUsageDatasetForHouse: (...args: any[]) => getActualUsageDatasetForHouse(...args),
}));

vi.mock("@/modules/manualUsage/store", () => ({
  getManualUsageInputForUserHouse: (...args: any[]) => getManualUsageInputForUserHouse(...args),
  saveManualUsageInputForUserHouse: (...args: any[]) => saveManualUsageInputForUserHouse(...args),
}));

vi.mock("@/modules/homeProfile/repo", () => ({
  getHomeProfileSimulatedByUserHouse: (...args: any[]) => getHomeProfileSimulatedByUserHouse(...args),
}));

vi.mock("@/modules/applianceProfile/repo", () => ({
  getApplianceProfileSimulatedByUserHouse: (...args: any[]) => getApplianceProfileSimulatedByUserHouse(...args),
}));

vi.mock("@/modules/applianceProfile/validation", () => ({
  normalizeStoredApplianceProfile: (...args: any[]) => normalizeStoredApplianceProfile(...args),
}));

vi.mock("@/modules/weatherSensitivity/shared", () => ({
  resolveSharedWeatherSensitivityEnvelope: (...args: any[]) => resolveSharedWeatherSensitivityEnvelope(...args),
}));

vi.mock("@/app/api/admin/tools/gapfill-lab/gapfillLabRouteHelpers", () => ({
  getTravelRangesFromDb: (...args: any[]) => getTravelRangesFromDb(...args),
}));

vi.mock("@/modules/usageSimulator/onePathSim", () => ({
  adaptIntervalRawInput: (...args: any[]) => adaptIntervalRawInput(...args),
  adaptManualMonthlyRawInput: (...args: any[]) => adaptManualMonthlyRawInput(...args),
  adaptManualAnnualRawInput: (...args: any[]) => adaptManualAnnualRawInput(...args),
  adaptNewBuildRawInput: (...args: any[]) => adaptNewBuildRawInput(...args),
  runSharedSimulation: (...args: any[]) => runSharedSimulation(...args),
  buildSharedSimulationReadModel: (...args: any[]) => buildSharedSimulationReadModel(...args),
}));

function buildRequest(body: Record<string, unknown>, cookie = "brian@intellipath-solutions.com") {
  return new NextRequest("http://localhost/api/admin/tools/one-path-sim", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: `intelliwatt_admin=${cookie}`,
    },
    body: JSON.stringify(body),
  });
}

describe("admin one path sim route", () => {
  beforeEach(() => {
    requireAdmin.mockReset();
    lookupAdminHousesByEmail.mockReset();
    resolveAdminHouseSelection.mockReset();
    listScenarios.mockReset();
    getActualUsageDatasetForHouse.mockReset();
    getManualUsageInputForUserHouse.mockReset();
    saveManualUsageInputForUserHouse.mockReset();
    getHomeProfileSimulatedByUserHouse.mockReset();
    getApplianceProfileSimulatedByUserHouse.mockReset();
    normalizeStoredApplianceProfile.mockReset();
    resolveSharedWeatherSensitivityEnvelope.mockReset();
    getTravelRangesFromDb.mockReset();
    adaptIntervalRawInput.mockReset();
    adaptManualMonthlyRawInput.mockReset();
    adaptManualAnnualRawInput.mockReset();
    adaptNewBuildRawInput.mockReset();
    runSharedSimulation.mockReset();
    buildSharedSimulationReadModel.mockReset();

    requireAdmin.mockReturnValue({ ok: false, status: 401, body: { error: "Unauthorized" } });
    lookupAdminHousesByEmail.mockResolvedValue({
      ok: true,
      email: "customer@example.com",
      userId: "user-1",
      houses: [{ id: "house-1", label: "Primary", esiid: "esiid-1", isPrimary: true }],
    });
    resolveAdminHouseSelection.mockResolvedValue({ id: "house-1", label: "Primary", esiid: "esiid-1", isPrimary: true });
    listScenarios.mockResolvedValue({ ok: true, scenarios: [{ id: "scenario-1", name: "Past" }] });
    getActualUsageDatasetForHouse.mockResolvedValue({ dataset: { summary: { totalKwh: 123 }, meta: { actualSource: "SMT" } } });
    getManualUsageInputForUserHouse.mockResolvedValue({ payload: null, updatedAt: null });
    getHomeProfileSimulatedByUserHouse.mockResolvedValue({ squareFeet: 2000 });
    getApplianceProfileSimulatedByUserHouse.mockResolvedValue({ appliancesJson: { fuelConfiguration: "all_electric", appliances: [] } });
    normalizeStoredApplianceProfile.mockReturnValue({ fuelConfiguration: "all_electric", appliances: [] });
    resolveSharedWeatherSensitivityEnvelope.mockResolvedValue({ score: { scoringMode: "INTERVAL_BASED" }, derivedInput: null });
    getTravelRangesFromDb.mockResolvedValue([{ startDate: "2026-03-01", endDate: "2026-03-05" }]);
    adaptIntervalRawInput.mockResolvedValue({ sharedProducerPathUsed: true, inputType: "INTERVAL" });
    adaptManualMonthlyRawInput.mockResolvedValue({ sharedProducerPathUsed: true, inputType: "MANUAL_MONTHLY" });
    adaptManualAnnualRawInput.mockResolvedValue({ sharedProducerPathUsed: true, inputType: "MANUAL_ANNUAL" });
    adaptNewBuildRawInput.mockResolvedValue({ sharedProducerPathUsed: true, inputType: "NEW_BUILD" });
    runSharedSimulation.mockResolvedValue({ artifactId: "artifact-1" });
    buildSharedSimulationReadModel.mockReturnValue({ runIdentity: { artifactId: "artifact-1" } });
  });

  it("allows the browser admin cookie for lookup and returns source context", async () => {
    const { POST } = await import("@/app/api/admin/tools/one-path-sim/route");
    const res = await POST(buildRequest({ action: "lookup", email: "customer@example.com" }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(requireAdmin).not.toHaveBeenCalled();
    expect(json.ok).toBe(true);
    expect(json.selectedHouse.id).toBe("house-1");
    expect(json.sourceContext.actualDatasetSummary).toEqual({ totalKwh: 123 });
    expect(json.sourceContext.weatherScore).toEqual({ scoringMode: "INTERVAL_BASED" });
    expect(json.sourceContext.travelRangesFromDb).toEqual([{ startDate: "2026-03-01", endDate: "2026-03-05" }]);
  });

  it("routes interval runs through the shared adapter, producer, and read model", async () => {
    const { POST } = await import("@/app/api/admin/tools/one-path-sim/route");
    const res = await POST(
      buildRequest({
        action: "run",
        email: "customer@example.com",
        houseId: "house-1",
        mode: "INTERVAL",
      })
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(adaptIntervalRawInput).toHaveBeenCalledTimes(1);
    expect(runSharedSimulation).toHaveBeenCalledWith({ sharedProducerPathUsed: true, inputType: "INTERVAL" });
    expect(buildSharedSimulationReadModel).toHaveBeenCalledWith({ artifactId: "artifact-1" });
    expect(json.readModel.runIdentity.artifactId).toBe("artifact-1");
  });

  it("routes manual save through the shared manual input store", async () => {
    saveManualUsageInputForUserHouse.mockResolvedValue({
      ok: true,
      updatedAt: "2026-04-09T00:00:00.000Z",
      payload: { mode: "ANNUAL", anchorEndDate: "2026-03-31", annualKwh: 9000, travelRanges: [] },
    });
    const { POST } = await import("@/app/api/admin/tools/one-path-sim/route");
    const res = await POST(
      buildRequest({
        action: "save_manual",
        email: "customer@example.com",
        houseId: "house-1",
        payload: { mode: "ANNUAL", anchorEndDate: "2026-03-31", annualKwh: 9000, travelRanges: [] },
      })
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(saveManualUsageInputForUserHouse).toHaveBeenCalledWith({
      userId: "user-1",
      houseId: "house-1",
      payload: { mode: "ANNUAL", anchorEndDate: "2026-03-31", annualKwh: 9000, travelRanges: [] },
    });
    expect(json.payload.mode).toBe("ANNUAL");
  });
});
