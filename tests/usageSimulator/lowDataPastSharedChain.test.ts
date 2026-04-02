import { beforeEach, describe, expect, it, vi } from "vitest";

const getActualIntervalsForRange = vi.fn();
const getHouseWeatherDays = vi.fn();
const ensureHouseWeatherBackfill = vi.fn();
const ensureHouseWeatherStubbed = vi.fn();
const getHomeProfileSimulatedByUserHouse = vi.fn();
const getApplianceProfileSimulatedByUserHouse = vi.fn();
const getLatestUsageShapeProfile = vi.fn();
const ensureUsageShapeProfileForUserHouse = vi.fn();
const buildPastSimulatedBaselineV1 = vi.fn();

vi.mock("@/lib/usage/actualDatasetForHouse", () => ({
  getActualIntervalsForRange: (...args: any[]) => getActualIntervalsForRange(...args),
}));

vi.mock("@/modules/weather/repo", () => ({
  getHouseWeatherDays: (...args: any[]) => getHouseWeatherDays(...args),
}));

vi.mock("@/modules/weather/backfill", () => ({
  ensureHouseWeatherBackfill: (...args: any[]) => ensureHouseWeatherBackfill(...args),
}));

vi.mock("@/modules/weather/stubs", () => ({
  ensureHouseWeatherStubbed: (...args: any[]) => ensureHouseWeatherStubbed(...args),
}));

vi.mock("@/modules/homeProfile/repo", () => ({
  getHomeProfileSimulatedByUserHouse: (...args: any[]) => getHomeProfileSimulatedByUserHouse(...args),
}));

vi.mock("@/modules/applianceProfile/repo", () => ({
  getApplianceProfileSimulatedByUserHouse: (...args: any[]) => getApplianceProfileSimulatedByUserHouse(...args),
}));

vi.mock("@/modules/usageShapeProfile/repo", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    getLatestUsageShapeProfile: (...args: any[]) => getLatestUsageShapeProfile(...args),
  };
});

vi.mock("@/modules/usageShapeProfile/autoBuild", () => ({
  ensureUsageShapeProfileForUserHouse: (...args: any[]) => ensureUsageShapeProfileForUserHouse(...args),
}));

vi.mock("@/modules/simulatedUsage/engine", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/modules/simulatedUsage/engine")>();
  return {
    ...mod,
    buildPastSimulatedBaselineV1: (...args: any[]) => buildPastSimulatedBaselineV1(...args),
  };
});

vi.mock("@/modules/usageSimulator/metadataWindow", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    resolveCanonicalUsage365CoverageWindow: vi.fn(() => ({
      startDate: "2025-03-14",
      endDate: "2026-03-13",
    })),
  };
});

vi.mock("@/lib/admin/gapfillLab", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    dateKeyInTimezone: (iso: string) => String(iso).slice(0, 10),
  };
});

vi.mock("@/lib/db", () => ({
  prisma: {
    houseAddress: {
      findUnique: vi.fn().mockResolvedValue({ lat: 30.27, lng: -97.74 }),
    },
  },
}));

const { logPipeline } = vi.hoisted(() => ({
  logPipeline: vi.fn(),
}));

vi.mock("@/modules/usageSimulator/simObservability", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/modules/usageSimulator/simObservability")>();
  return { ...mod, logSimPipelineEvent: logPipeline };
});

import { WEATHER_STUB_SOURCE } from "@/modules/weather/types";
import { simulatePastUsageDataset } from "@/modules/simulatedUsage/simulatePastUsageDataset";

function weatherRow(kind: "actual" | "stub") {
  const base = { tAvgF: 60, tMinF: 50, tMaxF: 70, hdd65: 5, cdd65: 2 };
  return kind === "actual" ? { ...base, source: "OPEN_METEO" } : { ...base, source: WEATHER_STUB_SOURCE };
}

