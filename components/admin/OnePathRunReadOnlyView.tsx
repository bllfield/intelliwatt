"use client";

import React, { useState } from "react";
import { UsageChartsPanel } from "@/components/usage/UsageChartsPanel";
import { WeatherSensitivityCard } from "@/components/usage/WeatherSensitivityCard";
import { formatDateLong, formatDateShort } from "@/components/usage/usageFormatting";
import { buildOnePathRunReadOnlyView } from "@/modules/onePathSim/runReadOnlyView";

function formatScenarioVariable(value: {
  kind: string;
  effectiveMonth?: string;
  payloadJson?: Record<string, unknown>;
}): string {
  const kind = String(value.kind ?? "").toUpperCase();
  const month = value.effectiveMonth ?? "";
  const payload = value.payloadJson ?? {};
  if (kind === "TRAVEL_RANGE") {
    const start = String(payload.startDate ?? "").slice(0, 10);
    const end = String(payload.endDate ?? "").slice(0, 10);
    return `Travel/Vacant: ${start} - ${end}`;
  }
  return `${kind}${month ? ` ${month}` : ""}`;
}

function MetricCard(props: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-[0.2em] text-neutral-500">{props.label}</div>
      <div className="mt-2 text-2xl font-semibold text-neutral-900">{props.value}</div>
      {props.note ? <p className="mt-1 text-xs text-neutral-500">{props.note}</p> : null}
    </div>
  );
}

export function OnePathRunReadOnlyView(props: {
  dataset?: Record<string, unknown> | null;
  engineInput?: Record<string, unknown> | null;
}) {
  const [monthlyView, setMonthlyView] = useState<"chart" | "table">("chart");
  const [dailyView, setDailyView] = useState<"chart" | "table">("chart");
  const view = buildOnePathRunReadOnlyView({
    dataset: props.dataset ?? null,
    engineInput: props.engineInput ?? null,
  });

  if (!view) return null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-neutral-500">Past simulated usage</p>
          <h2 className="text-xl font-semibold text-neutral-900">Household energy insights</h2>
          <p className="text-sm text-neutral-600">
            {view.summary.hasSimulatedFill
              ? "Based on actual usage data with simulated fill for Travel/Vacant dates."
              : "Based on a simulated 15-minute curve generated from your manual entry or SMT baseline."}
          </p>
          {view.summary.coverageStart && view.summary.coverageEnd ? (
            <p className="mt-1 text-xs text-neutral-500">
              Data coverage:{" "}
              <span className="font-medium text-neutral-700">
                {formatDateLong(view.summary.coverageStart)} - {formatDateLong(view.summary.coverageEnd)}
              </span>
              {view.summary.source ? <span> · Source: {view.summary.source}</span> : null}
              {typeof view.summary.intervalsCount === "number" ? (
                <span> · {view.summary.intervalsCount.toLocaleString()} intervals</span>
              ) : null}
            </p>
          ) : null}
          {view.summary.weatherBasisLabel ? <p className="mt-0.5 text-xs text-neutral-500">{view.summary.weatherBasisLabel}</p> : null}
          {view.summary.sourceOfDaySimulationCore ? (
            <p className="mt-0.5 text-xs text-neutral-500">
              Simulation core: <span className="font-medium text-neutral-600">{view.summary.sourceOfDaySimulationCore}</span>
            </p>
          ) : null}
          <div className="mt-3 rounded-lg border border-neutral-200 bg-neutral-50/80 px-3 py-2 min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500">Scenario variables</p>
            <div className="mt-1.5 text-xs text-neutral-700">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                {view.pastVariables.length > 0 ? (
                  view.pastVariables.map((variable, index) => (
                    <span key={`past-${index}`} className="inline-flex rounded bg-white/80 px-2 py-0.5 border border-neutral-200">
                      {formatScenarioVariable(variable)}
                    </span>
                  ))
                ) : (
                  <span className="text-neutral-500">None</span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {view.weatherScore ? (
        <WeatherSensitivityCard score={view.weatherScore} presentation="customer" title="Weather Efficiency Score" />
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Net usage"
          value={`${view.summary.totals.netKwh.toFixed(0)} kWh`}
          note="Imports minus exports."
        />
        <MetricCard
          label="Exported to grid"
          value={`${view.summary.totals.exportKwh.toFixed(0)} kWh`}
          note="Solar backfeed / buyback volume."
        />
        <MetricCard label="Imported from grid" value={`${view.summary.totals.importKwh.toFixed(0)} kWh`} />
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
          note={
            view.summary.peakHour
              ? `Hour: ${view.summary.peakHour.hour}:00 (${view.summary.peakHour.kw.toFixed(1)} kW)`
              : undefined
          }
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
