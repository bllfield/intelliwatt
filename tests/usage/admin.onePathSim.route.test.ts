import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

const requireAdmin = vi.fn();
const lookupAdminHousesByEmail = vi.fn();
const resolveAdminHouseSelection = vi.fn();
const listScenarios = vi.fn();
const getManualUsageInputForUserHouse = vi.fn();
const saveManualUsageInputForUserHouse = vi.fn();
const getHomeProfileSimulatedByUserHouse = vi.fn();
const getHomeProfileReadOnlyByUserHouse = vi.fn();
const getApplianceProfileSimulatedByUserHouse = vi.fn();
const normalizeStoredApplianceProfile = vi.fn();
const resolveSharedWeatherSensitivityEnvelope = vi.fn();
const getTravelRangesFromDb = vi.fn();
const getSimulationVariablePolicy = vi.fn();
const resolveUpstreamUsageTruthForSimulation = vi.fn();
const adaptIntervalRawInput = vi.fn();
const adaptManualMonthlyRawInput = vi.fn();
const adaptManualAnnualRawInput = vi.fn();
const adaptNewBuildRawInput = vi.fn();
const runSharedSimulation = vi.fn();
const buildSharedSimulationReadModel = vi.fn();
class UpstreamUsageTruthMissingError extends Error {
  code = "usage_truth_missing";
  usageTruthSource: string;
  seedResult: unknown;
  upstreamUsageTruth: unknown;

  constructor(args: { usageTruthSource: string; seedResult: unknown; upstreamUsageTruth: unknown }) {
    super("Upstream usage truth is required before simulation can run.");
    this.usageTruthSource = args.usageTruthSource;
    this.seedResult = args.seedResult;
    this.upstreamUsageTruth = args.upstreamUsageTruth;
  }
}

class SharedSimulationRunError extends Error {
  code: string;
  missingItems: string[];

  constructor(args: { code: string; missingItems?: string[] }) {
    super(args.code);
    this.code = args.code;
    this.missingItems = Array.isArray(args.missingItems) ? args.missingItems : [];
  }
}

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

vi.mock("@/modules/homeProfile/repo", () => ({
  getHomeProfileSimulatedByUserHouse: (...args: any[]) => getHomeProfileSimulatedByUserHouse(...args),
  getHomeProfileReadOnlyByUserHouse: (...args: any[]) => getHomeProfileReadOnlyByUserHouse(...args),
}));

vi.mock("@/modules/applianceProfile/repo", () => ({
  getApplianceProfileSimulatedByUserHouse: (...args: any[]) => getApplianceProfileSimulatedByUserHouse(...args),
}));

vi.mock("@/modules/applianceProfile/validation", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/applianceProfile/validation")>();
  return {
    ...actual,
    normalizeStoredApplianceProfile: (...args: any[]) => normalizeStoredApplianceProfile(...args),
  };
});

vi.mock("@/modules/onePathSim/runtime", () => ({
  getOnePathManualUsageInput: (...args: any[]) => getManualUsageInputForUserHouse(...args),
  saveOnePathManualUsageInput: (...args: any[]) => saveManualUsageInputForUserHouse(...args),
  resolveOnePathWeatherSensitivityEnvelope: (...args: any[]) => resolveSharedWeatherSensitivityEnvelope(...args),
  getOnePathTravelRangesFromDb: (...args: any[]) => getTravelRangesFromDb(...args),
  getOnePathSimulationVariablePolicy: (...args: any[]) => getSimulationVariablePolicy(...args),
  resolveOnePathUpstreamUsageTruthForSimulation: (...args: any[]) => resolveUpstreamUsageTruthForSimulation(...args),
}));

