"use client";

import React from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatDateShort, formatDateShortWithYear, formatMonthLabel, formatTimeLabel } from "@/components/usage/usageFormatting";
import { pct, sumKwh } from "@/components/usage/usageMath";

type MonthlyRow = { month: string; kwh: number };
type DailyRow = { date: string; kwh: number; source?: "ACTUAL" | "SIMULATED" | "MISSING_REFERENCE" };
type FifteenMinuteAverage = { hhmm: string; avgKw: number };
type StitchedMonth =
  | {
      mode: "PRIOR_YEAR_TAIL";
      yearMonth: string;
      haveDaysThrough: number;
      missingDaysFrom: number;
      missingDaysTo: number;
      borrowedFromYearMonth: string;
      completenessRule: string;
    }
  | null;

export function UsageChartsPanel(props: {
  monthly: MonthlyRow[];
  stitchedMonth: StitchedMonth;
  weekdayKwh: number;
  weekendKwh: number;
  timeOfDayBuckets?: { key: string; label: string; kwh: number }[];
  monthlyView: "chart" | "table";
  onMonthlyViewChange: (next: "chart" | "table") => void;
  dailyView: "chart" | "table";
  onDailyViewChange: (next: "chart" | "table") => void;
  daily: DailyRow[];
  /** Historic weather by date (YYYY-MM-DD). When set, table view shows weather columns. */
  dailyWeather?: Record<string, { tAvgF: number; tMinF: number; tMaxF: number; hdd65: number; cdd65: number; source?: string }> | null;
  /** When set and daily table shows weather, display this truthful basis (e.g. stub/test vs actual cached). */
  weatherBasisLabel?: string | null;
  fifteenCurve: FifteenMinuteAverage[];
  emptyFifteenCurveMessage?: string | null;
  /** When set and range spans two years, daily chart labels include year (e.g. Past anchor). */
  coverageStart?: string | null;
  coverageEnd?: string | null;
}) {
  const {
    monthly,
    stitchedMonth,
    weekdayKwh,
    weekendKwh,
    timeOfDayBuckets,
    monthlyView,
    onMonthlyViewChange,
    dailyView,
    onDailyViewChange,
    daily,
    dailyWeather,
    weatherBasisLabel,
    fifteenCurve,
    emptyFifteenCurveMessage,
    coverageStart,
    coverageEnd,
  } = props;
  const spansTwoYears = coverageStart && coverageEnd && coverageStart.slice(0, 4) !== coverageEnd.slice(0, 4);
  const firstLastSameMonthDay =
    daily.length >= 2 &&
    (() => {
      const [a, b] = [daily[0]!.date.slice(5, 10), daily[daily.length - 1]!.date.slice(5, 10)];
      return a === b && daily[0]!.date.slice(0, 4) !== daily[daily.length - 1]!.date.slice(0, 4);
    })();
  const dailyLabelFormat = spansTwoYears || firstLastSameMonthDay ? formatDateShortWithYear : formatDateShort;

  return (
    <>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm lg:col-span-1">
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-neutral-500">Weekday vs Weekend</div>
          <div className="mt-3 flex flex-col gap-2 text-sm text-neutral-800">
            {(() => {
              const total = weekdayKwh + weekendKwh;
              return (
                <>
                  <div className="flex items-center justify-between">
                    <span>Weekdays</span>
                    <span className="font-semibold">
                      {weekdayKwh.toFixed(1)} kWh{" "}
                      <span className="text-neutral-500 font-normal">({pct(weekdayKwh, total)})</span>
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Weekends</span>
                    <span className="font-semibold">
                      {weekendKwh.toFixed(1)} kWh{" "}
                      <span className="text-neutral-500 font-normal">({pct(weekendKwh, total)})</span>
                    </span>
                  </div>
                  <div className="my-1 h-px w-full bg-neutral-200" />
                  <div className="flex items-center justify-between">
                    <span>Total</span>
                    <span className="font-semibold">{total.toFixed(1)} kWh</span>
                  </div>
                </>
              );
            })()}

            {timeOfDayBuckets?.length ? (
              <>
                <div className="my-2 h-px w-full bg-neutral-200" />
                <div className="text-xs font-semibold uppercase tracking-[0.2em] text-neutral-500">Time of day</div>
                {(() => {
                  const total = timeOfDayBuckets.reduce((s, b) => s + (Number(b.kwh) || 0), 0);
                  return timeOfDayBuckets.map((b) => (
                    <div key={b.key} className="flex items-center justify-between">
                      <span className="text-neutral-800">{b.label}</span>
                      <span className="font-semibold">
                        {Number(b.kwh).toFixed(1)} kWh{" "}
                        <span className="text-neutral-500 font-normal">({pct(Number(b.kwh) || 0, total)})</span>
                      </span>
                    </div>
                  ));
                })()}
              </>
            ) : null}
          </div>
        </div>

        <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm lg:col-span-2">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-neutral-500">Monthly usage</div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onMonthlyViewChange("chart")}
                className={`rounded-full px-3 py-1 text-xs font-semibold border ${
                  monthlyView === "chart"
                    ? "border-sky-300 bg-sky-50 text-sky-700"
                    : "border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50"
                }`}
              >
                Chart
              </button>
              <button
                type="button"
                onClick={() => onMonthlyViewChange("table")}
                className={`rounded-full px-3 py-1 text-xs font-semibold border ${
                  monthlyView === "table"
                    ? "border-sky-300 bg-sky-50 text-sky-700"
                    : "border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50"
                }`}
              >
                Table
              </button>
            </div>
          </div>
          {monthly.length ? (
            <div>
              {monthlyView === "chart" ? (
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={monthly.map((m) => ({
                        ...m,
                        label: formatMonthLabel(m.month),
                        consumed: Math.max(m.kwh, 0),
                        exported: Math.max(-m.kwh, 0),
                      }))}
                      margin={{ top: 10, right: 16, bottom: 8, left: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="label" />
                      <YAxis />
                      <Tooltip
                        formatter={(value, key) => {
                          const label = key === "consumed" ? "Imported" : "Exported";
                          return `${Number(value ?? 0).toFixed(1)} kWh (${label})`;
                        }}
                      />
                      <Legend />
                      <Bar dataKey="consumed" stackId="a" fill="#0EA5E9" radius={[6, 6, 0, 0]} name="Imported" />
                      <Bar dataKey="exported" stackId="a" fill="#F59E0B" radius={[6, 6, 0, 0]} name="Exported" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="overflow-auto rounded-lg border border-neutral-200">
                  <table className="min-w-[520px] w-full text-sm">
                    <thead className="bg-neutral-50 text-neutral-600">
                      <tr>
                        <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide">Month</th>
                        <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide">Imported</th>
                        <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide">Exported</th>
                        <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide">Net</th>
                      </tr>
                    </thead>
                    <tbody className="text-neutral-800">
                      {monthly.map((m) => {
                        const imported = Math.max(m.kwh, 0);
                        const exported = Math.max(-m.kwh, 0);
                        return (
                          <tr key={m.month} className="border-t border-neutral-200">
                            <td className="px-3 py-2 font-medium">{formatMonthLabel(m.month)}</td>
                            <td className="px-3 py-2 text-right">{imported.toFixed(1)} kWh</td>
                            <td className="px-3 py-2 text-right">{exported.toFixed(1)} kWh</td>
                            <td className="px-3 py-2 text-right font-semibold">{m.kwh.toFixed(1)} kWh</td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot className="bg-neutral-50 text-neutral-800">
                      {(() => {
                        const imported = sumKwh(monthly.map((m) => ({ kwh: Math.max(m.kwh, 0) })));
                        const exported = sumKwh(monthly.map((m) => ({ kwh: Math.max(-m.kwh, 0) })));
                        const net = sumKwh(monthly.map((m) => ({ kwh: m.kwh })));
                        return (
                          <tr className="border-t border-neutral-200">
                            <td className="px-3 py-2 font-semibold">Total</td>
                            <td className="px-3 py-2 text-right font-semibold">{imported.toFixed(1)} kWh</td>
                            <td className="px-3 py-2 text-right font-semibold">{exported.toFixed(1)} kWh</td>
                            <td className="px-3 py-2 text-right font-semibold">{net.toFixed(1)} kWh</td>
                          </tr>
                        );
                      })()}
                    </tfoot>
                  </table>
                </div>
              )}
              {stitchedMonth ? (
                <p className="mt-2 text-xs text-neutral-500">
                  Note: The latest month may be <span className="font-medium text-neutral-700">stitched</span> to show a
                  full month total—days after the last complete day are filled using the same day-range from{" "}
                  {stitchedMonth.borrowedFromYearMonth}.
                </p>
              ) : null}
            </div>
          ) : (
            <p className="text-xs text-neutral-500">No monthly rollup available yet.</p>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-neutral-500">
              Daily usage (all {daily.length} days)
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onDailyViewChange("chart")}
                className={`rounded-full px-3 py-1 text-xs font-semibold border ${
                  dailyView === "chart"
                    ? "border-teal-300 bg-teal-50 text-teal-700"
                    : "border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50"
                }`}
              >
                Chart
              </button>
              <button
                type="button"
                onClick={() => onDailyViewChange("table")}
                className={`rounded-full px-3 py-1 text-xs font-semibold border ${
                  dailyView === "table"
                    ? "border-teal-300 bg-teal-50 text-teal-700"
                    : "border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50"
                }`}
              >
                Table
              </button>
            </div>
          </div>
          {daily.length ? (
            dailyView === "chart" ? (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={daily.map((d) => ({
                      ...d,
                      label: dailyLabelFormat(d.date),
                      consumed: Math.max(d.kwh, 0),
                      exported: Math.max(-d.kwh, 0),
                    }))}
                    margin={{ top: 10, right: 16, bottom: 8, left: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="label" />
                    <YAxis />
                    <Tooltip
                      formatter={(value, key) => {
                        const label = key === "consumed" ? "Imported" : "Exported";
                        return `${Number(value ?? 0).toFixed(1)} kWh (${label})`;
                      }}
                    />
                    <Legend />
                    <Bar dataKey="consumed" stackId="daily" fill="#14B8A6" radius={[6, 6, 0, 0]} name="Imported" />
                    <Bar dataKey="exported" stackId="daily" fill="#F59E0B" radius={[6, 6, 0, 0]} name="Exported" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="max-h-80 overflow-auto rounded-lg border border-neutral-200 select-text">
                {dailyWeather && Object.keys(dailyWeather).length > 0 && weatherBasisLabel ? (
                  <p className="mb-2 text-xs text-neutral-500">{weatherBasisLabel}</p>
                ) : null}
                {daily.some((d) => d.source === "SIMULATED") ? (
                  <p className="mb-2 text-xs text-neutral-500">Source notation: <span className="font-medium text-neutral-700">ACTUAL</span> or <span className="font-medium text-neutral-700">SIMULATED</span>.</p>
                ) : null}
                <table className="min-w-[280px] w-full text-sm font-mono">
                  <thead className="sticky top-0 z-10 bg-neutral-50 text-neutral-600">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide">Date</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide">kWh</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide">Source</th>
                      {dailyWeather && Object.keys(dailyWeather).length > 0 ? (
                        <>
                          <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide">Avg °F</th>
                          <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide">Min °F</th>
                          <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide">Max °F</th>
                          <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide">HDD65</th>
                          <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide">CDD65</th>
                        </>
                      ) : null}
                    </tr>
                  </thead>
                  <tbody className="text-neutral-800">
                    {daily.map((d) => {
                      const wx = dailyWeather?.[d.date];
                      return (
                        <tr key={d.date} className="border-t border-neutral-100 hover:bg-neutral-50/50">
                          <td className="px-3 py-1.5">{d.date}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{d.kwh.toFixed(2)}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{d.source ?? "ACTUAL"}</td>
                          {dailyWeather && Object.keys(dailyWeather).length > 0 ? (
                            <>
                              <td className="px-3 py-1.5 text-right tabular-nums">{wx != null && Number.isFinite(wx.tAvgF) ? wx.tAvgF.toFixed(1) : "—"}</td>
                              <td className="px-3 py-1.5 text-right tabular-nums">{wx != null && Number.isFinite(wx.tMinF) ? wx.tMinF.toFixed(1) : "—"}</td>
                              <td className="px-3 py-1.5 text-right tabular-nums">{wx != null && Number.isFinite(wx.tMaxF) ? wx.tMaxF.toFixed(1) : "—"}</td>
                              <td className="px-3 py-1.5 text-right tabular-nums">{wx != null && Number.isFinite(wx.hdd65) ? wx.hdd65.toFixed(1) : "—"}</td>
                              <td className="px-3 py-1.5 text-right tabular-nums">{wx != null && Number.isFinite(wx.cdd65) ? wx.cdd65.toFixed(1) : "—"}</td>
                            </>
                          ) : null}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )
          ) : (
            <p className="text-xs text-neutral-500">No daily data available yet.</p>
          )}
        </div>

        <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-xs font-semibold uppercase tracking-[0.2em] text-neutral-500">15-minute load curve</div>
            <div className="text-[11px] text-neutral-400">Average kW by time of day</div>
          </div>
          {fifteenCurve.length ? (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={fifteenCurve.map((p) => ({ ...p, label: formatTimeLabel(p.hhmm) }))}
                  margin={{ top: 10, right: 16, bottom: 8, left: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} minTickGap={20} />
                  <YAxis />
                  <Tooltip formatter={(value) => `${Number(value ?? 0).toFixed(2)} kW`} />
                  <Legend />
                  <Line type="monotone" dataKey="avgKw" stroke="#6366F1" dot={false} strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-xs text-neutral-500">
              {emptyFifteenCurveMessage ?? "Not enough interval data yet to build a load curve."}
            </p>
          )}
        </div>
      </div>
    </>
  );
}

