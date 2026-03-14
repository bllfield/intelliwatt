import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const requireAdmin = vi.fn();
const normalizeEmailSafe = vi.fn();
const chooseActualSource = vi.fn();
const getActualIntervalsForRange = vi.fn();
const buildGapfillCompareSimShared = vi.fn();
const getCandidateDateCoverageForSelection = vi.fn();
const buildAndSavePastForGapfillLab = vi.fn();
const mergeDateKeysToRanges = vi.fn();
const pickRandomTestDateKeys = vi.fn();

const prismaUserFindFirst = vi.fn();
const prismaHouseFindMany = vi.fn();
const prismaScenarioFindMany = vi.fn();
const prismaScenarioFindFirst = vi.fn();
const prismaBuildFindUnique = vi.fn();
const prismaScenarioEventFindMany = vi.fn();

vi.mock("@/lib/auth/admin", () => ({
  requireAdmin: (...args: any[]) => requireAdmin(...args),
}));

vi.mock("@/lib/utils/email", () => ({
  normalizeEmailSafe: (...args: any[]) => normalizeEmailSafe(...args),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    user: { findFirst: (...args: any[]) => prismaUserFindFirst(...args) },
    houseAddress: { findMany: (...args: any[]) => prismaHouseFindMany(...args), findUnique: vi.fn() },
    usageSimulatorScenario: {
      findMany: (...args: any[]) => prismaScenarioFindMany(...args),
      findFirst: (...args: any[]) => prismaScenarioFindFirst(...args),
    },
    usageSimulatorBuild: { findUnique: (...args: any[]) => prismaBuildFindUnique(...args) },
    usageSimulatorScenarioEvent: { findMany: (...args: any[]) => prismaScenarioEventFindMany(...args) },
  },
}));

vi.mock("@/lib/usage/actualDatasetForHouse", () => ({
  getActualIntervalsForRange: (...args: any[]) => getActualIntervalsForRange(...args),
}));

vi.mock("@/modules/realUsageAdapter/actual", () => ({
  chooseActualSource: (...args: any[]) => chooseActualSource(...args),
}));

vi.mock("@/modules/homeProfile/repo", () => ({
  getHomeProfileSimulatedByUserHouse: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/modules/applianceProfile/repo", () => ({
  getApplianceProfileSimulatedByUserHouse: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/modules/usageSimulator/service", () => ({
  buildGapfillCompareSimShared: (...args: any[]) => buildGapfillCompareSimShared(...args),
}));

vi.mock("@/lib/admin/gapfillLabPrime", async () => {
  const actual = await vi.importActual<any>("@/lib/admin/gapfillLabPrime");
  return {
    ...actual,
    buildAndSavePastForGapfillLab: (...args: any[]) => buildAndSavePastForGapfillLab(...args),
  };
});

