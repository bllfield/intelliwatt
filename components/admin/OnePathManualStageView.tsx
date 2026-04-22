"use client";

import { useMemo, useState } from "react";
import { UsageChartsPanel } from "@/components/usage/UsageChartsPanel";
import { ManualMonthlyReconciliationPanel } from "@/components/usage/ManualMonthlyReconciliationPanel";
import { type OnePathManualStageOneView } from "@/modules/onePathSim/manualStageView";

function MetricCard(props: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{props.label}</div>
      <div className="mt-1 text-sm font-semibold text-brand-navy">{props.value}</div>
      {props.note ? <div className="mt-1 text-xs text-slate-600">{props.note}</div> : null}
    </div>
  );
}

function formatTravelRanges(ranges: Array<{ startDate: string; endDate: string }>): string {
  if (!ranges.length) return "none";
  return ranges.map((range) => `${range.startDate} - ${range.endDate}`).join(", ");
}

export function OnePathManualStageView(props: { view?: OnePathManualStageOneView | null }) {
  const [monthlyView, setMonthlyView] = useState<"chart" | "table">("chart");
  const view = props.view ?? null;

  const stageOneTotal = useMemo(() => {
    if (!view) return 0;
    if (view.mode === "ANNUAL") return Number(view.annualCompareSummary?.stageOneTargetKwh ?? 0) || 0;
    if (view.stageOnePresentation.mode !== "MONTHLY") return 0;
    return view.stageOnePresentation.rows.reduce((sum, row) => sum + (Number(row.kwh) || 0), 0);
  }, [view]);

  if (!view) return null;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="text-sm font-semibold text-brand-navy">Manual Stage 1 contract</div>
        <p className="mt-2 text-sm text-slate-600">
          {view.source === "artifact_backed_read_model"
            ? "Artifact-backed manual Stage 1 truth for this One Path run. Monthly mode stays bill-period / statement-total semantics, and annual mode stays annual-total semantics."
            : "Saved manual payload preview for One Path. Monthly mode stays bill-period / statement-total semantics, and annual mode stays annual-total semantics until Stage 2 readback replaces the preview."}
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <MetricCard label="Source" value={view.source === "artifact_backed_read_model" ? "Artifact-backed" : "Saved preview"} />
        <MetricCard
          label={view.mode === "MONTHLY" ? "Anchor / Bill End Date" : "Anchor Date"}
          value={view.anchorEndDate ?? "not set"}
          note={view.mode === "ANNUAL" ? "Annual Stage 1 uses one trailing 365-day window ending on this anchor." : undefined}
        />
        <MetricCard label="Date source mode" value={view.dateSourceMode ?? "n/a"} note={view.mode === "MONTHLY" ? "Monthly only." : "Annual mode has no monthly date-source mode."} />
        <MetricCard
          label="Eligible vs Excluded"
          value={`${view.eligibleBillPeriodCount} eligible / ${view.excludedBillPeriodCount} excluded`}
          note="Travel-overlap and missing-input periods stay visible as excluded context."
        />
        <MetricCard label="Travel / Vacant" value={formatTravelRanges(view.travelRanges)} />
      </div>

      {view.stageOnePresentation.mode === "MONTHLY" ? (
        <UsageChartsPanel
          monthly={[]}
          stitchedMonth={null}
          weekdayKwh={0}
          weekendKwh={0}
          timeOfDayBuckets={[]}
          monthlyView={monthlyView}
          onMonthlyViewChange={setMonthlyView}
          dailyView="table"
          onDailyViewChange={() => undefined}
          daily={[]}
          fifteenCurve={[]}
          summaryTotalKwh={stageOneTotal}
          coverageStart={null}
          coverageEnd={null}
          manualMonthlyStageOneRows={view.stageOnePresentation.rows}
        />
      ) : (
        <UsageChartsPanel
          monthly={[]}
          stitchedMonth={null}
          weekdayKwh={0}
          weekendKwh={0}
          timeOfDayBuckets={[]}
          monthlyView="chart"
          onMonthlyViewChange={() => undefined}
          dailyView="table"
          onDailyViewChange={() => undefined}
          daily={[]}
          fifteenCurve={[]}
          summaryTotalKwh={stageOneTotal}
          coverageStart={null}
          coverageEnd={null}
          manualAnnualStageOneSummary={view.stageOnePresentation.summary}
        />
      )}

      {view.billPeriodCompare ? (
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-sm font-semibold text-brand-navy">Manual monthly parity / reconciliation</div>
          <div className="mt-1 text-xs text-slate-600">
            Raw actual-source bill-period totals, manual Stage 1 bill-period targets, and manual Stage 2 simulated totals. Eligible
            non-travel periods stay exact-match-required; excluded periods remain visible as context only.
          </div>
          <div className="mt-4">
            <ManualMonthlyReconciliationPanel reconciliation={view.billPeriodCompare} />
          </div>
        </div>
      ) : view.annualCompareSummary ? (
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-sm font-semibold text-brand-navy">Manual annual parity summary</div>
          <div className="mt-1 text-xs text-slate-600">
            Annual compare stays compact here because annual-total semantics are the Stage 1 source of truth.
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <MetricCard label="Stage 1 annual target" value={`${view.annualCompareSummary.stageOneTargetKwh.toFixed(2)} kWh`} />
            <MetricCard
              label="Actual annual truth"
              value={
                view.annualCompareSummary.actualIntervalKwh == null
                  ? "unavailable"
                  : `${view.annualCompareSummary.actualIntervalKwh.toFixed(2)} kWh`
              }
            />
            <MetricCard label="Stage 2 simulated total" value={`${view.annualCompareSummary.simulatedKwh.toFixed(2)} kWh`} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
