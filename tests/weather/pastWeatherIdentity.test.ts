import { beforeEach, describe, expect, it, vi } from "vitest";

const getHouseWeatherDays = vi.fn();

vi.mock("@/modules/weather/repo", () => ({
  getHouseWeatherDays: (...args: any[]) => getHouseWeatherDays(...args),
}));

import { computePastWeatherIdentity } from "@/modules/weather/identity";

describe("computePastWeatherIdentity", () => {
  beforeEach(() => {
    getHouseWeatherDays.mockReset();
  });

  it("is deterministic regardless of map insertion order", async () => {
    getHouseWeatherDays
      .mockResolvedValueOnce(
        new Map([
          ["2026-01-02", { source: "actual", tAvgF: 50, tMinF: 45, tMaxF: 55, hdd65: 15, cdd65: 0 }],
          ["2026-01-01", { source: "actual", tAvgF: 52, tMinF: 47, tMaxF: 57, hdd65: 13, cdd65: 0 }],
        ])
      )
      .mockResolvedValueOnce(
        new Map([
          ["2026-01-02", { source: "normal", tAvgF: 51, tMinF: 46, tMaxF: 56, hdd65: 14, cdd65: 0 }],
          ["2026-01-01", { source: "normal", tAvgF: 53, tMinF: 48, tMaxF: 58, hdd65: 12, cdd65: 0 }],
        ])
      );
    const a = await computePastWeatherIdentity({
      houseId: "h1",
      startDate: "2026-01-01",
      endDate: "2026-01-02",
    });

    getHouseWeatherDays
      .mockResolvedValueOnce(
        new Map([
          ["2026-01-01", { source: "actual", tAvgF: 52, tMinF: 47, tMaxF: 57, hdd65: 13, cdd65: 0 }],
          ["2026-01-02", { source: "actual", tAvgF: 50, tMinF: 45, tMaxF: 55, hdd65: 15, cdd65: 0 }],
        ])
      )
      .mockResolvedValueOnce(
        new Map([
          ["2026-01-01", { source: "normal", tAvgF: 53, tMinF: 48, tMaxF: 58, hdd65: 12, cdd65: 0 }],
          ["2026-01-02", { source: "normal", tAvgF: 51, tMinF: 46, tMaxF: 56, hdd65: 14, cdd65: 0 }],
        ])
      );
    const b = await computePastWeatherIdentity({
      houseId: "h1",
      startDate: "2026-01-01",
      endDate: "2026-01-02",
    });

    expect(a).toBe(b);
  });

  it("changes when weather rows change", async () => {
    getHouseWeatherDays
      .mockResolvedValueOnce(
        new Map([
          ["2026-01-01", { source: "actual", tAvgF: 52, tMinF: 47, tMaxF: 57, hdd65: 13, cdd65: 0 }],
        ])
      )
      .mockResolvedValueOnce(new Map());
    const a = await computePastWeatherIdentity({
      houseId: "h1",
      startDate: "2026-01-01",
      endDate: "2026-01-01",
    });

    getHouseWeatherDays
      .mockResolvedValueOnce(
        new Map([
          ["2026-01-01", { source: "actual", tAvgF: 54, tMinF: 49, tMaxF: 59, hdd65: 11, cdd65: 0 }],
        ])
      )
      .mockResolvedValueOnce(new Map());
    const b = await computePastWeatherIdentity({
      houseId: "h1",
      startDate: "2026-01-01",
      endDate: "2026-01-01",
    });

    expect(a).not.toBe(b);
  });
});

