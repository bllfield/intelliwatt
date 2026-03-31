import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchHistoricalDailyTemperatures } from "@/lib/weather/openMeteoClient";

describe("openMeteoClient daily normals fetch", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("requests daily historical temperatures with a consistent model", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        daily: {
          time: ["1991-01-01"],
          temperature_2m_mean: [10],
          temperature_2m_min: [5],
          temperature_2m_max: [15],
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const rows = await fetchHistoricalDailyTemperatures(32.7, -97.3, "1991-01-01", "2020-12-31");

    expect(rows).toEqual([
      {
        dateKey: "1991-01-01",
        temperatureMeanC: 10,
        temperatureMinC: 5,
        temperatureMaxC: 15,
      },
    ]);
    const url = String(fetchMock.mock.calls[0]?.[0] ?? "");
    expect(url).toContain("daily=temperature_2m_mean%2Ctemperature_2m_min%2Ctemperature_2m_max");
    expect(url).toContain("models=era5");
  });
});
