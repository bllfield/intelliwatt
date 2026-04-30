import { describe, expect, it } from "vitest";
import {
  pickManualUsagePayload,
  pickMonthlyManualUsagePayload,
  resolveManualStageOneLabPayloads,
  resolveManualStageOnePresentation,
  resolveManualMonthlyLabStageOnePayloads,
  resolveManualMonthlyStageOneRenderMode,
  shouldAllowManualStageOnePresentation,
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

  it("suppresses user stage-one fallback when interval usage is already resolved", () => {
    expect(
      shouldAllowManualStageOnePresentation({
        surface: "user_usage_manual_monthly_stage_one",
        hasResolvedIntervalDataset: true,
      })
    ).toBe(false);

    expect(
      shouldAllowManualStageOnePresentation({
        surface: "user_usage_manual_monthly_stage_one",
        hasResolvedIntervalDataset: false,
      })
    ).toBe(true);

    expect(
      shouldAllowManualStageOnePresentation({
        surface: "admin_manual_monthly_stage_one",
        hasResolvedIntervalDataset: true,
      })
    ).toBe(true);
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
    const presentation = resolveManualStageOnePresentation({
      surface: "admin_manual_monthly_stage_one",
      payload: {
        mode: "MONTHLY",
        anchorEndDate: "2025-05-31",
        monthlyKwh: [{ month: "2025-05", kwh: 456 }],
        statementRanges: [{ month: "2025-05", startDate: "2025-05-01", endDate: "2025-05-31" }],
        travelRanges: [],
      },
    });

    expect(presentation && presentation.mode === "MONTHLY" ? presentation.rows[0] : null).toMatchObject({
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

  it("keeps source payload selection separate from the stage-one preview payload", () => {
    const savedPayload = {
      mode: "MONTHLY" as const,
      anchorEndDate: "2026-03-31",
      monthlyKwh: [{ month: "2026-03", kwh: 805.22 }],
      statementRanges: [{ month: "2026-03", startDate: "2026-03-01", endDate: "2026-03-31" }],
      travelRanges: [],
    };
    const sourcePayload = {
      mode: "MONTHLY" as const,
      anchorEndDate: "2025-12-31",
      monthlyKwh: [{ month: "2025-12", kwh: 999 }],
      statementRanges: [{ month: "2025-12", startDate: "2025-12-01", endDate: "2025-12-31" }],
      travelRanges: [],
    };

    expect(pickMonthlyManualUsagePayload(savedPayload, sourcePayload)).toMatchObject(savedPayload);

    expect(
      resolveManualMonthlyLabStageOnePayloads({
        savedPayload,
        loadedSourcePayload: sourcePayload,
      })
    ).toMatchObject({
      sourcePayload,
      previewPayload: savedPayload,
    });
  });

  it("selects annual payloads for generic Stage 1 preview surfaces", () => {
    const annualPayload = {
      mode: "ANNUAL" as const,
      anchorEndDate: "2025-12-31",
      annualKwh: 6789,
      travelRanges: [],
    };

    expect(pickManualUsagePayload(annualPayload)).toMatchObject(annualPayload);
    expect(
      resolveManualStageOneLabPayloads({
        loadedSourcePayload: annualPayload,
        loadedPayload: annualPayload,
      })
    ).toMatchObject({
      sourcePayload: annualPayload,
      previewPayload: annualPayload,
    });
    expect(
      resolveManualStageOnePresentation({
        surface: "admin_manual_monthly_stage_one",
        payload: annualPayload,
      })
    ).toMatchObject({
      mode: "ANNUAL",
      summary: {
        annualKwh: 6789,
        endDate: "2025-12-31",
      },
    });
  });
});
