import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const resolveIntervalsLayer = vi.fn();
const getHomeProfileSimulatedByUserHouse = vi.fn();
const getApplianceProfileSimulatedByUserHouse = vi.fn();
const getManualUsageInputForUserHouse = vi.fn();
const resolveSharedWeatherSensitivityEnvelope = vi.fn();

vi.mock("@/lib/usage/resolveIntervalsLayer", () => ({
  resolveIntervalsLayer: (...args: any[]) => resolveIntervalsLayer(...args),
}));

vi.mock("@/modules/homeProfile/repo", () => ({
  getHomeProfileSimulatedByUserHouse: (...args: any[]) => getHomeProfileSimulatedByUserHouse(...args),
}));

vi.mock("@/modules/applianceProfile/repo", () => ({
  getApplianceProfileSimulatedByUserHouse: (...args: any[]) => getApplianceProfileSimulatedByUserHouse(...args),
}));

vi.mock("@/modules/applianceProfile/validation", () => ({
  normalizeStoredApplianceProfile: (value: unknown) => value,
}));

vi.mock("@/modules/manualUsage/store", () => ({
  getManualUsageInputForUserHouse: (...args: any[]) => getManualUsageInputForUserHouse(...args),
}));

vi.mock("@/modules/weatherSensitivity/shared", () => ({
  resolveSharedWeatherSensitivityEnvelope: (...args: any[]) => resolveSharedWeatherSensitivityEnvelope(...args),
}));

describe("user usage house contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveIntervalsLayer.mockResolvedValue({
      dataset: {
        summary: { source: "SMT", intervalsCount: 34823, totalKwh: 13542.3, start: "2025-04-14", end: "2026-04-14" },
        daily: [],
        monthly: [],
        series: { intervals15: [] },
      },
      alternatives: { smt: null, greenButton: null },
    });
    getHomeProfileSimulatedByUserHouse.mockResolvedValue(null);
    getApplianceProfileSimulatedByUserHouse.mockResolvedValue({ appliancesJson: null });
    getManualUsageInputForUserHouse.mockResolvedValue({ payload: null });
    resolveSharedWeatherSensitivityEnvelope.mockResolvedValue({
      score: {
        weatherEfficiencyScore0to100: 32,
        scoringMode: "INTERVAL_BASED",
        explanationSummary: "Weather score summary",
      },
      derivedInput: { source: "shared" },
    });
  });

  it("builds the canonical baseline house contract from the same usage owners the page uses", async () => {
    const { buildUserUsageHouseContract } = await import("@/lib/usage/userUsageHouseContract");
    const contract = await buildUserUsageHouseContract({
      userId: "user-1",
      house: {
        id: "house-1",
        label: "Test Home",
        addressLine1: "123 Main",
        addressCity: "Dallas",
        addressState: "TX",
        esiid: "esiid-1",
      },
    });

    expect(contract).toMatchObject({
      houseId: "house-1",
      label: "Test Home",
      dataset: {
        summary: {
          source: "SMT",
          intervalsCount: 34823,
          totalKwh: 13542.3,
        },
      },
      weatherSensitivityScore: {
        weatherEfficiencyScore0to100: 32,
      },
    });
    expect(resolveIntervalsLayer).toHaveBeenCalledOnce();
    expect(resolveSharedWeatherSensitivityEnvelope).toHaveBeenCalledOnce();
  });
});
