import { beforeEach, describe, expect, it, vi } from "vitest";
import { IntervalSeriesKind } from "@/modules/usageSimulator/kinds";

vi.mock("server-only", () => ({}));

const prismaUserFindUnique = vi.fn();
const prismaHouseFindMany = vi.fn();
const prismaHouseFindFirst = vi.fn();
const resolveIntervalsLayer = vi.fn();
const getSimulatedUsageForHouseScenario = vi.fn();
const buildUserUsageHouseContract = vi.fn();
const adaptGreenButtonRawInput = vi.fn();
const runSharedSimulation = vi.fn();

vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) => (name === "intelliwatt_user" ? { value: "user@example.com" } : undefined),
  }),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    user: { findUnique: (...args: any[]) => prismaUserFindUnique(...args) },
    houseAddress: {
      findMany: (...args: any[]) => prismaHouseFindMany(...args),
      findFirst: (...args: any[]) => prismaHouseFindFirst(...args),
    },
  },
}));

vi.mock("@/lib/utils/email", () => ({
  normalizeEmail: (v: string) => String(v).toLowerCase(),
}));

vi.mock("@/lib/usage/resolveIntervalsLayer", () => ({
  resolveIntervalsLayer: (...args: any[]) => resolveIntervalsLayer(...args),
}));

vi.mock("@/modules/usageSimulator/service", () => ({
  getSimulatedUsageForHouseScenario: (...args: any[]) => getSimulatedUsageForHouseScenario(...args),
}));

vi.mock("@/lib/usage/userUsageHouseContract", () => ({
  buildUserUsageHouseContract: (...args: any[]) => buildUserUsageHouseContract(...args),
}));

vi.mock("@/modules/onePathSim/onePathSim", () => ({
  adaptGreenButtonRawInput: (...args: any[]) => adaptGreenButtonRawInput(...args),
  runSharedSimulation: (...args: any[]) => runSharedSimulation(...args),
}));

import { GET as usageGet } from "@/app/api/user/usage/route";
import { GET as simulatedHouseGet } from "@/app/api/user/usage/simulated/house/route";