vi.mock("@/lib/admin/gapfillLab", () => ({
  canonicalIntervalKey: (s: string) => String(s),
  localDateKeysInRange: (startDate: string, endDate: string) => {
    const start = String(startDate ?? "").slice(0, 10);
    const end = String(endDate ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return [];
    const out: string[] = [];
    let cur = new Date(`${start}T00:00:00.000Z`);
    const last = new Date(`${end}T00:00:00.000Z`);
    if (Number.isNaN(cur.getTime()) || Number.isNaN(last.getTime())) return [];
    while (cur.getTime() <= last.getTime()) {
      out.push(cur.toISOString().slice(0, 10));
      cur = new Date(cur.getTime() + 24 * 60 * 60 * 1000);
    }
    return out;
  },
  buildDailyWeatherFeaturesFromHourly: vi.fn(),
  computeGapFillMetrics: () => ({
    mae: 0,
    rmse: 0,
    mape: 0,
    wape: 0,
    maxAbs: 0,
    totalActualKwhMasked: 1,
    totalSimKwhMasked: 1,
    deltaKwhMasked: 0,
    mapeFiltered: 0,
    mapeFilteredCount: 0,
    byMonth: [],
    byHour: [],
    byDayType: [],
    worstDays: [],
    worst10Abs: [],
    diagnostics: {
      dailyTotalsMasked: [],
      top10Under: [],
      top10Over: [],
      hourlyProfileMasked: [],
      seasonalSplit: { summer: { wape: 0, mae: 0, count: 0 }, winter: { wape: 0, mae: 0, count: 0 }, shoulder: { wape: 0, mae: 0, count: 0 } },
    },
  }),
  dateKeyInTimezone: (iso: string) => String(iso).slice(0, 10),
  getLocalDayOfWeekFromDateKey: vi.fn(),
  mergeDateKeysToRanges: (...args: any[]) => mergeDateKeysToRanges(...args),
  pickRandomTestDateKeys: (...args: any[]) => pickRandomTestDateKeys(...args),
  getCandidateDateCoverageForSelection: (...args: any[]) => getCandidateDateCoverageForSelection(...args),
  prevCalendarDay: vi.fn((s: string) => s),
  summarizeDailyCoverageFromIntervals: vi.fn(),
  filterCandidateDateKeysBySeason: vi.fn(),
  pickExtremeWeatherTestDateKeys: vi.fn(),
}));

vi.mock("@/lib/sim/weatherProvider", () => ({
  getWeatherForRange: vi.fn(),
}));

import { POST } from "@/app/api/admin/tools/gapfill-lab/route";

describe("gapfill-lab route artifact-only hard lock", () => {
  beforeEach(() => {
    requireAdmin.mockReset();
    normalizeEmailSafe.mockReset();
    chooseActualSource.mockReset();
    getActualIntervalsForRange.mockReset();
    buildGapfillCompareSimShared.mockReset();
    getCandidateDateCoverageForSelection.mockReset();
    buildAndSavePastForGapfillLab.mockReset();
    mergeDateKeysToRanges.mockReset();
    pickRandomTestDateKeys.mockReset();
    prismaUserFindFirst.mockReset();
    prismaHouseFindMany.mockReset();
    prismaScenarioFindMany.mockReset();
    prismaScenarioFindFirst.mockReset();
    prismaBuildFindUnique.mockReset();
    prismaScenarioEventFindMany.mockReset();

    requireAdmin.mockReturnValue({ ok: true });
    normalizeEmailSafe.mockImplementation((v: string) => String(v).trim().toLowerCase());
    prismaUserFindFirst.mockResolvedValue({ id: "u1", email: "user@example.com" });
    prismaHouseFindMany.mockResolvedValue([{ id: "h1", esiid: "1044", addressLine1: "123 Main", addressCity: "Fort Worth", addressState: "TX", addressZip5: "76102", createdAt: new Date() }]);
    prismaScenarioFindMany.mockResolvedValue([]);
    prismaScenarioFindFirst.mockResolvedValue({ id: "past-s1" });
    prismaBuildFindUnique.mockResolvedValue({
      buildInputs: {
        canonicalMonths: ["2025-03", "2025-04", "2025-05", "2025-06", "2025-07", "2025-08", "2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02"],
      },
    });
    prismaScenarioEventFindMany.mockResolvedValue([]);
    chooseActualSource.mockResolvedValue("SMT");
    getActualIntervalsForRange.mockResolvedValue([
      { timestamp: "2026-01-01T00:00:00.000Z", kwh: 0.25 },
      { timestamp: "2026-01-01T00:15:00.000Z", kwh: 0.25 },
    ]);
    getCandidateDateCoverageForSelection.mockImplementation(async ({ loadIntervalsForWindow }: any) => {
      const intervals = await loadIntervalsForWindow();
      const dateKeys = Array.from(
        new Set((Array.isArray(intervals) ? intervals : []).map((r: any) => String(r?.timestamp ?? "").slice(0, 10)))
      ).filter((dk) => /^\d{4}-\d{2}-\d{2}$/.test(dk));
      return { candidateDateKeys: dateKeys, cacheHit: false, coverageByDay: {}, intervalsForWindow: intervals ?? [] };
    });
    buildAndSavePastForGapfillLab.mockResolvedValue({
      ok: true,
      inputHash: "ih",
      houseId: "h1",
    });
    pickRandomTestDateKeys.mockReturnValue(["2026-01-01"]);
    mergeDateKeysToRanges.mockReturnValue([{ startDate: "2026-01-01", endDate: "2026-01-01" }]);
  });

  it("returns rebuild-required when artifact is missing and does not rebuild implicitly", async () => {
    buildGapfillCompareSimShared.mockResolvedValue({
      ok: false,
      status: 409,
      body: {
        ok: false,
        error: "artifact_missing_rebuild_required",
        message: "No saved gapfill artifact exists.",
      },
    });

    const req = {
      cookies: { get: () => undefined },
      json: async () => ({
        email: "user@example.com",
        testRanges: [{ startDate: "2026-01-01", endDate: "2026-01-01" }],
      }),
    } as any;
    const res = await POST(req);
    const body = await res.json();
    expect(res.status).toBe(409);
    expect(body.error).toBe("artifact_missing_rebuild_required");
    expect(buildGapfillCompareSimShared).toHaveBeenCalledWith(
      expect.objectContaining({
        rebuildArtifact: false,
      })
    );
  });

  it("uses explicit rebuild action and then reads in artifact_only mode", async () => {
    buildGapfillCompareSimShared.mockResolvedValue({
      ok: true,
      artifactAutoRebuilt: false,
      simulatedTestIntervals: [
        { timestamp: "2026-01-01T00:00:00.000Z", kwh: 0.25 },
        { timestamp: "2026-01-01T00:15:00.000Z", kwh: 0.25 },
      ],
      simulatedChartIntervals: [{ timestamp: "2026-01-01T00:00:00.000Z", kwh: 0.25 }],
      simulatedChartDaily: [{ date: "2026-01-01", simKwh: 0.5, source: "SIMULATED" }],
      simulatedChartMonthly: [{ month: "2026-01", kwh: 0.5 }],
      simulatedChartStitchedMonth: null,
      modelAssumptions: null,
      homeProfileFromModel: null,
      applianceProfileFromModel: null,
    });

    const req = {
      cookies: { get: () => undefined },
      json: async () => ({
        email: "user@example.com",
        rebuildArtifact: true,
        testRanges: [{ startDate: "2026-01-01", endDate: "2026-01-01" }],
      }),
    } as any;
    const res = await POST(req);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.rebuilt).toBe(true);
    expect(buildGapfillCompareSimShared).toHaveBeenCalledWith(
      expect.objectContaining({
        rebuildArtifact: true,
      })
    );
  });

  it("supports rebuild-only action without running compare", async () => {
    const req = {
      cookies: { get: () => undefined },
      json: async () => ({
        email: "user@example.com",
        rebuildArtifact: true,
        rebuildOnly: true,
        testRanges: [{ startDate: "2026-01-01", endDate: "2026-01-01" }],
      }),
    } as any;
    const res = await POST(req);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.action).toBe("rebuild_only");
    expect(body.rebuilt).toBe(true);
    expect(buildAndSavePastForGapfillLab).toHaveBeenCalled();
    expect(buildGapfillCompareSimShared).not.toHaveBeenCalled();
  });

  it("reuses cached candidate intervals for random-day compare without refetching actuals", async () => {
    getActualIntervalsForRange.mockReset();
    getCandidateDateCoverageForSelection.mockResolvedValue({
      candidateDateKeys: ["2026-01-01"],
      cacheHit: true,
      coverageByDay: {},
      intervalsForWindow: [
        { timestamp: "2026-01-01T00:00:00.000Z", kwh: 0.25 },
        { timestamp: "2026-01-01T00:15:00.000Z", kwh: 0.25 },
      ],
    });
    buildGapfillCompareSimShared.mockResolvedValue({
      ok: true,
      artifactAutoRebuilt: false,
      simulatedTestIntervals: [
        { timestamp: "2026-01-01T00:00:00.000Z", kwh: 0.25 },
        { timestamp: "2026-01-01T00:15:00.000Z", kwh: 0.25 },
      ],
      simulatedChartIntervals: [{ timestamp: "2026-01-01T00:00:00.000Z", kwh: 0.25 }],
      simulatedChartDaily: [{ date: "2026-01-01", simKwh: 0.5, source: "SIMULATED" }],
      simulatedChartMonthly: [{ month: "2026-01", kwh: 0.5 }],
      simulatedChartStitchedMonth: null,
      modelAssumptions: null,
      homeProfileFromModel: null,
      applianceProfileFromModel: null,
    });

    const req = {
      cookies: { get: () => undefined },
      json: async () => ({
        email: "user@example.com",
        testDays: 1,
        testMode: "fixed",
      }),
    } as any;
    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(getActualIntervalsForRange).not.toHaveBeenCalled();
  });
});