vi.mock("@/modules/onePathSim/onePathSim", () => ({
  adaptIntervalRawInput: (...args: any[]) => adaptIntervalRawInput(...args),
  adaptManualMonthlyRawInput: (...args: any[]) => adaptManualMonthlyRawInput(...args),
  adaptManualAnnualRawInput: (...args: any[]) => adaptManualAnnualRawInput(...args),
  adaptNewBuildRawInput: (...args: any[]) => adaptNewBuildRawInput(...args),
  runSharedSimulation: (...args: any[]) => runSharedSimulation(...args),
  buildSharedSimulationReadModel: (...args: any[]) => buildSharedSimulationReadModel(...args),
  SharedSimulationRunError,
  UpstreamUsageTruthMissingError,
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
    getManualUsageInputForUserHouse.mockReset();
    saveManualUsageInputForUserHouse.mockReset();
    getHomeProfileSimulatedByUserHouse.mockReset();
    getHomeProfileReadOnlyByUserHouse.mockReset();
    getApplianceProfileSimulatedByUserHouse.mockReset();
    normalizeStoredApplianceProfile.mockReset();
    resolveSharedWeatherSensitivityEnvelope.mockReset();
    getTravelRangesFromDb.mockReset();
    getSimulationVariablePolicy.mockReset();
    resolveUpstreamUsageTruthForSimulation.mockReset();
    adaptIntervalRawInput.mockReset();
    adaptManualMonthlyRawInput.mockReset();
    adaptManualAnnualRawInput.mockReset();
    adaptNewBuildRawInput.mockReset();
    runSharedSimulation.mockReset();
    buildSharedSimulationReadModel.mockReset();
    vi.stubEnv("HOME_DETAILS_DATABASE_URL", "");
    vi.stubEnv("APPLIANCES_DATABASE_URL", "");
    vi.stubEnv("USAGE_DATABASE_URL", "");

    requireAdmin.mockReturnValue({ ok: false, status: 401, body: { error: "Unauthorized" } });
    lookupAdminHousesByEmail.mockResolvedValue({
      ok: true,
      email: "customer@example.com",
      userId: "user-1",
      houses: [{ id: "house-1", label: "Primary", esiid: "esiid-1", isPrimary: true }],
    });
    resolveAdminHouseSelection.mockResolvedValue({ id: "house-1", label: "Primary", esiid: "esiid-1", isPrimary: true });
    listScenarios.mockResolvedValue({ ok: true, scenarios: [{ id: "scenario-1", name: "Past" }] });
    resolveUpstreamUsageTruthForSimulation.mockResolvedValue({
      dataset: { summary: { totalKwh: 123 }, meta: { actualSource: "SMT" } },
      alternatives: { smt: { totalKwh: 123 }, greenButton: null },
      actualContextHouse: { id: "house-1", esiid: "esiid-1" },
      usageTruthSource: "persisted_usage_output",
      seedResult: null,
      summary: {
        title: "Upstream Usage Truth",
        summary: "shared usage truth summary",
        currentRun: {
          statusSummary: {
            usageTruthStatus: "existing_persisted_truth",
            downstreamSimulationAllowed: true,
            seedingAttempted: false,
            seedingResult: "not_needed",
          },
        },
        sharedOwners: [],
      },
    });
    getManualUsageInputForUserHouse.mockResolvedValue({ payload: null, updatedAt: null });
    getHomeProfileSimulatedByUserHouse.mockResolvedValue({ squareFeet: 2000 });
    getHomeProfileReadOnlyByUserHouse.mockResolvedValue({ squareFeet: 2000 });
    getApplianceProfileSimulatedByUserHouse.mockResolvedValue({ appliancesJson: { fuelConfiguration: "all_electric", appliances: [] } });
    normalizeStoredApplianceProfile.mockReturnValue({ fuelConfiguration: "all_electric", appliances: [] });
    resolveSharedWeatherSensitivityEnvelope.mockResolvedValue({ score: { scoringMode: "INTERVAL_BASED" }, derivedInput: null });
    getTravelRangesFromDb.mockResolvedValue([{ startDate: "2026-03-01", endDate: "2026-03-05" }]);
    getSimulationVariablePolicy.mockResolvedValue({
      effectiveByMode: {
        INTERVAL: { previewPolicy: "interval" },
        MANUAL_MONTHLY: { previewPolicy: "manual-monthly" },
        MANUAL_ANNUAL: { previewPolicy: "manual-annual" },
        NEW_BUILD: { previewPolicy: "new-build" },
      },
      overrides: {},
    });
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
    expect(json.sourceContext.upstreamUsageTruth.currentRun.statusSummary).toEqual({
      usageTruthStatus: "existing_persisted_truth",
      downstreamSimulationAllowed: true,
      seedingAttempted: false,
      seedingResult: "not_needed",
    });
    expect(json.sourceContext.readOnlyAudit.validatorAudit.usageTruth).toEqual(
      expect.objectContaining({
        ready: true,
        validator: "upstreamUsageTruth.currentRun.statusSummary.downstreamSimulationAllowed || usageTruthSource === persisted_usage_output",
      })
    );
    expect(json.sourceContext.readOnlyAudit.readSourceComparison.manualUsage).toEqual(
      expect.objectContaining({
        sameBackingStoreAsUserSite: true,
      })
    );
    expect(json.sourceContext.environmentVisibility).toEqual({
      homeDetails: expect.objectContaining({
        envVarName: "HOME_DETAILS_DATABASE_URL",
        envVarPresent: false,
      }),
      appliances: expect.objectContaining({
        envVarName: "APPLIANCES_DATABASE_URL",
        envVarPresent: false,
      }),
      usage: expect.objectContaining({
        envVarName: "USAGE_DATABASE_URL",
        envVarPresent: false,
      }),
    });
    expect(json.sourceContext.weatherScore).toEqual({ scoringMode: "INTERVAL_BASED" });
    expect(json.sourceContext.travelRangesFromDb).toEqual([{ startDate: "2026-03-01", endDate: "2026-03-05" }]);
    expect(getHomeProfileReadOnlyByUserHouse).toHaveBeenCalledWith({ userId: "user-1", houseId: "house-1" });
    expect(getHomeProfileSimulatedByUserHouse).not.toHaveBeenCalled();
    expect(saveManualUsageInputForUserHouse).not.toHaveBeenCalled();
  });

  it("uses the selected mode policy and actual context house for lookup weather preview", async () => {
    lookupAdminHousesByEmail.mockResolvedValue({
      ok: true,
      email: "customer@example.com",
      userId: "user-1",
      houses: [
        { id: "house-1", label: "Primary", esiid: "esiid-1", isPrimary: true },
        { id: "house-2", label: "Actual", esiid: "esiid-2", isPrimary: false },
      ],
    });
    const { POST } = await import("@/app/api/admin/tools/one-path-sim/route");
    await POST(
      buildRequest({
        action: "lookup",
        email: "customer@example.com",
        mode: "MANUAL_MONTHLY",
        actualContextHouseId: "house-2",
      })
    );

    expect(resolveUpstreamUsageTruthForSimulation).toHaveBeenCalledWith({
      userId: "user-1",
      houseId: "house-1",
      actualContextHouseId: "house-2",
      seedIfMissing: false,
    });
    expect(resolveSharedWeatherSensitivityEnvelope).toHaveBeenCalledWith(
      expect.objectContaining({
        weatherHouseId: "house-2",
        simulationVariablePolicy: { previewPolicy: "manual-monthly" },
      })
    );
  });

  it("returns upstream usage truth metadata on lookup without introducing page-local usage loading", async () => {
    resolveUpstreamUsageTruthForSimulation.mockResolvedValue({
      dataset: null,
      alternatives: { smt: null, greenButton: null },
      actualContextHouse: { id: "house-2", esiid: "esiid-2" },
      usageTruthSource: "missing_usage_truth",
      seedResult: null,
      summary: {
        title: "Upstream Usage Truth",
        summary: "shared usage truth summary",
        currentRun: {
          statusSummary: {
            usageTruthStatus: "unavailable",
            downstreamSimulationAllowed: false,
            seedingAttempted: false,
            seedingResult: "not_needed",
          },
          orchestrationTrace: {
            lookedForExistingUsageTruth: true,
            existingUsageTruthFound: false,
            refreshRequested: false,
          },
        },
        sharedOwners: [],
      },
    });

    const { POST } = await import("@/app/api/admin/tools/one-path-sim/route");
    const res = await POST(
      buildRequest({
        action: "lookup",
        email: "customer@example.com",
        houseId: "house-1",
        mode: "MANUAL_MONTHLY",
        actualContextHouseId: "house-2",
      })
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.sourceContext.upstreamUsageTruth.currentRun.statusSummary).toEqual({
      usageTruthStatus: "unavailable",
      downstreamSimulationAllowed: false,
      seedingAttempted: false,
      seedingResult: "not_needed",
    });
    expect(json.sourceContext.upstreamUsageTruth.currentRun.orchestrationTrace).toEqual(
      expect.objectContaining({
        lookedForExistingUsageTruth: true,
        existingUsageTruthFound: false,
        refreshRequested: false,
      })
    );
    expect(adaptManualMonthlyRawInput).not.toHaveBeenCalled();
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

  it("passes actual context house and manual validation date keys through the shared adapter", async () => {
    const { POST } = await import("@/app/api/admin/tools/one-path-sim/route");
    await POST(
      buildRequest({
        action: "run",
        email: "customer@example.com",
        houseId: "house-1",
        mode: "INTERVAL",
        actualContextHouseId: "house-2",
        validationSelectionMode: "manual",
        validationOnlyDateKeysLocal: ["2026-03-10", "2026-03-11"],
      })
    );

    expect(adaptIntervalRawInput).toHaveBeenCalledWith(
      expect.objectContaining({
        actualContextHouseId: "house-2",
        validationSelectionMode: "manual",
        validationOnlyDateKeysLocal: ["2026-03-10", "2026-03-11"],
      })
    );
  });

  it("fails manual runs early when no saved manual payload exists", async () => {
    const { POST } = await import("@/app/api/admin/tools/one-path-sim/route");
    const res = await POST(
      buildRequest({
        action: "run",
        email: "customer@example.com",
        houseId: "house-1",
        mode: "MANUAL_MONTHLY",
      })
    );
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(adaptManualMonthlyRawInput).not.toHaveBeenCalled();
    expect(runSharedSimulation).not.toHaveBeenCalled();
    expect(json).toEqual({
      ok: false,
      error: "requirements_unmet",
      missingItems: ["Save manual usage totals (monthly or annual)."],
      message: "requirements_unmet: Save manual usage totals (monthly or annual).",
    });
  });

  it("returns shared recalc requirement failures without masking the missing manual payload", async () => {
    getManualUsageInputForUserHouse.mockResolvedValueOnce({
      payload: { mode: "MONTHLY", anchorEndDate: "2026-03-31", monthlyKwh: [{ month: "2026-03", kwh: 500 }] },
      updatedAt: "2026-04-09T00:00:00.000Z",
    });
    runSharedSimulation.mockRejectedValueOnce(
      new SharedSimulationRunError({
        code: "requirements_unmet",
        missingItems: ["Save manual usage totals (monthly or annual)."],
      })
    );

    const { POST } = await import("@/app/api/admin/tools/one-path-sim/route");
    const res = await POST(
      buildRequest({
        action: "run",
        email: "customer@example.com",
        houseId: "house-1",
        mode: "MANUAL_MONTHLY",
      })
    );
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json).toEqual({
      ok: false,
      error: "requirements_unmet",
      missingItems: ["Save manual usage totals (monthly or annual)."],
      message: "requirements_unmet: Save manual usage totals (monthly or annual).",
    });
  });

  it("maps plain requirements_unmet errors to a structured 409 response", async () => {
    getManualUsageInputForUserHouse.mockResolvedValueOnce({
      payload: { mode: "MONTHLY", anchorEndDate: "2026-03-31", monthlyKwh: [{ month: "2026-03", kwh: 500 }] },
      updatedAt: "2026-04-09T00:00:00.000Z",
    });
    runSharedSimulation.mockRejectedValueOnce(new Error("requirements_unmet"));

    const { POST } = await import("@/app/api/admin/tools/one-path-sim/route");
    const res = await POST(
      buildRequest({
        action: "run",
        email: "customer@example.com",
        houseId: "house-1",
        mode: "MANUAL_MONTHLY",
      })
    );
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json).toEqual({
      ok: false,
      error: "requirements_unmet",
      missingItems: [],
      message: "requirements_unmet",
    });
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
