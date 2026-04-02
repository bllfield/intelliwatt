import React from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { UsageChartsPanel } from "@/components/usage/UsageChartsPanel";
import { resolveManualStageOnePresentation } from "@/modules/manualUsage/statementRanges";

describe("manual monthly stage-one display", () => {
  it("activates only for allowed stage-one surfaces with manual payloads", () => {
    const monthlyPayload = {
      mode: "MONTHLY" as const,
      anchorEndDate: "2025-05-31",
      monthlyKwh: [{ month: "2025-05", kwh: 456 }],
      statementRanges: [{ month: "2025-05", startDate: "2025-05-01", endDate: "2025-05-31" }],
      travelRanges: [],
    };

    expect(
      resolveManualStageOnePresentation({
        surface: "user_usage_manual_monthly_stage_one",
        payload: monthlyPayload,
      })
    ).toMatchObject({
      mode: "MONTHLY",
      surface: "user_usage_manual_monthly_stage_one",
      rows: [
        expect.objectContaining({
          month: "2025-05",
          label: "5/1/25 - 5/31/25",
          kwh: 456,
        }),
      ],
    });

    expect(
      resolveManualStageOnePresentation({
        surface: null,
        payload: monthlyPayload,
      })
    ).toBeNull();

    expect(
      resolveManualStageOnePresentation({
        surface: "admin_manual_monthly_stage_one",
        payload: {
          mode: "ANNUAL" as const,
          anchorEndDate: "2025-05-31",
          annualKwh: 5000,
          travelRanges: [],
        },
      })
    ).toMatchObject({
      mode: "ANNUAL",
      summary: {
        annualKwh: 5000,
        endDate: "2025-05-31",
      },
    });
  });

  it("uses explicit statement ranges and falls back to anchor-derived bill labels for legacy payloads", () => {
    const explicit = resolveManualStageOnePresentation({
      surface: "admin_manual_monthly_stage_one",
      payload: {
        mode: "MONTHLY",
        anchorEndDate: "2025-05-31",
        monthlyKwh: [{ month: "2025-05", kwh: 456 }],
        statementRanges: [{ month: "2025-05", startDate: "2025-05-01", endDate: "2025-05-31" }],
        travelRanges: [],
      },
    });
    expect(explicit && explicit.mode === "MONTHLY" ? explicit.rows[0] : null).toMatchObject({
      label: "5/1/25 - 5/31/25",
      startDate: "2025-05-01",
      endDate: "2025-05-31",
    });

    const legacy = resolveManualStageOnePresentation({
      surface: "user_usage_manual_monthly_stage_one",
      payload: {
        mode: "MONTHLY",
        anchorEndDate: "2025-05-15",
        monthlyKwh: [{ month: "2025-05", kwh: 300 }],
        travelRanges: [],
      },
    });
    expect(legacy && legacy.mode === "MONTHLY" ? legacy.rows[0] : null).toMatchObject({
      month: "2025-05",
      label: expect.stringContaining("5/"),
      endDate: "2025-05-15",
    });
  });

  it("renders manual monthly stage one as monthly totals only", () => {
    const html = renderToStaticMarkup(
      <UsageChartsPanel
        monthly={[]}
        stitchedMonth={null}
        weekdayKwh={0}
        weekendKwh={0}
        monthlyView="table"
        onMonthlyViewChange={() => undefined}
        dailyView="table"
        onDailyViewChange={() => undefined}
        daily={[]}
        fifteenCurve={[]}
        manualMonthlyStageOneRows={[
          {
            key: "2025-05:2025-05-31",
            month: "2025-05",
            startDate: "2025-05-01",
            endDate: "2025-05-31",
            label: "5/1/25 - 5/31/25",
            shortLabel: "5/1/25-5/31/25",
            kwh: 456,
          },
        ]}
      />
    );

    expect(html).toContain("Monthly statement totals");
    expect(html).toContain("5/1/25 - 5/31/25");
    expect(html).toContain("456.0 kWh");
    expect(html).not.toContain("Daily usage");
    expect(html).not.toContain("15-minute load curve");
    expect(html).not.toContain("Weekday vs Weekend");
    expect(html).not.toContain("Time of day");
  });

  it("renders annual Stage 1 as a simple total without a chart", () => {
    const html = renderToStaticMarkup(
      <UsageChartsPanel
        monthly={[]}
        stitchedMonth={null}
        weekdayKwh={0}
        weekendKwh={0}
        monthlyView="table"
        onMonthlyViewChange={() => undefined}
        dailyView="table"
        onDailyViewChange={() => undefined}
        daily={[]}
        fifteenCurve={[]}
        manualAnnualStageOneSummary={{
          key: "annual:2025-12-31",
          startDate: "2025-01-01",
          endDate: "2025-12-31",
          anchorEndDate: "2025-12-31",
          label: "1/1/25 - 12/31/25",
          shortLabel: "1/1/25-12/31/25",
          annualKwh: 5000,
        }}
      />
    );

    expect(html).toContain("Annual usage total");
    expect(html).toContain("1/1/25 - 12/31/25");
    expect(html).toContain("5000.0");
    expect(html).not.toContain("Monthly usage");
    expect(html).not.toContain("Daily usage");
    expect(html).not.toContain("15-minute load curve");
  });

  it("keeps the default usage chart surfaces unchanged outside manual monthly stage one", () => {
    const html = renderToStaticMarkup(
      <UsageChartsPanel
        monthly={[{ month: "2025-05", kwh: 456 }]}
        stitchedMonth={null}
        weekdayKwh={300}
        weekendKwh={156}
        monthlyView="table"
        onMonthlyViewChange={() => undefined}
        dailyView="table"
        onDailyViewChange={() => undefined}
        daily={[{ date: "2025-05-31", kwh: 12, source: "ACTUAL", sourceDetail: "ACTUAL" }]}
        fifteenCurve={[]}
      />
    );

    expect(html).toContain("Weekday vs Weekend");
    expect(html).toContain("Daily usage (all 1 days)");
    expect(html).toContain("15-minute load curve");
  });
});
