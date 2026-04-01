import { beforeEach, describe, expect, it, vi } from "vitest";
import { validateManualUsagePayload } from "@/modules/manualUsage/validation";

vi.mock("@/modules/realUsageAdapter/actual", () => ({
  fetchActualCanonicalDailyTotals: vi.fn(),
  fetchActualCanonicalMonthlyTotals: vi.fn(),
}));

vi.mock("@/modules/usageEstimator/estimate", () => ({
  estimateUsageForCanonicalWindow: vi.fn(),
}));

import {
  fetchActualCanonicalDailyTotals,
  fetchActualCanonicalMonthlyTotals,
} from "@/modules/realUsageAdapter/actual";
import { estimateUsageForCanonicalWindow } from "@/modules/usageEstimator/estimate";
import { buildAdminLabSyntheticManualUsagePayload } from "@/modules/usageSimulator/adminLabManualFromActuals";

const fetchDailyMock = vi.mocked(fetchActualCanonicalDailyTotals);
const fetchMock = vi.mocked(fetchActualCanonicalMonthlyTotals);
const estimateMock = vi.mocked(estimateUsageForCanonicalWindow);

describe("buildAdminLabSyntheticManualUsagePayload", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchDailyMock.mockReset();
    estimateMock.mockReset();
  });

  it("builds MONTHLY payload from shared travel-aware monthly resolution and passes manual validation", async () => {
    fetchMock.mockResolvedValue({
      source: "SMT",
      intervalsCount: 100,
      monthlyKwhByMonth: { "2025-03": 400, "2025-04": 420 },
    });
    fetchDailyMock.mockResolvedValue({
      source: "SMT",
      intervalsCount: 100,
      dailyKwhByDateKey: {
        "2025-03-01": 10,
        "2025-03-02": 10,
        "2025-03-03": 10,
        "2025-03-04": 10,
        "2025-03-05": 10,
        "2025-03-10": 1,
        "2025-03-11": 1,
        "2025-03-12": 1,
      },
    });
    estimateMock.mockReturnValue({
      monthlyKwh: [333, 444],
      annualKwh: 777,
      confidence: "MEDIUM",
      notes: [],
      filledMonths: [],
    });
    const canonicalMonths = ["2025-03", "2025-04"];
    const out = await buildAdminLabSyntheticManualUsagePayload({
      treatmentMode: "manual_monthly_constrained",
      canonicalMonths,
      actualContextHouseId: "h-src",
      esiid: "E1",
      monthlyAnchorEndDate: "2025-04-15",
      homeProfile: {} as any,
      applianceProfile: { fuelConfiguration: {} } as any,
      travelRanges: [{ startDate: "2025-03-10", endDate: "2025-03-12" }],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        houseId: "h-src",
        esiid: "E1",
        canonicalMonths,
        travelRanges: [{ startDate: "2025-03-10", endDate: "2025-03-12" }],
      })
    );
    expect(out.payload.mode).toBe("MONTHLY");
    expect(out.payload.anchorEndDate).toBe("2025-04-15");
    expect(out.payload.travelRanges).toEqual([]);
    expect(out.monthlySourceDerivedResolution?.diagnostics[0]?.monthlyTargetBuildMethod).toBe(
      "normalized_from_non_travel_days"
    );
    expect(validateManualUsagePayload(out.payload).ok).toBe(true);
  });

  it("builds ANNUAL payload as sum of monthly actuals", async () => {
    fetchMock.mockResolvedValue({
      source: "GREEN_BUTTON",
      intervalsCount: 50,
      monthlyKwhByMonth: { "2025-03": 100, "2025-04": 200 },
    });
    const out = await buildAdminLabSyntheticManualUsagePayload({
      treatmentMode: "manual_annual_constrained",
      canonicalMonths: ["2025-03", "2025-04"],
      actualContextHouseId: "h-src",
      esiid: null,
      monthlyAnchorEndDate: "2025-04-15",
      homeProfile: {} as any,
      applianceProfile: { fuelConfiguration: {} } as any,
    });
    expect(out.payload.mode).toBe("ANNUAL");
    expect((out.payload as { annualKwh: number }).annualKwh).toBe(300);
    expect(out.payload.travelRanges).toEqual([]);
    expect(out.monthlySourceDerivedResolution).toBeNull();
    expect(validateManualUsagePayload(out.payload).ok).toBe(true);
  });

  it("keeps gapfill monthly-from-source on anchored shared month semantics across month edges", async () => {
    fetchMock.mockResolvedValue({
      source: "SMT",
      intervalsCount: 100,
      monthlyKwhByMonth: { "2025-03": 100, "2025-04": 200 },
    });
    fetchDailyMock.mockResolvedValue({
      source: "SMT",
      intervalsCount: 100,
      dailyKwhByDateKey: {
        "2025-03-31": 10,
        "2025-04-01": 20,
        "2025-04-02": 30,
        "2025-04-03": 40,
        "2025-04-04": 50,
      },
    });
    estimateMock.mockReturnValue({
      monthlyKwh: [111, 222],
      annualKwh: 333,
      confidence: "MEDIUM",
      notes: [],
      filledMonths: [],
    });

    const out = await buildAdminLabSyntheticManualUsagePayload({
      treatmentMode: "manual_monthly_constrained",
      canonicalMonths: ["2025-03", "2025-04"],
      actualContextHouseId: "h-src",
      esiid: "E1",
      monthlyAnchorEndDate: "2025-04-15",
      homeProfile: {} as any,
      applianceProfile: { fuelConfiguration: {} } as any,
    });

    expect(out.payload.anchorEndDate).toBe("2025-04-15");
    expect(out.monthlySourceDerivedResolution?.monthlyKwhByMonth["2025-04"]).toBe(930);
    expect(out.monthlySourceDerivedResolution?.diagnostics[1]).toMatchObject({
      month: "2025-04",
      rawMonthKwhFromSource: 150,
      trustedMonthlyAnchorUsed: true,
    });
  });
});