describe("low-data Past shared chain (Slice 14)", () => {
  beforeEach(() => {
    getActualIntervalsForRange.mockReset();
    getHouseWeatherDays.mockReset();
    ensureHouseWeatherBackfill.mockReset();
    ensureHouseWeatherStubbed.mockReset();
    getHomeProfileSimulatedByUserHouse.mockResolvedValue(null);
    getApplianceProfileSimulatedByUserHouse.mockResolvedValue(null);
    ensureHouseWeatherBackfill.mockResolvedValue({ fetched: 0, stubbed: 0 });
    ensureHouseWeatherStubbed.mockResolvedValue(undefined);
    getLatestUsageShapeProfile.mockResolvedValue(null);
    ensureUsageShapeProfileForUserHouse.mockResolvedValue({ ok: false, reason: "skip" });
    buildPastSimulatedBaselineV1.mockImplementation(() => ({
      intervals: [{ timestamp: "2026-01-01T00:00:00.000Z", kwh: 1 }],
      dayResults: [],
    }));

    getHouseWeatherDays.mockImplementation(async ({ dateKeys, kind }: any) => {
      const keys = Array.from(dateKeys ?? []) as string[];
      const m = new Map();
      const backfillCompleted = ensureHouseWeatherBackfill.mock.calls.length > 0;
      for (const dk of keys) {
        if (kind === "ACTUAL_LAST_YEAR") {
          m.set(dk, !backfillCompleted && dk === "2026-01-05" ? weatherRow("stub") : weatherRow("actual"));
        } else {
          m.set(dk, weatherRow("actual"));
        }
      }
      return m;
    });
  });

  const baseBuildInputs = {
    version: 1,
    baseKind: "MANUAL" as const,
    canonicalEndMonth: "2026-02",
    canonicalMonths: ["2025-03", "2025-04", "2025-05", "2025-06", "2025-07", "2025-08", "2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02"],
    monthlyTotalsKwhByMonth: Object.fromEntries(
      ["2025-03", "2025-04", "2025-05", "2025-06", "2025-07", "2025-08", "2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02"].map((m) => [m, 240])
    ),
    intradayShape96: Array.from({ length: 96 }, () => 1 / 96),
    notes: [],
    filledMonths: [],
  };

  it("MANUAL_TOTALS skips DB interval fetch and runs buildPastSimulatedBaselineV1 with merged weather", async () => {
    buildPastSimulatedBaselineV1.mockClear();
    const out = await simulatePastUsageDataset({
      userId: "u1",
      houseId: "h1",
      actualContextHouseId: "h1",
      esiid: null,
      startDate: "2026-01-01",
      endDate: "2026-01-05",
      timezone: "America/Chicago",
      travelRanges: [],
      buildInputs: {
        ...baseBuildInputs,
        mode: "MANUAL_TOTALS",
        resolvedSimFingerprint: {
          manualTotalsConstraint: "monthly",
        },
      } as any,
      buildPathKind: "recalc",
      includeSimulatedDayResults: false,
    });

    expect(getActualIntervalsForRange).not.toHaveBeenCalled();
    expect(out.dataset).not.toBeNull();
    const firstCall = buildPastSimulatedBaselineV1.mock.calls[0]?.[0];
    const wxArg = firstCall?.actualWxByDateKey as Map<string, { source?: string }>;
    expect(wxArg?.get("2026-01-05")?.source).toBe("OPEN_METEO");
    const keepRef = firstCall?.forceModeledOutputKeepReferencePoolDateKeys as Set<string> | undefined;
    expect(keepRef?.size).toBe(5);
    expect(firstCall?.modeledKeepRefReasonCode).toBe("MONTHLY_CONSTRAINED_NON_TRAVEL_DAY");
    const meta = out.dataset?.meta as Record<string, unknown> | undefined;
    expect(meta?.sharedWeatherTimelineContract).toBe("last365_actual_with_normal_gapfill");
    expect(meta?.lowDataSharedPastAdapter).toBe(true);
    expect(meta?.lowDataKeepRefModeledDays).toBe(true);
  });

  it("NEW_BUILD_ESTIMATE uses synthetic intervals path (no DB interval fetch)", async () => {
    buildPastSimulatedBaselineV1.mockClear();
    await simulatePastUsageDataset({
      userId: "u1",
      houseId: "h1",
      actualContextHouseId: "h1",
      esiid: null,
      startDate: "2026-01-01",
      endDate: "2026-01-02",
      timezone: "UTC",
      travelRanges: [],
      buildInputs: { ...baseBuildInputs, mode: "NEW_BUILD_ESTIMATE", baseKind: "ESTIMATED" } as any,
      buildPathKind: "recalc",
      includeSimulatedDayResults: false,
    });
    expect(getActualIntervalsForRange).not.toHaveBeenCalled();
    const keepRef = buildPastSimulatedBaselineV1.mock.calls[0]?.[0]?.forceModeledOutputKeepReferencePoolDateKeys as
      | Set<string>
      | undefined;
    expect(keepRef?.size).toBe(2);
  });

  it("SMT_BASELINE fails when actual weather coverage is still missing after backfill", async () => {
    buildPastSimulatedBaselineV1.mockClear();
    getHouseWeatherDays.mockImplementation(async ({ kind }: any) => {
      const m = new Map();
      if (kind === "ACTUAL_LAST_YEAR") {
        m.set("2026-01-01", weatherRow("stub"));
      } else {
        m.set("2026-01-01", weatherRow("actual"));
      }
      return m;
    });

    const out = await simulatePastUsageDataset({
      userId: "u1",
      houseId: "h1",
      actualContextHouseId: "h1",
      esiid: null,
      startDate: "2026-01-01",
      endDate: "2026-01-01",
      timezone: "UTC",
      travelRanges: [],
      buildInputs: {
        ...baseBuildInputs,
        mode: "SMT_BASELINE",
        baseKind: "SMT_ACTUAL_BASELINE",
      } as any,
      buildPathKind: "recalc",
      actualIntervals: Array.from({ length: 96 }, (_, i) => ({
        timestamp: new Date(Date.UTC(2026, 0, 1, 0, i * 15)).toISOString(),
        kwh: 0.1,
      })),
      includeSimulatedDayResults: false,
    });

    expect(out.dataset).toBeNull();
    expect("error" in out ? out.error : "").toMatch(/ACTUAL_LAST_YEAR coverage is still missing after real API backfill/);
  });
});