describe("baseline alias parity across usage routes", () => {
  beforeEach(() => {
    prismaUserFindUnique.mockReset();
    prismaHouseFindMany.mockReset();
    prismaHouseFindFirst.mockReset();
    resolveIntervalsLayer.mockReset();
    getSimulatedUsageForHouseScenario.mockReset();
    buildUserUsageHouseContract.mockReset();
    adaptGreenButtonRawInput.mockReset();
    runSharedSimulation.mockReset();

    prismaUserFindUnique.mockResolvedValue({ id: "u1" });
    prismaHouseFindMany.mockResolvedValue([
      {
        id: "h1",
        label: "GAPFILL_CANONICAL_LAB_TEST_HOME",
        addressLine1: "123 Main",
        addressCity: "Fort Worth",
        addressState: "TX",
        esiid: "1044372",
      },
    ]);
    prismaHouseFindFirst.mockResolvedValue({ id: "h1", esiid: "1044372" });

    resolveIntervalsLayer.mockResolvedValue({
      dataset: {
        summary: { source: "SMT", intervalsCount: 192, totalKwh: 48.5, start: "2026-01-01", end: "2026-01-02", latest: "2026-01-02" },
        series: { intervals15: [], hourly: [], daily: [], monthly: [], annual: [] },
      },
      alternatives: { smt: null, greenButton: null },
    });
    buildUserUsageHouseContract.mockResolvedValue({
      houseId: "h1",
      label: "Home",
      address: { line1: "123 Main", city: "Fort Worth", state: "TX" },
      esiid: "1044372",
      dataset: {
        summary: { source: "SMT", intervalsCount: 192, totalKwh: 48.5, start: "2026-01-01", end: "2026-01-02", latest: "2026-01-02" },
        series: { intervals15: [], hourly: [], daily: [], monthly: [], annual: [] },
      },
      alternatives: { smt: null, greenButton: null },
      datasetError: null,
      weatherSensitivityScore: null,
      weatherEfficiencyDerivedInput: null,
    });
    adaptGreenButtonRawInput.mockResolvedValue({ engineInputVersion: "one-path-sim-v1", inputType: "GREEN_BUTTON" });
    runSharedSimulation.mockResolvedValue({
      dataset: {
        summary: {
          source: "GREEN_BUTTON",
          intervalsCount: 35040,
          totalKwh: 1234,
          start: "2025-04-26",
          end: "2026-04-25",
        },
        meta: {
          actualSource: "GREEN_BUTTON",
          baselinePassthrough: true,
          coverageStart: "2025-04-26",
          coverageEnd: "2026-04-25",
        },
        daily: [],
        monthly: [],
        series: { intervals15: [], hourly: [], daily: [], monthly: [], annual: [] },
      },
    });
  });

  it("returns same baseline totals/count as actual usage endpoint when scenarioId is null", async () => {
    const usageRes = await usageGet({} as any);
    expect(usageRes.status).toBe(200);
    const usageBody = await usageRes.json();

    const simulatedRes = await simulatedHouseGet({
      url: "https://intelliwatt.com/api/user/usage/simulated/house?houseId=h1",
    } as any);
    expect(simulatedRes.status).toBe(200);
    const simulatedBody = await simulatedRes.json();

    expect(usageBody.houses[0].label).toBe("Home");
    expect(usageBody.houses[0].dataset.summary.intervalsCount).toBe(simulatedBody.dataset.summary.intervalsCount);
    expect(usageBody.houses[0].dataset.summary.totalKwh).toBe(simulatedBody.dataset.summary.totalKwh);

    const kindsCalled = resolveIntervalsLayer.mock.calls.map((c: any[]) => c[0]?.layerKind);
    expect(kindsCalled).toContain(IntervalSeriesKind.ACTUAL_USAGE_INTERVALS);
    expect(kindsCalled).not.toContain(IntervalSeriesKind.BASELINE_INTERVALS);
    expect(getSimulatedUsageForHouseScenario).not.toHaveBeenCalled();
  });

  it("cuts user-facing Green Button baseline through One Path baseline passthrough before building the usage contract", async () => {
    resolveIntervalsLayer.mockResolvedValueOnce({
      dataset: {
        summary: {
          source: "GREEN_BUTTON",
          intervalsCount: 35040,
          totalKwh: 1234,
          start: "2025-04-26",
          end: "2026-04-25",
        },
        meta: { actualSource: "GREEN_BUTTON", coverageStart: "2025-04-26", coverageEnd: "2026-04-25" },
        series: { intervals15: [], hourly: [], daily: [], monthly: [], annual: [] },
      },
      alternatives: { smt: null, greenButton: { rawId: "raw-1" } },
    });

    await usageGet({} as any);

    expect(adaptGreenButtonRawInput).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "u1",
        houseId: "h1",
        actualContextHouseId: "h1",
        scenarioId: null,
      }),
    );
    expect(runSharedSimulation).toHaveBeenCalledWith(
      expect.objectContaining({
        inputType: "GREEN_BUTTON",
      }),
    );
    expect(buildUserUsageHouseContract).toHaveBeenCalledWith(
      expect.objectContaining({
        resolvedUsage: expect.objectContaining({
          dataset: expect.objectContaining({
            meta: expect.objectContaining({
              baselinePassthrough: true,
              coverageStart: "2025-04-26",
              coverageEnd: "2026-04-25",
            }),
          }),
        }),
      }),
    );
  });

  it("cuts the simulated-house baseline alias through the same Green Button One Path passthrough", async () => {
    resolveIntervalsLayer.mockResolvedValueOnce({
      dataset: {
        summary: {
          source: "GREEN_BUTTON",
          intervalsCount: 35040,
          totalKwh: 1234,
          start: "2025-04-26",
          end: "2026-04-25",
        },
        meta: { actualSource: "GREEN_BUTTON", coverageStart: "2025-04-26", coverageEnd: "2026-04-25" },
        series: { intervals15: [], hourly: [], daily: [], monthly: [], annual: [] },
      },
      alternatives: { smt: null, greenButton: { rawId: "raw-1" } },
    });

    await simulatedHouseGet({
      url: "https://intelliwatt.com/api/user/usage/simulated/house?houseId=h1&scenarioId=baseline",
    } as any);

    expect(adaptGreenButtonRawInput).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "u1",
        houseId: "h1",
        actualContextHouseId: "h1",
        scenarioId: null,
      }),
    );
    expect(runSharedSimulation).toHaveBeenCalledWith(
      expect.objectContaining({
        inputType: "GREEN_BUTTON",
      }),
    );
    expect(buildUserUsageHouseContract).toHaveBeenCalledWith(
      expect.objectContaining({
        resolvedUsage: expect.objectContaining({
          dataset: expect.objectContaining({
            meta: expect.objectContaining({
              baselinePassthrough: true,
              coverageStart: "2025-04-26",
              coverageEnd: "2026-04-25",
            }),
          }),
        }),
      }),
    );
  });
});

