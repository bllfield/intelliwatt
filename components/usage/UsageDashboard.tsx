"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { getTemplateByKey } from "@/components/upgrades/catalog";
import { UsageChartsPanel } from "@/components/usage/UsageChartsPanel";
import { formatDateLong, formatDateShort } from "@/components/usage/usageFormatting";
import {
  type ManualMonthlyStageOneRow,
  resolveManualMonthlyStageOnePresentation,
  resolveManualMonthlyStageOneRenderMode,
  shouldUseManualMonthlyStageOnePayload,
  type ManualMonthlyStageOneSurface,
} from "@/modules/manualUsage/statementRanges";
import { dailyRowFieldsFromSourceRow } from "@/modules/usageSimulator/dailyRowFieldsFromDisplay";
import { toPublicHouseLabel } from "@/modules/usageSimulator/houseLabel";
import { resolveCanonicalUsage365CoverageWindow } from "@/modules/usageSimulator/metadataWindow";
import type { ManualUsagePayload } from "@/modules/simulatedUsage/types";

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

type DailyRow = {
  date: string;
  kwh: number;
  source?: "ACTUAL" | "SIMULATED";
  sourceDetail?:
    | "SIMULATED_TRAVEL_VACANT"
    | "SIMULATED_TEST_DAY"
    | "SIMULATED_MONTHLY_CONSTRAINED_NON_TRAVEL"
    | "SIMULATED_INCOMPLETE_METER"
    | "SIMULATED_LEADING_MISSING"
    | "SIMULATED_OTHER"
    | "ACTUAL_VALIDATION_TEST_DAY"
    | "ACTUAL";
};

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
  baseloadDaily?: number | null;
  baseloadMonthly?: number | null;
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

/** Truthful weather basis label from Past meta. Do not show "real weather" unless weatherSourceSummary === "actual_only". */
function getWeatherBasisLabel(meta: Record<string, unknown>): string | null {
  const s = meta?.weatherSourceSummary as string | undefined;
  const reason = meta?.weatherFallbackReason as string | undefined;
  const reasonSuffix =
    reason === "missing_lat_lng"
      ? " (no coordinates)"
      : reason === "partial_coverage"
        ? " (partial coverage)"
        : reason === "api_failure_or_no_data"
          ? " (API unavailable)"
          : "";
  if (s === "stub_only") return "Weather basis: stub/test weather data" + reasonSuffix;
  if (s === "actual_only") return "Weather basis: actual cached weather data";
  if (s === "mixed_actual_and_stub") return "Weather basis: mixed actual + stub weather data" + reasonSuffix;
  if (s === "unknown" || (s && s !== "none")) return "Weather basis: " + (reason ? reason.replace(/_/g, " ") : "unknown");
  return null;
}

export type HouseUsage = {
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
  datasetError?: {
    code?: string;
    explanation?: string;
  } | null;
};

type UsageApiResponse =
  | { ok: true; houses: HouseUsage[] }
  | { ok: false; error: string; code?: string; explanation?: string; missingData?: string[] };

type SessionCacheValue = { savedAt: number; payload: UsageApiResponse };
const SESSION_KEY_PREFIX = "usage_dashboard_v2";
const SESSION_TTL_MS = 60 * 60 * 1000; // UX cache only (real data lives in DB)
function publicHomeLabel(h: Pick<HouseUsage, "label" | "address">): string {
  return toPublicHouseLabel({
    label: h.label,
    addressLine1: h.address.line1,
  });
}

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

