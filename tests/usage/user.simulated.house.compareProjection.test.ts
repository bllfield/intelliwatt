import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("server-only", () => ({}));

const cookiesMock = vi.fn();
const prisma: any = {
  user: { findUnique: vi.fn() },
};
const getSimulatedUsageForHouseScenario = vi.fn();
const buildValidationCompareProjectionSidecar = vi.fn((dataset: any) => ({
  rows: Array.isArray(dataset?.meta?.validationCompareRows) ? dataset.meta.validationCompareRows : [],
  metrics:
    dataset?.meta?.validationCompareMetrics && typeof dataset.meta.validationCompareMetrics === "object"
      ? dataset.meta.validationCompareMetrics
      : {},
}));

vi.mock("next/headers", () => ({
  cookies: () => cookiesMock(),
}));

vi.mock("@/lib/db", () => ({ prisma }));

vi.mock("@/modules/usageSimulator/service", () => ({
  getSimulatedUsageForHouseScenario: (...args: any[]) => getSimulatedUsageForHouseScenario(...args),
}));
vi.mock("@/modules/usageSimulator/compareProjection", () => ({
  buildValidationCompareProjectionSidecar: (dataset: any) => buildValidationCompareProjectionSidecar(dataset),
}));

vi.mock("@/lib/usage/resolveIntervalsLayer", () => ({
  resolveIntervalsLayer: vi.fn(),
}));

vi.mock("@/modules/usageShapeProfile/autoBuild", () => ({
  ensureUsageShapeProfileForUserHouse: vi.fn(),
}));

describe("user simulated house compare projection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cookiesMock.mockReturnValue({
      get: (name: string) =>
        name === "intelliwatt_user" ? { value: "brian@intellipath-solutions.com" } : undefined,
    });
    prisma.user.findUnique.mockResolvedValue({ id: "u1" });
    getSimulatedUsageForHouseScenario.mockResolvedValue({
      ok: true,
      houseId: "h1",
      scenarioKey: "past-s1",
      scenarioId: "past-s1",
      dataset: {
        summary: { source: "SIMULATED" },
        meta: {
          validationCompareRows: [
            {
              localDate: "2025-04-10",
              dayType: "weekday",
              actualDayKwh: 10,
              simulatedDayKwh: 9,
              errorKwh: -1,
              percentError: 10,
              weather: {
                tAvgF: 62,
                tMinF: 55,
                tMaxF: 70,
                hdd65: 3,
                cdd65: 1,
                source: "actual_cached",
                weatherMissing: false,
              },
            },
          ],
          validationCompareMetrics: { wape: 10, mae: 1, rmse: 1 },
        },
      },
    });
  });

  it("returns compareProjection sidecar from canonical dataset family", async () => {
    const { GET } = await import("@/app/api/user/usage/simulated/house/route");
    const req = new NextRequest(
      "http://localhost/api/user/usage/simulated/house?houseId=h1&scenarioId=past-s1"
    );
    const res = await GET(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.compareProjection?.rows)).toBe(true);
    expect(body.compareProjection.rows[0]?.localDate).toBe("2025-04-10");
    expect(body.compareProjection.rows[0]?.weather?.tAvgF).toBe(62);
    expect(body.compareProjection.rows[0]?.weather?.weatherMissing).toBe(false);
    expect(body.compareProjection.metrics?.wape).toBe(10);
    expect(buildValidationCompareProjectionSidecar).toHaveBeenCalledTimes(1);
  });
});
