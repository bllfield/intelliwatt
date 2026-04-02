import { describe, expect, it } from "vitest";
import {
  resolveManualMonthlyStageOnePresentation,
  resolveManualMonthlyStageOneRenderMode,
  shouldUseManualMonthlyStageOnePayload,
} from "@/modules/manualUsage/statementRanges";

describe("manual monthly stage one dashboard state", () => {
  it("accepts the provided manual payload before a selected house is resolved", () => {
    expect(
      shouldUseManualMonthlyStageOnePayload({
        manualUsageHouseId: "house-1",
        selectedUsageHouseId: null,
      })
    ).toBe(true);

    expect(
      shouldUseManualMonthlyStageOnePayload({
        manualUsageHouseId: "house-1",
        selectedUsageHouseId: "house-1",
      })
    ).toBe(true);

    expect(
      shouldUseManualMonthlyStageOnePayload({
        manualUsageHouseId: "house-1",
        selectedUsageHouseId: "house-2",
      })
    ).toBe(false);
  });

  it("renders a forced empty state instead of a zero-data chart when no statement rows exist", () => {
    expect(
      resolveManualMonthlyStageOneRenderMode({
        forceManualMonthlyStageOne: true,
        rows: [],
      })
    ).toBe("empty");

    expect(
      resolveManualMonthlyStageOneRenderMode({
        forceManualMonthlyStageOne: false,
        rows: [],
      })
    ).toBe("off");
  });

  it("keeps the forced stage-one surface in rows mode once saved monthly totals resolve", () => {
    const presentation = resolveManualMonthlyStageOnePresentation({
      surface: "admin_manual_monthly_stage_one",
      payload: {
        mode: "MONTHLY",
        anchorEndDate: "2025-05-31",
        monthlyKwh: [{ month: "2025-05", kwh: 456 }],
        statementRanges: [{ month: "2025-05", startDate: "2025-05-01", endDate: "2025-05-31" }],
        travelRanges: [],
      },
    });

    expect(presentation?.rows[0]).toMatchObject({
      label: "5/1/25 - 5/31/25",
      kwh: 456,
    });
    expect(
      resolveManualMonthlyStageOneRenderMode({
        forceManualMonthlyStageOne: true,
        rows: presentation?.rows ?? [],
      })
    ).toBe("rows");
  });
});
