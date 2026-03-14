import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAdmin = vi.fn();
const normalizeEmailSafe = vi.fn();
const normalizeScenarioKey = vi.fn();
const runSimulatorDiagnostic = vi.fn();
const recalcSimulatorBuild = vi.fn();
const prismaUserFindUnique = vi.fn();
const prismaHouseFindFirst = vi.fn();
const prismaScenarioFindFirst = vi.fn();
const prismaBuildFindUnique = vi.fn();

vi.mock("@/lib/auth/admin", () => ({
  requireAdmin: (...args: any[]) => requireAdmin(...args),
}));

vi.mock("@/lib/utils/email", () => ({
  normalizeEmailSafe: (...args: any[]) => normalizeEmailSafe(...args),
}));

vi.mock("@/modules/usageSimulator/repo", () => ({
  normalizeScenarioKey: (...args: any[]) => normalizeScenarioKey(...args),
}));

vi.mock("@/lib/admin/simulatorDiagnostic", () => ({
  runSimulatorDiagnostic: (...args: any[]) => runSimulatorDiagnostic(...args),
}));

vi.mock("@/modules/usageSimulator/service", () => ({
  recalcSimulatorBuild: (...args: any[]) => recalcSimulatorBuild(...args),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    user: { findUnique: (...args: any[]) => prismaUserFindUnique(...args) },
    houseAddress: { findFirst: (...args: any[]) => prismaHouseFindFirst(...args) },
    usageSimulatorScenario: { findFirst: (...args: any[]) => prismaScenarioFindFirst(...args) },
    usageSimulatorBuild: { findUnique: (...args: any[]) => prismaBuildFindUnique(...args) },
  },
}));

import { POST } from "@/app/api/admin/simulation-engines/diagnostic/route";

describe("simulation-engines diagnostic identity payload", () => {
  beforeEach(() => {
    requireAdmin.mockReset();
    normalizeEmailSafe.mockReset();
    normalizeScenarioKey.mockReset();
    runSimulatorDiagnostic.mockReset();
    recalcSimulatorBuild.mockReset();
    prismaUserFindUnique.mockReset();
    prismaHouseFindFirst.mockReset();
    prismaScenarioFindFirst.mockReset();
    prismaBuildFindUnique.mockReset();

    requireAdmin.mockReturnValue({ ok: true });
    normalizeEmailSafe.mockImplementation((v: string) => String(v).trim().toLowerCase());
    normalizeScenarioKey.mockImplementation((v: string | null) => v ?? "BASELINE");
    prismaUserFindUnique.mockResolvedValue({ id: "u1", email: "user@example.com" });
    prismaHouseFindFirst.mockResolvedValue({ id: "h1", esiid: "10443720006712345" });
    prismaScenarioFindFirst.mockResolvedValue({ id: "s1" });
    prismaBuildFindUnique.mockResolvedValue({
      buildInputs: {
        mode: "SMT_BASELINE",
        canonicalMonths: ["2026-01"],
        timezone: "America/Chicago",
        travelRanges: [],
      },
      buildInputsHash: "build-hash",
    });
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
      parity: undefined,
      integrity: undefined,
      dayLevelParity: undefined,
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

  it("returns identity values surfaced from shared diagnostic helpers", async () => {
    const req = {
      cookies: { get: () => undefined },
      json: async () => ({ email: "user@example.com", houseId: "h1" }),
    } as any;

    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.diagnostic?.identity?.inputHash).toBe("input-hash");
    expect(body.diagnostic?.identity?.intervalDataFingerprint).toBe("interval-fp");
    expect(body.diagnostic?.identity?.weatherIdentity).toBe("weather-fp");
    expect(body.diagnostic?.identity?.usageShapeProfileIdentity?.usageShapeProfileId).toBe("profile_1");
  });
});
