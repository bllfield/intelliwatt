import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const scenarioFindFirst = vi.fn();
const getHouseAddressForUserHouse = vi.fn();
const getLatestCachedPastDatasetByScenario = vi.fn();
const simulatePastUsageDataset = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    usageSimulatorScenario: {
      findFirst: (...args: any[]) => scenarioFindFirst(...args),
    },
  },
}));

vi.mock("@/modules/usageSimulator/repo", () => ({
  getHouseAddressForUserHouse: (...args: any[]) => getHouseAddressForUserHouse(...args),
  normalizeScenarioKey: (v: string | null | undefined) => (v ? String(v) : "BASELINE"),
  listHouseAddressesForUser: vi.fn(),
  upsertSimulatorBuild: vi.fn(),
}));

vi.mock("@/modules/usageSimulator/pastCache", () => ({
  computePastInputHash: vi.fn(),
  getCachedPastDataset: vi.fn(),
  getLatestCachedPastDatasetByScenario: (...args: any[]) => getLatestCachedPastDatasetByScenario(...args),
  saveCachedPastDataset: vi.fn(),
  PAST_ENGINE_VERSION: "production_past_stitched_v2",
}));

vi.mock("@/modules/usageSimulator/intervalCodec", () => ({
  encodeIntervalsV1: vi.fn(),
  decodeIntervalsV1: vi.fn(() => [
    { timestamp: "2026-01-01T00:00:00.000Z", kwh: 0.25 },
    { timestamp: "2026-01-01T00:15:00.000Z", kwh: 0.5 },
  ]),
  INTERVAL_CODEC_V1: "v1_delta_varint",
}));

vi.mock("@/modules/simulatedUsage/simulatePastUsageDataset", () => ({
  simulatePastUsageDataset: (...args: any[]) => simulatePastUsageDataset(...args),
  getUsageShapeProfileIdentityForPast: vi.fn(),
}));

import { getSimulatedUsageForHouseScenario } from "@/modules/usageSimulator/service";

describe("getSimulatedUsageForHouseScenario artifact_only", () => {
  beforeEach(() => {
    scenarioFindFirst.mockReset();
    getHouseAddressForUserHouse.mockReset();
    getLatestCachedPastDatasetByScenario.mockReset();
    simulatePastUsageDataset.mockReset();

    getHouseAddressForUserHouse.mockResolvedValue({ id: "h1", esiid: "1044" });
    scenarioFindFirst.mockResolvedValue({ id: "gapfill_lab", name: "Past (Corrected)" });
  });

  it("returns ARTIFACT_MISSING instead of rebuilding when cache artifact is missing", async () => {
    getLatestCachedPastDatasetByScenario.mockResolvedValue(null);

    const out = await getSimulatedUsageForHouseScenario({
      userId: "u1",
      houseId: "h1",
      scenarioId: "gapfill_lab",
      readMode: "artifact_only",
    });

    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe("ARTIFACT_MISSING");
    expect(simulatePastUsageDataset).not.toHaveBeenCalled();
  });

  it("returns artifact dataset when persisted cache exists and does not rebuild", async () => {
    getLatestCachedPastDatasetByScenario.mockResolvedValue({
      inputHash: "hash1",
      updatedAt: new Date("2026-03-12T00:00:00.000Z"),
      datasetJson: {
        summary: { source: "SIMULATED", intervalsCount: 2, totalKwh: 0.75, start: "2026-01-01", end: "2026-01-01", latest: "2026-01-01" },
        series: {},
      },
      intervalsCodec: "v1_delta_varint",
      intervalsCompressed: Buffer.from("00", "hex"),
    });

    const out = await getSimulatedUsageForHouseScenario({
      userId: "u1",
      houseId: "h1",
      scenarioId: "gapfill_lab",
      readMode: "artifact_only",
    });

    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.dataset?.meta?.artifactReadMode).toBe("artifact_only");
      expect(Array.isArray(out.dataset?.series?.intervals15)).toBe(true);
    }
    expect(simulatePastUsageDataset).not.toHaveBeenCalled();
  });

  it("artifact_only does not require usageSimulatorScenario row for cache-backed scenarios", async () => {
    scenarioFindFirst.mockResolvedValue(null);
    getLatestCachedPastDatasetByScenario.mockResolvedValue({
      inputHash: "hash2",
      updatedAt: new Date("2026-03-12T00:00:00.000Z"),
      datasetJson: {
        summary: { source: "SIMULATED", intervalsCount: 2, totalKwh: 0.75, start: "2026-01-01", end: "2026-01-01", latest: "2026-01-01" },
        series: {},
      },
      intervalsCodec: "v1_delta_varint",
      intervalsCompressed: Buffer.from("00", "hex"),
    });

    const out = await getSimulatedUsageForHouseScenario({
      userId: "u1",
      houseId: "h1",
      scenarioId: "gapfill_lab",
      readMode: "artifact_only",
    });

    expect(out.ok).toBe(true);
    expect(scenarioFindFirst).not.toHaveBeenCalled();
    expect(simulatePastUsageDataset).not.toHaveBeenCalled();
  });
});

