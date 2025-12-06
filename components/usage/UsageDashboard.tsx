"use client";

import React, { useEffect, useMemo, useState } from "react";
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

type UsageSeriesPoint = {
  timestamp: string;
  kwh: number;
};

type UsageDatasetSummary = {
  source: "SMT" | "GREEN_BUTTON";
  intervalsCount: number;
  totalKwh: number;
  start: string | null;
  end: string | null;
  latest: string | null;
};

type IntervalRow = {
  houseId: string | null;
  esiid: string | null;
  meter: string;
  timestamp: string;
  kwh: number;
  source: string;
  rawSourceId: string;
};

type DailyRow = { date: string; kwh: number };
type MonthlyRow = { month: string; kwh: number };
type FifteenMinuteAverage = { hhmm: string; avgKw: number };

type UsageInsights = {
  fifteenMinuteAverages: FifteenMinuteAverage[];
  monthlyTotals?: MonthlyRow[];
  dailyTotals?: DailyRow[];
  peakDay: { date: string; kwh: number } | null;
  peakHour: { hour: number; kw: number } | null;
  baseload: number | null;
  weekdayVsWeekend: { weekday: number; weekend: number };
} | null;

type UsageDataset = {
  summary: UsageDatasetSummary;
  series: {
    intervals15: UsageSeriesPoint[];
    hourly: UsageSeriesPoint[];
    daily: UsageSeriesPoint[];
    monthly: UsageSeriesPoint[];
    annual: UsageSeriesPoint[];
  };
  intervals?: IntervalRow[];
  daily?: DailyRow[];
  monthly?: MonthlyRow[];
  insights?: UsageInsights;
} | null;

type HouseUsage = {
  houseId: string;
  label: string | null;
  address: {
    line1: string;
    city: string | null;
    state: string | null;
  };
  esiid: string | null;
  dataset: UsageDataset | null;
  alternatives: {
    smt: UsageDatasetSummary | null;
    greenButton: UsageDatasetSummary | null;
  };
};

type UsageApiResponse = { ok: true; houses: HouseUsage[] } | { ok: false; error: string };

function formatMonthLabel(month: string) {
  const [y, m] = month.split("-");
  return `${m}/${y.slice(2)}`;
}

function formatDateShort(date: string) {
  const [y, m, d] = date.split("-");
  return `${m}/${d}`;
}

