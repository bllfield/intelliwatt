import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const prismaHouseFindUnique = vi.fn();
const getWeatherForRange = vi.fn();
const hourlyRowsToDayWxMap = vi.fn();
const resolveHistoricalDailyTemperatures = vi.fn();
const deleteHouseWeatherStubRows = vi.fn();
const findDateKeysMissingOrStub = vi.fn();
const findMissingHouseWeatherDateKeys = vi.fn();
const upsertHouseWeatherDays = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    houseAddress: {
      findUnique: (...args: any[]) => prismaHouseFindUnique(...args),
    },
  },
}));

vi.mock("@/lib/sim/weatherProvider", () => ({
  getWeatherForRange: (...args: any[]) => getWeatherForRange(...args),
  hourlyRowsToDayWxMap: (...args: any[]) => hourlyRowsToDayWxMap(...args),
}));

vi.mock("@/lib/weather/weatherService", () => ({
  resolveHistoricalDailyTemperatures: (...args: any[]) => resolveHistoricalDailyTemperatures(...args),
}));

vi.mock("@/modules/weather/repo", () => ({
  deleteHouseWeatherStubRows: (...args: any[]) => deleteHouseWeatherStubRows(...args),
  findDateKeysMissingOrStub: (...args: any[]) => findDateKeysMissingOrStub(...args),
  findMissingHouseWeatherDateKeys: (...args: any[]) => findMissingHouseWeatherDateKeys(...args),
  upsertHouseWeatherDays: (...args: any[]) => upsertHouseWeatherDays(...args),
}));

import { resolveCanonicalUsage365CoverageWindow } from "@/modules/usageSimulator/metadataWindow";
import { ensureHouseWeatherBackfill } from "@/modules/weather/backfill";

describe("weather backfill manual coverage", () => {
  beforeEach(() => {
    prismaHouseFindUnique.mockReset();
    getWeatherForRange.mockReset();
    hourlyRowsToDayWxMap.mockReset();
    resolveHistoricalDailyTemperatures.mockReset();
    deleteHouseWeatherStubRows.mockReset();
    findDateKeysMissingOrStub.mockReset();
    findMissingHouseWeatherDateKeys.mockReset();
    upsertHouseWeatherDays.mockReset();

    prismaHouseFindUnique.mockResolvedValue({ lat: 32.7, lng: -97.3 });
    getWeatherForRange.mockResolvedValue({ rows: [] });
    hourlyRowsToDayWxMap.mockReturnValue(new Map());
    findMissingHouseWeatherDateKeys.mockResolvedValue([]);
    upsertHouseWeatherDays.mockResolvedValue(0);
  });

  it("can backfill dates older than the canonical customer window when manual sim needs them", async () => {
    const canonicalCoverage = resolveCanonicalUsage365CoverageWindow();
    const olderStart = new Date(`${canonicalCoverage.startDate}T00:00:00.000Z`);
    olderStart.setUTCDate(olderStart.getUTCDate() - 14);
    const startDate = olderStart.toISOString().slice(0, 10);
    const endDate = canonicalCoverage.startDate;

    findDateKeysMissingOrStub.mockImplementation(async ({ dateKeys }: any) => dateKeys);

    await ensureHouseWeatherBackfill({
      houseId: "house-1",
      startDate,
      endDate,
      allowOutsideCanonicalCoverage: true,
    });

    const requestedDateKeys = findDateKeysMissingOrStub.mock.calls[0]?.[0]?.dateKeys ?? [];
    expect(requestedDateKeys[0]).toBe(startDate);
    expect(requestedDateKeys).toContain(canonicalCoverage.startDate);
  });
});
