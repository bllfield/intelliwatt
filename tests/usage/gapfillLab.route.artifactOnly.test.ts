import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

vi.mock("server-only", () => ({}));
vi.mock("next/link", () => ({
  default: () => null,
}));
vi.mock("@/components/usage/UsageChartsPanel", () => ({
  UsageChartsPanel: () => null,
}));

const requireAdmin = vi.fn();
const normalizeEmailSafe = vi.fn();
const chooseActualSource = vi.fn();
const getActualIntervalsForRange = vi.fn();
const getActualUsageDatasetForHouse = vi.fn();
const buildGapfillCompareSimShared = vi.fn();
const getSharedPastCoverageWindowForHouse = vi.fn();
const rebuildGapfillSharedPastArtifact = vi.fn();
const getCandidateDateCoverageForSelection = vi.fn();
const mergeDateKeysToRanges = vi.fn();
const pickRandomTestDateKeys = vi.fn();
const computeGapFillMetrics = vi.fn();

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
  getActualUsageDatasetForHouse: (...args: any[]) => getActualUsageDatasetForHouse(...args),
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
  getSharedPastCoverageWindowForHouse: (...args: any[]) => getSharedPastCoverageWindowForHouse(...args),
  rebuildGapfillSharedPastArtifact: (...args: any[]) => rebuildGapfillSharedPastArtifact(...args),
}));

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
  computeGapFillMetrics: (...args: any[]) => computeGapFillMetrics(...args),
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

vi.mock("@/lib/time/chicago", async () => {
  const actual = await vi.importActual<any>("@/lib/time/chicago");
  return {
    ...actual,
    canonicalUsageWindowChicago: vi.fn(() => ({ startDate: "2025-03-13", endDate: "2026-03-12" })),
    canonicalUsageWindowForTimezone: vi.fn(() => ({ startDate: "2025-03-13", endDate: "2026-03-12" })),
  };
});

import { POST } from "@/app/api/admin/tools/gapfill-lab/route";

