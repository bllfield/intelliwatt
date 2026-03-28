import { beforeEach, describe, expect, it, vi } from "vitest";
import { IntervalSeriesKind } from "@/modules/usageSimulator/kinds";

vi.mock("server-only", () => ({}));

const prismaUserFindUnique = vi.fn();
const prismaHouseFindMany = vi.fn();
const prismaHouseFindFirst = vi.fn();
const resolveIntervalsLayer = vi.fn();
const getSimulatedUsageForHouseScenario = vi.fn();

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

import { GET as usageGet } from "@/app/api/user/usage/route";
import { GET as simulatedHouseGet } from "@/app/api/user/usage/simulated/house/route";

describe("baseline alias parity across usage routes", () => {
  beforeEach(() => {
    prismaUserFindUnique.mockReset();
    prismaHouseFindMany.mockReset();
    prismaHouseFindFirst.mockReset();
    resolveIntervalsLayer.mockReset();
    getSimulatedUsageForHouseScenario.mockReset();

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
});

