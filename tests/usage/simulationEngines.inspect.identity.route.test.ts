import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAdmin = vi.fn();
const runSimulatorDiagnostic = vi.fn();
const normalizeEmailSafe = vi.fn();
const normalizeStoredApplianceProfile = vi.fn();
const getApplianceProfileSimulatedByUserHouse = vi.fn();
const getHomeProfileSimulatedByUserHouse = vi.fn();
const recalcSimulatorBuild = vi.fn();
const getSimulatedUsageForHouseScenario = vi.fn();
const prismaUserFindUnique = vi.fn();
const prismaHouseAddressFindMany = vi.fn();
const prismaScenarioFindMany = vi.fn();
const prismaBuildFindUnique = vi.fn();
const prismaScenarioEventFindMany = vi.fn();

vi.mock("@/lib/auth/admin", () => ({
  requireAdmin: (...args: any[]) => requireAdmin(...args),
}));

vi.mock("@/lib/admin/simulatorDiagnostic", () => ({
  runSimulatorDiagnostic: (...args: any[]) => runSimulatorDiagnostic(...args),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    user: { findUnique: (...args: any[]) => prismaUserFindUnique(...args) },
    houseAddress: { findMany: (...args: any[]) => prismaHouseAddressFindMany(...args) },
    usageSimulatorScenario: { findMany: (...args: any[]) => prismaScenarioFindMany(...args) },
    usageSimulatorBuild: { findUnique: (...args: any[]) => prismaBuildFindUnique(...args) },
    usageSimulatorScenarioEvent: { findMany: (...args: any[]) => prismaScenarioEventFindMany(...args) },
  },
}));

vi.mock("@/lib/utils/email", () => ({
  normalizeEmailSafe: (...args: any[]) => normalizeEmailSafe(...args),
}));

vi.mock("@/modules/applianceProfile/validation", () => ({
  normalizeStoredApplianceProfile: (...args: any[]) => normalizeStoredApplianceProfile(...args),
}));

vi.mock("@/modules/applianceProfile/repo", () => ({
  getApplianceProfileSimulatedByUserHouse: (...args: any[]) => getApplianceProfileSimulatedByUserHouse(...args),
}));

vi.mock("@/modules/homeProfile/repo", () => ({
  getHomeProfileSimulatedByUserHouse: (...args: any[]) => getHomeProfileSimulatedByUserHouse(...args),
}));

vi.mock("@/modules/usageSimulator/service", () => ({
  recalcSimulatorBuild: (...args: any[]) => recalcSimulatorBuild(...args),
  getSimulatedUsageForHouseScenario: (...args: any[]) => getSimulatedUsageForHouseScenario(...args),
}));

import { GET } from "@/app/api/admin/simulation-engines/route";