describe("gapfill-lab route artifact-only hard lock", () => {
  const zeroMetrics = () => ({
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
  });
  const withSharedWeatherDefaults = (result: any) => {
    if (!result || result.ok !== true) return result;
    const omitSharedWeather = result.__omitSharedWeather === true;
    const cleanedResult =
      "__omitSharedWeather" in result
        ? Object.fromEntries(Object.entries(result).filter(([key]) => key !== "__omitSharedWeather"))
        : result;
    if (omitSharedWeather) return cleanedResult;
    if (Array.isArray(cleanedResult.scoredDayWeatherRows) || cleanedResult.scoredDayWeatherTruth) return cleanedResult;
    const scoringDateKeys = Array.from(
      new Set<string>([
        ...Array.from(cleanedResult.scoringTestDateKeysLocal ?? []).map((dk) => String(dk ?? "").slice(0, 10)),
        ...((Array.isArray(cleanedResult.simulatedTestIntervals)
          ? cleanedResult.simulatedTestIntervals
          : []
        ) as Array<{ timestamp?: string }>).map((row) => String(row?.timestamp ?? "").slice(0, 10)),
        ...((Array.isArray(cleanedResult.simulatedChartDaily)
          ? cleanedResult.simulatedChartDaily
          : []
        ) as Array<{ date?: string; source?: string }>).map((row) => String(row?.date ?? "").slice(0, 10)),
      ])
    ).filter((dk) => /^\d{4}-\d{2}-\d{2}$/.test(String(dk ?? "")));
    if (scoringDateKeys.length === 0) return cleanedResult;
    return {
      ...cleanedResult,
      scoredDayWeatherRows: scoringDateKeys.map((localDate) => ({
        localDate,
        avgTempF: 51,
        minTempF: 41,
        maxTempF: 61,
        hdd65: 14,
        cdd65: 0,
        weatherBasisUsed: cleanedResult.weatherBasisUsed ?? "actual_only",
        weatherKindUsed: "actual",
        weatherSourceUsed: "open_meteo",
        weatherProviderName: "Open-Meteo",
        weatherFallbackReason: null,
      })),
      scoredDayWeatherTruth: {
        availability: "available",
        reasonCode: "SCORED_DAY_WEATHER_AVAILABLE",
        explanation: "Compact scored-day weather truth is available from the shared compare execution.",
        source: "shared_compare_scored_day_weather",
        scoredDateCount: scoringDateKeys.length,
        weatherRowCount: scoringDateKeys.length,
        missingDateCount: 0,
        missingDateSample: [],
      },
    };
  };
  const mockCompareResult = (result: any) =>
    buildGapfillCompareSimShared.mockResolvedValue(withSharedWeatherDefaults(result));
  const mockCompareResultOnce = (result: any) =>
    buildGapfillCompareSimShared.mockResolvedValueOnce(withSharedWeatherDefaults(result));
  beforeEach(() => {
    requireAdmin.mockReset();
    normalizeEmailSafe.mockReset();
    chooseActualSource.mockReset();
    getActualIntervalsForRange.mockReset();
    buildGapfillCompareSimShared.mockReset();
    getSharedPastCoverageWindowForHouse.mockReset();
    getCandidateDateCoverageForSelection.mockReset();
    rebuildGapfillSharedPastArtifact.mockReset();
    mergeDateKeysToRanges.mockReset();
    pickRandomTestDateKeys.mockReset();
    computeGapFillMetrics.mockReset();
    vi.restoreAllMocks();
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
    getSharedPastCoverageWindowForHouse.mockResolvedValue({
      startDate: "2025-03-14",
      endDate: "2026-03-14",
    });
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
    rebuildGapfillSharedPastArtifact.mockResolvedValue({
      ok: true,
      scenarioId: "past-s1",
      artifactScenarioId: "past-s1",
      requestedInputHash: "hash-ensure-default",
      artifactInputHashUsed: "hash-ensure-default",
      artifactHashMatch: true,
      artifactSourceMode: "exact_hash_match",
      artifactSourceNote: "Artifact source: exact identity match on Past input hash.",
    });
    pickRandomTestDateKeys.mockReturnValue(["2026-01-01"]);
    mergeDateKeysToRanges.mockReturnValue([{ startDate: "2026-01-01", endDate: "2026-01-01" }]);
    computeGapFillMetrics.mockImplementation(() => zeroMetrics());
  });

  it("returns rebuild-required when artifact is missing and does not rebuild implicitly", async () => {
    mockCompareResult({
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
        includeFullReportText: true,
      }),
    } as any;
    const res = await POST(req);
    const body = await res.json();
    expect(res.status).toBe(409);
    expect(body.error).toBe("artifact_missing_rebuild_required");
    expect(body.compareRequestTruth).toEqual({
      includeDiagnosticsRequested: false,
      includeFullReportTextRequested: true,
      compareFreshModeRequested: "full_window",
    });
    expect(buildGapfillCompareSimShared).toHaveBeenCalledWith(
      expect.objectContaining({
        rebuildArtifact: false,
        compareFreshMode: "full_window",
      })
    );
  });

  it("uses explicit rebuild action and then reads in artifact_only mode", async () => {
    mockCompareResult({
      ok: true,
      artifactAutoRebuilt: false,
      sharedCoverageWindow: { startDate: "2025-03-14", endDate: "2026-03-14" },
      boundedTravelDateKeysLocal: new Set<string>(),
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
        autoEnsureArtifact: true,
        compareFreshMode: "selected_days",
      })
    );
  });

  it("supports rebuild-only action without running compare", async () => {
    rebuildGapfillSharedPastArtifact.mockResolvedValueOnce({
      ok: true,
      scenarioId: "past-s1",
      artifactScenarioId: "past-s1",
      requestedInputHash: "hash-ensure-1",
      artifactInputHashUsed: "hash-ensure-1",
      artifactHashMatch: true,
      artifactSourceMode: "exact_hash_match",
      artifactSourceNote: "Artifact source: exact identity match on Past input hash.",
    });
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
    expect(body.scenarioId).toBe("past-s1");
    expect(body.artifactScenarioId).toBe("past-s1");
    expect(body.requestedInputHash).toBe("hash-ensure-1");
    expect(body.artifactInputHashUsed).toBe("hash-ensure-1");
    expect(body.artifactHashMatch).toBe(true);
    expect(body.artifactSourceMode).toBe("exact_hash_match");
    expect(body.testRangesUsed).toEqual([{ startDate: "2026-01-01", endDate: "2026-01-01" }]);
    expect(body.testSelectionMode).toBe("manual_ranges");
    expect(rebuildGapfillSharedPastArtifact).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "u1",
        houseId: "h1",
      })
    );
    expect(buildGapfillCompareSimShared).not.toHaveBeenCalled();
    expect(getActualIntervalsForRange).not.toHaveBeenCalled();
  });

  it("expands manual-range actual fetch by one day on each side for timezone spillover safety", async () => {
    getActualIntervalsForRange.mockResolvedValueOnce([
      { timestamp: "2026-01-01T05:00:00.000Z", kwh: 0.25 },
      { timestamp: "2026-01-01T05:15:00.000Z", kwh: 0.25 },
    ]);
    mockCompareResultOnce({
      ok: true,
      artifactAutoRebuilt: false,
      timezoneUsedForScoring: "America/Chicago",
      windowUsedForScoring: { startDate: "2025-03-14", endDate: "2026-03-14" },
      scoringTestDateKeysLocal: new Set<string>(["2026-01-01"]),
      sharedCoverageWindow: { startDate: "2025-03-14", endDate: "2026-03-14" },
      boundedTravelDateKeysLocal: new Set<string>(),
      simulatedTestIntervals: [
        { timestamp: "2026-01-01T05:00:00.000Z", kwh: 0.25 },
        { timestamp: "2026-01-01T05:15:00.000Z", kwh: 0.25 },
      ],
      simulatedChartIntervals: [{ timestamp: "2026-01-01T05:00:00.000Z", kwh: 0.25 }],
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
        testRanges: [{ startDate: "2026-01-01", endDate: "2026-01-01" }],
        includeFullReportText: true,
      }),
    } as any;
    const res = await POST(req);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(getActualIntervalsForRange).toHaveBeenCalledWith(
      expect.objectContaining({
        startDate: "2025-12-31",
        endDate: "2026-01-02",
      })
    );
  });

  it("uses service-provided scoring date-key selection metadata for actual-vs-sim join filtering", async () => {
    getActualIntervalsForRange.mockResolvedValueOnce([
      { timestamp: "2026-01-01T00:00:00.000Z", kwh: 0.25 },
      { timestamp: "2026-01-02T00:00:00.000Z", kwh: 0.5 },
    ]);
    mockCompareResultOnce({
      ok: true,
      artifactAutoRebuilt: false,
      timezoneUsedForScoring: "America/Chicago",
      windowUsedForScoring: { startDate: "2025-03-14", endDate: "2026-03-14" },
      scoringTestDateKeysLocal: new Set<string>(["2026-01-02"]),
      sharedCoverageWindow: { startDate: "2025-03-14", endDate: "2026-03-14" },
      boundedTravelDateKeysLocal: new Set<string>(),
      simulatedTestIntervals: [{ timestamp: "2026-01-02T00:00:00.000Z", kwh: 0.5 }],
      simulatedChartIntervals: [{ timestamp: "2026-01-02T00:00:00.000Z", kwh: 0.5 }],
      simulatedChartDaily: [{ date: "2026-01-02", simKwh: 0.5, source: "SIMULATED" }],
      simulatedChartMonthly: [{ month: "2026-01", kwh: 0.5 }],
      simulatedChartStitchedMonth: null,
      modelAssumptions: null,
      homeProfileFromModel: null,
      applianceProfileFromModel: null,
    });
    computeGapFillMetrics.mockImplementation(({ actual, simulatedByTs }: any) => {
      const matched = actual.filter((p: any) => simulatedByTs.has(p.timestamp));
      return {
        ...zeroMetrics(),
        totalActualKwhMasked: matched.reduce((s: number, p: any) => s + (Number(p.kwh) || 0), 0),
        totalSimKwhMasked: matched.reduce((s: number, p: any) => s + (Number(simulatedByTs.get(p.timestamp)) || 0), 0),
      };
    });

    const req = {
      cookies: { get: () => undefined },
      json: async () => ({
        email: "user@example.com",
        testRanges: [{ startDate: "2026-01-01", endDate: "2026-01-01" }],
        includeDiagnostics: true,
        includeFullReportText: true,
      }),
    } as any;
    const res = await POST(req);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.timezoneUsedForScoring).toBe("America/Chicago");
    expect(body.windowUsedForScoring).toEqual({ startDate: "2025-03-14", endDate: "2026-03-14" });
    expect(body.actualTestIntervalsCount).toBe(1);
    expect(body.scoredTestDaysMissingSimulatedOwnershipCount).toBe(0);
  });

  it("uses shared coverage window and bounded travel count in metadata outputs", async () => {
    mockCompareResultOnce({
      ok: true,
      artifactAutoRebuilt: false,
      sharedCoverageWindow: { startDate: "2025-03-14", endDate: "2026-03-14" },
      boundedTravelDateKeysLocal: new Set<string>(["2025-03-14", "2025-03-15", "2025-08-13"]),
      simulatedTestIntervals: [
        { timestamp: "2026-01-01T00:00:00.000Z", kwh: 0.25 },
        { timestamp: "2026-01-01T00:15:00.000Z", kwh: 0.25 },
      ],
      simulatedChartIntervals: [{ timestamp: "2026-01-01T00:00:00.000Z", kwh: 0.25 }],
      simulatedChartDaily: [{ date: "2026-01-01", simKwh: 0.5, source: "SIMULATED" }],
      simulatedChartMonthly: [{ month: "2026-01", kwh: 0.5 }],
      simulatedChartStitchedMonth: null,
      modelAssumptions: {
        intervalCount: 1,
        artifactSourceMode: "exact_hash_match",
        requestedInputHash: "hash-1",
        artifactInputHashUsed: "hash-1",
        artifactHashMatch: true,
        artifactScenarioId: "past_s1",
        artifactCreatedAt: null,
        artifactUpdatedAt: "2026-01-02T00:00:00.000Z",
        artifactSourceNote: "Artifact source: exact identity match on Past input hash.",
        artifactInputHash: "hash-1",
      },
      homeProfileFromModel: null,
      applianceProfileFromModel: null,
    });

    const req = {
      cookies: { get: () => undefined },
      json: async () => ({
        email: "user@example.com",
        testRanges: [{ startDate: "2026-01-01", endDate: "2026-01-01" }],
        includeDiagnostics: true,
        includeFullReportText: true,
      }),
    } as any;
    const res = await POST(req);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.parity?.windowStartUtc).toBe("2025-03-14");
    expect(body.parity?.windowEndUtc).toBe("2026-03-14");
    expect(String(body.fullReportText ?? "")).toContain("windowStartUtc: 2025-03-14");
    expect(String(body.fullReportText ?? "")).toContain("windowEndUtc: 2026-03-14");
    expect(String(body.fullReportText ?? "")).toContain("excludedDateKeysCount: 3");
  expect(body.artifactSourceMode).toBe("exact_hash_match");
  expect(body.requestedInputHash).toBe("hash-1");
  expect(body.artifactInputHashUsed).toBe("hash-1");
  expect(body.artifactHashMatch).toBe(true);
  expect(body.scenarioId).toBe("past_s1");
  expect(body.artifactScenarioId).toBe("past_s1");
  expect(body.artifactUpdatedAt).toBe("2026-01-02T00:00:00.000Z");
  expect(typeof body.artifactSourceNote).toBe("string");
  });

  it("keeps travel-day displayed kWh identical across shared artifact daily output and gap-fill chart/table output", async () => {
    const sharedPastDaily = [{ date: "2025-06-01", simKwh: 56.74, source: "SIMULATED" as const }];
    mockCompareResultOnce({
      ok: true,
      artifactAutoRebuilt: false,
      sharedCoverageWindow: { startDate: "2025-03-14", endDate: "2026-03-14" },
      boundedTravelDateKeysLocal: new Set<string>(["2025-06-01"]),
      simulatedTestIntervals: [
        { timestamp: "2026-01-01T00:00:00.000Z", kwh: 0.25 },
        { timestamp: "2026-01-01T00:15:00.000Z", kwh: 0.25 },
      ],
      simulatedChartIntervals: [{ timestamp: "2025-06-01T00:00:00.000Z", kwh: 56.74 / 96 }],
      simulatedChartDaily: sharedPastDaily,
      simulatedChartMonthly: [{ month: "2025-06", kwh: 900 }],
      simulatedChartStitchedMonth: null,
      modelAssumptions: null,
      homeProfileFromModel: null,
      applianceProfileFromModel: null,
    });

    const req = {
      cookies: { get: () => undefined },
      json: async () => ({
        email: "user@example.com",
        testRanges: [{ startDate: "2026-01-01", endDate: "2026-01-01" }],
        includeDiagnostics: true,
      }),
    } as any;
    const res = await POST(req);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.diagnostics?.dailyTotalsChartSim).toEqual(sharedPastDaily);
    expect(body.diagnostics?.dailyTotalsChartSim?.[0]?.simKwh).toBe(56.74);
    expect(body.diagnostics?.dailyTotalsChartSim?.[0]?.source).toBe("SIMULATED");
    expect(body.displaySimulated?.daily).toEqual(sharedPastDaily);
    expect(body.displaySimulated?.daily?.[0]?.simKwh).toBe(56.74);
  });

  it("falls back scenarioId to context scenario id when artifactScenarioId is null", async () => {
    mockCompareResultOnce({
      ok: true,
      artifactAutoRebuilt: false,
      sharedCoverageWindow: { startDate: "2025-03-14", endDate: "2026-03-14" },
      boundedTravelDateKeysLocal: new Set<string>(),
      simulatedTestIntervals: [
        { timestamp: "2026-01-01T00:00:00.000Z", kwh: 0.25 },
        { timestamp: "2026-01-01T00:15:00.000Z", kwh: 0.25 },
      ],
      simulatedChartIntervals: [{ timestamp: "2026-01-01T00:00:00.000Z", kwh: 0.25 }],
      simulatedChartDaily: [{ date: "2026-01-01", simKwh: 0.5, source: "SIMULATED" }],
      simulatedChartMonthly: [{ month: "2026-01", kwh: 0.5 }],
      simulatedChartStitchedMonth: null,
      modelAssumptions: {
        scenarioId: "past-context-s1",
        artifactScenarioId: null,
      },
      homeProfileFromModel: null,
      applianceProfileFromModel: null,
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
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.scenarioId).toBe("past-context-s1");
    expect(body.artifactScenarioId).toBeNull();
  });

  it("falls back scenarioId to past_shared_artifact when artifact and context scenario ids are missing", async () => {
    mockCompareResultOnce({
      ok: true,
      artifactAutoRebuilt: false,
      sharedCoverageWindow: { startDate: "2025-03-14", endDate: "2026-03-14" },
      boundedTravelDateKeysLocal: new Set<string>(),
      simulatedTestIntervals: [
        { timestamp: "2026-01-01T00:00:00.000Z", kwh: 0.25 },
        { timestamp: "2026-01-01T00:15:00.000Z", kwh: 0.25 },
      ],
      simulatedChartIntervals: [{ timestamp: "2026-01-01T00:00:00.000Z", kwh: 0.25 }],
      simulatedChartDaily: [{ date: "2026-01-01", simKwh: 0.5, source: "SIMULATED" }],
      simulatedChartMonthly: [{ month: "2026-01", kwh: 0.5 }],
      simulatedChartStitchedMonth: null,
      modelAssumptions: {},
      homeProfileFromModel: null,
      applianceProfileFromModel: null,
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
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.scenarioId).toBe("past_shared_artifact");
    expect(body.artifactScenarioId).toBeNull();
  });

  it("does not collapse to zero metrics when simulated scoring intervals differ from actual", async () => {
    mockCompareResultOnce({
      ok: true,
      artifactAutoRebuilt: false,
      scoringSimulatedSource: "shared_artifact_simulated_intervals15",
      scoringUsedSharedArtifact: true,
      sharedCoverageWindow: { startDate: "2025-03-14", endDate: "2026-03-14" },
      boundedTravelDateKeysLocal: new Set<string>(),
      simulatedTestIntervals: [
        { timestamp: "2026-01-01T00:00:00.000Z", kwh: 0.75 },
        { timestamp: "2026-01-01T00:15:00.000Z", kwh: 0.75 },
      ],
      simulatedChartIntervals: [{ timestamp: "2026-01-01T00:00:00.000Z", kwh: 0.75 }],
      simulatedChartDaily: [{ date: "2026-01-01", simKwh: 1.5, source: "SIMULATED" }],
      simulatedChartMonthly: [{ month: "2026-01", kwh: 1.5 }],
      simulatedChartStitchedMonth: null,
      modelAssumptions: null,
      homeProfileFromModel: null,
      applianceProfileFromModel: null,
    });
    getActualIntervalsForRange.mockResolvedValueOnce([
      { timestamp: "2026-01-01T00:00:00.000Z", kwh: 0.25 },
      { timestamp: "2026-01-01T00:15:00.000Z", kwh: 0.25 },
    ]);
    computeGapFillMetrics.mockImplementation(({ actual, simulatedByTs }: any) => {
      const abs = actual.map((p: any) => Math.abs((simulatedByTs.get(p.timestamp) ?? 0) - (Number(p.kwh) || 0)));
      const mae = abs.reduce((s: number, v: number) => s + v, 0) / Math.max(1, abs.length);
      return {
        ...zeroMetrics(),
        mae,
        rmse: mae,
        mape: 100,
        wape: 100,
        maxAbs: Math.max(...abs),
        totalActualKwhMasked: 0.5,
        totalSimKwhMasked: 1.5,
        deltaKwhMasked: 1.0,
      };
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
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.metrics.mae).toBeGreaterThan(0);
    expect(body.metrics.wape).toBeGreaterThan(0);
    expect(body.scoringActualSource).toBe("actual_usage_test_window_intervals");
    expect(body.scoringSimulatedSource).toBe("shared_artifact_simulated_intervals15");
    expect(body.scoringUsedSharedArtifact).toBe(true);
    expect(body.comparePulledFromSharedArtifactOnly).toBe(true);
    expect(body.artifactUsesTestDaysInIdentity).toBe(false);
    expect(body.artifactUsesTravelDaysInIdentity).toBe(true);
    expect(body.artifactBuildExcludedSource).toBe("shared_past_travel_vacant_excludedDateKeysFingerprint");
    expect(body.scoringExcludedSource).toBe("shared_past_travel_vacant_excludedDateKeysFingerprint");
    expect(body.hasScoreableIntervals).toBe(true);
  });

  it("returns success with zero scored intervals when shared artifact has no selected test-date intervals", async () => {
    mockCompareResultOnce({
      ok: true,
      artifactAutoRebuilt: false,
      scoringSimulatedSource: "shared_artifact_simulated_intervals15",
      scoringUsedSharedArtifact: true,
      sharedCoverageWindow: { startDate: "2025-03-14", endDate: "2026-03-14" },
      boundedTravelDateKeysLocal: new Set<string>(),
      simulatedTestIntervals: [],
      simulatedChartIntervals: [{ timestamp: "2026-01-01T00:00:00.000Z", kwh: 0.25 }],
      simulatedChartDaily: [{ date: "2026-01-01", simKwh: 0.25, source: "ACTUAL" }],
      simulatedChartMonthly: [{ month: "2026-01", kwh: 0.25 }],
      simulatedChartStitchedMonth: null,
      modelAssumptions: null,
      homeProfileFromModel: null,
      applianceProfileFromModel: null,
    });
    getActualIntervalsForRange.mockResolvedValueOnce([
      { timestamp: "2026-01-01T00:00:00.000Z", kwh: 0.25 },
      { timestamp: "2026-01-01T00:15:00.000Z", kwh: 0.25 },
    ]);

    const req = {
      cookies: { get: () => undefined },
      json: async () => ({
        email: "user@example.com",
        testRanges: [{ startDate: "2026-01-01", endDate: "2026-01-01" }],
      }),
    } as any;
    const res = await POST(req);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.actualTestIntervalsCount).toBe(0);
    expect(body.simulatedTestIntervalsCount).toBe(0);
    expect(body.hasScoreableIntervals).toBe(false);
    expect(String(body.message ?? "")).toContain("shared compare scoring output");
    expect(body.scoredTestDaysMissingSimulatedOwnershipCount).toBe(1);
  });

  it("does not pass legacy travelSimulatedDateKeysLocal argument to shared module", async () => {
    prismaScenarioFindMany.mockResolvedValueOnce([{ id: "past-s1" }]);
    prismaScenarioEventFindMany.mockResolvedValueOnce([
      { payloadJson: { startDate: "2024-01-01", endDate: "2024-01-02" } },
    ]);
    mockCompareResultOnce({
      ok: true,
      artifactAutoRebuilt: false,
      sharedCoverageWindow: { startDate: "2025-03-14", endDate: "2026-03-14" },
      boundedTravelDateKeysLocal: new Set<string>(),
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
        testRanges: [{ startDate: "2026-01-01", endDate: "2026-01-01" }],
      }),
    } as any;
    const res = await POST(req);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);

    const callArg = buildGapfillCompareSimShared.mock.calls.at(-1)?.[0];
    expect(callArg?.travelSimulatedDateKeysLocal).toBeUndefined();
  });

  it("returns classified stale-rebuild response when shared artifact is stale", async () => {
    mockCompareResultOnce({
      ok: false,
      status: 409,
      body: {
        ok: false,
        error: "artifact_stale_rebuild_required",
        message: "Saved shared Past artifact is stale/incomplete for this canonical window.",
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
    expect(body.error).toBe("artifact_stale_rebuild_required");
    expect(body.reasonCode).toBe("ARTIFACT_STALE_REBUILD_REQUIRED");
    expect(Array.isArray(body.missingData)).toBe(true);
  });

  it("returns join-incomplete rebuild-required when simulated join timestamps are missing", async () => {
    mockCompareResultOnce({
      ok: true,
      artifactAutoRebuilt: false,
      scoringSimulatedSource: "shared_artifact_simulated_intervals15",
      scoringUsedSharedArtifact: true,
      sharedCoverageWindow: { startDate: "2025-03-14", endDate: "2026-03-14" },
      boundedTravelDateKeysLocal: new Set<string>(),
      simulatedTestIntervals: [{ timestamp: "2026-01-01T00:00:00.000Z", kwh: 0.25 }],
      simulatedChartIntervals: [{ timestamp: "2026-01-01T00:00:00.000Z", kwh: 0.25 }],
      simulatedChartDaily: [{ date: "2026-01-01", simKwh: 0.25, source: "SIMULATED" }],
      simulatedChartMonthly: [{ month: "2026-01", kwh: 0.25 }],
      simulatedChartStitchedMonth: null,
      modelAssumptions: null,
      homeProfileFromModel: null,
      applianceProfileFromModel: null,
    });
    getActualIntervalsForRange.mockResolvedValueOnce([
      { timestamp: "2026-01-01T00:00:00.000Z", kwh: 0.25 },
      { timestamp: "2026-01-01T00:15:00.000Z", kwh: 0.25 },
    ]);

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
    expect(body.error).toBe("artifact_compare_join_incomplete_rebuild_required");
    expect(body.reasonCode).toBe("ARTIFACT_COMPARE_JOIN_INCOMPLETE_REBUILD_REQUIRED");
    expect(body.joinMissingCount).toBeGreaterThan(0);
  });

  it("keeps compare scoring non-blocking when artifact join is incomplete but fresh scoring join is complete", async () => {
    mockCompareResultOnce({
      ok: true,
      artifactAutoRebuilt: false,
      scoringSimulatedSource: "shared_selected_days_simulated_intervals15",
      compareSharedCalcPath: "simulatePastSelectedDaysShared(buildPastSimulatedBaselineV1->simulatePastDay)->buildGapfillCompareSimShared",
      compareFreshModeUsed: "selected_days",
      compareCalculationScope: "selected_days_shared_path_only",
      compareSimSource: "shared_selected_days_calc",
      displaySimSource: "dataset.daily",
      weatherBasisUsed: "actual_only",
      sharedCoverageWindow: { startDate: "2025-03-14", endDate: "2026-03-14" },
      boundedTravelDateKeysLocal: new Set<string>(),
      artifactIntervals: [{ timestamp: "2026-01-01T00:00:00.000Z", kwh: 0.25 }],
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
    getActualIntervalsForRange.mockResolvedValueOnce([
      { timestamp: "2026-01-01T00:00:00.000Z", kwh: 0.25 },
      { timestamp: "2026-01-01T00:15:00.000Z", kwh: 0.25 },
    ]);

    const req = {
      cookies: { get: () => undefined },
      json: async () => ({
        email: "user@example.com",
        testRanges: [{ startDate: "2026-01-01", endDate: "2026-01-01" }],
      }),
    } as any;
    const res = await POST(req);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.scoringUsedSharedArtifact).toBe(false);
    expect(body.artifactDisplayReferenceWarning).toMatchObject({
      code: "artifact_display_reference_incomplete",
      nonBlocking: true,
      joinMissingCount: 1,
    });
    expect(body.truthEnvelope?.artifactDisplayReferenceWarning).toMatchObject({
      code: "artifact_display_reference_incomplete",
      nonBlocking: true,
      joinMissingCount: 1,
    });
  });

  it("returns compare_scoring_join_incomplete when fresh selected-day scoring join is incomplete", async () => {
    mockCompareResultOnce({
      ok: true,
      artifactAutoRebuilt: false,
      scoringSimulatedSource: "shared_selected_days_simulated_intervals15",
      compareSharedCalcPath: "simulatePastSelectedDaysShared(buildPastSimulatedBaselineV1->simulatePastDay)->buildGapfillCompareSimShared",
      compareFreshModeUsed: "selected_days",
      compareCalculationScope: "selected_days_shared_path_only",
      compareSimSource: "shared_selected_days_calc",
      displaySimSource: "dataset.daily",
      weatherBasisUsed: "actual_only",
      sharedCoverageWindow: { startDate: "2025-03-14", endDate: "2026-03-14" },
      boundedTravelDateKeysLocal: new Set<string>(),
      artifactIntervals: [
        { timestamp: "2026-01-01T00:00:00.000Z", kwh: 0.25 },
        { timestamp: "2026-01-01T00:15:00.000Z", kwh: 0.25 },
      ],
      simulatedTestIntervals: [{ timestamp: "2026-01-01T00:00:00.000Z", kwh: 0.25 }],
      simulatedChartIntervals: [{ timestamp: "2026-01-01T00:00:00.000Z", kwh: 0.25 }],
      simulatedChartDaily: [{ date: "2026-01-01", simKwh: 0.25, source: "SIMULATED" }],
      simulatedChartMonthly: [{ month: "2026-01", kwh: 0.25 }],
      simulatedChartStitchedMonth: null,
      modelAssumptions: null,
      homeProfileFromModel: null,
      applianceProfileFromModel: null,
    });
    getActualIntervalsForRange.mockResolvedValueOnce([
      { timestamp: "2026-01-01T00:00:00.000Z", kwh: 0.25 },
      { timestamp: "2026-01-01T00:15:00.000Z", kwh: 0.25 },
    ]);

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
    expect(body.error).toBe("compare_scoring_join_incomplete");
    expect(body.reasonCode).toBe("COMPARE_SCORING_JOIN_INCOMPLETE");
    expect(Array.isArray(body.missingData)).toBe(true);
    expect(body.missingData).toContain("fresh_shared_compare_intervals15");
    expect(body.joinMissingCount).toBeGreaterThan(0);
    expect(body.compareCoreTiming?.lastCompletedStep).toBe("join_actual_vs_sim");
    expect(body.compareCoreTiming?.failedStep).toBe("join_actual_vs_sim");
  });

  it("returns compact response by default while keeping integrity/count metadata", async () => {
    mockCompareResultOnce({
      ok: true,
      artifactAutoRebuilt: false,
      scoringSimulatedSource: "shared_selected_days_simulated_intervals15",
      scoringUsedSharedArtifact: false,
      compareSharedCalcPath: "simulatePastSelectedDaysShared(buildPastSimulatedBaselineV1->simulatePastDay)->buildGapfillCompareSimShared",
      compareFreshModeUsed: "selected_days",
      compareCalculationScope: "selected_days_shared_path_only",
      displaySimSource: "dataset.daily",
      compareSimSource: "shared_selected_days_calc",
      weatherBasisUsed: "actual_only",
      scoredDayWeatherRows: [
        {
          localDate: "2026-01-01",
          avgTempF: 51,
          minTempF: 41,
          maxTempF: 61,
          hdd65: 14,
          cdd65: 0,
          weatherBasisUsed: "actual_only",
          weatherKindUsed: "ACTUAL_LAST_YEAR",
          weatherSourceUsed: "OPEN_METEO",
          weatherProviderName: "OPEN_METEO",
          weatherFallbackReason: null,
        },
      ],
      scoredDayWeatherTruth: {
        availability: "available",
        reasonCode: "SCORED_DAY_WEATHER_AVAILABLE",
        explanation: "Compact scored-day weather truth is available from the shared compare execution.",
        source: "shared_compare_scored_day_weather",
        scoredDateCount: 1,
        weatherRowCount: 1,
        missingDateCount: 0,
        missingDateSample: [],
      },
      displayVsFreshParityForScoredDays: {
        matches: true,
        mismatchCount: 0,
        mismatchSampleDates: [],
        missingDisplaySimCount: 0,
        complete: true,
        parityDisplaySourceUsed: "canonical_artifact_simulated_day_totals",
        parityDisplayValueKind: "artifact_simulated_day_total",
        scope: "scored_test_days_local",
        granularity: "daily_kwh_rounded_2dp",
        comparisonBasis: "artifact_simulated_display_rows_vs_compare_selected_days_fresh_calc",
      },
      travelVacantParityRows: [
        {
          localDate: "2025-12-25",
          artifactCanonicalSimDayKwh: 12.34,
          freshSharedDayCalcKwh: 12.34,
          parityMatch: true,
          artifactReferenceAvailability: "available",
          freshCompareAvailability: "available",
          parityReasonCode: "TRAVEL_VACANT_PARITY_MATCH",
        },
      ],
      travelVacantParityTruth: {
        availability: "validated",
        reasonCode: "TRAVEL_VACANT_PARITY_VALIDATED",
        explanation:
          "DB travel/vacant parity validation proved canonical artifact simulated-day totals match fresh shared compare totals for the validated dates.",
        source: "db_travel_vacant_ranges",
        comparisonBasis: "canonical_artifact_simulated_day_totals_vs_fresh_shared_compare_daily_totals",
        requestedDateCount: 1,
        validatedDateCount: 1,
        mismatchCount: 0,
        missingArtifactReferenceCount: 0,
        missingFreshCompareCount: 0,
        requestedDateSample: ["2025-12-25"],
        exactProofRequired: false,
        exactProofSatisfied: true,
      },
      sharedCoverageWindow: { startDate: "2025-03-14", endDate: "2026-03-14" },
      boundedTravelDateKeysLocal: new Set<string>(),
      simulatedTestIntervals: [
        { timestamp: "2026-01-01T00:00:00.000Z", kwh: 0.25 },
        { timestamp: "2026-01-01T00:15:00.000Z", kwh: 0.25 },
      ],
      artifactSimulatedDayReferenceSource: "canonical_artifact_simulated_day_totals",
      artifactSimulatedDayReferenceRows: [{ date: "2026-01-01", simKwh: 0.5 }],
      simulatedChartIntervals: [{ timestamp: "2026-01-01T00:00:00.000Z", kwh: 0.25 }],
      simulatedChartDaily: [{ date: "2026-01-01", simKwh: 0.5, source: "SIMULATED" }],
      simulatedChartMonthly: [{ month: "2026-01", kwh: 0.5 }],
      simulatedChartStitchedMonth: null,
      modelAssumptions: {
        artifactSourceMode: "exact_hash_match",
        requestedInputHash: "hash-1",
        artifactInputHashUsed: "hash-1",
        artifactHashMatch: true,
        artifactScenarioId: "past-s1",
        artifactRequestedScenarioId: "past-s1",
        artifactExactIdentityRequested: true,
        artifactExactIdentityResolved: true,
        artifactIdentitySource: "same_run_artifact_ensure",
        artifactSameRunEnsureIdentity: true,
        artifactFallbackOccurred: false,
        artifactFallbackReason: null,
        artifactExactIdentifierUsed: "past-s1:hash-1",
        usageShapeProfileDiag: { found: true, reasonNotUsed: null },
        weatherApiData: [
          { dateKey: "2026-01-01", tAvgF: 51 },
          { dateKey: "2026-01-02", tAvgF: 52 },
        ],
        simulatedDayDiagnosticsSample: [
          { localDate: "2026-01-01", fallbackLevel: null },
          { localDate: "2026-01-02", fallbackLevel: "fallback" },
        ],
        dayTotalDiagnostics: { heavy: true },
      },
      homeProfileFromModel: null,
      applianceProfileFromModel: null,
      scoringTestDateKeysLocal: new Set<string>(["2026-01-01"]),
      timezoneUsedForScoring: "America/Chicago",
      windowUsedForScoring: { startDate: "2025-03-14", endDate: "2026-03-14" },
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

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.requestedTestDaysCount).toBe(1);
    expect(body.scoringTestDaysCount).toBe(1);
    expect(body.scoredIntervalsCount).toBe(2);
    expect(body.compareSharedCalcPath).toContain("simulatePastSelectedDaysShared");
    expect(body.compareFreshModeUsed).toBe("selected_days");
    expect(body.compareCoreMode).toBe("selected_days_core_lightweight");
    expect(body.compareCoreStepTimings).toEqual(body.compareCoreTiming?.stepsMs);
    expect(body.selectedFreshIntervalCount).toBe(2);
    expect(body.selectedActualIntervalCount).toBe(2);
    expect(body.artifactReferenceDayCount).toBe(1);
    expect(body.compareCoreTiming?.selectedDaysCoreLightweight).toBe(true);
    expect(body.compareCoreTiming?.selectedDaysRequestedCount).toBe(1);
    expect(body.compareCoreTiming?.selectedDaysScoredCount).toBe(1);
    expect(body.compareCoreTiming?.freshSimIntervalCountSelectedDays).toBe(2);
    expect(body.compareCoreTiming?.actualIntervalCountSelectedDays).toBe(2);
    expect(body.compareCoreTiming?.artifactReferenceDayCountUsed).toBe(1);
    expect(body.compareCoreTiming?.compareCorePhaseStep).toBe("finalize_response");
    expect(body.compareCoreTiming?.compareCorePhaseElapsedMsByStep).toEqual(body.compareCoreTiming?.stepsMs);
    expect(body.compareCoreTiming?.stepsMs?.build_shared_compare).toBeTypeOf("number");
    expect(body.compareCoreTiming?.stepsMs?.build_metrics).toBeTypeOf("number");
    expect(body.compareCoreTiming?.stepsMs?.build_diagnostics).toBeTypeOf("number");
    expect(body.compareCalculationScope).toBe("selected_days_shared_path_only");
    expect(body.displaySimSource).toBe("dataset.daily");
    expect(body.compareSimSource).toBe("shared_selected_days_calc");
    expect(body.weatherBasisUsed).toBe("actual_only");
    expect(body.displayVsFreshParityForScoredDays?.matches).toBe(true);
    expect(body.displayVsFreshParityForScoredDays?.missingDisplaySimCount).toBe(0);
    expect(body.displayVsFreshParityForScoredDays?.scope).toBe("scored_test_days_local");
    expect(body.compareTruth?.compareFreshModeUsed).toBe("selected_days");
    expect(body.compareRequestTruth).toEqual({
      includeDiagnosticsRequested: false,
      includeFullReportTextRequested: false,
      compareFreshModeRequested: "selected_days",
    });
    expect(body.compareTruth?.compareRequestTruth).toEqual({
      includeDiagnosticsRequested: false,
      includeFullReportTextRequested: false,
      compareFreshModeRequested: "selected_days",
    });
    expect(body.compareTruth?.compareFreshModeLabel).toContain("Selected-days");
    expect(body.compareTruth?.compareCalculationScope).toBe("selected_days_shared_path_only");
    expect(body.compareTruth?.compareCalculationScopeLabel).toContain("Selected-day-only");
    expect(body.compareTruth?.architectureNote).toContain("not an isolated route-level per-day simulator");
    expect(body.compareTruth?.artifactParityReferenceSource).toBe("canonical_artifact_simulated_day_totals");
    expect(body.travelVacantParityRows?.[0]).toMatchObject({
      localDate: "2025-12-25",
      artifactCanonicalSimDayKwh: 12.34,
      freshSharedDayCalcKwh: 12.34,
      parityMatch: true,
    });
    expect(body.travelVacantParityTruth).toMatchObject({
      availability: "validated",
      reasonCode: "TRAVEL_VACANT_PARITY_VALIDATED",
      validatedDateCount: 1,
    });
    expect(body.compareTruth?.travelVacantParityAvailability).toBe("validated");
    expect(body.compareTruth?.travelVacantParityExactProofSatisfied).toBe(true);
    expect(body.truthEnvelope?.compareTruth?.compareFreshModeUsed).toBe("selected_days");
    expect(body.truthEnvelope?.compareFreshModeUsed).toBe("selected_days");
    expect(body.truthEnvelope?.compareRequestTruth).toEqual({
      includeDiagnosticsRequested: false,
      includeFullReportTextRequested: false,
      compareFreshModeRequested: "selected_days",
    });
    expect(body.truthEnvelope?.compareCalculationScope).toBe("selected_days_shared_path_only");
    expect(body.truthEnvelope?.requestedTestDaysCount).toBe(1);
    expect(body.truthEnvelope?.scoringTestDaysCount).toBe(1);
    expect(body.truthEnvelope?.scoredIntervalsCount).toBe(2);
    expect(body.truthEnvelope?.artifact).toMatchObject({
      requestedInputHash: "hash-1",
      requestedScenarioId: "past-s1",
      exactIdentifierUsed: "past-s1:hash-1",
      exactIdentityRequested: true,
      exactIdentityResolved: true,
      sameRunEnsureArtifact: true,
      compareUsedSameRunEnsureArtifact: true,
      fallbackOccurred: false,
    });
    expect(body.displaySimulated?.daily?.[0]?.date).toBe("2026-01-01");
    expect(body.displaySimulated?.monthly?.[0]?.month).toBe("2026-01");
    expect(body.scoredDayWeatherRows?.[0]).toMatchObject({
      localDate: "2026-01-01",
      avgTempF: 51,
      minTempF: 41,
      maxTempF: 61,
      hdd65: 14,
      cdd65: 0,
      weatherBasisUsed: "actual_only",
    });
    expect(body.scoredDayWeatherTruth).toMatchObject({
      availability: "available",
      reasonCode: "SCORED_DAY_WEATHER_AVAILABLE",
    });
    expect(Array.isArray(body.scoredDayTruthRows)).toBe(true);
    expect(body.scoredDayTruthRows?.[0]).toMatchObject({
      localDate: "2026-01-01",
      displayVsFreshParityMatch: true,
      avgTempF: 51,
      minTempF: 41,
      maxTempF: 61,
      hdd65: 14,
      cdd65: 0,
      weatherSourceUsed: "OPEN_METEO",
    });
    expect(body.missAttributionSummary?.source).toBe("scored_day_truth_rows");
    expect(body.accuracyTuningBreakdowns?.source).toBe("scored_day_truth_rows");
    expect(body.diagnostics?.included).toBe(false);
    expect(body.modelAssumptions?.usageShapeProfileDiag).toEqual({ found: true, reasonNotUsed: null });
    expect(body.modelAssumptions?.weatherApiData).toBeUndefined();
    expect(body.modelAssumptions?.simulatedDayDiagnosticsSample).toBeUndefined();
    expect(body.modelAssumptions?.dayTotalDiagnostics).toBeUndefined();
    expect(body.fullReportText).toBeUndefined();
  });

  it("keeps selected-days compare mode when diagnostics flags are explicitly false", async () => {
    mockCompareResultOnce({
      ok: true,
      artifactAutoRebuilt: false,
      scoringSimulatedSource: "shared_selected_days_simulated_intervals15",
      scoringUsedSharedArtifact: false,
      compareSharedCalcPath: "simulatePastSelectedDaysShared(buildPastSimulatedBaselineV1->simulatePastDay)->buildGapfillCompareSimShared",
      compareFreshModeUsed: "selected_days",
      compareCalculationScope: "selected_days_shared_path_only",
      displaySimSource: "dataset.daily",
      compareSimSource: "shared_selected_days_calc",
      weatherBasisUsed: "actual_only",
      sharedCoverageWindow: { startDate: "2025-03-14", endDate: "2026-03-14" },
      boundedTravelDateKeysLocal: new Set<string>(),
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
      scoringTestDateKeysLocal: new Set<string>(["2026-01-01"]),
      timezoneUsedForScoring: "America/Chicago",
      windowUsedForScoring: { startDate: "2025-03-14", endDate: "2026-03-14" },
    });

    const req = {
      cookies: { get: () => undefined },
      json: async () => ({
        email: "user@example.com",
        testRanges: [{ startDate: "2026-01-01", endDate: "2026-01-01" }],
        includeDiagnostics: false,
        includeFullReportText: false,
      }),
    } as any;
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.compareRequestTruth).toEqual({
      includeDiagnosticsRequested: false,
      includeFullReportTextRequested: false,
      compareFreshModeRequested: "selected_days",
    });
    expect(buildGapfillCompareSimShared).toHaveBeenCalledWith(
      expect.objectContaining({
        compareFreshMode: "selected_days",
        autoEnsureArtifact: false,
        includeFreshCompareCalc: false,
        selectedDaysLightweightArtifactRead: true,
      })
    );
  });

  it("fails explicitly when shared compare succeeds without scored-day weather truth", async () => {
    mockCompareResultOnce({
      __omitSharedWeather: true,
      ok: true,
      artifactAutoRebuilt: false,
      scoringSimulatedSource: "shared_selected_days_simulated_intervals15",
      scoringUsedSharedArtifact: false,
      compareSharedCalcPath: "simulatePastSelectedDaysShared(buildPastSimulatedBaselineV1->simulatePastDay)->buildGapfillCompareSimShared",
      compareFreshModeUsed: "selected_days",
      compareCalculationScope: "selected_days_shared_path_only",
      displaySimSource: "dataset.daily",
      compareSimSource: "shared_selected_days_calc",
      weatherBasisUsed: "actual_only",
      scoredDayWeatherRows: [],
      scoredDayWeatherTruth: {
        availability: "missing_expected_scored_day_weather",
        reasonCode: "SCORED_DAY_WEATHER_MISSING",
        explanation: "Shared compare completed without compact weather truth for one or more scored dates.",
        source: "shared_compare_scored_day_weather",
        scoredDateCount: 1,
        weatherRowCount: 0,
        missingDateCount: 1,
        missingDateSample: ["2026-01-01"],
      },
      sharedCoverageWindow: { startDate: "2025-03-14", endDate: "2026-03-14" },
      boundedTravelDateKeysLocal: new Set<string>(),
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
      scoringTestDateKeysLocal: new Set<string>(["2026-01-01"]),
      timezoneUsedForScoring: "America/Chicago",
      windowUsedForScoring: { startDate: "2025-03-14", endDate: "2026-03-14" },
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

    expect(res.status).toBe(500);
    expect(body.error).toBe("compare_core_weather_truth_missing");
    expect(body.reasonCode).toBe("COMPARE_CORE_WEATHER_TRUTH_MISSING");
    expect(body.scoredDayWeatherTruth).toMatchObject({
      availability: "missing_expected_scored_day_weather",
      missingDateCount: 1,
      missingDateSample: ["2026-01-01"],
    });
  });

  it("fails explicitly when shared compare omits scored-day weather fields even if legacy weatherApiData exists", async () => {
    mockCompareResultOnce({
      __omitSharedWeather: true,
      ok: true,
      artifactAutoRebuilt: false,
      scoringSimulatedSource: "shared_selected_days_simulated_intervals15",
      scoringUsedSharedArtifact: false,
      compareSharedCalcPath: "simulatePastSelectedDaysShared(buildPastSimulatedBaselineV1->simulatePastDay)->buildGapfillCompareSimShared",
      compareFreshModeUsed: "selected_days",
      compareCalculationScope: "selected_days_shared_path_only",
      displaySimSource: "dataset.daily",
      compareSimSource: "shared_selected_days_calc",
      weatherBasisUsed: "actual_only",
      sharedCoverageWindow: { startDate: "2025-03-14", endDate: "2026-03-14" },
      boundedTravelDateKeysLocal: new Set<string>(),
      simulatedTestIntervals: [
        { timestamp: "2026-01-01T00:00:00.000Z", kwh: 0.25 },
        { timestamp: "2026-01-01T00:15:00.000Z", kwh: 0.25 },
      ],
      simulatedChartIntervals: [{ timestamp: "2026-01-01T00:00:00.000Z", kwh: 0.25 }],
      simulatedChartDaily: [{ date: "2026-01-01", simKwh: 0.5, source: "SIMULATED" }],
      simulatedChartMonthly: [{ month: "2026-01", kwh: 0.5 }],
      simulatedChartStitchedMonth: null,
      modelAssumptions: {
        weatherApiData: [
          {
            dateKey: "2026-01-01",
            kind: "ACTUAL_LAST_YEAR",
            tAvgF: 51,
            tMinF: 41,
            tMaxF: 61,
            hdd65: 14,
            cdd65: 0,
            source: "OPEN_METEO",
          },
        ],
      },
      homeProfileFromModel: null,
      applianceProfileFromModel: null,
      scoringTestDateKeysLocal: new Set<string>(["2026-01-01"]),
      timezoneUsedForScoring: "America/Chicago",
      windowUsedForScoring: { startDate: "2025-03-14", endDate: "2026-03-14" },
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

    expect(res.status).toBe(500);
    expect(body.error).toBe("compare_core_weather_truth_missing");
    expect(body.reasonCode).toBe("COMPARE_CORE_WEATHER_TRUTH_MISSING");
    expect(body.scoredDayWeatherTruth).toMatchObject({
      availability: "missing_expected_scored_day_weather",
      missingDateCount: 1,
      missingDateSample: ["2026-01-01"],
    });
    expect(body.scoredDayWeatherRows).toBeUndefined();
  });

  it("blocks contradictory success when exact travel/vacant parity proof cannot be established", async () => {
    mockCompareResultOnce({
      ok: false,
      status: 409,
      body: {
        ok: false,
        error: "travel_vacant_parity_proof_failed",
        message:
          "Compare requires exact shared artifact parity proof, but DB travel/vacant parity could not be proven against fresh shared compare output.",
        reasonCode: "TRAVEL_VACANT_ARTIFACT_REFERENCE_MISSING",
        travelVacantParityTruth: {
          availability: "missing_artifact_reference",
          reasonCode: "TRAVEL_VACANT_ARTIFACT_REFERENCE_MISSING",
          explanation:
            "Canonical artifact simulated-day totals were missing for one or more DB travel/vacant parity dates.",
          source: "db_travel_vacant_ranges",
          comparisonBasis: "canonical_artifact_simulated_day_totals_vs_fresh_shared_compare_daily_totals",
          requestedDateCount: 1,
          validatedDateCount: 0,
          mismatchCount: 0,
          missingArtifactReferenceCount: 1,
          missingFreshCompareCount: 0,
          requestedDateSample: ["2025-12-25"],
          exactProofRequired: true,
          exactProofSatisfied: false,
        },
      },
    });

    const req = {
      cookies: { get: () => undefined },
      json: async () => ({
        email: "user@example.com",
        testRanges: [{ startDate: "2026-01-01", endDate: "2026-01-01" }],
        requestedInputHash: "hash-1",
        artifactScenarioId: "past-s1",
        requireExactArtifactMatch: true,
      }),
    } as any;
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toBe("travel_vacant_parity_proof_failed");
    expect(body.reasonCode).toBe("TRAVEL_VACANT_ARTIFACT_REFERENCE_MISSING");
    expect(body.travelVacantParityTruth).toMatchObject({
      availability: "missing_artifact_reference",
      exactProofRequired: true,
      exactProofSatisfied: false,
    });
  });

  it("keeps compare auto-ensure enabled for full-window diagnostics mode", async () => {
    mockCompareResultOnce({
      ok: true,
      artifactAutoRebuilt: false,
      scoringSimulatedSource: "shared_fresh_simulated_intervals15",
      scoringUsedSharedArtifact: false,
      compareSharedCalcPath: "getPastSimulatedDatasetForHouse(simulatePastUsageDataset)->buildGapfillCompareSimShared",
      compareFreshModeUsed: "full_window",
      compareCalculationScope: "full_window_shared_path_then_scored_day_filter",
      displaySimSource: "dataset.daily",
      compareSimSource: "shared_fresh_calc",
      weatherBasisUsed: "actual_only",
      sharedCoverageWindow: { startDate: "2025-03-14", endDate: "2026-03-14" },
      boundedTravelDateKeysLocal: new Set<string>(),
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
      scoringTestDateKeysLocal: new Set<string>(["2026-01-01"]),
      timezoneUsedForScoring: "America/Chicago",
      windowUsedForScoring: { startDate: "2025-03-14", endDate: "2026-03-14" },
    });

    const req = {
      cookies: { get: () => undefined },
      json: async () => ({
        email: "user@example.com",
        testRanges: [{ startDate: "2026-01-01", endDate: "2026-01-01" }],
        includeDiagnostics: true,
        includeFullReportText: false,
      }),
    } as any;
    const res = await POST(req);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(buildGapfillCompareSimShared).toHaveBeenCalledWith(
      expect.objectContaining({
        compareFreshMode: "full_window",
        autoEnsureArtifact: true,
        includeFreshCompareCalc: true,
        selectedDaysLightweightArtifactRead: false,
      })
    );
  });

  it("reports zero chart interval count for lightweight selected-days responses with no chart intervals", async () => {
    mockCompareResultOnce({
      ok: true,
      artifactAutoRebuilt: false,
      scoringSimulatedSource: "shared_selected_days_simulated_intervals15",
      scoringUsedSharedArtifact: false,
      compareSharedCalcPath: "simulatePastSelectedDaysShared(buildPastSimulatedBaselineV1->simulatePastDay)->buildGapfillCompareSimShared",
      compareFreshModeUsed: "selected_days",
      compareCalculationScope: "selected_days_shared_path_only",
      displaySimSource: "dataset.daily",
      compareSimSource: "shared_selected_days_calc",
      weatherBasisUsed: "actual_only",
      sharedCoverageWindow: { startDate: "2025-03-14", endDate: "2026-03-14" },
      boundedTravelDateKeysLocal: new Set<string>(),
      simulatedTestIntervals: [
        { timestamp: "2026-01-01T00:00:00.000Z", kwh: 0.25 },
        { timestamp: "2026-01-01T00:15:00.000Z", kwh: 0.25 },
      ],
      artifactIntervals: [],
      simulatedChartIntervals: [],
      simulatedChartDaily: [{ date: "2026-01-01", simKwh: 0.5, source: "SIMULATED" }],
      simulatedChartMonthly: [{ month: "2026-01", kwh: 0.5 }],
      simulatedChartStitchedMonth: null,
      modelAssumptions: {
        intervalCount: 0,
        artifactStoredIntervalCount: 999,
        usageShapeProfileDiag: { found: true, reasonNotUsed: null },
      },
      homeProfileFromModel: null,
      applianceProfileFromModel: null,
      scoringTestDateKeysLocal: new Set<string>(["2026-01-01"]),
      timezoneUsedForScoring: "America/Chicago",
      windowUsedForScoring: { startDate: "2025-03-14", endDate: "2026-03-14" },
    });

    const req = {
      cookies: { get: () => undefined },
      json: async () => ({
        email: "user@example.com",
        testRanges: [{ startDate: "2026-01-01", endDate: "2026-01-01" }],
        includeDiagnostics: false,
        includeFullReportText: false,
      }),
    } as any;
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.diagnostics?.chartIntervalCount).toBe(0);
    expect(Array.isArray(body.displaySimulated?.daily)).toBe(true);
    expect(body.modelAssumptions?.intervalCount).toBe(0);
    expect(body.modelAssumptions?.artifactStoredIntervalCount).toBe(999);
    expect(body.modelAssumptions?.usageShapeProfileDiag).toEqual({ found: true, reasonNotUsed: null });
    expect(body.modelAssumptions?.weatherApiData).toBeUndefined();
    expect(body.modelAssumptions?.simulatedDayDiagnosticsSample).toBeUndefined();
    expect(body.modelAssumptions?.dayTotalDiagnostics).toBeUndefined();
  });

  it("passes through parity mismatch proof metadata from shared compare service", async () => {
    mockCompareResultOnce({
      ok: true,
      artifactAutoRebuilt: false,
      scoringSimulatedSource: "shared_selected_days_simulated_intervals15",
      scoringUsedSharedArtifact: false,
      compareSharedCalcPath: "simulatePastSelectedDaysShared(buildPastSimulatedBaselineV1->simulatePastDay)->buildGapfillCompareSimShared",
      compareFreshModeUsed: "selected_days",
      compareCalculationScope: "selected_days_shared_path_only",
      displaySimSource: "dataset.daily",
      compareSimSource: "shared_selected_days_calc",
      weatherBasisUsed: "actual_only",
      displayVsFreshParityForScoredDays: {
        matches: false,
        mismatchCount: 1,
        mismatchSampleDates: ["2026-01-01"],
        missingDisplaySimCount: 0,
        complete: false,
        parityDisplaySourceUsed: "canonical_artifact_simulated_day_totals",
        parityDisplayValueKind: "artifact_simulated_day_total",
        scope: "scored_test_days_local",
        granularity: "daily_kwh_rounded_2dp",
        comparisonBasis: "artifact_simulated_display_rows_vs_compare_selected_days_fresh_calc",
      },
      travelVacantParitySample: [],
      sharedCoverageWindow: { startDate: "2025-03-14", endDate: "2026-03-14" },
      boundedTravelDateKeysLocal: new Set<string>(),
      simulatedTestIntervals: [
        { timestamp: "2026-01-01T00:00:00.000Z", kwh: 0.25 },
        { timestamp: "2026-01-01T00:15:00.000Z", kwh: 0.25 },
      ],
      artifactSimulatedDayReferenceSource: "canonical_artifact_simulated_day_totals",
      artifactSimulatedDayReferenceRows: [{ date: "2026-01-01", simKwh: 99 }],
      simulatedChartIntervals: [{ timestamp: "2026-01-01T00:00:00.000Z", kwh: 0.25 }],
      simulatedChartDaily: [{ date: "2026-01-01", simKwh: 99, source: "SIMULATED" }],
      simulatedChartMonthly: [{ month: "2026-01", kwh: 99 }],
      simulatedChartStitchedMonth: null,
      modelAssumptions: null,
      homeProfileFromModel: null,
      applianceProfileFromModel: null,
      scoringTestDateKeysLocal: new Set<string>(["2026-01-01"]),
      timezoneUsedForScoring: "America/Chicago",
      windowUsedForScoring: { startDate: "2025-03-14", endDate: "2026-03-14" },
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

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.displayVsFreshParityForScoredDays?.matches).toBe(false);
    expect(body.displayVsFreshParityForScoredDays?.mismatchCount).toBe(1);
    expect(body.displayVsFreshParityForScoredDays?.mismatchSampleDates).toEqual(["2026-01-01"]);
    expect(body.compareFreshModeUsed).toBe("selected_days");
    expect(body.compareCalculationScope).toBe("selected_days_shared_path_only");
    expect(body.compareTruth?.compareSimSource).toBe("shared_selected_days_calc");
    expect(body.compareTruth?.displaySimSource).toBe("dataset.daily");
    expect(body.scoredDayTruthRows?.[0]?.displayVsFreshParityMatch).toBe(false);
    expect(body.scoredDayTruthRows?.[0]?.displayedPastStyleSimDayKwh).toBe(99);
    expect(body.scoredDayTruthRows?.[0]?.freshCompareSimDayKwh).toBe(0.5);
  });

  it("preserves full parity totals while mismatch and missing samples stay capped", async () => {
    mockCompareResultOnce({
      ok: true,
      artifactAutoRebuilt: false,
      scoringSimulatedSource: "shared_selected_days_simulated_intervals15",
      scoringUsedSharedArtifact: false,
      compareSharedCalcPath: "simulatePastSelectedDaysShared(buildPastSimulatedBaselineV1->simulatePastDay)->buildGapfillCompareSimShared",
      compareFreshModeUsed: "selected_days",
      compareCalculationScope: "selected_days_shared_path_only",
      displaySimSource: "dataset.daily",
      compareSimSource: "shared_selected_days_calc",
      weatherBasisUsed: "actual_only",
      displayVsFreshParityForScoredDays: {
        matches: false,
        mismatchCount: 12,
        mismatchSampleDates: Array.from({ length: 10 }, (_, i) => `2026-01-${String(i + 1).padStart(2, "0")}`),
        missingDisplaySimCount: 14,
        missingDisplaySimSampleDates: Array.from({ length: 10 }, (_, i) => `2026-02-${String(i + 1).padStart(2, "0")}`),
        comparableDateCount: 22,
        complete: false,
        parityDisplaySourceUsed: "canonical_artifact_simulated_day_totals",
        parityDisplayValueKind: "artifact_simulated_day_total",
        scope: "scored_test_days_local",
        granularity: "daily_kwh_rounded_2dp",
        comparisonBasis: "artifact_simulated_display_rows_vs_compare_selected_days_fresh_calc",
      },
      travelVacantParitySample: [],
      sharedCoverageWindow: { startDate: "2025-03-14", endDate: "2026-03-14" },
      boundedTravelDateKeysLocal: new Set<string>(),
      simulatedTestIntervals: [
        { timestamp: "2026-01-01T00:00:00.000Z", kwh: 0.25 },
        { timestamp: "2026-01-01T00:15:00.000Z", kwh: 0.25 },
      ],
      simulatedChartIntervals: [{ timestamp: "2026-01-01T00:00:00.000Z", kwh: 0.25 }],
      simulatedChartDaily: [{ date: "2026-01-01", simKwh: 99, source: "SIMULATED" }],
      simulatedChartMonthly: [{ month: "2026-01", kwh: 99 }],
      simulatedChartStitchedMonth: null,
      modelAssumptions: null,
      homeProfileFromModel: null,
      applianceProfileFromModel: null,
      scoringTestDateKeysLocal: new Set<string>(["2026-01-01"]),
      timezoneUsedForScoring: "America/Chicago",
      windowUsedForScoring: { startDate: "2025-03-14", endDate: "2026-03-14" },
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

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.displayVsFreshParityForScoredDays?.mismatchCount).toBe(12);
    expect(body.displayVsFreshParityForScoredDays?.mismatchSampleDates).toHaveLength(10);
    expect(body.displayVsFreshParityForScoredDays?.missingDisplaySimCount).toBe(14);
    expect(body.displayVsFreshParityForScoredDays?.missingDisplaySimSampleDates).toHaveLength(10);
    expect(body.displayVsFreshParityForScoredDays?.comparableDateCount).toBe(22);
    expect(body.displayVsFreshParityForScoredDays?.complete).toBe(false);
  });

  it("marks scored actual days as not-applicable parity when no artifact simulated-day reference exists", async () => {
    mockCompareResultOnce({
      ok: true,
      artifactAutoRebuilt: false,
      scoringSimulatedSource: "shared_selected_days_simulated_intervals15",
      scoringUsedSharedArtifact: false,
      compareSharedCalcPath: "simulatePastSelectedDaysShared(buildPastSimulatedBaselineV1->simulatePastDay)->buildGapfillCompareSimShared",
      compareFreshModeUsed: "selected_days",
      compareCalculationScope: "selected_days_shared_path_only",
      displaySimSource: "dataset.daily",
      compareSimSource: "shared_selected_days_calc",
      weatherBasisUsed: "actual_only",
      displayVsFreshParityForScoredDays: {
        matches: null,
        mismatchCount: 0,
        mismatchSampleDates: [],
        missingDisplaySimCount: 0,
        missingDisplaySimSampleDates: [],
        comparableDateCount: 0,
        complete: null,
        availability: "not_applicable_scored_actual_days",
        reasonCode: "SCORED_DAYS_USE_ACTUAL_ARTIFACT_ROWS",
        parityDisplaySourceUsed: "canonical_artifact_simulated_day_totals",
        parityDisplayValueKind: "not_applicable_scored_actual_day",
        scope: "scored_test_days_local",
        granularity: "daily_kwh_rounded_2dp",
        comparisonBasis: "artifact_simulated_display_rows_vs_compare_selected_days_fresh_calc",
      },
      travelVacantParitySample: [],
      sharedCoverageWindow: { startDate: "2025-03-14", endDate: "2026-03-14" },
      boundedTravelDateKeysLocal: new Set<string>(),
      simulatedTestIntervals: [
        { timestamp: "2026-01-01T00:00:00.000Z", kwh: 0.25 },
        { timestamp: "2026-01-01T00:15:00.000Z", kwh: 0.25 },
      ],
      artifactSimulatedDayReferenceSource: "canonical_artifact_simulated_day_totals",
      artifactSimulatedDayReferenceRows: [],
      simulatedChartIntervals: [{ timestamp: "2026-01-01T00:00:00.000Z", kwh: 0.25 }],
      simulatedChartDaily: [{ date: "2026-01-01", simKwh: 99, source: "ACTUAL" }],
      simulatedChartMonthly: [{ month: "2026-01", kwh: 99 }],
      simulatedChartStitchedMonth: null,
      modelAssumptions: null,
      homeProfileFromModel: null,
      applianceProfileFromModel: null,
      scoringTestDateKeysLocal: new Set<string>(["2026-01-01"]),
      timezoneUsedForScoring: "America/Chicago",
      windowUsedForScoring: { startDate: "2025-03-14", endDate: "2026-03-14" },
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

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.displayVsFreshParityForScoredDays?.matches).toBeNull();
    expect(body.displayVsFreshParityForScoredDays?.mismatchCount).toBe(0);
    expect(body.displayVsFreshParityForScoredDays?.missingDisplaySimCount).toBe(0);
    expect(body.displayVsFreshParityForScoredDays?.missingDisplaySimSampleDates).toEqual([]);
    expect(body.displayVsFreshParityForScoredDays?.availability).toBe("not_applicable_scored_actual_days");
    expect(body.displayVsFreshParityForScoredDays?.reasonCode).toBe("SCORED_DAYS_USE_ACTUAL_ARTIFACT_ROWS");
    expect(body.scoredDayTruthRows?.[0]?.displayedPastStyleSimDayKwh).toBeNull();
    expect(body.scoredDayTruthRows?.[0]?.displayVsFreshParityMatch).toBeNull();
    expect(body.scoredDayTruthRows?.[0]?.parityAvailability).toBe("not_applicable_scored_actual_days");
    expect(body.scoredDayTruthRows?.[0]?.parityReasonCode).toBe("SCORED_DAYS_USE_ACTUAL_ARTIFACT_ROWS");
    expect(body.scoredDayTruthRows?.[0]?.parityDisplayValueKind).toBe("not_applicable_scored_actual_day");
    expect(body.scoredDayTruthRows?.[0]?.artifactSimulatedDayReferenceSource).toBe("canonical_artifact_simulated_day_totals");
    expect(body.scoredDayTruthRows?.[0]?.scoredDayDisplaySource).toBe("ACTUAL");
  });

  it("passes exact artifact identity request fields into shared compare build", async () => {
    mockCompareResultOnce({
      ok: true,
      artifactAutoRebuilt: false,
      sharedCoverageWindow: { startDate: "2025-03-14", endDate: "2026-03-14" },
      boundedTravelDateKeysLocal: new Set<string>(),
      simulatedTestIntervals: [
        { timestamp: "2026-01-01T00:00:00.000Z", kwh: 0.25 },
        { timestamp: "2026-01-01T00:15:00.000Z", kwh: 0.25 },
      ],
      simulatedChartIntervals: [],
      simulatedChartDaily: [{ date: "2026-01-01", simKwh: 0.5, source: "SIMULATED" }],
      simulatedChartMonthly: [{ month: "2026-01", kwh: 0.5 }],
      simulatedChartStitchedMonth: null,
      modelAssumptions: {
        artifactSourceMode: "exact_hash_match",
        requestedInputHash: "hash-forwarded",
        artifactInputHashUsed: "hash-forwarded",
        artifactHashMatch: true,
        artifactScenarioId: "past-s1",
        artifactRequestedScenarioId: "past-s1",
        artifactExactIdentityResolved: true,
        artifactSameRunEnsureIdentity: true,
        artifactFallbackOccurred: false,
        artifactExactIdentifierUsed: "past-s1:hash-forwarded",
      },
      homeProfileFromModel: null,
      applianceProfileFromModel: null,
      scoringTestDateKeysLocal: new Set<string>(["2026-01-01"]),
      timezoneUsedForScoring: "America/Chicago",
      windowUsedForScoring: { startDate: "2025-03-14", endDate: "2026-03-14" },
    });

    const req = {
      cookies: { get: () => undefined },
      json: async () => ({
        email: "user@example.com",
        testRanges: [{ startDate: "2026-01-01", endDate: "2026-01-01" }],
        requestedInputHash: "hash-forwarded",
        artifactScenarioId: "past-s1",
        requireExactArtifactMatch: true,
        artifactIdentitySource: "same_run_artifact_ensure",
      }),
    } as any;
    const res = await POST(req);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(buildGapfillCompareSimShared).toHaveBeenCalledWith(
      expect.objectContaining({
        artifactExactInputHash: "hash-forwarded",
        artifactExactScenarioId: "past-s1",
        requireExactArtifactMatch: true,
        artifactIdentitySource: "same_run_artifact_ensure",
      })
    );
    expect(body.artifactRequestTruth).toEqual({
      requestedInputHash: "hash-forwarded",
      requestedArtifactScenarioId: "past-s1",
      requireExactArtifactMatch: true,
      artifactIdentitySource: "same_run_artifact_ensure",
    });
  });

  it("returns explicit artifact request truth when exact same-run artifact identity cannot be resolved", async () => {
    mockCompareResultOnce({
      ok: false,
      status: 409,
      body: {
        ok: false,
        error: "artifact_exact_identity_missing_rebuild_required",
        message: "Compare expected the exact shared Past artifact rebuilt earlier in this run, but it could not be read.",
        requestedArtifactScenarioId: "past-s1",
        requestedInputHash: "hash-missing",
        requireExactArtifactMatch: true,
        artifactIdentitySource: "same_run_artifact_ensure",
        fallbackOccurred: false,
        fallbackReason: "requested_exact_identity_not_found",
      },
    });

    const req = {
      cookies: { get: () => undefined },
      json: async () => ({
        email: "user@example.com",
        testRanges: [{ startDate: "2026-01-01", endDate: "2026-01-01" }],
        requestedInputHash: "hash-missing",
        artifactScenarioId: "past-s1",
        requireExactArtifactMatch: true,
        artifactIdentitySource: "same_run_artifact_ensure",
      }),
    } as any;
    const res = await POST(req);
    const body = await res.json();
    expect(res.status).toBe(409);
    expect(body.error).toBe("artifact_exact_identity_missing_rebuild_required");
    expect(body.artifactRequestTruth).toEqual({
      requestedInputHash: "hash-missing",
      requestedArtifactScenarioId: "past-s1",
      requireExactArtifactMatch: true,
      artifactIdentitySource: "same_run_artifact_ensure",
    });
    expect(body.fallbackOccurred).toBe(false);
    expect(body.fallbackReason).toBe("requested_exact_identity_not_found");
  });

  it("fails instead of returning contradictory exact-match success truth", async () => {
    mockCompareResultOnce({
      ok: true,
      artifactAutoRebuilt: false,
      sharedCoverageWindow: { startDate: "2025-03-14", endDate: "2026-03-14" },
      boundedTravelDateKeysLocal: new Set<string>(),
      simulatedTestIntervals: [
        { timestamp: "2026-01-01T00:00:00.000Z", kwh: 0.25 },
        { timestamp: "2026-01-01T00:15:00.000Z", kwh: 0.25 },
      ],
      simulatedChartIntervals: [],
      simulatedChartDaily: [{ date: "2026-01-01", simKwh: 0.5, source: "SIMULATED" }],
      simulatedChartMonthly: [{ month: "2026-01", kwh: 0.5 }],
      simulatedChartStitchedMonth: null,
      modelAssumptions: {
        artifactSourceMode: "exact_hash_match",
        requestedInputHash: "hash-contradictory",
        artifactInputHashUsed: null,
        artifactHashMatch: false,
        artifactScenarioId: "past-s1",
        artifactExactIdentityResolved: false,
        artifactSameRunEnsureIdentity: true,
      },
      homeProfileFromModel: null,
      applianceProfileFromModel: null,
      scoringTestDateKeysLocal: new Set<string>(["2026-01-01"]),
      timezoneUsedForScoring: "America/Chicago",
      windowUsedForScoring: { startDate: "2025-03-14", endDate: "2026-03-14" },
    });

    const req = {
      cookies: { get: () => undefined },
      json: async () => ({
        email: "user@example.com",
        testRanges: [{ startDate: "2026-01-01", endDate: "2026-01-01" }],
        requestedInputHash: "hash-contradictory",
        artifactScenarioId: "past-s1",
        requireExactArtifactMatch: true,
        artifactIdentitySource: "same_run_artifact_ensure",
      }),
    } as any;
    const res = await POST(req);
    const body = await res.json();
    expect(res.status).toBe(409);
    expect(body.error).toBe("artifact_exact_identity_unresolved");
    expect(body.reasonCode).toBe("ARTIFACT_EXACT_IDENTITY_UNRESOLVED");
    expect(body.artifactTruth).toMatchObject({
      sourceMode: "exact_hash_match",
      requestedInputHash: "hash-contradictory",
      artifactInputHashUsed: null,
      artifactHashMatch: false,
      exactIdentityResolved: false,
      sameRunEnsureArtifact: true,
    });
  });

  it("fails early when same-run exact compare receives fallback artifact identity truth", async () => {
    mockCompareResultOnce({
      ok: true,
      artifactAutoRebuilt: false,
      sharedCoverageWindow: { startDate: "2025-03-14", endDate: "2026-03-14" },
      boundedTravelDateKeysLocal: new Set<string>(),
      simulatedTestIntervals: [
        { timestamp: "2026-01-01T00:00:00.000Z", kwh: 0.25 },
        { timestamp: "2026-01-01T00:15:00.000Z", kwh: 0.25 },
      ],
      simulatedChartIntervals: [],
      simulatedChartDaily: [{ date: "2026-01-01", simKwh: 0.5, source: "SIMULATED" }],
      simulatedChartMonthly: [{ month: "2026-01", kwh: 0.5 }],
      simulatedChartStitchedMonth: null,
      modelAssumptions: {
        artifactSourceMode: "latest_by_scenario_fallback",
        requestedInputHash: "hash-requested",
        artifactInputHashUsed: "hash-fallback",
        artifactHashMatch: false,
        artifactScenarioId: "past-s1",
        artifactExactIdentityResolved: false,
        artifactIdentitySource: "same_run_artifact_ensure",
        artifactSameRunEnsureIdentity: true,
        artifactFallbackOccurred: true,
        artifactFallbackReason: "requested_exact_identity_not_found_fell_back_to_latest_by_scenario",
      },
      homeProfileFromModel: null,
      applianceProfileFromModel: null,
      scoringTestDateKeysLocal: new Set<string>(["2026-01-01"]),
      timezoneUsedForScoring: "America/Chicago",
      windowUsedForScoring: { startDate: "2025-03-14", endDate: "2026-03-14" },
    });

    const req = {
      cookies: { get: () => undefined },
      json: async () => ({
        email: "user@example.com",
        testRanges: [{ startDate: "2026-01-01", endDate: "2026-01-01" }],
        requestedInputHash: "hash-requested",
        artifactScenarioId: "past-s1",
        requireExactArtifactMatch: true,
        artifactIdentitySource: "same_run_artifact_ensure",
      }),
    } as any;
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toBe("artifact_exact_identity_unresolved");
    expect(body.reasonCode).toBe("ARTIFACT_ENSURE_EXACT_HANDOFF_FAILED");
    expect(body.artifactTruth).toMatchObject({
      sourceMode: "latest_by_scenario_fallback",
      requestedInputHash: "hash-requested",
      artifactInputHashUsed: "hash-fallback",
      artifactHashMatch: false,
      sameRunEnsureArtifact: true,
      fallbackOccurred: true,
    });
  });

  it("classifies heavy diagnostics client timeout, fetch failure, and exception explicitly in client source", () => {
    const clientSource = readFileSync(
      resolve(process.cwd(), "app/admin/tools/gapfill-lab/GapFillLabClient.tsx"),
      "utf8"
    );
    expect(clientSource).toContain("compare_heavy_client_timeout");
    expect(clientSource).toContain("compare_heavy_client_fetch_failure");
    expect(clientSource).toContain("compare_heavy_client_exception");
    expect(clientSource).toContain("compare_heavy_timeout");
    expect(clientSource).toContain("compare_heavy_fetch_failure");
    expect(clientSource).toContain("heavyFailureKind");
    expect(clientSource).toContain("\"route_timeout\"");
    expect(clientSource).toContain("\"route_exception\"");
  });

  it("requests and merges compact heavy-only responses in client source", () => {
    const clientSource = readFileSync(
      resolve(process.cwd(), "app/admin/tools/gapfill-lab/GapFillLabClient.tsx"),
      "utf8"
    );
    expect(clientSource).toContain('responseMode: "heavy_only_compact"');
    expect(clientSource).toContain('if ((data as any).responseMode === "heavy_only_compact")');
    expect(clientSource).toContain("heavyStartedAt");
    expect(clientSource).toContain("heavyStepsMs");
    expect(clientSource).toContain("compareCoreMode: prev.compareCoreMode");
    expect(clientSource).toContain("compareCoreTiming: (prev as any).compareCoreTiming");
    expect(clientSource).toContain("compareCoreStepTimings: prev.compareCoreStepTimings");
    expect(clientSource).toContain("...prev,");
  });

  it("returns a compact heavy-only response with heavy timing fields for merge-on-top-of-core", async () => {
    mockCompareResultOnce({
      ok: true,
      artifactAutoRebuilt: false,
      scoringSimulatedSource: "shared_fresh_simulated_intervals15",
      scoringUsedSharedArtifact: false,
      compareSharedCalcPath: "getPastSimulatedDatasetForHouse(simulatePastUsageDataset)->buildGapfillCompareSimShared",
      compareFreshModeUsed: "full_window",
      compareCalculationScope: "full_window_shared_path_then_scored_day_filter",
      displaySimSource: "dataset.daily",
      compareSimSource: "shared_fresh_calc",
      weatherBasisUsed: "actual_only",
      scoredDayWeatherRows: [
        {
          localDate: "2026-01-01",
          avgTempF: 48,
          minTempF: 38,
          maxTempF: 58,
          hdd65: 17,
          cdd65: 0,
          weatherBasisUsed: "actual_only",
          weatherKindUsed: "ACTUAL_LAST_YEAR",
          weatherSourceUsed: "OPEN_METEO",
          weatherProviderName: "OPEN_METEO",
          weatherFallbackReason: null,
        },
      ],
      scoredDayWeatherTruth: {
        availability: "available",
        reasonCode: "SCORED_DAY_WEATHER_AVAILABLE",
        explanation: "Compact scored-day weather truth is available from the shared compare execution.",
        source: "shared_compare_scored_day_weather",
        scoredDateCount: 1,
        weatherRowCount: 1,
        missingDateCount: 0,
        missingDateSample: [],
      },
      displayVsFreshParityForScoredDays: {
        matches: true,
        mismatchCount: 0,
        mismatchSampleDates: [],
        missingDisplaySimCount: 0,
        missingDisplaySimSampleDates: [],
        comparableDateCount: 1,
        complete: true,
        availability: "available",
        reasonCode: "ARTIFACT_SIMULATED_REFERENCE_AVAILABLE",
        parityDisplaySourceUsed: "canonical_artifact_simulated_day_totals",
        parityDisplayValueKind: "artifact_simulated_day_total",
        scope: "scored_test_days_local",
        granularity: "daily_kwh_rounded_2dp",
        comparisonBasis: "display_shared_artifact_vs_compare_shared_full_window_then_filter",
      },
      travelVacantParityRows: [
        {
          localDate: "2025-12-25",
          artifactCanonicalSimDayKwh: 12.34,
          freshSharedDayCalcKwh: 12.34,
          parityMatch: true,
          artifactReferenceAvailability: "available",
          freshCompareAvailability: "available",
          parityReasonCode: "TRAVEL_VACANT_PARITY_MATCH",
        },
      ],
      travelVacantParityTruth: {
        availability: "validated",
        reasonCode: "TRAVEL_VACANT_PARITY_VALIDATED",
        explanation:
          "DB travel/vacant parity validation proved canonical artifact simulated-day totals match fresh shared compare totals for the validated dates.",
        source: "db_travel_vacant_ranges",
        comparisonBasis: "canonical_artifact_simulated_day_totals_vs_fresh_shared_compare_daily_totals",
        requestedDateCount: 1,
        validatedDateCount: 1,
        mismatchCount: 0,
        missingArtifactReferenceCount: 0,
        missingFreshCompareCount: 0,
        requestedDateSample: ["2025-12-25"],
        exactProofRequired: false,
        exactProofSatisfied: true,
      },
      sharedCoverageWindow: { startDate: "2025-03-14", endDate: "2026-03-14" },
      boundedTravelDateKeysLocal: new Set<string>(),
      simulatedTestIntervals: [
        { timestamp: "2026-01-01T00:00:00.000Z", kwh: 0.25 },
        { timestamp: "2026-01-01T00:15:00.000Z", kwh: 0.25 },
      ],
      artifactSimulatedDayReferenceSource: "canonical_artifact_simulated_day_totals",
      artifactSimulatedDayReferenceRows: [{ date: "2026-01-01", simKwh: 0.5 }],
      simulatedChartIntervals: [{ timestamp: "2026-01-01T00:00:00.000Z", kwh: 0.25 }],
      simulatedChartDaily: [{ date: "2026-01-01", simKwh: 0.5, source: "SIMULATED" }],
      simulatedChartMonthly: [{ month: "2026-01", kwh: 0.5 }],
      simulatedChartStitchedMonth: null,
      modelAssumptions: {
        artifactSourceMode: "exact_hash_match",
        requestedInputHash: "hash-1",
        artifactInputHashUsed: "hash-1",
        artifactHashMatch: true,
        artifactScenarioId: "past-s1",
        artifactExactIdentityResolved: true,
      },
      homeProfileFromModel: null,
      applianceProfileFromModel: null,
      scoringTestDateKeysLocal: new Set<string>(["2026-01-01"]),
      timezoneUsedForScoring: "America/Chicago",
      windowUsedForScoring: { startDate: "2025-03-14", endDate: "2026-03-14" },
    });

    const req = {
      cookies: { get: () => undefined },
      json: async () => ({
        email: "user@example.com",
        testRanges: [{ startDate: "2026-01-01", endDate: "2026-01-01" }],
        includeDiagnostics: true,
        includeFullReportText: true,
        responseMode: "heavy_only_compact",
      }),
    } as any;
    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.responseMode).toBe("heavy_only_compact");
    expect(body.diagnostics?.dailyTotalsChartSim?.[0]?.date).toBe("2026-01-01");
    expect(typeof body.fullReportText).toBe("string");
    expect(body.missAttributionSummary?.source).toBe("scored_day_truth_rows");
    expect(body.accuracyTuningBreakdowns?.source).toBe("scored_day_truth_rows");
    expect(body.heavyStartedAt).toBeTypeOf("string");
    expect(body.heavyEndedAt).toBeTypeOf("string");
    expect(body.heavyElapsedMs).toBeTypeOf("number");
    expect(body.heavyLastCompletedStep).toBe("finalize_response");
    expect(body.heavyStepsMs?.build_full_report).toBeTypeOf("number");
    expect(body.heavyTruth).toMatchObject({
      source: "heavy_only_compact",
      artifactSourceMode: "exact_hash_match",
      artifactHashMatch: true,
      artifactExactIdentityResolved: true,
      parityAvailability: "available",
    });
    expect(body.scoredDayWeatherRows?.[0]).toMatchObject({
      localDate: "2026-01-01",
      avgTempF: 48,
      hdd65: 17,
      weatherBasisUsed: "actual_only",
    });
    expect(body.travelVacantParityRows?.[0]).toMatchObject({
      localDate: "2025-12-25",
      artifactCanonicalSimDayKwh: 12.34,
      freshSharedDayCalcKwh: 12.34,
      parityMatch: true,
    });
    expect(body.travelVacantParityTruth?.availability).toBe("validated");
    expect(body.scoredDayWeatherTruth?.availability).toBe("available");
    expect(String(body.fullReportText ?? "")).toContain("Scored-day weather truth");
    expect(String(body.fullReportText ?? "")).toContain("2026-01-01 | 48 | 38 | 58 | 17 | 0 | actual_only");
    expect(body.compareCoreTiming).toBeUndefined();
    expect(body.compareCoreStepTimings).toBeUndefined();
    expect(body.usage365).toBeUndefined();
    expect(body.displaySimulated).toBeUndefined();
    expect(body.scoredDayTruthRows).toBeUndefined();
    expect(body.byMonth).toBeUndefined();
    expect(body.byHour).toBeUndefined();
    expect(body.byDayType).toBeUndefined();
    expect(body.worstDays).toBeUndefined();
    expect(body.modelAssumptions).toBeUndefined();
  });

  it("returns route timeout classification with timing envelope when shared compare build stalls", async () => {
    const timeoutErr: any = new Error("compare_core_route_timeout_build_shared_compare");
    timeoutErr.code = "compare_core_route_timeout_build_shared_compare";
    buildGapfillCompareSimShared.mockRejectedValueOnce(timeoutErr);

    const req = {
      cookies: { get: () => undefined },
      json: async () => ({
        email: "user@example.com",
        testRanges: [{ startDate: "2026-01-01", endDate: "2026-01-01" }],
      }),
    } as any;
    const res = await POST(req);
    const body = await res.json();
    expect(res.status).toBe(504);
    expect(body.error).toBe("compare_core_route_timeout");
    expect(body.reasonCode).toBe("COMPARE_CORE_ROUTE_TIMEOUT_BUILD_SHARED_COMPARE");
    expect(body.compareCoreTiming?.failedStep).toBe("build_shared_compare");
    expect(body.compareCoreTiming?.compareRequestTruth?.compareFreshModeRequested).toBe("selected_days");
  });

  it("classifies diagnostics full-report timeout vs non-timeout distinctly in source", () => {
    const routeSource = readFileSync(
      resolve(process.cwd(), "app/api/admin/tools/gapfill-lab/route.ts"),
      "utf8"
    );
    expect(routeSource).toContain(
      "const timedOut = normalizedError.code === \"compare_core_route_timeout_build_full_report\";"
    );
    expect(routeSource).toContain("error: timedOut ? \"compare_core_route_timeout\" : \"compare_core_route_exception\"");
    expect(routeSource).toContain("COMPARE_CORE_ROUTE_TIMEOUT_BUILD_DIAGNOSTICS");
    expect(routeSource).toContain("COMPARE_CORE_ROUTE_EXCEPTION_BUILD_DIAGNOSTICS");
    expect(routeSource).toContain("{ status: timedOut ? 504 : 500 }");
    expect(routeSource).toContain("Compare core timed out while building diagnostics report payload.");
    expect(routeSource).toContain("Compare core failed while building diagnostics report payload.");
  });

  it("does not reconstruct scored-day weather rows in route source", () => {
    const routeSource = readFileSync(
      resolve(process.cwd(), "app/api/admin/tools/gapfill-lab/route.ts"),
      "utf8"
    );
    expect(routeSource).toContain("Array.isArray((sharedSim as any)?.scoredDayWeatherRows)");
    expect(routeSource).not.toContain("weatherApiRows.map((w) => ({");
    expect(routeSource).not.toContain("weatherBasisUsed: String((sharedSim as any).weatherBasisUsed ?? null)");
  });

  it("binds compare-core weather truth directly in client source without heavy-only dependency", () => {
    const clientSource = readFileSync(
      resolve(process.cwd(), "app/admin/tools/gapfill-lab/GapFillLabClient.tsx"),
      "utf8"
    );
    expect(clientSource).toContain("const EMPTY_SCORED_DAY_WEATHER_ROWS");
    expect(clientSource).toContain("const EMPTY_SCORED_DAY_TRUTH_ROWS");
    expect(clientSource).toContain("Compare-Core Weather Truth");
    expect(clientSource).toContain("extractCompareCoreScoredDayWeather(result)");
    expect(clientSource).toContain("const scoredDayTruthRows = useMemo(");
    expect(clientSource).toContain("mergeScoredDayTruthRowsWithCompareCoreWeather(");
    expect(clientSource).toContain("compareCoreScoredDayWeatherRows.length > 0");
    expect(clientSource).toContain('row.weatherSourceUsed ?? "—"');
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
    mockCompareResult({
      ok: true,
      artifactAutoRebuilt: false,
      sharedCoverageWindow: { startDate: "2025-03-14", endDate: "2026-03-14" },
      boundedTravelDateKeysLocal: new Set<string>(),
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

  it("keeps plain lookup lightweight when includeUsage365 is false", async () => {
    getActualIntervalsForRange.mockReset();
    const req = {
      cookies: { get: () => undefined },
      json: async () => ({
        email: "user@example.com",
        testRanges: [],
        includeUsage365: false,
      }),
    } as any;
    const res = await POST(req);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.usage365).toBeUndefined();
    expect(getActualIntervalsForRange).not.toHaveBeenCalled();
  });

  it("bounds Usage365 daily rows to shared coverage window dates", async () => {
    getActualIntervalsForRange.mockResolvedValue([
      { timestamp: "2025-02-28T23:45:00.000Z", kwh: 0.25 },
      { timestamp: "2025-03-01T00:00:00.000Z", kwh: 0.5 },
      { timestamp: "2026-02-28T23:45:00.000Z", kwh: 0.75 },
      { timestamp: "2026-03-01T00:00:00.000Z", kwh: 1.0 },
    ]);

    const req = {
      cookies: { get: () => undefined },
      json: async () => ({
        email: "user@example.com",
        testRanges: [],
        includeUsage365: true,
      }),
    } as any;
    const res = await POST(req);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    const usageDaily = Array.isArray(body.usage365?.daily) ? body.usage365.daily : [];
    expect(usageDaily.map((d: any) => d.date)).toEqual(["2026-02-28", "2026-03-01"]);
    expect(body.usage365?.coverageStart).toBe("2025-03-14");
    expect(body.usage365?.coverageEnd).toBe("2026-03-14");
  });

  it("uses shared Past coverage window for Usage365 bounds", async () => {
    getActualIntervalsForRange.mockResolvedValueOnce([
      { timestamp: "2025-03-13T12:00:00.000Z", kwh: 2.0 },
      { timestamp: "2025-03-14T12:00:00.000Z", kwh: 3.0 },
      { timestamp: "2026-03-14T12:00:00.000Z", kwh: 4.0 },
    ]);

    const req = {
      cookies: { get: () => undefined },
      json: async () => ({
        email: "user@example.com",
        testRanges: [],
        includeUsage365: true,
      }),
    } as any;

    const res = await POST(req);
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.usage365?.coverageStart).toBe("2025-03-14");
    expect(body.usage365?.coverageEnd).toBe("2026-03-14");
    const usageDaily = Array.isArray(body.usage365?.daily) ? body.usage365.daily : [];
    expect(usageDaily.map((d: any) => d.date)).toEqual(["2025-03-14", "2026-03-14"]);
    const usageMonthly = Array.isArray(body.usage365?.monthly) ? body.usage365.monthly : [];
    expect(usageMonthly.length).toBe(12);
    expect(body.usage365?.stitchedMonth?.yearMonth).toBe("2026-03");
  });
});


describe("GapFillLabClient catch normalization helpers", () => {
  const clientSource = readFileSync(
    resolve(process.cwd(), "app/admin/tools/gapfill-lab/GapFillLabClient.tsx"),
    "utf8"
  );

  it("uses explicit unknown-error normalization in compare catch path", () => {
    expect(clientSource).toContain("function normalizeUnknownUiError(");
    expect(clientSource).toContain("const normalizedError = normalizeUnknownUiError(");
    expect(clientSource).toContain("phase: normalizedError.isAbortError ? \"orchestrator_timeout\" : \"orchestrator_exception\"");
  });

  it("records compare_core request before fetch and uses explicit core timeout handling", () => {
    expect(clientSource).toContain("const compareCoreFetchStartedAt = new Date().toISOString();");
    expect(clientSource).toContain("compareCoreFetchStartedAt");
    expect(clientSource).toContain("compareCoreFetchSettledAt");
    expect(clientSource).toContain("GAPFILL_COMPARE_CORE_TIMEOUT_MS");
    expect(clientSource).toContain("postGapfill(compareBodyBase, GAPFILL_COMPARE_CORE_TIMEOUT_MS)");
    expect(clientSource).toContain("compare_core_client_timeout");
  });

  it("does not require instanceof Error before phase error finalization", () => {
    expect(clientSource).not.toContain("(e?.name === \"AbortError\" || e instanceof Error) && typeof e?.message === \"string\"");
    expect(clientSource).toContain("setOrchestratorPhases((prev) =>");
    expect(clientSource).toContain("markActiveOrchestratorPhasesErrored(prev, {");
  });

  it("finalizes active phases as error with normalized message", () => {
    expect(clientSource).toContain("function markActiveOrchestratorPhasesErrored");
    expect(clientSource).toContain("if (phase.status !== \"active\") return phase;");
    expect(clientSource).toContain("status: \"error\",");
    expect(clientSource).toContain("errorMessage: args.errorMessage,");
  });
});

