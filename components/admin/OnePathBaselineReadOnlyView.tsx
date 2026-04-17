"use client";

import type { UserUsageHouseContract } from "@/lib/usage/userUsageHouseContract";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { buildOnePathBaselineReadOnlyView } from "@/modules/onePathSim/baselineReadOnlyView";
import type { OnePathBaselineParityAudit } from "@/modules/onePathSim/baselineParityAudit";

function formatMonthLabel(month: string): string {
  const [year, rawMonth] = month.split("-");
  const monthIndex = Number(rawMonth) - 1;
  const date = new Date(Date.UTC(Number(year) || 0, monthIndex >= 0 ? monthIndex : 0, 1));
  return date.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

function formatDateLabel(value: string): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime())) return value;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function formatTimeLabel(value: string): string {
  const [hour, minute] = value.split(":");
  const date = new Date(Date.UTC(2020, 0, 1, Number(hour) || 0, Number(minute) || 0));
  return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" });
}

function scoreTone(score: number): string {
  if (score >= 75) return "text-emerald-700";
  if (score >= 50) return "text-amber-700";
  return "text-rose-700";
}

function MetricCard(props: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">{props.label}</div>
      <div className="mt-2 text-2xl font-semibold text-slate-900">{props.value}</div>
      {props.note ? <p className="mt-1 text-xs text-slate-500">{props.note}</p> : null}
    </div>
  );
}

function WeatherScoreCard(props: { score: UserUsageHouseContract["weatherSensitivityScore"] | null }) {
  if (!props.score) return null;
  return (
    <section className="rounded-2xl border border-brand-blue/15 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-navy/60">
            {props.score.scoringMode === "BILLING_PERIOD_BASED" ? "Billing-period based" : "Interval based"}
          </div>
          <h3 className="mt-1 text-lg font-semibold text-brand-navy">Weather Efficiency Score</h3>
        </div>
        <div className={`text-3xl font-bold ${scoreTone(props.score.weatherEfficiencyScore0to100)}`}>
          {props.score.weatherEfficiencyScore0to100}
        </div>
      </div>
      <p className="mt-3 text-sm text-brand-navy/80">{props.score.explanationSummary}</p>
    </section>
  );
}

export function OnePathBaselineReadOnlyView(props: {
  houseContract?: UserUsageHouseContract | null;
  parityAudit?: OnePathBaselineParityAudit | null;
}) {
  const view = buildOnePathBaselineReadOnlyView({
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
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="Parity status" value={view.parityAudit?.parityStatus ?? "missing"} />
          <MetricCard label="Interval count parity" value={String(view.parityAudit?.intervalCountParity ?? "unknown")} />
          <MetricCard label="Total kWh parity" value={String(view.parityAudit?.totalKwhParity ?? "unknown")} />
          <MetricCard label="Monthly / daily parity" value={`${String(view.parityAudit?.monthlyParity ?? "unknown")} / ${String(view.parityAudit?.dailyParity ?? "unknown")}`} />
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="text-sm font-semibold text-brand-navy">Household energy insights</div>
        <p className="mt-2 text-sm text-slate-600">
          Baseline charts and cards below use the same read-only baseline contract the user usage run/page renders for the selected house.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Source / coverage"
          value={`${view.summary.source ?? "unknown"} · ${view.summary.coverageStart ?? "n/a"} – ${view.summary.coverageEnd ?? "n/a"}`}
          note={view.summary.intervalsCount != null ? `${view.summary.intervalsCount.toLocaleString()} intervals` : undefined}
        />
        <MetricCard label="Net usage" value={`${view.summary.totals.netKwh.toFixed(1)} kWh`} note="Imported minus exported." />
        <MetricCard label="Imported / exported" value={`${view.summary.totals.importKwh.toFixed(1)} / ${view.summary.totals.exportKwh.toFixed(1)} kWh`} />
        <MetricCard label="Baseload" value={view.summary.baseload != null ? `${view.summary.baseload.toFixed(2)} kWh` : "--"} />
        <MetricCard
          label="Peak pattern"
          value={
            view.summary.peakDay
              ? `${formatDateLabel(view.summary.peakDay.date)} · ${view.summary.peakDay.kwh.toFixed(1)} kWh`
              : "not available"
          }
          note={view.summary.peakHour ? `${view.summary.peakHour.hour}:00 · ${view.summary.peakHour.kw.toFixed(1)} kW` : undefined}
        />
        <MetricCard
          label="Weekday / weekend"
          value={`${view.summary.weekdayKwh.toFixed(1)} / ${view.summary.weekendKwh.toFixed(1)} kWh`}
        />
        <MetricCard
          label="Time of day"
          value={
            view.summary.timeOfDayBuckets.length
              ? view.summary.timeOfDayBuckets.map((bucket) => `${bucket.label}: ${bucket.kwh.toFixed(1)}`).join(" · ")
              : "not available"
          }
        />
      </div>

      <WeatherScoreCard score={view.weatherScore} />

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Monthly usage</div>
          <div className="mt-4 h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={view.monthlyRows.map((row) => ({ ...row, label: formatMonthLabel(row.month) }))}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" />
                <YAxis />
                <Tooltip formatter={(value) => `${Number(value ?? 0).toFixed(1)} kWh`} />
                <Bar dataKey="kwh" fill="#0EA5E9" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Monthly usage</div>
          <div className="mt-4 max-h-72 overflow-auto rounded-lg border border-slate-200">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide">Month</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide">kWh</th>
                </tr>
              </thead>
              <tbody>
                {view.monthlyRows.map((row) => (
                  <tr key={row.month} className="border-t border-slate-200">
                    <td className="px-3 py-2">{formatMonthLabel(row.month)}</td>
                    <td className="px-3 py-2 text-right">{row.kwh.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Daily usage</div>
          <div className="mt-4 h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={view.dailyRows.map((row) => ({ ...row, label: formatDateLabel(row.date) }))}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" hide />
                <YAxis />
                <Tooltip labelFormatter={(value) => String(value)} formatter={(value) => `${Number(value ?? 0).toFixed(2)} kWh`} />
                <Bar dataKey="kwh" fill="#14B8A6" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Daily usage</div>
          <div className="mt-4 max-h-72 overflow-auto rounded-lg border border-slate-200">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide">Date</th>
                  <th className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide">kWh</th>
                </tr>
              </thead>
              <tbody>
                {view.dailyRows.map((row) => (
                  <tr key={row.date} className="border-t border-slate-200">
                    <td className="px-3 py-2">{row.date}</td>
                    <td className="px-3 py-2 text-right">{row.kwh.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">15-minute load curve</div>
        <div className="mt-4 h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={view.fifteenMinuteAverages.map((row) => ({ ...row, label: formatTimeLabel(row.hhmm) }))}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" minTickGap={20} tick={{ fontSize: 10 }} />
              <YAxis />
              <Tooltip formatter={(value) => `${Number(value ?? 0).toFixed(2)} kW`} />
              <Line type="monotone" dataKey="avgKw" stroke="#6366F1" dot={false} strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
