"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { getTemplateByKey } from "@/components/upgrades/catalog";
import { UsageChartsPanel } from "@/components/usage/UsageChartsPanel";
import { formatDateLong, formatDateShort } from "@/components/usage/usageFormatting";

type UsageSeriesPoint = {
  timestamp: string;
  kwh: number;
};

type UsageDatasetSummary = {
  source: "SMT" | "GREEN_BUTTON" | "SIMULATED";
  intervalsCount: number;
  totalKwh: number;
  start: string | null;
  end: string | null;
  latest: string | null;
};

type UsageTotals = {
  importKwh: number;
  exportKwh: number;
  netKwh: number;
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
  timeOfDayBuckets?: { key: string; label: string; kwh: number }[];
  stitchedMonth?: {
    mode: "PRIOR_YEAR_TAIL";
    yearMonth: string;
    haveDaysThrough: number;
    missingDaysFrom: number;
    missingDaysTo: number;
    borrowedFromYearMonth: string;
    completenessRule: string;
  } | null;
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
  totals?: UsageTotals;
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

type SessionCacheValue = { savedAt: number; payload: UsageApiResponse };
const SESSION_KEY_PREFIX = "usage_dashboard_v1";
const SESSION_TTL_MS = 60 * 60 * 1000; // UX cache only (real data lives in DB)

function sessionKey(mode: "REAL" | "SIMULATED") {
  return `${SESSION_KEY_PREFIX}:${mode}`;
}

function readSessionCache(mode: "REAL" | "SIMULATED"): SessionCacheValue | null {
  try {
    const raw = sessionStorage.getItem(sessionKey(mode));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SessionCacheValue;
    if (!parsed?.savedAt || !parsed?.payload) return null;
    if (Date.now() - parsed.savedAt > SESSION_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeSessionCache(mode: "REAL" | "SIMULATED", payload: UsageApiResponse) {
  try {
    const v: SessionCacheValue = { savedAt: Date.now(), payload };
    sessionStorage.setItem(sessionKey(mode), JSON.stringify(v));
  } catch {
    // ignore
  }
}

function deriveTotalsFromRows(rows: { kwh: number }[]): UsageTotals {
  let importKwh = 0;
  let exportKwh = 0;
  for (const row of rows) {
    if (row.kwh >= 0) importKwh += row.kwh;
    else exportKwh += Math.abs(row.kwh);
  }
  return {
    importKwh,
    exportKwh,
    netKwh: importKwh - exportKwh,
  };
}

function toDateKeyFromTimestamp(ts: string): string {
  return ts.slice(0, 10);
}

export function formatScenarioVariable(v: ScenarioVariable): string {
  const kind = String(v.kind ?? "").toUpperCase();
  const month = v.effectiveMonth ?? "";
  const p = (v.payloadJson ?? {}) as Record<string, unknown>;
  if (kind === "TRAVEL_RANGE") {
    const start = (p.startDate as string) ?? "";
    const end = (p.endDate as string) ?? "";
    return `Travel/Vacant: ${start} – ${end}`;
  }
  if (kind === "MONTHLY_ADJUSTMENT") {
    const mult = p.monthlyMultiplier ?? (p as any).multiplier;
    const add = p.monthlyAdderKwh ?? (p as any).adderKwh;
    const parts: string[] = [month];
    if (typeof mult === "number" && Number.isFinite(mult)) parts.push(`${(mult * 100).toFixed(0)}%`);
    if (typeof add === "number" && Number.isFinite(add)) parts.push(`${add >= 0 ? "+" : ""}${add} kWh`);
    return `Monthly adjustment: ${parts.join(", ")}`;
  }
  if (kind === "UPGRADE_ACTION") {
    const upgradeType = String(p.upgradeType ?? "").trim();
    const changeType = String(p.changeType ?? "").trim();
    const effectiveDate = typeof p.effectiveDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(p.effectiveDate) ? p.effectiveDate : "";
    const effectiveEndDate = typeof p.effectiveEndDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(p.effectiveEndDate) ? p.effectiveEndDate : "";
    const quantity = typeof p.quantity === "number" && Number.isFinite(p.quantity) ? p.quantity : null;
    const units = String(p.units ?? "").trim();
    const notes = String(p.notes ?? "").trim();
    const label = upgradeType ? (getTemplateByKey(upgradeType)?.label ?? upgradeType) : "Upgrade";
    const change = changeType ? `${changeType} · ` : "";
    const dateRange = effectiveDate
      ? effectiveEndDate
        ? ` (${effectiveDate} – ${effectiveEndDate})`
        : ` (effective ${effectiveDate})`
      : month
        ? ` (${month})`
        : "";
    const qty = quantity != null && quantity !== 0 ? `, ${quantity}${units ? ` ${units}` : ""}` : "";
    const note = notes ? ` — ${notes}` : "";
    return `${change}${label}${dateRange}${qty}${note}`;
  }
  return `${kind}${month ? ` ${month}` : ""}`;
}

export type ScenarioVariable = {
  kind: string;
  effectiveMonth?: string;
  payloadJson?: Record<string, unknown>;
};

type Props = {
  initialMode?: "REAL" | "SIMULATED";
  forcedMode?: "REAL" | "SIMULATED";
  allowModeToggle?: boolean;
  refreshToken?: string | number;
  simulatedHousesOverride?: HouseUsage[] | null;
  /** When set (simulator context), show this as the dashboard label and optionally list variables. */
  dashboardVariant?: "USAGE" | "PAST_SIMULATED_USAGE" | "FUTURE_SIMULATED_USAGE";
  pastVariables?: ScenarioVariable[];
  futureVariables?: ScenarioVariable[];
};

const DASHBOARD_LABELS: Record<NonNullable<Props["dashboardVariant"]>, string> = {
  USAGE: "Usage",
  PAST_SIMULATED_USAGE: "Past simulated usage",
  FUTURE_SIMULATED_USAGE: "Future simulated usage",
};

export const UsageDashboard: React.FC<Props> = ({
  initialMode = "REAL",
  forcedMode,
  allowModeToggle = true,
  refreshToken,
  simulatedHousesOverride = null,
  dashboardVariant,
  pastVariables = [],
  futureVariables = [],
}) => {
  const [datasetMode, setDatasetMode] = useState<"REAL" | "SIMULATED">(forcedMode ?? initialMode);
  const [houses, setHouses] = useState<HouseUsage[]>([]);
  const [selectedHouseId, setSelectedHouseId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [monthlyView, setMonthlyView] = useState<"chart" | "table">("chart");
  const lastSmtIntervalsRef = useRef<number>(0);
  const smtPollTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (forcedMode) setDatasetMode(forcedMode);
  }, [forcedMode]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        setError(null);

        // When the simulator supplies a scenario-specific simulated dataset,
        // bypass the baseline simulated endpoint and use the override as-is.
        if (datasetMode === "SIMULATED" && simulatedHousesOverride && simulatedHousesOverride.length) {
          const hs = simulatedHousesOverride;
          setHouses(hs);
          const firstWithData = hs.find((h) => h.dataset);
          setSelectedHouseId(firstWithData?.houseId ?? hs[0]?.houseId ?? null);
          setLoading(false);
          return;
        }

        // Show cached payload instantly (back/forward nav), then refresh in the background.
        // Skip cache when on simulator baseline (simulatedHousesOverride === null) so baseline always shows canonical dates + SIMULATED source.
        const skipCache = datasetMode === "SIMULATED" && simulatedHousesOverride === null;
        const cached = skipCache ? null : readSessionCache(datasetMode);
        const cachedPayload = cached?.payload ?? null;
        if (cachedPayload && (cachedPayload as any).ok !== false && (cachedPayload as any).houses) {
          const c = cachedPayload as { ok: true; houses: HouseUsage[] };
          setHouses(c.houses || []);
          const firstWithData = c.houses.find((h) => h.dataset);
          setSelectedHouseId(firstWithData?.houseId ?? c.houses[0]?.houseId ?? null);
          setLoading(false);
        } else {
          setLoading(true);
        }

        // Always refresh in the background so SMT pulls/backfills show up immediately
        // (even if the user recently visited this page and has sessionStorage cached).
        // Use no-store + cache-bust to avoid browser cache keeping an old payload around.
        const url =
          datasetMode === "SIMULATED"
            ? `/api/user/usage/simulated?ts=${Date.now()}`
            : `/api/user/usage?ts=${Date.now()}`;
        const res = await fetch(url, { cache: "no-store" });
        const json = (await res.json()) as UsageApiResponse;
        if (!res.ok || json.ok === false) {
          throw new Error((json as any).error || `Failed with status ${res.status}`);
        }
        if (cancelled) return;
        writeSessionCache(datasetMode, json);
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
  }, [datasetMode, refreshToken, simulatedHousesOverride]);

  // If usage isn't available yet (common immediately after SMT backfill request),
  // keep checking until it lands by polling the SMT orchestrator and reloading usage.
  useEffect(() => {
    if (datasetMode === "SIMULATED") {
      if (smtPollTimerRef.current) {
        window.clearTimeout(smtPollTimerRef.current);
        smtPollTimerRef.current = null;
      }
      return;
    }

    // Clear any prior polling
    if (smtPollTimerRef.current) {
      window.clearTimeout(smtPollTimerRef.current);
      smtPollTimerRef.current = null;
    }

    if (loading) return;
    if (!selectedHouseId) return;
    const active = houses.find((h) => h.houseId === selectedHouseId) || null;
    if (!active) return;

    // Only poll when there's an ESIID but no dataset yet.
    const shouldPoll = Boolean(active.esiid && !active.dataset);
    if (!shouldPoll) return;

    let cancelled = false;
    let attempts = 0;

    async function reloadUsageOnce() {
      const res = await fetch(`/api/user/usage?ts=${Date.now()}`, { cache: "no-store" });
      const json = (await res.json()) as UsageApiResponse;
      if (!res.ok || (json as any).ok === false) return;
      if (cancelled) return;
      writeSessionCache("REAL", json);
      setHouses((json as any).houses || []);
      const nextHouses = (json as any).houses || [];
      const firstWithData = nextHouses.find((h: any) => h.dataset);
      setSelectedHouseId(firstWithData?.houseId ?? nextHouses[0]?.houseId ?? null);
    }

    async function tick() {
      if (cancelled) return;
      attempts += 1;
      if (attempts > 60) return; // ~20-30 minutes depending on nextPollMs

      try {
        const r = await fetch("/api/user/smt/orchestrate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ homeId: selectedHouseId }),
          cache: "no-store",
        });
        const j: any = await r.json().catch(() => null);
        if (!cancelled && r.ok && j?.ok) {
          const intervals = Number(j?.usage?.intervals ?? 0);
          const ready = Boolean(j?.usage?.ready);
          const nextPollMs =
            typeof j?.nextPollMs === "number" && j.nextPollMs > 0 ? j.nextPollMs : 30_000;

          // If intervals increased (or we reached ready), reload the usage dashboard data.
          if (ready || intervals > lastSmtIntervalsRef.current) {
            lastSmtIntervalsRef.current = intervals;
            await reloadUsageOnce();
          }

          if (!ready) {
            smtPollTimerRef.current = window.setTimeout(() => void tick(), nextPollMs);
            return;
          }
          return;
        }
      } catch {
        // ignore and back off
      }

      smtPollTimerRef.current = window.setTimeout(() => void tick(), 60_000);
    }

    void tick();
    return () => {
      cancelled = true;
      if (smtPollTimerRef.current) {
        window.clearTimeout(smtPollTimerRef.current);
        smtPollTimerRef.current = null;
      }
    };
  }, [datasetMode, loading, selectedHouseId, houses]);

  const activeHouse = useMemo(() => {
    if (!selectedHouseId) return null;
    return houses.find((h) => h.houseId === selectedHouseId) || null;
  }, [houses, selectedHouseId]);

  const coverage = useMemo(() => {
    const ds = activeHouse?.dataset;
    const meta = (ds as any)?.meta ?? {};
    const datasetKind = meta.datasetKind ?? null;
    const startIso = ds?.summary?.start ?? null;
    const endIso = ds?.summary?.end ?? ds?.summary?.latest ?? null;
    const start = startIso ? String(startIso).slice(0, 10) : null;
    const end = endIso ? String(endIso).slice(0, 10) : null;
    const provenance = meta.monthProvenanceByMonth as Record<string, string> | undefined;
    const actualSource = meta.actualSource as string | undefined;
    const hasSimulatedFill =
      datasetKind === "SIMULATED" &&
      actualSource &&
      provenance &&
      Object.values(provenance).some((v) => v === "SIMULATED");
    const source =
      hasSimulatedFill && actualSource
        ? `${actualSource} with simulated fill for Travel/Vacant`
        : datasetKind === "SIMULATED"
          ? "SIMULATED"
          : ds?.summary?.source ?? null;
    return {
      source,
      start,
      end,
      intervalsCount: ds?.summary?.intervalsCount ?? null,
      hasSimulatedFill,
    };
  }, [activeHouse]);

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

    const totalsFromApi = dataset?.totals;
    const totals = totalsFromApi
      ?? (fallbackDaily.length
        ? deriveTotalsFromRows(fallbackDaily)
        : intervals.length
          ? deriveTotalsFromRows(intervals.map((i) => ({ kwh: i.kwh })))
          : { importKwh: 0, exportKwh: 0, netKwh: 0 });

    const totalKwh = totals.netKwh;

    const avgDailyKwh = fallbackDaily.length ? totalKwh / fallbackDaily.length : 0;
    const weekdayKwh = dataset?.insights?.weekdayVsWeekend.weekday ?? 0;
    const weekendKwh = dataset?.insights?.weekdayVsWeekend.weekend ?? 0;

    const peakDay = dataset?.insights?.peakDay ?? null;
    const peakHour = dataset?.insights?.peakHour ?? null;
    const baseload = dataset?.insights?.baseload ?? null;

    const timeOfDayBuckets = (dataset?.insights?.timeOfDayBuckets ?? []).map((b) => ({
      key: b.key,
      label: b.label,
      kwh: b.kwh,
    }));

    const recentDaily = fallbackDaily
      .slice()
      .sort((a, b) => (a.date < b.date ? -1 : 1));

    const monthlySorted = monthly.slice().sort((a, b) => (a.month < b.month ? -1 : 1));

    return {
      monthly: monthlySorted,
      stitchedMonth: dataset?.insights?.stitchedMonth ?? null,
      daily: recentDaily,
      fifteenCurve,
      totalKwh,
      totals,
      avgDailyKwh,
      weekdayKwh,
      weekendKwh,
      timeOfDayBuckets,
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
        <p className="text-sm text-neutral-600">
          {datasetMode === "SIMULATED"
            ? "No homes found yet. Add a service address, then enter manual usage to generate a simulated curve."
            : "No usage data yet. Connect SMT or upload a Green Button file to view analytics."}
        </p>
      </div>
    );
  }

  const hasData = Boolean(activeHouse?.dataset);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-neutral-500">
            {dashboardVariant ? DASHBOARD_LABELS[dashboardVariant] : "Usage dashboard"}
          </p>
          <h2 className="text-xl font-semibold text-neutral-900">Household energy insights</h2>
          <p className="text-sm text-neutral-600">
            {datasetMode === "SIMULATED"
              ? coverage?.hasSimulatedFill
                ? "Based on actual usage data with simulated fill for Travel/Vacant dates."
                : "Based on a simulated 15-minute curve generated from your manual entry or SMT baseline."
              : "Based on normalized 15-minute interval data from your connected sources."}
          </p>
          {coverage?.start && coverage?.end ? (
            <p className="mt-1 text-xs text-neutral-500">
              Data coverage:{" "}
              <span className="font-medium text-neutral-700">
                {formatDateLong(coverage.start)} – {formatDateLong(coverage.end)}
              </span>
              {coverage.source ? <span> · Source: {coverage.source}</span> : null}
              {typeof coverage.intervalsCount === "number" ? <span> · {coverage.intervalsCount.toLocaleString()} intervals</span> : null}
            </p>
          ) : null}
          {dashboardVariant && (dashboardVariant === "PAST_SIMULATED_USAGE" || dashboardVariant === "FUTURE_SIMULATED_USAGE") ? (
            <div className="mt-3 rounded-lg border border-neutral-200 bg-neutral-50/80 px-3 py-2 min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500">Scenario variables</p>
              <div className="mt-1.5 text-xs text-neutral-700">
                {dashboardVariant === "PAST_SIMULATED_USAGE" && (
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    {pastVariables.length > 0
                      ? pastVariables.map((v, i) => (
                          <span key={`past-${i}`} className="inline-flex rounded bg-white/80 px-2 py-0.5 border border-neutral-200">
                            {formatScenarioVariable(v)}
                          </span>
                        ))
                      : <span className="text-neutral-500">None</span>}
                  </div>
                )}
                {dashboardVariant === "FUTURE_SIMULATED_USAGE" && (
                  <div className="flex flex-col gap-1.5">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-medium text-neutral-600 shrink-0">Past</span>
                      {pastVariables.length > 0 ? (
                        pastVariables.map((v, i) => (
                          <span key={`past-${i}`} className="inline-flex rounded bg-white/80 px-2 py-0.5 border border-neutral-200">
                            {formatScenarioVariable(v)}
                          </span>
                        ))
                      ) : (
                        <span className="text-neutral-500">None</span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-medium text-neutral-600 shrink-0">Future</span>
                      {futureVariables.length > 0 ? (
                        futureVariables.map((v, i) => (
                          <span key={`future-${i}`} className="inline-flex rounded bg-white/80 px-2 py-0.5 border border-neutral-200">
                            {formatScenarioVariable(v)}
                          </span>
                        ))
                      ) : (
                        <span className="text-neutral-500">None</span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </div>
        <div className="flex flex-col gap-2 md:items-end">
          {allowModeToggle && !forcedMode ? (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setDatasetMode("REAL")}
                className={`rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-wide transition ${
                  datasetMode === "REAL"
                    ? "border-brand-blue bg-brand-blue/10 text-brand-navy"
                    : "border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-50"
                }`}
              >
                Real
              </button>
              <button
                type="button"
                onClick={() => setDatasetMode("SIMULATED")}
                className={`rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-wide transition ${
                  datasetMode === "SIMULATED"
                    ? "border-brand-blue bg-brand-blue/10 text-brand-navy"
                    : "border-neutral-300 bg-white text-neutral-600 hover:bg-neutral-50"
                }`}
              >
                Simulated
              </button>
            </div>
          ) : null}

          {houses.length > 1 ? (
            <label className="text-sm text-neutral-700">
              <span className="mr-2 text-xs uppercase tracking-wide text-neutral-500">Home</span>
              <select
                className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-800"
                value={selectedHouseId ?? ""}
                onChange={(e) => setSelectedHouseId(e.target.value)}
              >
                {houses.map((h) => (
                  <option key={h.houseId} value={h.houseId}>
                    {h.label || h.address.line1 || "Home"}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
      </div>

      {!hasData ? (
        <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
          <p className="text-sm text-neutral-600">
            {datasetMode === "SIMULATED" ? (
              <>
                No simulated dataset yet for this home.{" "}
                <a className="font-semibold text-brand-blue hover:underline" href="/dashboard/usage/simulated#manual-totals">
                  Open the Usage Simulator
                </a>{" "}
                to generate a simulated curve.
              </>
            ) : (
              "No usage data for this home yet. Once SMT or Green Button data is ingested, charts will appear here."
            )}
          </p>
        </div>
      ) : (
        <>
          {/* Summary cards */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-neutral-500">Net usage</div>
              <div className="mt-2 text-2xl font-semibold text-neutral-900">
                {derived.totalKwh.toFixed(0)} <span className="text-base font-normal text-neutral-500">kWh</span>
              </div>
              <p className="mt-1 text-xs text-neutral-500">Imports minus exports.</p>
            </div>

            <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-neutral-500">Exported to grid</div>
              <div className="mt-2 text-2xl font-semibold text-amber-700">
                {derived.totals.exportKwh.toFixed(0)} <span className="text-base font-normal text-neutral-500">kWh</span>
              </div>
              <p className="mt-1 text-xs text-neutral-500">Solar backfeed / buyback volume.</p>
            </div>

            <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
              <div className="text-xs font-semibold uppercase tracking-[0.2em] text-neutral-500">Imported from grid</div>
              <div className="mt-2 text-2xl font-semibold text-emerald-700">
                {derived.totals.importKwh.toFixed(0)} <span className="text-base font-normal text-neutral-500">kWh</span>
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
                {derived.baseload != null ? derived.baseload.toFixed(2) : "--"} <span className="text-base font-normal text-neutral-500">kW</span>
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
          <UsageChartsPanel
            monthly={derived.monthly}
            stitchedMonth={derived.stitchedMonth}
            weekdayKwh={derived.weekdayKwh}
            weekendKwh={derived.weekendKwh}
            timeOfDayBuckets={derived.timeOfDayBuckets}
            monthlyView={monthlyView}
            onMonthlyViewChange={setMonthlyView}
            daily={derived.daily}
            fifteenCurve={derived.fifteenCurve}
            coverageStart={coverage?.start ?? null}
            coverageEnd={coverage?.end ?? null}
          />
        </>
      )}
    </div>
  );
};

export default UsageDashboard;