import { beforeEach, describe, expect, it, vi } from "vitest";
import { validateManualUsagePayload } from "@/modules/manualUsage/validation";
import { buildAdminLabSyntheticManualUsagePayload } from "@/modules/usageSimulator/adminLabManualFromActuals";

const getActualUsageDatasetForHouse = vi.fn();

vi.mock("@/lib/usage/actualDatasetForHouse", () => ({
  getActualUsageDatasetForHouse: (...args: any[]) => getActualUsageDatasetForHouse(...args),
}));

describe("buildAdminLabSyntheticManualUsagePayload", () => {
  beforeEach(() => {
    getActualUsageDatasetForHouse.mockReset();
    getActualUsageDatasetForHouse.mockResolvedValue({
      dataset: {
        summary: { end: "2025-04-15" },
        daily: [
          { date: "2025-03-16", kwh: 10 },
          { date: "2025-03-17", kwh: 10 },
          { date: "2025-04-14", kwh: 20 },
          { date: "2025-04-15", kwh: 20 },
        ],
      },
    });
  });

  it("reuses shared MONTHLY source payloads when present", async () => {
    const out = await buildAdminLabSyntheticManualUsagePayload({
      treatmentMode: "manual_monthly_constrained",
      canonicalMonths: ["2025-03", "2025-04"],
      actualContextHouseId: "h-src",
      esiid: "E1",
      monthlyAnchorEndDate: "2025-04-15",
      homeProfile: {} as any,
      applianceProfile: { fuelConfiguration: {} } as any,
      sourcePayload: {
        mode: "MONTHLY",
        anchorEndDate: "2025-04-15",
        monthlyKwh: [{ month: "2025-04", kwh: 456 }],
        statementRanges: [{ month: "2025-04", startDate: "2025-03-16", endDate: "2025-04-15" }],
        travelRanges: [],
      },
    });

    expect(getActualUsageDatasetForHouse).toHaveBeenCalledWith(
      "h-src",
      "E1",
      expect.objectContaining({ skipFullYearIntervalFetch: true })
    );
    expect(out.payload).toMatchObject({
      mode: "MONTHLY",
      anchorEndDate: "2025-04-15",
      monthlyKwh: [{ month: "2025-04", kwh: 456 }],
    });
    expect(out.monthlySourceDerivedResolution).toBeNull();
    expect(validateManualUsagePayload(out.payload).ok).toBe(true);
  });

  it("reuses shared ANNUAL source payloads when present", async () => {
    const out = await buildAdminLabSyntheticManualUsagePayload({
      treatmentMode: "manual_annual_constrained",
      canonicalMonths: ["2025-03", "2025-04"],
      actualContextHouseId: "h-src",
      esiid: null,
      monthlyAnchorEndDate: "2025-04-15",
      homeProfile: {} as any,
      applianceProfile: { fuelConfiguration: {} } as any,
      sourcePayload: {
        mode: "ANNUAL",
        anchorEndDate: "2025-04-15",
        annualKwh: 876,
        travelRanges: [],
      },
    });

    expect(out.payload).toMatchObject({
      mode: "ANNUAL",
      anchorEndDate: "2025-04-15",
      annualKwh: 876,
    });
    expect(out.monthlySourceDerivedResolution).toBeNull();
    expect(validateManualUsagePayload(out.payload).ok).toBe(true);
  });

  it("falls back to shared actual-derived monthly seeds with statement ranges", async () => {
    const out = await buildAdminLabSyntheticManualUsagePayload({
      treatmentMode: "manual_monthly_constrained",
      canonicalMonths: ["2025-03", "2025-04"],
      actualContextHouseId: "h-src",
      esiid: "E1",
      monthlyAnchorEndDate: "2025-04-15",
      homeProfile: {} as any,
      applianceProfile: { fuelConfiguration: {} } as any,
      travelRanges: [],
    });

    expect(out.payload.mode).toBe("MONTHLY");
    expect(out.payload.anchorEndDate).toBe("2025-04-15");
    expect(out.payload.statementRanges?.[0]).toMatchObject({
      month: "2025-04",
      endDate: "2025-04-15",
    });
    expect(out.monthlySourceDerivedResolution).toBeNull();
    expect(validateManualUsagePayload(out.payload).ok).toBe(true);
  });
});