function formatTimeLabel(hhmm: string) {
  const [hh, mm] = hhmm.split(":").map(Number);
  const ampm = hh >= 12 ? "pm" : "am";
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${h12}:${String(mm).padStart(2, "0")}${ampm}`;
}

function sumKwh(rows: { kwh: number }[]) {
  return rows.reduce((sum, r) => sum + r.kwh, 0);
}

function toDateKeyFromTimestamp(ts: string): string {
  return ts.slice(0, 10);
}

export const UsageDashboard: React.FC = () => {
  const [houses, setHouses] = useState<HouseUsage[]>([]);
  const [selectedHouseId, setSelectedHouseId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        setLoading(true);
        setError(null);
        const res = await fetch("/api/user/usage", { cache: "no-store" });
        const json = (await res.json()) as UsageApiResponse;
        if (!res.ok || json.ok === false) {
          throw new Error((json as any).error || `Failed with status ${res.status}`);
        }
        if (cancelled) return;
        setHouses(json.houses || []);
        const firstWithData = json.houses.find((h) => h.dataset);
        setSelectedHouseId(firstWithData?.houseId ?? json.houses[0]?.houseId ?? null);
      } catch (err: any) {
        if (!cancelled) setError(err?.message || "Failed to load usage data");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const activeHouse = useMemo(() => {
    if (!selectedHouseId) return null;
    return houses.find((h) => h.houseId === selectedHouseId) || null;
  }, [houses, selectedHouseId]);

  const derived = useMemo(() => {
    const dataset = activeHouse?.dataset;
    const monthly = dataset?.monthly ?? dataset?.insights?.monthlyTotals ?? [];
    const daily = dataset?.daily ?? [];
    const fallbackDaily = daily.length
      ? daily
      : (dataset?.series?.daily ?? []).map((d) => ({ date: toDateKeyFromTimestamp(d.timestamp), kwh: d.kwh }));

    const intervals = dataset?.intervals ?? [];
    const fifteenCurve = (dataset?.insights?.fifteenMinuteAverages ?? []).slice().sort((a, b) => {
      const toMinutes = (hhmm: string) => {
        const [h, m] = hhmm.split(":").map(Number);
        return h * 60 + m;
      };
      return toMinutes(a.hhmm) - toMinutes(b.hhmm);
    });

    const totalKwh = monthly.length
      ? sumKwh(monthly)
      : fallbackDaily.length
        ? sumKwh(fallbackDaily)
        : intervals.length
          ? sumKwh(intervals.map((i) => ({ kwh: i.kwh })))
          : 0;

    const avgDailyKwh = fallbackDaily.length ? totalKwh / fallbackDaily.length : 0;
    const weekdayKwh = dataset?.insights?.weekdayVsWeekend.weekday ?? 0;
    const weekendKwh = dataset?.insights?.weekdayVsWeekend.weekend ?? 0;

    const peakDay = dataset?.insights?.peakDay ?? null;
    const peakHour = dataset?.insights?.peakHour ?? null;
    const baseload = dataset?.insights?.baseload ?? null;

    const recentDaily = fallbackDaily
      .slice()
      .sort((a, b) => (a.date < b.date ? -1 : 1))
      .slice(-30);

    const monthlySorted = monthly.slice().sort((a, b) => (a.month < b.month ? -1 : 1));

    return {
      monthly: monthlySorted,
      daily: recentDaily,
      fifteenCurve,
      totalKwh,
      avgDailyKwh,
      weekdayKwh,
      weekendKwh,
      peakDay,
      peakHour,
      baseload,
    };
  }, [activeHouse]);

  if (loading) {
    return (
      <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
        <p className="text-sm text-neutral-600">Loading usage data…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-rose-700">
        <p className="text-sm font-semibold">Unable to load usage</p>
        <p className="text-sm">{error}</p>
      </div>
    );
  }

  if (!houses.length) {
    return (
      <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
        <p className="text-sm text-neutral-600">No usage data yet. Connect SMT or upload a Green Button file to view analytics.</p>
      </div>
    );
  }

  const hasData = Boolean(activeHouse?.dataset);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-neutral-500">Usage dashboard</p>
          <h2 className="text-xl font-semibold text-neutral-900">Household energy insights</h2>
          <p className="text-sm text-neutral-600">Based on normalized 15-minute interval data from your connected sources.</p>
        </div>
        {houses.length > 1 ? (
          <label className="text-sm text-neutral-700">
            <span className="mr-2 text-xs uppercase tracking-wide text-neutral-500">Home</span>
            <select
              className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-800"
              value={selectedHouseId ?? ''}
              onChange={(e) => setSelectedHouseId(e.target.value)}
            >
              {houses.map((h) => (
                <option key={h.houseId} value={h.houseId}>
                  {h.label || h.address.line1 || 'Home'}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      {!hasData ? (
        <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
          <p className="text-sm text-neutral-600">
            No usage data for this home yet. Once SMT or Green Button data is ingested, charts will appear here.
          </p>
        </div>
      ) : (
        <>
          {/* Summary cards */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-neutral-500">Total usage</div>
              <div className="mt-2 text-2xl font-semibold text-neutral-900">
                {derived.totalKwh.toFixed(0)} <span className="text-base font-normal text-neutral-500">kWh</span>
              </div>
            </div>

            <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-neutral-500">Average daily</div>
              <div className="mt-2 text-2xl font-semibold text-neutral-900">
                {derived.avgDailyKwh.toFixed(1)} <span className="text-base font-normal text-neutral-500">kWh/day</span>
              </div>
            </div>

            <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-neutral-500">Baseload</div>
              <div className="mt-2 text-2xl font-semibold text-neutral-900">
                {derived.baseload != null ? derived.baseload.toFixed(1) : "--"} <span className="text-base font-normal text-neutral-500">kW</span>
              </div>
              <p className="mt-1 text-xs text-neutral-500">Estimated always-on power.</p>
            </div>

            <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-neutral-500">Peak pattern</div>
              <div className="mt-2 text-sm text-neutral-800">
                {derived.peakDay ? (
                  <>
                    <div>
                      <span className="font-semibold">Day:</span> {formatDateShort(derived.peakDay.date)} ({derived.peakDay.kwh.toFixed(1)} kWh)
                    </div>
                  </>
                ) : (
                  <div>–</div>
                )}
                {derived.peakHour ? (
                  <div className="mt-1">
                    <span className="font-semibold">Hour:</span> {derived.peakHour.hour}:00 ({derived.peakHour.kw.toFixed(1)} kW)
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          {/* Weekday vs weekend + Monthly */}
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm lg:col-span-1">
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-neutral-500">Weekday vs Weekend</div>
              <div className="mt-3 flex flex-col gap-2 text-sm text-neutral-800">
                <div className="flex items-center justify-between">
                  <span>Weekdays</span>
                  <span className="font-semibold">{derived.weekdayKwh.toFixed(1)} kWh</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Weekends</span>
                  <span className="font-semibold">{derived.weekendKwh.toFixed(1)} kWh</span>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm lg:col-span-2">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-xs font-semibold uppercase tracking-[0.2em] text-neutral-500">Monthly usage</div>
              </div>
              {derived.monthly.length ? (
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={derived.monthly.map((m) => ({ ...m, label: formatMonthLabel(m.month) }))}
                      margin={{ top: 10, right: 16, bottom: 8, left: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="label" />
                      <YAxis />
                      <Tooltip formatter={(value: number) => `${value.toFixed(1)} kWh`} />
                      <Bar dataKey="kwh" fill="#0EA5E9" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p className="text-xs text-neutral-500">No monthly rollup available yet.</p>
              )}
            </div>
          </div>

          {/* Daily + 15-min */}
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
              <div className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-neutral-500">
                Recent daily usage (last {derived.daily.length} days)
              </div>
              {derived.daily.length ? (
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={derived.daily.map((d) => ({ ...d, label: formatDateShort(d.date) }))}
                      margin={{ top: 10, right: 16, bottom: 8, left: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="label" />
                      <YAxis />
                      <Tooltip formatter={(value: number) => `${value.toFixed(1)} kWh`} />
                      <Bar dataKey="kwh" fill="#14B8A6" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p className="text-xs text-neutral-500">No daily data available yet.</p>
              )}
            </div>

            <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
              <div className="mb-2 flex items-center justify-between">
                <div className="text-xs font-semibold uppercase tracking-[0.2em] text-neutral-500">15-minute load curve</div>
                <div className="text-[11px] text-neutral-400">Average kW by time of day</div>
              </div>
              {derived.fifteenCurve.length ? (
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      data={derived.fifteenCurve.map((p) => ({ ...p, label: formatTimeLabel(p.hhmm) }))}
                      margin={{ top: 10, right: 16, bottom: 8, left: 0 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 10 }} minTickGap={20} />
                      <YAxis />
                      <Tooltip formatter={(value: number) => `${(value as number).toFixed(2)} kW`} />
                      <Legend />
                      <Line type="monotone" dataKey="avgKw" stroke="#6366F1" dot={false} strokeWidth={2} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p className="text-xs text-neutral-500">Not enough interval data yet to build a load curve.</p>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default UsageDashboard;