import { describe, expect, it } from "vitest";
import { buildSimulatorInputs, buildUniformMonthlyTotalsFromAnnualWindow } from "@/modules/usageSimulator/build";
import {
  buildSourceDerivedMonthlyTargetResolutionFromPayload,
  resolveManualMonthlyTargetDiagnostics,
} from "@/modules/usageSimulator/monthlyTargetConstruction";

describe("manual totals input contract", () => {
  it("keeps travel-overlap source months out of monthly source-truth ownership", () => {
    const payload = {
      mode: "MONTHLY" as const,
      anchorEndDate: "2026-02-28",
      monthlyKwh: [
        { month: "2026-01", kwh: 310 },
        { month: "2026-02", kwh: 280 },
      ],
      statementRanges: [
        { month: "2026-01", startDate: "2025-12-29", endDate: "2026-01-28" },
        { month: "2026-02", startDate: "2026-01-29", endDate: "2026-02-28" },
      ],
      travelRanges: [{ startDate: "2026-02-10", endDate: "2026-02-12" }],
    };
    const resolution = buildSourceDerivedMonthlyTargetResolutionFromPayload({
      canonicalMonths: ["2026-01", "2026-02"],
      payload,
    });

    expect(resolution).not.toBeNull();
    expect(resolution?.monthlyKwhByMonth).toEqual({
      "2026-01": 310,
    });
    const resolved = resolveManualMonthlyTargetDiagnostics({
      payload,
      canonicalMonths: ["2026-01", "2026-02"],
      sourceDerivedResolution: resolution,
    });
    expect(resolved.monthlyKwhByMonth).toEqual({
      "2026-01": 310,
    });
    expect(resolved.manualMonthlyInputState).toMatchObject({
      enteredMonthKeys: ["2026-01"],
      missingMonthKeys: ["2026-02"],
    });
    expect(resolved.diagnostics).toContainEqual(
      expect.objectContaining({
        month: "2026-02",
        trustedMonthlyAnchorUsed: false,
        monthlyTargetBuildMethod: "insufficient_non_travel_days_fallback_to_pool_sim",
      })
    );
  });

  it("derives annual monthly totals inside the simulation contract from the annual total only", () => {
    const monthly = buildUniformMonthlyTotalsFromAnnualWindow({
      annualKwh: 3650,
      anchorEndDate: "2026-02-28",
      canonicalMonths: [
        "2025-03",
        "2025-04",
        "2025-05",
        "2025-06",
        "2025-07",
        "2025-08",
        "2025-09",
        "2025-10",
        "2025-11",
        "2025-12",
        "2026-01",
        "2026-02",
      ],
    });

    expect(monthly["2025-03"]).toBe(310);
    expect(monthly["2025-04"]).toBe(300);
    expect(monthly["2026-02"]).toBe(280);
    const total = Object.values(monthly).reduce((sum, value) => sum + value, 0);
    expect(total).toBe(3650);
  });

  it("keeps pure manual monthly payloads out of source-derived monthly ownership", async () => {
    const built = await buildSimulatorInputs({
      mode: "MANUAL_TOTALS",
      manualUsagePayload: {
        mode: "MONTHLY",
        anchorEndDate: "2026-02-28",
        monthlyKwh: [
          { month: "2026-01", kwh: 310 },
          { month: "2026-02", kwh: 280 },
        ],
        statementRanges: [
          { month: "2026-01", startDate: "2025-12-29", endDate: "2026-01-28" },
          { month: "2026-02", startDate: "2026-01-29", endDate: "2026-02-28" },
        ],
        travelRanges: [],
      },
      homeProfile: {} as any,
      applianceProfile: {} as any,
      canonicalMonths: ["2026-01", "2026-02"],
      travelRanges: [],
    });

    expect(built.monthlyTotalsKwhByMonth).toMatchObject({
      "2026-01": 310,
      "2026-02": 280,
    });
    expect(built.sourceDerivedTrustedMonthlyTotalsKwhByMonth).toBeNull();
    expect(built.monthlyTargetConstructionDiagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          month: "2026-01",
          rawMonthKwhFromSource: null,
          monthlyTargetBuildMethod: "user_manual_month_value",
          trustedMonthlyAnchorUsed: true,
        }),
      ])
    );
  });
});
