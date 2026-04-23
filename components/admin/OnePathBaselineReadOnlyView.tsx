"use client";

import React, { useState } from "react";
import type { UserUsageHouseContract } from "@/lib/usage/userUsageHouseContract";
import { buildOnePathBaselineReadOnlyView } from "@/modules/onePathSim/baselineReadOnlyView";
import type { OnePathBaselineReadOnlyView as OnePathBaselineReadOnlyViewData } from "@/modules/onePathSim/baselineReadOnlyView";
import type { OnePathBaselineParityAudit } from "@/modules/onePathSim/baselineParityAudit";
import type { buildBaselineParityReport } from "@/modules/onePathSim/baselineParityReport";
import { UsageChartsPanel } from "@/components/usage/UsageChartsPanel";
import { WeatherSensitivityCard } from "@/components/usage/WeatherSensitivityCard";
import { formatDateLong, formatDateShort } from "@/components/usage/usageFormatting";

function MetricCard(props: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">{props.label}</div>
      <div className="mt-2 text-2xl font-semibold text-slate-900">{props.value}</div>
      {props.note ? <p className="mt-1 text-xs text-slate-500">{props.note}</p> : null}
    </div>
  );
}

export function OnePathBaselineReadOnlyView(props: {
  houseContract?: UserUsageHouseContract | null;
  view?: OnePathBaselineReadOnlyViewData | null;
  parityAudit?: OnePathBaselineParityAudit | null;
  parityReport?: ReturnType<typeof buildBaselineParityReport> | null;
}) {
  const [monthlyView, setMonthlyView] = useState<"chart" | "table">("chart");
  const [dailyView, setDailyView] = useState<"chart" | "table">("chart");
  const view =
    props.view ??
    buildOnePathBaselineReadOnlyView({
      houseContract: props.houseContract ?? null,
      parityAudit: props.parityAudit ?? null,
    });

  if (!view) return null;

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="text-sm font-semibold text-brand-navy">Baseline parity audit</div>
        <p className="mt-2 text-sm text-slate-600">
          This baseline preview renders from the same shared user-usage output contract the baseline usage page already uses.
        </p>
        {view.parityAudit?.displayOwnerSplitInformational ? (
          <p className="mt-2 text-sm text-amber-700">
            {view.parityAudit.displayOwnerSplitNote ??
              "Baseline truth parity passed. The remaining daily/headline difference is an informational display-owner split."}
          </p>
        ) : null}
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="Parity status" value={view.parityAudit?.parityStatus ?? "missing"} />
          <MetricCard label="Interval count parity" value={String(view.parityAudit?.intervalCountParity ?? "unknown")} />
          <MetricCard label="Total kWh parity" value={String(view.parityAudit?.totalKwhParity ?? "unknown")} />
          <MetricCard label="Monthly / daily parity" value={`${String(view.parityAudit?.monthlyParity ?? "unknown")} / ${String(view.parityAudit?.dailyParity ?? "unknown")}`} />
        </div>
        {props.parityReport ? (
          <div className="mt-4 grid gap-3 xl:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Fields matched</div>
              <p className="mt-2 text-sm text-slate-700">
                {props.parityReport.matchedKeys.length ? props.parityReport.matchedKeys.join(", ") : "None"}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Fields mismatched</div>
              <p className="mt-2 text-sm text-slate-700">
                {props.parityReport.mismatchedKeys.length ? props.parityReport.mismatchedKeys.join(", ") : "None"}
              </p>
            </div>
          </div>
        ) : null}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="text-sm font-semibold text-brand-navy">Household energy insights</div>
        <p className="mt-2 text-sm text-slate-600">
          Baseline charts and cards below use the same read-only baseline contract the user usage run/page renders for the selected house.
        </p>
        {view.summary.coverageStart && view.summary.coverageEnd ? (
          <p className="mt-2 text-xs text-slate-500">
            Data coverage:{" "}
            <span className="font-medium text-slate-700">
              {formatDateLong(view.summary.coverageStart)} - {formatDateLong(view.summary.coverageEnd)}
            </span>
            {view.summary.source ? <span> · Source: {view.summary.source}</span> : null}
            {typeof view.summary.intervalsCount === "number" ? (
              <span> · {view.summary.intervalsCount.toLocaleString()} intervals</span>
            ) : null}
          </p>
        ) : null}
        {view.summary.weatherBasisLabel ? <p className="mt-0.5 text-xs text-slate-500">{view.summary.weatherBasisLabel}</p> : null}
        {view.summary.sourceOfDaySimulationCore ? (
          <p className="mt-0.5 text-xs text-slate-500">
            Simulation core: <span className="font-medium text-slate-600">{view.summary.sourceOfDaySimulationCore}</span>
          </p>
        ) : null}
      </div>

      {view.weatherScore ? (
        <WeatherSensitivityCard score={view.weatherScore} presentation="customer" title="Weather Efficiency Score" />
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <MetricCard label="Net usage" value={`${view.summary.totals.netKwh.toFixed(1)} kWh`} note="Imported minus exported." />
        <MetricCard
          label="Exported to grid"
          value={`${view.summary.totals.exportKwh.toFixed(1)} kWh`}
          note="Solar backfeed / buyback volume."
        />
        <MetricCard label="Imported from grid" value={`${view.summary.totals.importKwh.toFixed(1)} kWh`} />
        <MetricCard label="Average daily" value={`${view.summary.avgDailyKwh.toFixed(1)} kWh/day`} />
        <MetricCard
          label="Baseload (15-min)"
          value={view.summary.baseload != null ? `${view.summary.baseload.toFixed(2)} kWh` : "--"}
          note="Estimated always-on interval energy."
        />
        <MetricCard
          label="Baseload (daily)"
          value={view.summary.baseloadDaily != null ? `${view.summary.baseloadDaily.toFixed(2)} kWh/day` : "--"}
        />
        <MetricCard
          label="Baseload (monthly)"
          value={view.summary.baseloadMonthly != null ? `${view.summary.baseloadMonthly.toFixed(2)} kWh/month` : "--"}
        />
        <MetricCard
          label="Peak pattern"
          value={
            view.summary.peakDay
              ? `Day: ${formatDateShort(view.summary.peakDay.date)} (${view.summary.peakDay.kwh.toFixed(1)} kWh)`
              : "-"
          }
          note={view.summary.peakHour ? `Hour: ${view.summary.peakHour.hour}:00 (${view.summary.peakHour.kw.toFixed(1)} kW)` : undefined}
        />
      </div>

      <UsageChartsPanel
        monthly={view.monthlyRows}
        stitchedMonth={view.stitchedMonth}
        weekdayKwh={view.summary.weekdayKwh}
        weekendKwh={view.summary.weekendKwh}
        timeOfDayBuckets={view.summary.timeOfDayBuckets}
        monthlyView={monthlyView}
        onMonthlyViewChange={setMonthlyView}
        dailyView={dailyView}
        onDailyViewChange={setDailyView}
        daily={view.dailyRows}
        dailyWeather={view.dailyWeather ?? undefined}
        weatherBasisLabel={view.summary.weatherBasisLabel ?? undefined}
        fifteenCurve={view.fifteenMinuteAverages}
        summaryTotalKwh={view.summary.totals.netKwh}
        coverageStart={view.summary.coverageStart}
        coverageEnd={view.summary.coverageEnd}
      />
    </div>
  );
}