describe("simulation-engines inspect identity payload", () => {
  beforeEach(() => {
    requireAdmin.mockReset();
    runSimulatorDiagnostic.mockReset();
    normalizeEmailSafe.mockReset();
    normalizeStoredApplianceProfile.mockReset();
    getApplianceProfileSimulatedByUserHouse.mockReset();
    getHomeProfileSimulatedByUserHouse.mockReset();
    recalcSimulatorBuild.mockReset();
    getSimulatedUsageForHouseScenario.mockReset();
    prismaUserFindUnique.mockReset();
    prismaHouseAddressFindMany.mockReset();
    prismaScenarioFindMany.mockReset();
    prismaBuildFindUnique.mockReset();
    prismaScenarioEventFindMany.mockReset();

    requireAdmin.mockReturnValue({ ok: true });
    normalizeEmailSafe.mockImplementation((v: string) => String(v).trim().toLowerCase());
    prismaUserFindUnique.mockResolvedValue({ id: "u1", email: "user@example.com" });
    prismaHouseAddressFindMany.mockResolvedValue([
      {
        id: "h1",
        label: "Home",
        addressLine1: "123 Main",
        addressCity: "Austin",
        addressState: "TX",
        esiid: "10443720006712345",
        isPrimary: true,
        updatedAt: "2026-03-01T00:00:00.000Z",
      },
    ]);
    prismaScenarioFindMany.mockResolvedValue([
      { id: "s1", name: "Past (Corrected)", createdAt: "2026-03-01T00:00:00.000Z", updatedAt: "2026-03-01T00:00:00.000Z" },
    ]);
    prismaBuildFindUnique.mockResolvedValue({
      buildInputs: {
        mode: "SMT_BASELINE",
        canonicalMonths: ["2026-01"],
        timezone: "America/Chicago",
        travelRanges: [],
      },
      buildInputsHash: "build-hash",
      lastBuiltAt: "2026-03-01T00:00:00.000Z",
      mode: "SMT_BASELINE",
      baseKind: "PAST_CORRECTED_BASELINE",
    });
    prismaScenarioEventFindMany.mockResolvedValue([]);
    getSimulatedUsageForHouseScenario.mockResolvedValue({
      ok: true,
      scenarioKey: "s1",
      scenarioId: "s1",
      dataset: { summary: { totalKwh: 100 }, totals: {}, meta: {}, series: { intervals15: [], hourly: [], daily: [], monthly: [] } },
    });
    getHomeProfileSimulatedByUserHouse.mockResolvedValue({ occupants: 2 });
    getApplianceProfileSimulatedByUserHouse.mockResolvedValue({ appliancesJson: [] });
    normalizeStoredApplianceProfile.mockReturnValue([]);
    runSimulatorDiagnostic.mockResolvedValue({
      ok: true,
      context: {
        houseId: "h1",
        scenarioId: "s1",
        scenarioKey: "s1",
        buildInputsHash: "build-hash",
        coverageStart: "2026-01-01",
        coverageEnd: "2026-01-31",
        userId: "u1",
        travelRangesUsed: [],
      },
      identity: {
        windowStartUtc: "2026-01-01",
        windowEndUtc: "2026-01-31",
        timezone: "America/Chicago",
        engineVersion: "production_past_stitched_v2",
        buildInputsHash: "build-hash",
        intervalDataFingerprint: "interval-fp",
        weatherIdentity: "weather-fp",
        usageShapeProfileIdentity: {
          usageShapeProfileId: "profile_1",
          usageShapeProfileVersion: "1",
          usageShapeProfileDerivedAt: "2026-01-01T00:00:00.000Z",
          usageShapeProfileSimHash: "shape-fp",
        },
        inputHash: "input-hash",
      },
      pastPath: {},
      weatherProvenance: {},
      stubAudit: { totalActualRows: 0, totalStubRows: 0, stubDateKeys: [], boundaryStubDateKeys: [] },
      dayLevelParity: null,
      integrity: null,
      gapfillLabNote: { enginePath: "x", label: "x", sameEngineAsPastProduction: true, note: "x" },
      rawActualIntervalsMeta: {
        label: "Raw actual intervals",
        source: "none",
        coverageStart: null,
        coverageEnd: null,
        intervalCount: 0,
        truncated: false,
        truncationLimit: 96,
      },
      rawActualIntervals: [],
      stitchedPastIntervalsMeta: {
        label: "Final stitched Past corrected-baseline intervals",
        source: "production_artifact",
        coverageStart: null,
        coverageEnd: null,
        intervalCount: 0,
        truncated: false,
        truncationLimit: 96,
      },
      stitchedPastIntervals: [],
      firstActualOnlyDayComparison: { date: null, rawActualDayTotalKwh: null, stitchedPastDayTotalKwh: null, note: "n/a" },
    });
  });

  it("returns non-placeholder shared identity fields in inspect payload", async () => {
    const req = {
      url: "https://intelliwatt.com/api/admin/simulation-engines?email=user@example.com&scenario=past",
      cookies: { get: () => undefined },
    } as any;

    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.engineContext?.identity?.inputHash).toBe("input-hash");
    expect(body.engineContext?.identity?.intervalDataFingerprint).toBe("interval-fp");
    expect(body.engineContext?.identity?.weatherIdentity).toBe("weather-fp");
    expect(body.engineContext?.identity?.usageShapeProfileIdentity?.usageShapeProfileId).toBe("profile_1");
  });
});