function formatUsageApiError(payload: any, status: number): string {
  const base = String(payload?.error ?? `Failed with status ${status}`);
  const explanation = String(payload?.explanation ?? "").trim();
  const missing = Array.isArray(payload?.missingData)
    ? payload.missingData.map((v: unknown) => String(v)).filter(Boolean)
    : [];
  if (!explanation && missing.length === 0) return base;
  const lines: string[] = [base];
  if (explanation) lines.push(`Why: ${explanation}`);
  if (missing.length > 0) lines.push(`Missing data: ${missing.join(", ")}`);
  return lines.join("\n");
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

function low10AverageKwh(values: number[]): number | null {
  const finite = values.filter((v) => Number.isFinite(v));
  if (!finite.length) return null;
  const positive = finite.filter((v) => v > 1e-6).sort((a, b) => a - b);
  const count10 = Math.max(1, Math.floor((positive.length || finite.length) * 0.1));
  const slice =
    positive.length >= count10
      ? positive.slice(0, count10)
      : finite.sort((a, b) => a - b).slice(0, Math.max(1, Math.floor(finite.length * 0.1)));
  if (!slice.length) return null;
  const avg = slice.reduce((a, b) => a + b, 0) / slice.length;
  return Number.isFinite(avg) ? avg : null;
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
  housesOverride?: HouseUsage[] | null;
  simulatedHousesOverride?: HouseUsage[] | null;
  /**
   * When set, this mode is used for the data fetch (and cache key) instead of datasetMode.
   * Use "REAL" when showing Usage/baseline on the simulation page so it uses the same
   * API as the main Usage dashboard — one source of truth. Scenarios (Past/Future) use SIMULATED.
   */
  fetchModeOverride?: "REAL" | "SIMULATED";
  /** When set (simulator context), show this as the dashboard label and optionally list variables. */
  dashboardVariant?: "USAGE" | "PAST_SIMULATED_USAGE" | "FUTURE_SIMULATED_USAGE";
  pastVariables?: ScenarioVariable[];
  futureVariables?: ScenarioVariable[];
  /** When false, hide the multi-home selector (main Energy Usage page uses a single primary home). Default true. */
  showHouseSelector?: boolean;
  preferredHouseId?: string | null;
  manualUsagePayload?: ManualUsagePayload | null;
  manualUsageHouseId?: string | null;
  manualMonthlyStageOneRowsOverride?: ManualMonthlyStageOneRow[] | null;
  forceManualMonthlyStageOne?: boolean;
  presentationSurface?: ManualMonthlyStageOneSurface | null;
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
  housesOverride = null,
  simulatedHousesOverride = null,
  fetchModeOverride,
  dashboardVariant,
  pastVariables = [],
  futureVariables = [],
  showHouseSelector = true,
  preferredHouseId = null,
  manualUsagePayload = null,
  manualUsageHouseId = null,
  manualMonthlyStageOneRowsOverride = null,
  forceManualMonthlyStageOne = false,
  presentationSurface = null,
}) => {
  const [datasetMode, setDatasetMode] = useState<"REAL" | "SIMULATED">(forcedMode ?? initialMode);
  const [houses, setHouses] = useState<HouseUsage[]>([]);
  const [selectedHouseId, setSelectedHouseId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [monthlyView, setMonthlyView] = useState<"chart" | "table">("chart");
  const [dailyView, setDailyView] = useState<"chart" | "table">("chart");
  const [fetchedManualUsagePayload, setFetchedManualUsagePayload] = useState<ManualUsagePayload | null>(null);
  const lastSmtIntervalsRef = useRef<number>(0);
  const smtPollTimerRef = useRef<number | null>(null);

  const pickSelectedHouseId = (nextHouses: HouseUsage[]): string | null => {
    if (!nextHouses.length) return null;
    const preferred =
      preferredHouseId && nextHouses.some((house) => house.houseId === preferredHouseId) ? preferredHouseId : null;
    if (preferred) return preferred;
    const firstWithData = nextHouses.find((house) => house.dataset);
    return firstWithData?.houseId ?? nextHouses[0]?.houseId ?? null;
  };

  useEffect(() => {
    if (forcedMode) setDatasetMode(forcedMode);
  }, [forcedMode]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        setError(null);

        // Effective mode for fetch: when simulator shows Usage tab, use REAL so we hit the same API as the main Usage page (one source).
        const effectiveFetchMode = fetchModeOverride ?? datasetMode;

        if (housesOverride && housesOverride.length) {
          setHouses(housesOverride);
          setSelectedHouseId(pickSelectedHouseId(housesOverride));
          setLoading(false);
          return;
        }

        // When the simulator supplies a scenario-specific dataset (Past/Future only), use it as-is. No scenario on Usage tab.
        if (effectiveFetchMode === "SIMULATED" && simulatedHousesOverride && simulatedHousesOverride.length) {
          const hs = simulatedHousesOverride;
          setHouses(hs);
          setSelectedHouseId(pickSelectedHouseId(hs));
          setLoading(false);
          return;
        }

        // Never use cache for REAL so Usage page and Simulated Usage tab always show same fresh data (no stale Feb etc).
        // For SIMULATED with no override, skip cache so we refetch from server.
        const skipCache =
          effectiveFetchMode === "REAL" ||
          (effectiveFetchMode === "SIMULATED" && simulatedHousesOverride === null);
        const cached = skipCache ? null : readSessionCache(effectiveFetchMode);
        const cachedPayload = cached?.payload ?? null;
        if (cachedPayload && (cachedPayload as any).ok !== false && (cachedPayload as any).houses) {
          const c = cachedPayload as { ok: true; houses: HouseUsage[] };
          setHouses(c.houses || []);
          setSelectedHouseId(pickSelectedHouseId(c.houses || []));
          setLoading(false);
        } else {
          setLoading(true);
        }

        // Single source: Usage/baseline always fetches /api/user/usage (REAL). Past/Future use /api/user/usage/simulated.
        const url =
          effectiveFetchMode === "SIMULATED"
            ? `/api/user/usage/simulated?ts=${Date.now()}`
            : `/api/user/usage?ts=${Date.now()}`;
        const res = await fetch(url, { cache: "no-store" });
        let json: UsageApiResponse;
        try {
          const text = await res.text();
          json = JSON.parse(text) as UsageApiResponse;
        } catch {
          const msg =
            res.status === 504 || (res.status === 502 && res.url)
              ? "Request timed out. Please try again."
              : "Server returned an invalid response. Please try again.";
          throw new Error(msg);
        }
        if (!res.ok || json.ok === false) {
          throw new Error(formatUsageApiError(json, res.status));
        }
        if (cancelled) return;
        // Don't write REAL to cache so no stale usage data can ever be shown when switching views.
        if (effectiveFetchMode !== "REAL") {
          writeSessionCache(effectiveFetchMode, json);
        }
        setHouses(json.houses || []);
        setSelectedHouseId(pickSelectedHouseId(json.houses || []));
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
  }, [datasetMode, fetchModeOverride, housesOverride, preferredHouseId, refreshToken, simulatedHousesOverride]);

  // If usage isn't available yet (common immediately after SMT backfill request),
  // keep checking until it lands by polling the SMT orchestrator and reloading usage.
  // Only poll when we're actually showing REAL data (main Usage or simulator Usage tab).
  const effectiveFetchMode = fetchModeOverride ?? datasetMode;
  useEffect(() => {
    if (housesOverride && housesOverride.length) {
      if (smtPollTimerRef.current) {
        window.clearTimeout(smtPollTimerRef.current);
        smtPollTimerRef.current = null;
      }
      return;
    }
    if (effectiveFetchMode === "SIMULATED") {
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
      let json: UsageApiResponse;
      try {
        const text = await res.text();
        json = JSON.parse(text) as UsageApiResponse;
      } catch {
        return; // Non-JSON (e.g. timeout page): skip update, next poll will retry
      }
      if (!res.ok || (json as any).ok === false) return;
      if (cancelled) return;
      writeSessionCache("REAL", json);
      setHouses((json as any).houses || []);
      const nextHouses = (json as any).houses || [];
      setSelectedHouseId(pickSelectedHouseId(nextHouses));
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
  }, [datasetMode, fetchModeOverride, houses, housesOverride, loading, selectedHouseId]);

  const activeHouse = useMemo(() => {
    if (!selectedHouseId) return null;
    return houses.find((h) => h.houseId === selectedHouseId) || null;
  }, [houses, selectedHouseId]);

  useEffect(() => {
    let cancelled = false;
    if (presentationSurface !== "user_usage_manual_monthly_stage_one") {
      setFetchedManualUsagePayload(null);
      return;
    }
    const targetHouseId = manualUsageHouseId ?? activeHouse?.houseId ?? null;
    if (!targetHouseId) {
      setFetchedManualUsagePayload(null);
      return;
    }
    if (manualUsagePayload && (!manualUsageHouseId || manualUsageHouseId === targetHouseId)) {
      setFetchedManualUsagePayload(null);
      return;
    }
    (async () => {
      try {
        const res = await fetch(`/api/user/manual-usage?houseId=${encodeURIComponent(targetHouseId)}`, { cache: "no-store" });
        const json = (await res.json().catch(() => null)) as { ok?: boolean; payload?: ManualUsagePayload | null } | null;
        if (cancelled) return;
        if (!res.ok || !json?.ok) {
          setFetchedManualUsagePayload(null);
          return;
        }
        setFetchedManualUsagePayload(json.payload ?? null);
      } catch {
        if (!cancelled) setFetchedManualUsagePayload(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeHouse?.houseId, manualUsageHouseId, manualUsagePayload, presentationSurface]);

  const manualMonthlyStageOne = useMemo(() => {
    if (manualMonthlyStageOneRowsOverride?.length) {
      return {
        surface: presentationSurface ?? "admin_manual_monthly_stage_one",
        rows: manualMonthlyStageOneRowsOverride,
      };
    }
    const selectedManualUsageHouseId = activeHouse?.houseId ?? selectedHouseId ?? preferredHouseId ?? null;
    const resolvedPayload =
      manualUsagePayload &&
      shouldUseManualMonthlyStageOnePayload({
        manualUsageHouseId,
        selectedUsageHouseId: selectedManualUsageHouseId,
      })
        ? manualUsagePayload
        : fetchedManualUsagePayload;
    if (!resolvedPayload) return null;
    return resolveManualMonthlyStageOnePresentation({
      surface: presentationSurface,
      payload: resolvedPayload,
    });
  }, [
    activeHouse?.houseId,
    fetchedManualUsagePayload,
    manualMonthlyStageOneRowsOverride,
    manualUsageHouseId,
    manualUsagePayload,
    preferredHouseId,
    presentationSurface,
    selectedHouseId,
  ]);
  const manualMonthlyStageOneRows = manualMonthlyStageOne?.rows ?? [];
  const manualMonthlyStageOneRenderMode = resolveManualMonthlyStageOneRenderMode({
    forceManualMonthlyStageOne,
    rows: manualMonthlyStageOneRows,
  });
  const shouldRenderManualMonthlyStageOne = manualMonthlyStageOneRenderMode === "rows";
  const shouldShowForcedManualMonthlyStageOneEmptyState = manualMonthlyStageOneRenderMode === "empty";
  const isManualMonthlyStageOnePresentation = manualMonthlyStageOneRenderMode !== "off";

  const coverage = useMemo(() => {
    const ds = activeHouse?.dataset;
    const meta = (ds as any)?.meta ?? {};
    const datasetKind = meta.datasetKind ?? null;
    const canonicalWindow = resolveCanonicalUsage365CoverageWindow();
    const start = canonicalWindow.startDate;
    const end = canonicalWindow.endDate;
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
    const weatherBasisLabel = getWeatherBasisLabel(meta);
    const sourceOfDaySimulationCore = (meta.sourceOfDaySimulationCore as string) || null;
    return {
      source,
      start,
      end,
      intervalsCount: ds?.summary?.intervalsCount ?? null,
      hasSimulatedFill,
      weatherBasisLabel,
      sourceOfDaySimulationCore,
    };
  }, [activeHouse]);

  const derived = useMemo(() => {
    const dataset = activeHouse?.dataset;
    const monthly = dataset?.monthly ?? dataset?.insights?.monthlyTotals ?? [];
    const daily = dataset?.daily ?? [];
    const fallbackDailyRaw = daily.length
      ? daily
      : (dataset?.series?.daily ?? []).map((d) =>
          dailyRowFieldsFromSourceRow({
            date: toDateKeyFromTimestamp(d.timestamp),
            kwh: d.kwh,
            source: (d as { source?: string }).source,
            sourceDetail: (d as { sourceDetail?: string }).sourceDetail,
          })
        );
    const canonicalWindow = resolveCanonicalUsage365CoverageWindow();
    const coverageStart = canonicalWindow.startDate;
    const coverageEnd = canonicalWindow.endDate;
    const dateInRange = (d: string) =>
      (!coverageStart || d >= coverageStart) && (!coverageEnd || d <= coverageEnd);
    const seen = new Set<string>();
    const fallbackDaily = fallbackDailyRaw
      .filter((row) => {
        const d = String(row?.date ?? "").slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
        if (seen.has(d)) return false;
        seen.add(d);
        return dateInRange(d);
      })
      .map(
        (row): DailyRow =>
          dailyRowFieldsFromSourceRow({
            date: String((row as { date: string }).date),
            kwh: (row as { kwh: unknown }).kwh,
            source: (row as { source?: string }).source,
            sourceDetail: (row as { sourceDetail?: string }).sourceDetail,
          })
      )
      .sort((a, b) => (a.date < b.date ? -1 : 1));

    const intervals = dataset?.intervals ?? [];
    const fifteenCurve = (dataset?.insights?.fifteenMinuteAverages ?? []).slice().sort((a, b) => {
      const toMinutes = (hhmm: string) => {
        const [h, m] = hhmm.split(":").map(Number);
        return h * 60 + m;
      };
      return toMinutes(a.hhmm) - toMinutes(b.hhmm);
    });

    const totalsFromApi = dataset?.totals;
    const totalsFromSeries =
      fallbackDaily.length
        ? deriveTotalsFromRows(fallbackDaily)
        : intervals.length
          ? deriveTotalsFromRows(intervals.map((i) => ({ kwh: i.kwh })))
          : { importKwh: 0, exportKwh: 0, netKwh: 0 };
    const totalsFromMonthly = monthly.length
      ? deriveTotalsFromRows(monthly.map((m) => ({ kwh: Number(m?.kwh) || 0 })))
      : null;
    const totals =
      totalsFromApi != null
        ? totalsFromMonthly != null && Math.abs((Number(totalsFromApi?.netKwh) || 0) - totalsFromMonthly.netKwh) > 0.05
          ? totalsFromMonthly
          : totalsFromApi
        : totalsFromMonthly ?? totalsFromSeries;

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
    const baseloadDaily =
      dataset?.insights?.baseloadDaily ??
      (() => {
        const v = low10AverageKwh(recentDaily.map((d) => Number(d.kwh) || 0));
        return v != null ? Number(v.toFixed(2)) : null;
      })();
    const baseloadMonthly =
      dataset?.insights?.baseloadMonthly ??
      (() => {
        const v = low10AverageKwh(monthlySorted.map((m) => Number(m.kwh) || 0));
        return v != null ? Number(v.toFixed(2)) : null;
      })();

    return {
      monthly: monthlySorted,
      stitchedMonth: dataset?.insights?.stitchedMonth ?? null,
      daily: recentDaily,
      dailyWeather: (dataset as any)?.dailyWeather ?? null,
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
      baseloadDaily,
      baseloadMonthly,
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
        <p className="mt-2 text-xs text-neutral-500">
          If this looks wrong, data sync may still be running or a required source is temporarily unavailable.
        </p>
      </div>
    );
  }

  const hasData = Boolean(activeHouse?.dataset) || isManualMonthlyStageOnePresentation;
  const houseDatasetExplanation = String(activeHouse?.datasetError?.explanation ?? "").trim();

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-neutral-500">
            {dashboardVariant ? DASHBOARD_LABELS[dashboardVariant] : "Usage dashboard"}
          </p>
          <h2 className="text-xl font-semibold text-neutral-900">Household energy insights</h2>
          <p className="text-sm text-neutral-600">
            {isManualMonthlyStageOnePresentation
              ? "Based on your saved monthly statement totals. Daily and interval analytics stay on the Past Sim page after the house usage is simulated."
              : datasetMode === "SIMULATED"
              ? coverage?.hasSimulatedFill
                ? "Based on actual usage data with simulated fill for Travel/Vacant dates."
                : "Based on a simulated 15-minute curve generated from your manual entry or SMT baseline."
              : "Based on normalized 15-minute interval data from your connected sources."}
          </p>
          {!isManualMonthlyStageOnePresentation && coverage?.start && coverage?.end ? (
            <p className="mt-1 text-xs text-neutral-500">
              Data coverage:{" "}
              <span className="font-medium text-neutral-700">
                {formatDateLong(coverage.start)} – {formatDateLong(coverage.end)}
              </span>
              {coverage.source ? <span> · Source: {coverage.source}</span> : null}
              {typeof coverage.intervalsCount === "number" ? <span> · {coverage.intervalsCount.toLocaleString()} intervals</span> : null}
            </p>
          ) : null}
          {!isManualMonthlyStageOnePresentation && coverage?.weatherBasisLabel ? (
            <p className="mt-0.5 text-xs text-neutral-500">{coverage.weatherBasisLabel}</p>
          ) : null}
          {!isManualMonthlyStageOnePresentation && coverage?.sourceOfDaySimulationCore && dashboardVariant === "PAST_SIMULATED_USAGE" ? (
            <p className="mt-0.5 text-xs text-neutral-500">
              Simulation core: <span className="font-medium text-neutral-600">{coverage.sourceOfDaySimulationCore}</span>
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

          {showHouseSelector && !dashboardVariant && houses.length > 1 ? (
            <label className="text-sm text-neutral-700">
              <span className="mr-2 text-xs uppercase tracking-wide text-neutral-500">Home</span>
              <select
                className="rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-800"
                value={selectedHouseId ?? ""}
                onChange={(e) => setSelectedHouseId(e.target.value)}
              >
                {houses.map((h) => (
                  <option key={h.houseId} value={h.houseId}>
                    {publicHomeLabel(h)}
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
            {effectiveFetchMode === "SIMULATED" ? (
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
          {houseDatasetExplanation ? (
            <p className="mt-2 text-sm text-amber-700">Why: {houseDatasetExplanation}</p>
          ) : null}
        </div>
      ) : (
        shouldRenderManualMonthlyStageOne ? (
          <UsageChartsPanel
            monthly={[]}
            stitchedMonth={null}
            weekdayKwh={0}
            weekendKwh={0}
            timeOfDayBuckets={[]}
            monthlyView={monthlyView}
            onMonthlyViewChange={setMonthlyView}
            dailyView={dailyView}
            onDailyViewChange={setDailyView}
            daily={[]}
            fifteenCurve={[]}
            summaryTotalKwh={manualMonthlyStageOneRows.reduce((sum, row) => sum + (Number(row.kwh) || 0), 0)}
            coverageStart={null}
            coverageEnd={null}
            manualMonthlyStageOneRows={manualMonthlyStageOneRows}
          />
        ) : shouldShowForcedManualMonthlyStageOneEmptyState ? (
          <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-neutral-700">
              No saved monthly statement totals are available for this Stage 1 view yet.
            </p>
            <p className="mt-2 text-xs text-neutral-500">
              Save monthly totals with their statement ranges to preview the bill-date chart on this surface.
            </p>
          </div>
        ) : (
          <>
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
                <div className="text-xs font-semibold uppercase tracking-[0.2em] text-neutral-500">Baseload (15-min)</div>
                <div className="mt-2 text-2xl font-semibold text-neutral-900">
                  {derived.baseload != null ? derived.baseload.toFixed(2) : "--"} <span className="text-base font-normal text-neutral-500">kWh</span>
                </div>
                <p className="mt-1 text-xs text-neutral-500">Estimated always-on interval energy.</p>
              </div>

              <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
                <div className="text-xs font-semibold uppercase tracking-[0.2em] text-neutral-500">Baseload (daily)</div>
                <div className="mt-2 text-2xl font-semibold text-neutral-900">
                  {derived.baseloadDaily != null ? derived.baseloadDaily.toFixed(2) : "--"}{" "}
                  <span className="text-base font-normal text-neutral-500">kWh/day</span>
                </div>
              </div>

              <div className="rounded-xl border border-neutral-200 bg-white p-4 shadow-sm">
                <div className="text-xs font-semibold uppercase tracking-[0.2em] text-neutral-500">Baseload (monthly)</div>
                <div className="mt-2 text-2xl font-semibold text-neutral-900">
                  {derived.baseloadMonthly != null ? derived.baseloadMonthly.toFixed(2) : "--"}{" "}
                  <span className="text-base font-normal text-neutral-500">kWh/month</span>
                </div>
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

            <UsageChartsPanel
              monthly={derived.monthly}
              stitchedMonth={derived.stitchedMonth}
              weekdayKwh={derived.weekdayKwh}
              weekendKwh={derived.weekendKwh}
              timeOfDayBuckets={derived.timeOfDayBuckets}
              monthlyView={monthlyView}
              onMonthlyViewChange={setMonthlyView}
              dailyView={dailyView}
              onDailyViewChange={setDailyView}
              daily={derived.daily}
              dailyWeather={derived.dailyWeather ?? undefined}
              weatherBasisLabel={coverage?.weatherBasisLabel ?? undefined}
              fifteenCurve={derived.fifteenCurve}
              summaryTotalKwh={derived.totalKwh}
              coverageStart={coverage?.start ?? null}
              coverageEnd={coverage?.end ?? null}
            />
          </>
        )
      )}
    </div>
  );
};

export default UsageDashboard;