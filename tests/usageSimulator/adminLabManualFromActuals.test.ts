import { beforeEach, describe, expect, it, vi } from "vitest";
import { validateManualUsagePayload } from "@/modules/manualUsage/validation";

vi.mock("@/modules/realUsageAdapter/actual", () => ({
  fetchActualCanonicalMonthlyTotals: vi.fn(),
}));

import { fetchActualCanonicalMonthlyTotals } from "@/modules/realUsageAdapter/actual";
import { buildAdminLabSyntheticManualUsagePayload } from "@/modules/usageSimulator/adminLabManualFromActuals";

const fetchMock = vi.mocked(fetchActualCanonicalMonthlyTotals);

describe("buildAdminLabSyntheticManualUsagePayload", () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it("builds MONTHLY payload from shared actual totals and passes manual validation", async () => {
    fetchMock.mockResolvedValue({
      source: "SMT",
      intervalsCount: 100,
      monthlyKwhByMonth: { "2025-03": 400, "2025-04": 420 },
    });
    const canonicalMonths = ["2025-03", "2025-04"];
    const payload = await buildAdminLabSyntheticManualUsagePayload({
      treatmentMode: "manual_monthly_constrained",
      canonicalMonths,
      actualContextHouseId: "h-src",
      esiid: "E1",
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
    expect(payload.mode).toBe("MONTHLY");
    expect(payload.travelRanges).toEqual([]);
    expect(validateManualUsagePayload(payload).ok).toBe(true);
  });

  it("builds ANNUAL payload as sum of monthly actuals", async () => {
    fetchMock.mockResolvedValue({
      source: "GREEN_BUTTON",
      intervalsCount: 50,
      monthlyKwhByMonth: { "2025-03": 100, "2025-04": 200 },
    });
    const payload = await buildAdminLabSyntheticManualUsagePayload({
      treatmentMode: "manual_annual_constrained",
      canonicalMonths: ["2025-03", "2025-04"],
      actualContextHouseId: "h-src",
      esiid: null,
    });
    expect(payload.mode).toBe("ANNUAL");
    expect((payload as { annualKwh: number }).annualKwh).toBe(300);
    expect(payload.travelRanges).toEqual([]);
    expect(validateManualUsagePayload(payload).ok).toBe(true);
  });
});
