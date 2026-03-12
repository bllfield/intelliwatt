import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAdmin = vi.fn();
const normalizeEmailSafe = vi.fn();
const chooseActualSource = vi.fn();
const getActualIntervalsForRange = vi.fn();
const inspectPastCacheArtifacts = vi.fn();
const buildAndSavePastForGapfillLab = vi.fn();
const getSimulatedUsageForHouseScenario = vi.fn();

const prismaUserFindFirst = vi.fn();
const prismaHouseFindMany = vi.fn();
const prismaScenarioFindMany = vi.fn();
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
    usageSimulatorScenario: { findMany: (...args: any[]) => prismaScenarioFindMany(...args) },
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

vi.mock("@/lib/admin/gapfillLabPrime", () => ({
  inspectPastCacheArtifacts: (...args: any[]) => inspectPastCacheArtifacts(...args),
  buildAndSavePastForGapfillLab: (...args: any[]) => buildAndSavePastForGapfillLab(...args),
}));

vi.mock("@/modules/usageSimulator/service", () => ({
  getSimulatedUsageForHouseScenario: (...args: any[]) => getSimulatedUsageForHouseScenario(...args),
}));

vi.mock("@/lib/admin/gapfillLab", () => ({
  canonicalIntervalKey: (s: string) => String(s),
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
  mergeDateKeysToRanges: vi.fn(),
  pickRandomTestDateKeys: vi.fn(),
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
    inspectPastCacheArtifacts.mockReset();
    buildAndSavePastForGapfillLab.mockReset();
    getSimulatedUsageForHouseScenario.mockReset();
    prismaUserFindFirst.mockReset();
    prismaHouseFindMany.mockReset();
    prismaScenarioFindMany.mockReset();
    prismaScenarioEventFindMany.mockReset();

    requireAdmin.mockReturnValue({ ok: true });
    normalizeEmailSafe.mockImplementation((v: string) => String(v).trim().toLowerCase());
    prismaUserFindFirst.mockResolvedValue({ id: "u1", email: "user@example.com" });
    prismaHouseFindMany.mockResolvedValue([{ id: "h1", esiid: "1044", addressLine1: "123 Main", addressCity: "Fort Worth", addressState: "TX", addressZip5: "76102", createdAt: new Date() }]);
    prismaScenarioFindMany.mockResolvedValue([]);
    prismaScenarioEventFindMany.mockResolvedValue([]);
    chooseActualSource.mockResolvedValue("SMT");
    getActualIntervalsForRange.mockResolvedValue([
      { timestamp: "2026-01-01T00:00:00.000Z", kwh: 0.25 },
      { timestamp: "2026-01-01T00:15:00.000Z", kwh: 0.25 },
    ]);
  });

  it("returns rebuild-required when artifact is missing and does not rebuild implicitly", async () => {
    inspectPastCacheArtifacts.mockResolvedValue({ count: 0, latestUpdatedAt: null });

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
    expect(buildAndSavePastForGapfillLab).not.toHaveBeenCalled();
    expect(getSimulatedUsageForHouseScenario).not.toHaveBeenCalled();
  });

  it("uses explicit rebuild action and then reads in artifact_only mode", async () => {
    buildAndSavePastForGapfillLab.mockResolvedValue({ ok: true, inputHash: "h", houseId: "h1" });
    getSimulatedUsageForHouseScenario.mockResolvedValue({
      ok: true,
      houseId: "h1",
      scenarioKey: "gapfill_lab",
      scenarioId: "gapfill_lab",
      dataset: {
        series: { intervals15: [{ timestamp: "2026-01-01T00:00:00.000Z", kwh: 0.25 }] },
      },
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
    expect(buildAndSavePastForGapfillLab).toHaveBeenCalledTimes(1);
    expect(getSimulatedUsageForHouseScenario).toHaveBeenCalledWith(
      expect.objectContaining({
        readMode: "artifact_only",
        scenarioId: "gapfill_lab",
      })
    );
  });
});

