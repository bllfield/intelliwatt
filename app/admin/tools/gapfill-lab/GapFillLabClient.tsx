"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { UsageChartsPanel } from "@/components/usage/UsageChartsPanel";

type HouseOption = { id: string; label: string };
type RangeRow = { startDate: string; endDate: string };
type Usage365Payload = {
  source: string;
  timezone: string;
  coverageStart: string | null;
  coverageEnd: string | null;
  intervalCount: number;
  daily: Array<{ date: string; kwh: number; source?: "ACTUAL" | "SIMULATED" }>;
  monthly: Array<{ month: string; kwh: number }>;
  weekdayKwh: number;
  weekendKwh: number;
  fifteenCurve: Array<{ hhmm: string; avgKw: number }>;
  stitchedMonth?: {
    mode: "PRIOR_YEAR_TAIL";
    yearMonth: string;
    haveDaysThrough: number;
    missingDaysFrom: number;
    missingDaysTo: number;
    borrowedFromYearMonth: string;
    completenessRule: string;
  } | null;
};

type ApiResponse =
  | {
      ok: true;
      house: HouseOption;
      houses: HouseOption[];
      homeProfile: any;
      applianceProfile: any;
      modelAssumptions: any;
      testIntervalsCount: number;
      metrics: any;
      primaryPercentMetric: number | null;
      byMonth: any[];
      byHour: any[];
      byDayType: any[];
      worstDays: any[];
      diagnostics: any;
      pasteSummary: string;
      fullReportText?: string;
      fullReportJson?: { scenario?: { testRangesInput?: RangeRow[]; testSelectionMode?: string } } | null;
      message?: string;
      travelRangesFromDb?: Array<{ startDate: string; endDate: string }>;
      testSelectionMode?: "manual_ranges" | "random_days";
      testDaysRequested?: number;
      testDaysSelected?: number;
      seedUsed?: string | null;
      testRangesUsed?: RangeRow[];
      testMode?: string;
      candidateDaysAfterModeFilterCount?: number | null;
      minDayCoveragePct?: number;
      candidateWindowStartUtc?: string | null;
      candidateWindowEndUtc?: string | null;
      trainingMaxDays?: number;
      trainingGapDays?: number;
      excludedFromTest_travelCount?: number;
      excludedFromTraining_travelCount?: number;
      excludedFromTraining_testCount?: number;
      trainingCoverage?: { expected: number; found: number | null; pct: number | null };
      usage365?: Usage365Payload;
      truthEnvelope?: any;
      displaySimulated?: {
        source: string | null;
        coverageStart: string | null;
        coverageEnd: string | null;
        daily: Array<{ date: string; simKwh: number; source?: "ACTUAL" | "SIMULATED" }>;
        monthly: Array<{ month: string; kwh: number }>;
        stitchedMonth?: Usage365Payload["stitchedMonth"];
      };
      scoredDayTruthRows?: Array<{
        localDate: string;
        actualDayKwh: number;
        freshCompareSimDayKwh: number;
        displayedPastStyleSimDayKwh: number;
        actualVsFreshErrorKwh: number;
        displayVsFreshParityMatch: boolean;
        dayType: "weekday" | "weekend";
        weatherBasis: string | null;
        avgTempF: number | null;
        minTempF: number | null;
        maxTempF: number | null;
        hdd65: number | null;
        cdd65: number | null;
        fallbackLevel: string | null;
        selectedDayTotalSource: string | null;
        selectedShapeVariant: string | null;
        selectedReferenceMatchTier: string | null;
        selectedMatchSampleCount: number | null;
        reasonCode: string | null;
      }>;
      missAttributionSummary?: any;
      accuracyTuningBreakdowns?: any;
    }
  | {
      ok: false;
      error: string;
      message?: string;
      explanation?: string;
      missingData?: string[];
      reasonCode?: string;
      overlapCount?: number;
      overlapSample?: string[];
    };

const DEFAULT_RANGE: RangeRow = { startDate: "", endDate: "" };

function formatDate(d: string) {
  return d ? new Date(d + "T12:00:00Z").toLocaleDateString("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }) : "";
}

const VALID_RANDOM_TEST_MODES = ["fixed", "random", "winter", "summer", "shoulder", "extreme_weather"] as const;
type RandomTestMode = (typeof VALID_RANDOM_TEST_MODES)[number];

type WeatherKindOption = "ACTUAL_LAST_YEAR" | "NORMAL_AVG" | "open_meteo";
type ChartMode = "usage365" | "gapfill";

function normalizeDailyRowsToWindow<T extends { date: string }>(
  rows: T[],
  coverageStart: string | null,
  coverageEnd: string | null,
  maxDays = 365
): T[] {
  const start = typeof coverageStart === "string" && /^\d{4}-\d{2}-\d{2}$/.test(coverageStart) ? coverageStart : null;
  const end = typeof coverageEnd === "string" && /^\d{4}-\d{2}-\d{2}$/.test(coverageEnd) ? coverageEnd : null;
  const seen = new Set<string>();
  const filtered = rows
    .filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(String(row?.date ?? "")))
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .filter((row) => {
      const d = String(row.date);
      if (seen.has(d)) return false;
      seen.add(d);
      if (start && d < start) return false;
      if (end && d > end) return false;
      return true;
    });
  const limit = Math.max(1, Math.trunc(Number(maxDays) || 365));
  return filtered.length > limit ? filtered.slice(filtered.length - limit) : filtered;
}

function formatApiError(data: any, status: number): string {
  const base = String(data?.message ?? data?.error ?? `Request failed (${status})`);
  const explanation = String(data?.explanation ?? "").trim();
  const missing = Array.isArray(data?.missingData) ? data.missingData.map((v: unknown) => String(v)).filter(Boolean) : [];
  if (!explanation && missing.length === 0) return base;
  const parts: string[] = [base];
  if (explanation) parts.push(`Why: ${explanation}`);
  if (missing.length > 0) parts.push(`Missing data: ${missing.join(", ")}`);
  return parts.join("\n");
}

function toReplayTestRanges(raw: unknown): RangeRow[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((r) => ({
      startDate: String((r as any)?.startDate ?? "").slice(0, 10),
      endDate: String((r as any)?.endDate ?? "").slice(0, 10),
    }))
    .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.startDate) && /^\d{4}-\d{2}-\d{2}$/.test(r.endDate));
}

function buildCompareBodyAfterRebuild(
  originalBody: Record<string, unknown>,
  rebuildData: ApiResponse
): Record<string, unknown> {
  const replayRanges = toReplayTestRanges((rebuildData as any)?.testRangesUsed);
  if (replayRanges.length === 0) return originalBody;
  const nextBody: Record<string, unknown> = { ...originalBody };
  delete nextBody.testDays;
  delete nextBody.testMode;
  delete nextBody.seed;
  delete nextBody.minDayCoveragePct;
  delete nextBody.stratifyByMonth;
  delete nextBody.stratifyByWeekend;
  nextBody.testRanges = replayRanges;
  return nextBody;
}

function isArtifactRebuildRequiredError(errorCode: unknown): boolean {
  const code = String(errorCode ?? "").trim();
  return (
    code === "artifact_missing_rebuild_required" ||
    code === "artifact_scope_mismatch_rebuild_required" ||
    code === "artifact_stale_rebuild_required" ||
    code === "artifact_compare_join_incomplete_rebuild_required" ||
    code === "past_rebuild_failed"
  );
}

export default function GapFillLabClient() {
  const [email, setEmail] = useState("");
  const [timezone, setTimezone] = useState("America/Chicago");
  const [weatherKind, setWeatherKind] = useState<WeatherKindOption>("ACTUAL_LAST_YEAR");
  const [testMode, setTestMode] = useState<"manual_ranges" | "random_days">("manual_ranges");
  const [randomTestMode, setRandomTestMode] = useState<RandomTestMode>("fixed");
  const [testRanges, setTestRanges] = useState<RangeRow[]>([{ ...DEFAULT_RANGE }]);
  const [testDays, setTestDays] = useState(21);
  const [seed, setSeed] = useState("");
  const [minDayCoveragePct, setMinDayCoveragePct] = useState(95);
  const [stratifyByMonth, setStratifyByMonth] = useState(true);
  const [stratifyByWeekend, setStratifyByWeekend] = useState(true);
  const [houseId, setHouseId] = useState("");
  const [houses, setHouses] = useState<HouseOption[]>([]);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [usage365Loading, setUsage365Loading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [rebuildLoading, setRebuildLoading] = useState(false);
  const [progressStatus, setProgressStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [artifactMissing, setArtifactMissing] = useState(false);
  const [lastCompareBody, setLastCompareBody] = useState<Record<string, unknown> | null>(null);
  const [lastAttemptDebug, setLastAttemptDebug] = useState<Record<string, unknown> | null>(null);
  const [result, setResult] = useState<ApiResponse | null>(null);
  const [travelRangesFromDb, setTravelRangesFromDb] = useState<RangeRow[]>([]);
  const [usageMonthlyView, setUsageMonthlyView] = useState<"chart" | "table">("chart");
  const [usageDailyView, setUsageDailyView] = useState<"chart" | "table">("chart");
  const [chartMode, setChartMode] = useState<ChartMode>("usage365");
  const compareInFlightRef = useRef(false);
  const rebuildInFlightRef = useRef(false);

  const gapfillChartData = useMemo(() => {
    if (!result || !result.ok) return null;
    const dailyChartRows = Array.isArray((result as any)?.displaySimulated?.daily)
      ? ((result as any).displaySimulated.daily as Array<{ date: string; simKwh: number; source?: "ACTUAL" | "SIMULATED" }>)
      : Array.isArray((result as any).diagnostics?.dailyTotalsChartSim)
      ? ((result as any).diagnostics.dailyTotalsChartSim as Array<{ date: string; simKwh: number; source?: "ACTUAL" | "SIMULATED" }>)
      : Array.isArray((result as any).diagnostics?.dailyTotalsMasked)
        ? ((result as any).diagnostics.dailyTotalsMasked as Array<{ date: string; simKwh?: number; kwh?: number }>)
      : [];
    if (!dailyChartRows.length) return null;

    const rawDaily = dailyChartRows
      .map((d) => ({
        date: String(d.date ?? ""),
        kwh: Number((d as any).simKwh ?? (d as any).kwh ?? 0) || 0,
        ...(String((d as any)?.source ?? "").toUpperCase() === "SIMULATED" ? { source: "SIMULATED" as const } : {}),
      }))
      .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.date))
      .sort((a, b) => (a.date < b.date ? -1 : 1));
    const coverageStart =
      (result as any)?.displaySimulated?.coverageStart ??
      (result as any)?.truthEnvelope?.windowUsedForScoring?.startDate ??
      (result as any)?.parity?.windowStartUtc ??
      rawDaily[0]?.date ??
      null;
    const coverageEnd =
      (result as any)?.displaySimulated?.coverageEnd ??
      (result as any)?.truthEnvelope?.windowUsedForScoring?.endDate ??
      (result as any)?.parity?.windowEndUtc ??
      rawDaily[rawDaily.length - 1]?.date ??
      null;
    const daily = normalizeDailyRowsToWindow(rawDaily, coverageStart, coverageEnd, 365);

    if (!daily.length) return null;

    const monthly = Array.isArray((result as any)?.displaySimulated?.monthly)
      ? ((result as any).displaySimulated.monthly as Array<{ month: string; kwh: number }>)
          .map((m) => ({ month: String(m.month ?? ""), kwh: Number(m.kwh) || 0 }))
          .filter((m) => /^\d{4}-\d{2}$/.test(m.month))
          .sort((a, b) => (a.month < b.month ? -1 : 1))
      : Array.isArray((result as any)?.diagnostics?.monthlyTotalsChartSim)
      ? ((result as any).diagnostics.monthlyTotalsChartSim as Array<{ month: string; kwh: number }>)
          .map((m) => ({ month: String(m.month ?? ""), kwh: Number(m.kwh) || 0 }))
          .filter((m) => /^\d{4}-\d{2}$/.test(m.month))
          .sort((a, b) => (a.month < b.month ? -1 : 1))
      : Array.from(
          daily.reduce((acc, d) => {
            const month = d.date.slice(0, 7);
            acc.set(month, (acc.get(month) ?? 0) + d.kwh);
            return acc;
          }, new Map<string, number>())
        )
          .sort((a, b) => (a[0] < b[0] ? -1 : 1))
          .map(([month, kwh]) => ({ month, kwh }));

    const weekdayWeekend = daily.reduce(
      (acc, d) => {
        const dow = new Date(`${d.date}T12:00:00.000Z`).getUTCDay();
        if (dow === 0 || dow === 6) acc.weekend += d.kwh;
        else acc.weekday += d.kwh;
        return acc;
      },
      { weekday: 0, weekend: 0 }
    );

    const hourly = Array.isArray((result as any).diagnostics?.hourlyProfileMasked)
      ? ((result as any).diagnostics.hourlyProfileMasked as Array<{ hour: number; simMeanKwh: number }>)
      : [];
    const fifteenCurve = hourly
      .filter((h) => Number.isFinite(Number(h.hour)) && Number(h.hour) >= 0 && Number(h.hour) <= 23)
      .sort((a, b) => Number(a.hour) - Number(b.hour))
      .map((h) => ({
        hhmm: `${String(Number(h.hour)).padStart(2, "0")}:00`,
        // simMeanKwh is per 15m interval in this diagnostics view; convert to avg kW.
        avgKw: (Number(h.simMeanKwh) || 0) * 4,
      }));

    return {
      source: "GAPFILL_SIMULATED_TEST_WINDOW",
      timezone: timezone || "America/Chicago",
      // Prefer shared canonical window metadata from backend for date-label parity with Usage charts.
      coverageStart,
      coverageEnd,
      intervalCount: Number((result as any)?.diagnostics?.chartIntervalCount ?? (result as any).testIntervalsCount ?? (result as any)?.parity?.intervalCount ?? 0) || 0,
      daily,
      monthly,
      weekdayKwh: weekdayWeekend.weekday,
      weekendKwh: weekdayWeekend.weekend,
      fifteenCurve,
      stitchedMonth: (result as any)?.displaySimulated?.stitchedMonth ?? (result as any)?.diagnostics?.stitchedMonthChartSim ?? null,
    };
  }, [result, timezone]);
  const usage365ChartData = useMemo(() => {
    if (!result || !result.ok || !result.usage365?.daily?.length) return null;
    const normalizedDaily = normalizeDailyRowsToWindow(
      result.usage365.daily,
      result.usage365.coverageStart ?? null,
      result.usage365.coverageEnd ?? null,
      365
    );
    if (!normalizedDaily.length) return null;
    const normalizedCoverageStart = normalizedDaily[0]?.date ?? result.usage365.coverageStart ?? null;
    const normalizedCoverageEnd = normalizedDaily[normalizedDaily.length - 1]?.date ?? result.usage365.coverageEnd ?? null;
    return {
      ...result.usage365,
      coverageStart: normalizedCoverageStart,
      coverageEnd: normalizedCoverageEnd,
      daily: normalizedDaily,
    };
  }, [result]);
  const hasUsage365ChartData = Boolean(usage365ChartData?.daily?.length);
  const hasGapfillChartData = Boolean(gapfillChartData?.daily?.length);
  const effectiveChartMode: ChartMode =
    chartMode === "usage365" && !hasUsage365ChartData && hasGapfillChartData
      ? "gapfill"
      : chartMode === "gapfill" && !hasGapfillChartData && hasUsage365ChartData
        ? "usage365"
        : chartMode;
  const truthEnvelope = result && result.ok ? (result as any).truthEnvelope ?? null : null;
  const artifactFromEnvelope = truthEnvelope?.artifact ?? null;
  const artifactFromTopLevel =
    result && result.ok
      ? {
          sourceMode: (result as any)?.artifactSourceMode ?? null,
          sourceNote: (result as any)?.artifactSourceNote ?? null,
          requestedInputHash: (result as any)?.requestedInputHash ?? null,
          artifactInputHashUsed: (result as any)?.artifactInputHashUsed ?? null,
          artifactHashMatch: (result as any)?.artifactHashMatch ?? null,
          scenarioId: (result as any)?.artifactScenarioId ?? null,
          createdAt: (result as any)?.artifactCreatedAt ?? null,
          updatedAt: (result as any)?.artifactUpdatedAt ?? null,
          rebuiltRequested: Boolean((result as any)?.rebuilt),
          autoRebuilt: (result as any)?.artifactAutoRebuilt === true,
          pathKind:
            (result as any)?.artifactAutoRebuilt || (result as any)?.rebuilt
              ? "full_rebuild"
              : ["exact_hash_match", "latest_by_scenario_fallback"].includes(String((result as any)?.artifactSourceMode ?? ""))
                ? "cheap_read"
                : null,
        }
      : null;
  const artifactStatus = artifactFromEnvelope ?? artifactFromTopLevel;
  const scoredDayTruthRows =
    result && result.ok && Array.isArray((result as any).scoredDayTruthRows)
      ? ((result as any).scoredDayTruthRows as Array<any>)
      : [];
  const usageShapeDependencyStatus = truthEnvelope?.usageShapeDependencyStatus;
  const usageShapeDiag =
    result && result.ok ? ((result as any)?.modelAssumptions?.usageShapeProfileDiag ?? null) : null;
  const usageShapeNeedsAction =
    Boolean(usageShapeDependencyStatus) &&
    String(usageShapeDependencyStatus?.status ?? "").toLowerCase() !== "available";
  const hybridStepStatus: Array<{ key: string; label: string; state: "done" | "active" | "pending" }> = [
    {
      key: "lookup",
      label: "Lookup",
      state: houses.length > 0 ? "done" : lookupLoading ? "active" : "pending",
    },
    {
      key: "dependency",
      label: "Dependency Check",
      state: truthEnvelope ? "done" : (loading || rebuildLoading) ? "active" : "pending",
    },
    {
      key: "artifact",
      label: "Artifact Ensure/Rebuild",
      state:
        truthEnvelope?.artifact || (result && result.ok && (result as any).rebuilt != null)
          ? "done"
          : rebuildLoading
            ? "active"
            : "pending",
    },
    {
      key: "compare",
      label: "Compare",
      state: result && result.ok && result.metrics ? "done" : loading ? "active" : "pending",
    },
  ];

  function addTestRange() {
    setTestRanges((prev) => [...prev, { ...DEFAULT_RANGE }]);
  }

  function removeTestRange(i: number) {
    setTestRanges((prev) => (prev.length <= 1 ? prev : prev.filter((_, j) => j !== i)));
  }

  function updateTestRange(i: number, field: "startDate" | "endDate", value: string) {
    setTestRanges((prev) => prev.map((r, j) => (j === i ? { ...r, [field]: value.slice(0, 10) } : r)));
  }

  function handleHouseChange(newHouseId: string) {
    if (newHouseId !== houseId) {
      setHouseId(newHouseId);
      setTestRanges([{ ...DEFAULT_RANGE }]);
      // House selection changes request identity; clear prior run state to avoid stale carry-over.
      setResult(null);
      setError(null);
      setArtifactMissing(false);
      setLastCompareBody(null);
      setChartMode("usage365");
    }
  }

  async function postGapfill(body: Record<string, unknown>, timeoutMs = 320_000): Promise<{ res: Response; data: ApiResponse }> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch("/api/admin/tools/gapfill-lab", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const data = (await res.json().catch(() => ({
        ok: false as const,
        error: "invalid_json_response",
        message: `Server returned a non-JSON response (HTTP ${res.status}).`,
      }))) as ApiResponse;
      return { res, data };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  function mergeSuccessfulResult(data: ApiResponse) {
    setResult((prev) => {
      if (data.ok && prev?.ok) {
        return {
          ...data,
          ...(data.houses?.length ? {} : prev.houses?.length ? { houses: prev.houses } : {}),
          ...(data.primaryPercentMetric != null ? {} : prev.primaryPercentMetric != null ? { primaryPercentMetric: prev.primaryPercentMetric } : {}),
          ...(data.pasteSummary ? {} : prev.pasteSummary ? { pasteSummary: prev.pasteSummary } : {}),
          ...(data.usage365 ? {} : prev.usage365 ? { usage365: prev.usage365 } : {}),
          // Keep compare artifacts when a usage-only refresh returns no compare payload.
          ...(data.metrics ? {} : prev.metrics ? { metrics: prev.metrics } : {}),
          ...(data.testIntervalsCount != null ? {} : prev.testIntervalsCount != null ? { testIntervalsCount: prev.testIntervalsCount } : {}),
          ...(Array.isArray(data.byMonth) && data.byMonth.length > 0 ? {} : Array.isArray(prev.byMonth) ? { byMonth: prev.byMonth } : {}),
          ...(Array.isArray(data.byHour) && data.byHour.length > 0 ? {} : Array.isArray(prev.byHour) ? { byHour: prev.byHour } : {}),
          ...(Array.isArray(data.byDayType) && data.byDayType.length > 0 ? {} : Array.isArray(prev.byDayType) ? { byDayType: prev.byDayType } : {}),
          ...(Array.isArray(data.worstDays) && data.worstDays.length > 0 ? {} : Array.isArray(prev.worstDays) ? { worstDays: prev.worstDays } : {}),
          ...(data.diagnostics ? {} : prev.diagnostics ? { diagnostics: prev.diagnostics } : {}),
          // Never retain stale parity window metadata across requests.
          ...((data as any).fullReportText ? {} : (prev as any).fullReportText ? { fullReportText: (prev as any).fullReportText } : {}),
          ...((data as any).fullReportJson ? {} : (prev as any).fullReportJson ? { fullReportJson: (prev as any).fullReportJson } : {}),
          ...(data.homeProfile == null && prev.homeProfile != null ? { homeProfile: prev.homeProfile } : {}),
          ...(data.applianceProfile == null && prev.applianceProfile != null ? { applianceProfile: prev.applianceProfile } : {}),
          ...(data.modelAssumptions == null && prev.modelAssumptions != null ? { modelAssumptions: prev.modelAssumptions } : {}),
        };
      }
      return data;
    });
    if (data.ok && data.houses?.length) setHouses(data.houses);
    if (data.ok && Array.isArray((data as any).travelRangesFromDb)) {
      setTravelRangesFromDb((data as any).travelRangesFromDb.map((r: RangeRow) => ({ startDate: r.startDate, endDate: r.endDate })));
    }
  }

  function buildCompareBody(trimmedEmail: string, validRanges: RangeRow[]): Record<string, unknown> {
    const body: Record<string, unknown> = {
      email: trimmedEmail,
      timezone,
      houseId: houseId || undefined,
      weatherKind,
      includeUsage365: false,
      includeDiagnostics: true,
      includeFullReportText: true,
    };
    if (testMode === "random_days") {
      body.testDays = testDays;
      body.testMode = randomTestMode;
      if (seed.trim()) body.seed = seed.trim();
      body.minDayCoveragePct = minDayCoveragePct / 100;
      body.stratifyByMonth = stratifyByMonth;
      body.stratifyByWeekend = stratifyByWeekend;
      body.testRanges = [];
    } else {
      body.testRanges = validRanges;
    }
    return body;
  }

  async function handleLookup() {
    setError(null);
    setResult(null);
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) {
      setError("Enter an email address.");
      return;
    }
    setLookupLoading(true);
    try {
      const res = await fetch("/api/admin/tools/gapfill-lab", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: trimmed,
          timezone,
          testRanges: [],
          houseId: houseId || undefined,
          includeUsage365: false,
        }),
      });
      const data = (await res.json().catch(() => null)) as ApiResponse;
      if (!res.ok) {
        setError(formatApiError(data, res.status));
        setResult(null);
        return;
      }
      if (data.ok && data.houses?.length) {
        setHouses(data.houses);
        const currentInList = houseId && data.houses.some((h) => h.id === houseId);
        setHouseId(currentInList ? houseId : data.houses[0].id);
      }
      if (data.ok && Array.isArray((data as any).travelRangesFromDb)) {
        setTravelRangesFromDb((data as any).travelRangesFromDb.map((r: RangeRow) => ({ startDate: r.startDate, endDate: r.endDate })));
      }
      setResult(data);
    } catch (e: any) {
      setError(e?.name === "AbortError" ? "Request timed out." : (e?.message ?? String(e)));
      setResult(null);
    } finally {
      setLookupLoading(false);
    }
  }

  async function handleLoadUsage365() {
    setError(null);
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) {
      setError("Enter an email address.");
      return;
    }
    setUsage365Loading(true);
    try {
      const { res, data } = await postGapfill({
        email: trimmed,
        timezone,
        testRanges: [],
        houseId: houseId || undefined,
        includeUsage365: true,
      });
      if (!res.ok) {
        setError(formatApiError(data, res.status));
        return;
      }
      if (!data.ok) {
        setError(formatApiError(data, res.status));
        return;
      }
      mergeSuccessfulResult(data);
    } catch (e: any) {
      setError(e?.name === "AbortError" ? "Request timed out while loading Usage 365." : (e?.message ?? String(e)));
    } finally {
      setUsage365Loading(false);
    }
  }

  async function handleRunCompare() {
    if (compareInFlightRef.current || rebuildInFlightRef.current) {
      setError("A Gap-Fill request is already running. Wait for it to finish.");
      return;
    }
    setError(null);
    setProgressStatus(null);
    setArtifactMissing(false);
    const trimmed = email.trim().toLowerCase();
    if (!trimmed) {
      setError("Enter an email address.");
      return;
    }
    const validRanges = testRanges.filter((r) => r.startDate && r.endDate);
    if (testMode === "manual_ranges" && !validRanges.length) {
      setError("Add at least one Test Date range (start and end date), or use Random Test Days.");
      return;
    }
    compareInFlightRef.current = true;
    setLoading(true);
    let attemptedArtifactAutoRebuild = false;
    try {
      const body = buildCompareBody(trimmed, validRanges);
      setLastCompareBody(body);
      setLastAttemptDebug({
        startedAt: new Date().toISOString(),
        phase: "compare_request_started",
        requestBody: body,
      });
      const { res, data } = await postGapfill(body);
      if (!res.ok) {
        setLastAttemptDebug((prev) => ({
          ...(prev ?? {}),
          phase: "compare_response_error",
          responseStatus: res.status,
          responseError: (data as any)?.error ?? null,
          responseMessage: (data as any)?.message ?? null,
        }));
        if (isArtifactRebuildRequiredError((data as any)?.error)) {
          setArtifactMissing(true);
          // Backstop only: server now auto-ensures shared artifacts in the compare request.
          // Keep this branch as a legacy safety fallback.
          attemptedArtifactAutoRebuild = true;
          const rebuildBody = { ...body, rebuildArtifact: true, rebuildOnly: true };
          setLastAttemptDebug((prev) => ({
            ...(prev ?? {}),
            phase: "legacy_rebuild_only_started",
            rebuildBody,
          }));
          const { res: rebuildRes, data: rebuildData } = await postGapfill(rebuildBody);
          if (!rebuildRes.ok) {
            setProgressStatus(null);
            setArtifactMissing(isArtifactRebuildRequiredError((rebuildData as any)?.error));
            setError(formatApiError(rebuildData, rebuildRes.status));
            setResult(null);
            setLastAttemptDebug((prev) => ({
              ...(prev ?? {}),
              phase: "legacy_rebuild_only_error",
              rebuildStatus: rebuildRes.status,
              rebuildError: (rebuildData as any)?.error ?? null,
              rebuildMessage: (rebuildData as any)?.message ?? null,
            }));
            return;
          }
          const compareBody = buildCompareBodyAfterRebuild(body, rebuildData);
          setLastCompareBody(compareBody);
          setArtifactMissing(false);
          setProgressStatus("Rebuild complete. Loading compare result from shared artifact...");
          setLastAttemptDebug((prev) => ({
            ...(prev ?? {}),
            phase: "legacy_compare_after_rebuild_started",
            compareBodyAfterRebuild: compareBody,
          }));
          const { res: compareRes, data: compareData } = await postGapfill(compareBody);
          if (!compareRes.ok) {
            setProgressStatus("Rebuild complete. Click \"Run Compare\" again to load results.");
            setError(formatApiError(compareData, compareRes.status));
            setArtifactMissing(isArtifactRebuildRequiredError((compareData as any)?.error));
            setResult(null);
            setLastAttemptDebug((prev) => ({
              ...(prev ?? {}),
              phase: "legacy_compare_after_rebuild_error",
              compareStatus: compareRes.status,
              compareError: (compareData as any)?.error ?? null,
              compareMessage: (compareData as any)?.message ?? null,
            }));
            return;
          }
          setProgressStatus(null);
          setLastAttemptDebug((prev) => ({
            ...(prev ?? {}),
            phase: "compare_success_after_legacy_rebuild",
          }));
          mergeSuccessfulResult(compareData);
          return;
        }
        setProgressStatus(null);
        const errMsg = (data as any)?.error === "test_overlaps_travel"
          ? "Test Dates overlap Vacant/Travel dates — remove overlap and retry."
          : formatApiError(data, res.status);
        setError(errMsg);
        setResult(null);
        return;
      }
      setProgressStatus(null);
      setLastAttemptDebug((prev) => ({
        ...(prev ?? {}),
        phase: "compare_success",
        responseStatus: res.status,
      }));
      mergeSuccessfulResult(data);
    } catch (e: any) {
      setProgressStatus(null);
      const msg = e?.name === "AbortError"
        ? "Request timed out while ensuring artifacts + compare. Retry once; if it repeats, run Rebuild artifact and retry."
        : (e?.message ?? String(e));
      if (attemptedArtifactAutoRebuild || e?.name === "AbortError") {
        // Keep rebuild CTA visible when automatic rebuild or long compare request fails.
        setArtifactMissing(true);
      }
      setError(msg);
      setResult(null);
      setLastAttemptDebug((prev) => ({
        ...(prev ?? {}),
        phase: e?.name === "AbortError" ? "compare_timeout" : "compare_exception",
        errorName: e?.name ?? null,
        errorMessage: e?.message ?? String(e),
      }));
    } finally {
      setLoading(false);
      compareInFlightRef.current = false;
    }
  }

  async function handleRebuildAndRetry() {
    if (compareInFlightRef.current || rebuildInFlightRef.current) {
      setError("A Gap-Fill request is already running. Wait for it to finish.");
      return;
    }
    rebuildInFlightRef.current = true;
    if (!lastCompareBody) {
      setError("No prior compare request found. Run Compare first.");
      rebuildInFlightRef.current = false;
      return;
    }
    setRebuildLoading(true);
    setError(null);
    setProgressStatus(null);
    try {
      const rebuildBody = { ...lastCompareBody, rebuildArtifact: true, rebuildOnly: true };
      const { res: rebuildRes, data: rebuildData } = await postGapfill(rebuildBody);
      if (!rebuildRes.ok) {
        setProgressStatus(null);
        const errMsg = formatApiError(rebuildData, rebuildRes.status);
        setError(errMsg);
        setResult(null);
        setArtifactMissing(isArtifactRebuildRequiredError((rebuildData as any)?.error));
        setLastAttemptDebug((prev) => ({
          ...(prev ?? {}),
          phase: "manual_rebuild_error",
          rebuildStatus: rebuildRes.status,
          rebuildError: (rebuildData as any)?.error ?? null,
          rebuildMessage: (rebuildData as any)?.message ?? null,
        }));
        return;
      }
      const compareBody = buildCompareBodyAfterRebuild(lastCompareBody, rebuildData);
      setLastCompareBody(compareBody);
      setArtifactMissing(false);
      setResult(null);
      setProgressStatus("Rebuild complete. Click \"Run Compare\" to load results.");
      setError(null);
      // Do not auto-run compare here; it often times out. User runs compare in a separate request with full timeout budget.
    } catch (e: any) {
      setProgressStatus(null);
      setError(e?.name === "AbortError" ? "Request timed out while rebuilding or re-running compare. Retry once more." : (e?.message ?? String(e)));
      setResult(null);
      setLastAttemptDebug((prev) => ({
        ...(prev ?? {}),
        phase: e?.name === "AbortError" ? "manual_rebuild_timeout" : "manual_rebuild_exception",
        errorName: e?.name ?? null,
        errorMessage: e?.message ?? String(e),
      }));
    } finally {
      setRebuildLoading(false);
      rebuildInFlightRef.current = false;
    }
  }

  async function copyPasteSummary() {
    if (!result || !result.ok || !result.pasteSummary) return;
    try {
      await navigator.clipboard.writeText(result.pasteSummary);
    } catch {
      // ignore
    }
  }

  async function copyFullReport() {
    if (!result || !result.ok) return;
    const text = (result as any).fullReportText ?? "";
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // ignore
    }
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="mb-6">
        <Link href="/admin" className="text-brand-blue hover:underline text-sm">
          ← Admin
        </Link>
        <h1 className="text-2xl font-bold text-brand-navy mt-2">Gap-Fill Lab</h1>
        <p className="text-brand-navy/70 text-sm mt-1">
          Compare gap-fill simulation vs actual usage on masked (travel/vacant) intervals. Uses email only (no homeId).
        </p>
      </div>

      <div className="space-y-4 mb-8">
        <div>
          <label className="block text-sm font-medium text-brand-navy mb-1">Email (required)</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="user@example.com"
            className="w-full max-w-md border border-brand-blue/30 rounded px-3 py-2 text-brand-navy"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-brand-navy mb-1">Timezone</label>
          <input
            type="text"
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            className="w-full max-w-md border border-brand-blue/30 rounded px-3 py-2 text-brand-navy"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleLookup}
            disabled={lookupLoading || loading || rebuildLoading || usage365Loading}
            className="px-4 py-2 bg-brand-blue text-white rounded hover:bg-brand-navy disabled:opacity-50"
          >
            {lookupLoading ? "Looking up..." : "Lookup"}
          </button>
          <button
            type="button"
            onClick={handleLoadUsage365}
            disabled={usage365Loading || lookupLoading || loading || rebuildLoading}
            className="px-4 py-2 bg-brand-navy text-white rounded hover:bg-brand-blue disabled:opacity-50"
          >
            {usage365Loading ? "Loading Usage 365..." : "Load Usage (365-day)"}
          </button>
        </div>

        {houses.length > 1 && (
          <div>
            <label className="block text-sm font-medium text-brand-navy mb-1">House</label>
            <select
              value={houseId}
              onChange={(e) => handleHouseChange(e.target.value)}
              className="w-full max-w-md border border-brand-blue/30 rounded px-3 py-2 text-brand-navy"
            >
              {houses.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.label}
                </option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-brand-navy mb-2">Vacant/Travel (DB)</label>
          <p className="text-sm text-brand-navy/60 mb-2">
            Vacant/Travel (DB) are guardrails so we don’t accidentally test on customer-travel days. Only Test Dates are scored against actual intervals.
          </p>
          {travelRangesFromDb.length > 0 ? (
            <div className="p-3 rounded border border-brand-blue/20 bg-brand-navy/5 space-y-1">
              {travelRangesFromDb.map((r, i) => (
                <div key={i} className="text-sm text-brand-navy">
                  {formatDate(r.startDate)} – {formatDate(r.endDate)}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-brand-navy/60 italic">Run Lookup to load. None saved if empty.</p>
          )}
        </div>
        <div>
          <label className="block text-sm font-medium text-brand-navy mb-2">Test Dates</label>
          <p className="text-sm text-brand-navy/60 mb-2">
            Only Test Dates are scored against actual intervals. Do not overlap Vacant/Travel (DB) above when using manual ranges.
          </p>
          <div className="flex flex-wrap gap-2 mb-2">
            <button
              type="button"
              onClick={() => setTestMode("manual_ranges")}
              className={`px-3 py-1.5 rounded text-sm ${testMode === "manual_ranges" ? "bg-brand-navy text-white" : "bg-brand-navy/10 text-brand-navy"}`}
            >
              Manual Test Ranges
            </button>
            <button
              type="button"
              onClick={() => setTestMode("random_days")}
              className={`px-3 py-1.5 rounded text-sm ${testMode === "random_days" ? "bg-brand-navy text-white" : "bg-brand-navy/10 text-brand-navy"}`}
            >
              Random Test Days
            </button>
          </div>
          {testMode === "manual_ranges" && (
            <div className="space-y-2">
              {testRanges.map((r, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2">
                  <input
                    type="date"
                    value={r.startDate}
                    onChange={(e) => updateTestRange(i, "startDate", e.target.value)}
                    className="border border-brand-blue/30 rounded px-3 py-2 text-brand-navy"
                  />
                  <span className="text-brand-navy/60">–</span>
                  <input
                    type="date"
                    value={r.endDate}
                    onChange={(e) => updateTestRange(i, "endDate", e.target.value)}
                    className="border border-brand-blue/30 rounded px-3 py-2 text-brand-navy"
                  />
                  <button type="button" onClick={() => removeTestRange(i)} className="text-rose-600 hover:underline text-sm">
                    Remove
                  </button>
                </div>
              ))}
              <button type="button" onClick={addTestRange} className="text-brand-blue hover:underline text-sm">
                + Add range
              </button>
            </div>
          )}
          {testMode === "random_days" && (
            <div className="p-3 rounded border border-brand-blue/20 bg-brand-navy/5 space-y-3 max-w-md">
              <div>
                <label className="block text-xs text-brand-navy/70 mb-1">Test day selection mode</label>
                <select
                  value={randomTestMode}
                  onChange={(e) => setRandomTestMode(e.target.value as RandomTestMode)}
                  className="w-full border border-brand-blue/30 rounded px-2 py-1.5 text-brand-navy"
                >
                  <option value="fixed">Fixed (deterministic, same days every run)</option>
                  <option value="random">Random (different days each run)</option>
                  <option value="winter">Winter (Dec, Jan, Feb only)</option>
                  <option value="summer">Summer (Jun, Jul, Aug only)</option>
                  <option value="shoulder">Shoulder (Mar–May, Sep–Nov)</option>
                  <option value="extreme_weather">Extreme weather (min ≤ -2°C or max ≥ 35°C)</option>
                </select>
              </div>
              <div>
                <label className="block text-xs text-brand-navy/70 mb-1">Test Days</label>
                <input
                  type="number"
                  min={1}
                  max={365}
                  value={testDays}
                  onChange={(e) => setTestDays(Math.max(1, Math.min(365, parseInt(e.target.value, 10) || 21)))}
                  className="w-24 border border-brand-blue/30 rounded px-2 py-1.5 text-brand-navy"
                />
              </div>
              <div>
                <label className="block text-xs text-brand-navy/70 mb-1">Seed (optional; blank = server picks)</label>
                <input
                  type="text"
                  value={seed}
                  onChange={(e) => setSeed(e.target.value)}
                  placeholder="e.g. my-run-1"
                  className="w-full border border-brand-blue/30 rounded px-2 py-1.5 text-brand-navy"
                />
              </div>
              <div>
                <label className="block text-xs text-brand-navy/70 mb-1">Min Day Coverage %</label>
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={minDayCoveragePct}
                  onChange={(e) => setMinDayCoveragePct(Math.max(1, Math.min(100, parseInt(e.target.value, 10) || 95)))}
                  className="w-20 border border-brand-blue/30 rounded px-2 py-1.5 text-brand-navy"
                />
              </div>
              <div className="flex flex-wrap gap-4">
                <label className="flex items-center gap-2 text-sm text-brand-navy">
                  <input
                    type="checkbox"
                    checked={stratifyByMonth}
                    onChange={(e) => setStratifyByMonth(e.target.checked)}
                    className="rounded"
                  />
                  Stratify by month
                </label>
                <label className="flex items-center gap-2 text-sm text-brand-navy">
                  <input
                    type="checkbox"
                    checked={stratifyByWeekend}
                    onChange={(e) => setStratifyByWeekend(e.target.checked)}
                    className="rounded"
                  />
                  Stratify by weekend/weekday
                </label>
              </div>
              {result && result.ok && (result as any).testSelectionMode === "random_days" && (result as any).fullReportJson?.scenario?.testRangesInput?.length > 0 && (
                <div className="mt-2 pt-2 border-t border-brand-blue/20">
                  <div className="text-xs text-brand-navy/70 mb-1">Selected Test Dates (read-only)</div>
                  <div className="text-sm text-brand-navy space-y-0.5">
                    {(result as any).fullReportJson.scenario.testRangesInput.slice(0, 10).map((r: RangeRow, i: number) => (
                      <div key={i}>{formatDate(r.startDate)} – {formatDate(r.endDate)}</div>
                    ))}
                    {(result as any).fullReportJson.scenario.testRangesInput.length > 10 && (
                      <div className="text-brand-navy/60">… and {(result as any).fullReportJson.scenario.testRangesInput.length - 10} more ranges</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
        <div>
          <label className="block text-sm font-medium text-brand-navy mb-2">Weather for simulation</label>
          <p className="text-sm text-brand-navy/60 mb-2">
            Choose which temperature source to use for gap-fill weather scaling (last year, normals, or live API).
          </p>
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 text-sm text-brand-navy cursor-pointer">
              <input
                type="radio"
                name="weatherKind"
                checked={weatherKind === "ACTUAL_LAST_YEAR"}
                onChange={() => setWeatherKind("ACTUAL_LAST_YEAR")}
                className="text-brand-blue"
              />
              Last year temps
            </label>
            <label className="flex items-center gap-2 text-sm text-brand-navy cursor-pointer">
              <input
                type="radio"
                name="weatherKind"
                checked={weatherKind === "NORMAL_AVG"}
                onChange={() => setWeatherKind("NORMAL_AVG")}
                className="text-brand-blue"
              />
              Average temps
            </label>
            <label className="flex items-center gap-2 text-sm text-brand-navy cursor-pointer">
              <input
                type="radio"
                name="weatherKind"
                checked={weatherKind === "open_meteo"}
                onChange={() => setWeatherKind("open_meteo")}
                className="text-brand-blue"
              />
              Live (Open-Meteo)
            </label>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleRunCompare}
            disabled={loading}
            className="px-4 py-2 bg-brand-navy text-white rounded hover:bg-brand-blue disabled:opacity-50"
          >
            {loading ? "Running…" : "Run Compare"}
          </button>
          <span className="text-sm text-brand-navy/60">Typically returns in seconds (test-days-only).</span>
        </div>
        {progressStatus && (
          <div className="text-sm text-brand-navy/80">{progressStatus}</div>
        )}
      </div>

      {error && (
        <div className="mb-6 p-4 rounded bg-rose-50 text-rose-800 border border-rose-200">
          <div className="whitespace-pre-line">{error}</div>
          {artifactMissing && (
            <button
              type="button"
              onClick={handleRebuildAndRetry}
              disabled={rebuildLoading || loading}
              className="mt-3 px-3 py-1.5 bg-brand-navy text-white rounded hover:bg-brand-blue disabled:opacity-50 text-sm"
            >
              {rebuildLoading ? "Rebuilding and retrying..." : "Rebuild artifact and retry"}
            </button>
          )}
        </div>
      )}

      {lastAttemptDebug && (
        <details className="mb-6 border border-brand-blue/20 rounded" open>
          <summary className="p-3 cursor-pointer font-semibold text-brand-navy bg-brand-blue/5 rounded-t">
            Last Attempt Debug
          </summary>
          <div className="p-4 border-t border-brand-blue/20">
            <pre className="text-xs bg-brand-navy/5 p-3 rounded overflow-x-auto max-h-80 overflow-y-auto">
              {JSON.stringify(lastAttemptDebug, null, 2)}
            </pre>
          </div>
        </details>
      )}

      {result && result.ok && (
        <div className="space-y-4">
          {(hasUsage365ChartData || hasGapfillChartData) ? (
            <details className="border border-brand-blue/20 rounded" open>
              <summary className="p-3 cursor-pointer font-semibold text-brand-navy bg-brand-blue/5 rounded-t">
                Usage / Gap-Fill chart
              </summary>
              <div className="p-4 border-t border-brand-blue/20">
                <div className="mb-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setChartMode("usage365")}
                    className={`px-3 py-1.5 rounded text-sm border ${
                      effectiveChartMode === "usage365"
                        ? "bg-brand-navy text-white border-brand-navy"
                        : "bg-white text-brand-navy border-brand-blue/30"
                    }`}
                  >
                    Usage (365-day)
                  </button>
                  <button
                    type="button"
                    onClick={() => setChartMode("gapfill")}
                    className={`px-3 py-1.5 rounded text-sm border ${
                      effectiveChartMode === "gapfill"
                        ? "bg-brand-navy text-white border-brand-navy"
                        : "bg-white text-brand-navy border-brand-blue/30"
                    }`}
                  >
                    Gap-Fill (simulated test window)
                  </button>
                </div>
                {effectiveChartMode === "gapfill" && gapfillChartData ? (
                  <>
                    <p className="text-sm text-brand-navy/70 mb-4">
                      Source: {gapfillChartData.source} · {gapfillChartData.intervalCount.toLocaleString()} intervals ·
                      {` ${gapfillChartData.coverageStart ?? "—"} to ${gapfillChartData.coverageEnd ?? "—"}`}
                    </p>
                    <UsageChartsPanel
                      monthly={gapfillChartData.monthly}
                      stitchedMonth={gapfillChartData.stitchedMonth ?? null}
                      weekdayKwh={gapfillChartData.weekdayKwh}
                      weekendKwh={gapfillChartData.weekendKwh}
                      monthlyView={usageMonthlyView}
                      onMonthlyViewChange={setUsageMonthlyView}
                      dailyView={usageDailyView}
                      onDailyViewChange={setUsageDailyView}
                      daily={gapfillChartData.daily}
                      fifteenCurve={gapfillChartData.fifteenCurve}
                      coverageStart={gapfillChartData.coverageStart}
                      coverageEnd={gapfillChartData.coverageEnd}
                    />
                  </>
                ) : usage365ChartData?.daily?.length ? (
                  <>
                    <p className="text-sm text-brand-navy/70 mb-4">
                      Source: {usage365ChartData.source} · {usage365ChartData.intervalCount.toLocaleString()} intervals ·
                      {` ${usage365ChartData.coverageStart ?? "—"} to ${usage365ChartData.coverageEnd ?? "—"}`}
                    </p>
                    <UsageChartsPanel
                      monthly={usage365ChartData.monthly}
                      stitchedMonth={usage365ChartData.stitchedMonth ?? null}
                      weekdayKwh={usage365ChartData.weekdayKwh}
                      weekendKwh={usage365ChartData.weekendKwh}
                      monthlyView={usageMonthlyView}
                      onMonthlyViewChange={setUsageMonthlyView}
                      dailyView={usageDailyView}
                      onDailyViewChange={setUsageDailyView}
                      daily={usage365ChartData.daily}
                      fifteenCurve={usage365ChartData.fifteenCurve}
                      coverageStart={usage365ChartData.coverageStart}
                      coverageEnd={usage365ChartData.coverageEnd}
                    />
                  </>
                ) : (
                  <p className="text-sm text-brand-navy/70">
                    No chart data for this view yet. Load Usage (365-day) or run Compare.
                  </p>
                )}
              </div>
            </details>
          ) : null}

          <div className="p-4 rounded bg-brand-blue/5 border border-brand-blue/20">
            <div className="font-semibold text-brand-navy">Simulation Audit Report</div>
            <div className="text-sm text-brand-navy/80 mt-1">
              {result.house?.label} · {result.testIntervalsCount} test intervals
              {result.metrics ? ` · WAPE ${result.metrics.wape}% · MAE ${result.metrics.mae} kWh · RMSE ${result.metrics.rmse}` : ""}
            </div>
            {(result as any).testSelectionMode === "random_days" && (
              <div className="text-sm text-brand-navy/80 mt-1">
                Test selection: Random ({(result as any).testDaysSelected ?? "—"} days)
                {(result as any).testMode ? `, mode=${(result as any).testMode}` : ""}
                {(result as any).candidateDaysAfterModeFilterCount != null ? `, candidates after filter=${(result as any).candidateDaysAfterModeFilterCount}` : ""}
                {(result as any).seedUsed ? `, seed=${(result as any).seedUsed}` : ""}
                {(result as any).minDayCoveragePct != null ? `, minCoverage=${Math.round((result as any).minDayCoveragePct * 100)}%` : ""}
              </div>
            )}
          </div>

          <div className="p-4 rounded border border-brand-blue/20 bg-white">
            <div className="font-semibold text-brand-navy mb-2">Hybrid Automation Step Status</div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {hybridStepStatus.map((step) => (
                <div key={step.key} className="p-2 border border-brand-blue/20 rounded text-sm">
                  <div className="text-brand-navy">{step.label}</div>
                  <div
                    className={`font-semibold ${
                      step.state === "done"
                        ? "text-emerald-700"
                        : step.state === "active"
                          ? "text-amber-700"
                          : "text-brand-navy/60"
                    }`}
                  >
                    {step.state}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <details className="border border-brand-blue/20 rounded" open>
            <summary className="p-3 cursor-pointer font-semibold text-brand-navy bg-brand-blue/5 rounded-t">
              Artifact Processing Status
            </summary>
            <div className="p-4 border-t border-brand-blue/20 space-y-3 text-sm">
              <div className="grid md:grid-cols-2 gap-3">
                <div className="p-3 rounded border border-brand-blue/20">
                  <div className="text-xs text-brand-navy/70">Artifact source mode</div>
                  <div className="font-mono">{String(artifactStatus?.sourceMode ?? "—")}</div>
                </div>
                <div className="p-3 rounded border border-brand-blue/20">
                  <div className="text-xs text-brand-navy/70">Artifact path kind</div>
                  <div className="font-mono">{String(artifactStatus?.pathKind ?? "—")}</div>
                </div>
                <div className="p-3 rounded border border-brand-blue/20">
                  <div className="text-xs text-brand-navy/70">Hash alignment</div>
                  <div className="font-mono">
                    {artifactStatus?.artifactHashMatch == null
                      ? "—"
                      : artifactStatus.artifactHashMatch
                        ? "match"
                        : "mismatch"}
                  </div>
                </div>
                <div className="p-3 rounded border border-brand-blue/20">
                  <div className="text-xs text-brand-navy/70">Scenario ID</div>
                  <div className="font-mono break-all">{String(artifactStatus?.scenarioId ?? "—")}</div>
                </div>
              </div>
              <div className="p-3 rounded border border-brand-blue/20">
                <div className="font-medium text-brand-navy mb-1">Artifact details</div>
                <pre className="text-xs bg-brand-navy/5 p-2 rounded overflow-x-auto">
                  {JSON.stringify(artifactStatus ?? null, null, 2)}
                </pre>
              </div>
            </div>
          </details>

          <details className="border border-brand-blue/20 rounded" open>
            <summary className="p-3 cursor-pointer font-semibold text-brand-navy bg-brand-blue/5 rounded-t">
              Shared Module Alignment
            </summary>
            <div className="p-4 border-t border-brand-blue/20 space-y-3 text-sm">
              <div className="grid md:grid-cols-2 gap-3">
                <div className="p-3 rounded border border-brand-blue/20">
                  <div className="text-xs text-brand-navy/70">Calculation scope</div>
                  <div className="font-mono">{String(truthEnvelope?.compareCalculationScope ?? "—")}</div>
                </div>
                <div className="p-3 rounded border border-brand-blue/20">
                  <div className="text-xs text-brand-navy/70">Shared calc path</div>
                  <div className="font-mono break-words">{String(truthEnvelope?.compareSharedCalcPath ?? "—")}</div>
                </div>
                <div className="p-3 rounded border border-brand-blue/20">
                  <div className="text-xs text-brand-navy/70">Compare sim source</div>
                  <div className="font-mono">{String(truthEnvelope?.compareSimSource ?? "—")}</div>
                </div>
                <div className="p-3 rounded border border-brand-blue/20">
                  <div className="text-xs text-brand-navy/70">Display sim source</div>
                  <div className="font-mono">{String(truthEnvelope?.displaySimSource ?? "—")}</div>
                </div>
              </div>
              <div className="p-3 rounded border border-brand-blue/20">
                <div className="text-xs text-brand-navy/70">Display vs fresh parity</div>
                <div className="font-mono">
                  {truthEnvelope?.displayVsFreshParityForScoredDays
                    ? JSON.stringify(truthEnvelope.displayVsFreshParityForScoredDays)
                    : "—"}
                </div>
              </div>
            </div>
          </details>

          <details className="border border-brand-blue/20 rounded" open>
            <summary className="p-3 cursor-pointer font-semibold text-brand-navy bg-brand-blue/5 rounded-t">
              Calculation / Input Truth
            </summary>
            <div className="p-4 border-t border-brand-blue/20 space-y-3 text-sm">
              <div className="grid md:grid-cols-2 gap-3">
                <div className="p-3 rounded border border-brand-blue/20">
                  <div className="text-xs text-brand-navy/70">Timezone used for scoring</div>
                  <div className="font-mono">{String(truthEnvelope?.timezoneUsedForScoring ?? "—")}</div>
                </div>
                <div className="p-3 rounded border border-brand-blue/20">
                  <div className="text-xs text-brand-navy/70">Scoring window</div>
                  <div className="font-mono">
                    {truthEnvelope?.windowUsedForScoring
                      ? `${truthEnvelope.windowUsedForScoring.startDate} to ${truthEnvelope.windowUsedForScoring.endDate}`
                      : "—"}
                  </div>
                </div>
                <div className="p-3 rounded border border-brand-blue/20">
                  <div className="text-xs text-brand-navy/70">Requested / scoring / scored intervals</div>
                  <div className="font-mono">
                    {String(truthEnvelope?.requestedTestDaysCount ?? "—")} / {String(truthEnvelope?.scoringTestDaysCount ?? "—")} /{" "}
                    {String(truthEnvelope?.scoredIntervalsCount ?? "—")}
                  </div>
                </div>
                <div className="p-3 rounded border border-brand-blue/20">
                  <div className="text-xs text-brand-navy/70">Travel/vacant exclusion count</div>
                  <div className="font-mono">{String(truthEnvelope?.travelVacantExclusionCount ?? "—")}</div>
                </div>
              </div>
              <div className="p-3 rounded border border-brand-blue/20">
                <div className="font-medium text-brand-navy mb-1">Artifact Outcome</div>
                <pre className="text-xs bg-brand-navy/5 p-2 rounded overflow-x-auto">
                  {JSON.stringify(truthEnvelope?.artifact ?? null, null, 2)}
                </pre>
              </div>
              <div className="p-3 rounded border border-brand-blue/20">
                <div className="font-medium text-brand-navy mb-1">Usage-Shape Dependency</div>
                <pre className="text-xs bg-brand-navy/5 p-2 rounded overflow-x-auto">
                  {JSON.stringify(usageShapeDependencyStatus ?? null, null, 2)}
                </pre>
                {usageShapeNeedsAction && (
                  <div className="mt-2 text-sm">
                    <Link className="text-brand-blue underline" href="/admin/tools/usage-shape-profile">
                      Open Usage Shape Profile tool
                    </Link>
                  </div>
                )}
              </div>
              <div className="p-3 rounded border border-brand-blue/20">
                <div className="font-medium text-brand-navy mb-1">Usage-Shape Profile Diagnostic</div>
                <pre className="text-xs bg-brand-navy/5 p-2 rounded overflow-x-auto">
                  {JSON.stringify(usageShapeDiag ?? null, null, 2)}
                </pre>
                {usageShapeNeedsAction && (
                  <div className="mt-2 text-xs text-amber-800">
                    Usage-shape dependency is not available for this run; open the Usage Shape Profile tool to inspect inputs/variables.
                  </div>
                )}
              </div>
            </div>
          </details>

          <details className="border border-brand-blue/20 rounded" open>
            <summary className="p-3 cursor-pointer font-semibold text-brand-navy bg-brand-blue/5 rounded-t">
              Scored Day Truth Table
            </summary>
            <div className="p-4 border-t border-brand-blue/20 space-y-3">
              {scoredDayTruthRows.length > 0 ? (
                <div className="overflow-x-auto max-h-[28rem] overflow-y-auto">
                  <table className="w-full text-xs border border-brand-blue/20">
                    <thead>
                      <tr className="bg-brand-blue/10">
                        <th className="text-left p-2">Date</th>
                        <th className="text-right p-2">Actual</th>
                        <th className="text-right p-2">Fresh sim</th>
                        <th className="text-right p-2">Display sim</th>
                        <th className="text-right p-2">Error</th>
                        <th className="text-left p-2">Parity</th>
                        <th className="text-left p-2">Day</th>
                        <th className="text-right p-2">Avg/Min/Max F</th>
                        <th className="text-right p-2">HDD/CDD</th>
                        <th className="text-left p-2">Weather basis</th>
                        <th className="text-left p-2">Fallback</th>
                        <th className="text-left p-2">Day total source</th>
                        <th className="text-left p-2">Shape</th>
                        <th className="text-left p-2">Reference tier</th>
                        <th className="text-right p-2">Sample count</th>
                        <th className="text-left p-2">Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {scoredDayTruthRows.map((row: any) => (
                        <tr key={row.localDate} className="border-t border-brand-blue/10">
                          <td className="p-2 font-mono">{row.localDate}</td>
                          <td className="p-2 text-right font-mono">{row.actualDayKwh}</td>
                          <td className="p-2 text-right font-mono">{row.freshCompareSimDayKwh}</td>
                          <td className="p-2 text-right font-mono">{row.displayedPastStyleSimDayKwh}</td>
                          <td className="p-2 text-right font-mono">{row.actualVsFreshErrorKwh}</td>
                          <td className={`p-2 ${row.displayVsFreshParityMatch ? "text-emerald-700" : "text-rose-700"}`}>
                            {row.displayVsFreshParityMatch ? "match" : "mismatch"}
                          </td>
                          <td className="p-2">{row.dayType}</td>
                          <td className="p-2 text-right font-mono">
                            {row.avgTempF ?? "—"} / {row.minTempF ?? "—"} / {row.maxTempF ?? "—"}
                          </td>
                          <td className="p-2 text-right font-mono">
                            {row.hdd65 ?? "—"} / {row.cdd65 ?? "—"}
                          </td>
                          <td className="p-2">{row.weatherBasis ?? "—"}</td>
                          <td className="p-2">{row.fallbackLevel ?? "—"}</td>
                          <td className="p-2">{row.selectedDayTotalSource ?? "—"}</td>
                          <td className="p-2">{row.selectedShapeVariant ?? "—"}</td>
                          <td className="p-2">{row.selectedReferenceMatchTier ?? "—"}</td>
                          <td className="p-2 text-right font-mono">{row.selectedMatchSampleCount ?? "—"}</td>
                          <td className="p-2">{row.reasonCode ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-sm text-brand-navy/70">No scored-day truth rows were returned for this run.</p>
              )}
            </div>
          </details>

          <details className="border border-brand-blue/20 rounded" open>
            <summary className="p-3 cursor-pointer font-semibold text-brand-navy bg-brand-blue/5 rounded-t">
              Accuracy Tuning Snapshot
            </summary>
            <div className="p-4 border-t border-brand-blue/20 space-y-3 text-sm">
              <div className="p-3 rounded border border-brand-blue/20">
                <div className="font-medium text-brand-navy mb-1">Miss Attribution Summary</div>
                <pre className="text-xs bg-brand-navy/5 p-2 rounded overflow-x-auto">
                  {JSON.stringify((result as any).missAttributionSummary ?? null, null, 2)}
                </pre>
              </div>
              <div className="p-3 rounded border border-brand-blue/20">
                <div className="font-medium text-brand-navy mb-1">Accuracy Tuning Breakdowns</div>
                <pre className="text-xs bg-brand-navy/5 p-2 rounded overflow-x-auto">
                  {JSON.stringify((result as any).accuracyTuningBreakdowns ?? null, null, 2)}
                </pre>
              </div>
            </div>
          </details>

          {/* Overview */}
          <details className="border border-brand-blue/20 rounded" open>
            <summary className="p-3 cursor-pointer font-semibold text-brand-navy bg-brand-blue/5 rounded-t">
              Overview
            </summary>
            <div className="p-4 border-t border-brand-blue/20 space-y-4">
              {result.metrics && (
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                  <div className="p-3 rounded border border-brand-blue/20">
                    <div className="text-xs text-brand-navy/60">WAPE (primary)</div>
                    <div className="font-mono">{result.metrics.wape}%</div>
                  </div>
                  <div className="p-3 rounded border border-brand-blue/20">
                    <div className="text-xs text-brand-navy/60">MAE</div>
                    <div className="font-mono">{result.metrics.mae} kWh</div>
                  </div>
                  <div className="p-3 rounded border border-brand-blue/20">
                    <div className="text-xs text-brand-navy/60">RMSE</div>
                    <div className="font-mono">{result.metrics.rmse}</div>
                  </div>
                  <div className="p-3 rounded border border-brand-blue/20">
                    <div className="text-xs text-brand-navy/60">MAPE</div>
                    <div className="font-mono">{result.metrics.mape}%</div>
                  </div>
                  <div className="p-3 rounded border border-brand-blue/20">
                    <div className="text-xs text-brand-navy/60">Max abs</div>
                    <div className="font-mono">{result.metrics.maxAbs} kWh</div>
                  </div>
                </div>
              )}
              {result.pasteSummary && (
                <div>
                  <div className="font-semibold text-brand-navy mb-2">Report summary (copy to paste)</div>
                  <textarea
                    readOnly
                    value={result.pasteSummary}
                    rows={12}
                    className="w-full border border-brand-blue/20 rounded p-3 font-mono text-sm resize-y"
                  />
                  <button
                    type="button"
                    onClick={copyPasteSummary}
                    className="mt-2 px-3 py-1.5 bg-brand-blue/20 text-brand-navy rounded hover:bg-brand-blue/30 text-sm"
                  >
                    Copy
                  </button>
                </div>
              )}
              {(result as any).fullReportText && (
                <div className="mt-4">
                  <div className="font-semibold text-brand-navy mb-2">FULL COPY/PASTE REPORT (for ChatGPT/Cursor)</div>
                  <textarea
                    readOnly
                    value={(result as any).fullReportText}
                    rows={24}
                    className="w-full border border-brand-blue/20 rounded p-3 font-mono text-sm resize-y"
                  />
                  <button
                    type="button"
                    onClick={copyFullReport}
                    className="mt-2 px-3 py-1.5 bg-brand-navy text-white rounded hover:bg-brand-blue text-sm"
                  >
                    Copy Full Report
                  </button>
                </div>
              )}
            </div>
          </details>

          {/* Inputs: Home + Appliance Profile */}
          <details className="border border-brand-blue/20 rounded">
            <summary className="p-3 cursor-pointer font-semibold text-brand-navy bg-brand-blue/5 rounded-t">
              Inputs (Home Profile + Appliance Profile)
            </summary>
            <div className="p-4 border-t border-brand-blue/20 space-y-4">
              {result.homeProfile ? (
                <div>
                  <div className="font-medium text-brand-navy mb-2">Home Profile</div>
                  <pre className="text-xs bg-brand-navy/5 p-3 rounded overflow-x-auto max-h-64 overflow-y-auto">
                    {JSON.stringify(result.homeProfile, null, 2)}
                  </pre>
                </div>
              ) : (
                <p className="text-brand-navy/70 text-sm">No home profile on file.</p>
              )}
              {result.applianceProfile ? (
                <div>
                  <div className="font-medium text-brand-navy mb-2">Appliance Profile</div>
                  <pre className="text-xs bg-brand-navy/5 p-3 rounded overflow-x-auto max-h-64 overflow-y-auto">
                    {JSON.stringify(result.applianceProfile, null, 2)}
                  </pre>
                </div>
              ) : (
                <p className="text-brand-navy/70 text-sm">No appliance profile on file.</p>
              )}
            </div>
          </details>

          {/* Assumptions */}
          <details className="border border-brand-blue/20 rounded">
            <summary className="p-3 cursor-pointer font-semibold text-brand-navy bg-brand-blue/5 rounded-t">
              Assumptions (modelAssumptions)
            </summary>
            <div className="p-4 border-t border-brand-blue/20">
              {result.modelAssumptions ? (
                <pre className="text-xs bg-brand-navy/5 p-3 rounded overflow-x-auto max-h-96 overflow-y-auto">
                  {JSON.stringify(result.modelAssumptions, null, 2)}
                </pre>
              ) : (
                <p className="text-brand-navy/70 text-sm">Run Compare to see assumptions.</p>
              )}
            </div>
          </details>

          {/* Diagnostics */}
          <details className="border border-brand-blue/20 rounded">
            <summary className="p-3 cursor-pointer font-semibold text-brand-navy bg-brand-blue/5 rounded-t">
              Diagnostics
            </summary>
            <div className="p-4 border-t border-brand-blue/20 space-y-4">
              {result.byMonth?.length > 0 && (
                <div>
                  <div className="font-semibold text-brand-navy mb-2">By month</div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm border border-brand-blue/20">
                      <thead>
                        <tr className="bg-brand-blue/10">
                          <th className="text-left p-2">Month</th>
                          <th className="text-right p-2">MAE</th>
                          <th className="text-right p-2">MAPE %</th>
                          <th className="text-right p-2">Count</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.byMonth.map((row: any) => (
                          <tr key={row.month} className="border-t border-brand-blue/10">
                            <td className="p-2">{row.month}</td>
                            <td className="text-right p-2 font-mono">{row.mae}</td>
                            <td className="text-right p-2 font-mono">{row.mape}</td>
                            <td className="text-right p-2">{row.count}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {result.byDayType?.length > 0 && (
                <div>
                  <div className="font-semibold text-brand-navy mb-2">By day type</div>
                  <table className="w-full text-sm border border-brand-blue/20 max-w-xs">
                    <thead>
                      <tr className="bg-brand-blue/10">
                        <th className="text-left p-2">Type</th>
                        <th className="text-right p-2">MAE</th>
                        <th className="text-right p-2">MAPE %</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.byDayType.map((row: any) => (
                        <tr key={row.dayType} className="border-t border-brand-blue/10">
                          <td className="p-2">{row.dayType}</td>
                          <td className="text-right p-2 font-mono">{row.mae}</td>
                          <td className="text-right p-2 font-mono">{row.mape}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {result.diagnostics?.dailyTotalsMasked?.length > 0 && (
                <div>
                  <div className="font-semibold text-brand-navy mb-2">Daily totals (masked)</div>
                  <div className="overflow-x-auto max-h-48 overflow-y-auto">
                    <table className="w-full text-sm border border-brand-blue/20">
                      <thead>
                        <tr className="bg-brand-blue/10">
                          <th className="text-left p-2">Date</th>
                          <th className="text-right p-2">Actual kWh</th>
                          <th className="text-right p-2">Sim kWh</th>
                          <th className="text-right p-2">Delta</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.diagnostics.dailyTotalsMasked.slice(0, 31).map((row: any) => (
                          <tr key={row.date} className="border-t border-brand-blue/10">
                            <td className="p-2">{row.date}</td>
                            <td className="text-right p-2 font-mono">{row.actualKwh}</td>
                            <td className="text-right p-2 font-mono">{row.simKwh}</td>
                            <td className="text-right p-2 font-mono">{row.deltaKwh}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {result.diagnostics?.hourlyProfileMasked?.length > 0 && (
                <div>
                  <div className="font-semibold text-brand-navy mb-2">Hourly profile (masked, mean kWh)</div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm border border-brand-blue/20">
                      <thead>
                        <tr className="bg-brand-blue/10">
                          <th className="text-left p-2">Hour</th>
                          <th className="text-right p-2">Actual mean</th>
                          <th className="text-right p-2">Sim mean</th>
                          <th className="text-right p-2">Delta</th>
                        </tr>
                      </thead>
                      <tbody>
                        {result.diagnostics.hourlyProfileMasked.map((row: any) => (
                          <tr key={row.hour} className="border-t border-brand-blue/10">
                            <td className="p-2">{row.hour}</td>
                            <td className="text-right p-2 font-mono">{row.actualMeanKwh}</td>
                            <td className="text-right p-2 font-mono">{row.simMeanKwh}</td>
                            <td className="text-right p-2 font-mono">{row.deltaMeanKwh}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {result.diagnostics?.seasonalSplit && (
                <div>
                  <div className="font-semibold text-brand-navy mb-2">Seasonal split</div>
                  <div className="grid grid-cols-3 gap-4 text-sm">
                    <div className="p-3 rounded border border-brand-blue/20">
                      <div className="text-brand-navy/70">Summer (Jun–Aug)</div>
                      <div className="font-mono">WAPE {result.diagnostics.seasonalSplit.summer.wape}% · MAE {result.diagnostics.seasonalSplit.summer.mae} · n={result.diagnostics.seasonalSplit.summer.count}</div>
                    </div>
                    <div className="p-3 rounded border border-brand-blue/20">
                      <div className="text-brand-navy/70">Winter (Dec–Feb)</div>
                      <div className="font-mono">WAPE {result.diagnostics.seasonalSplit.winter.wape}% · MAE {result.diagnostics.seasonalSplit.winter.mae} · n={result.diagnostics.seasonalSplit.winter.count}</div>
                    </div>
                    <div className="p-3 rounded border border-brand-blue/20">
                      <div className="text-brand-navy/70">Shoulder</div>
                      <div className="font-mono">WAPE {result.diagnostics.seasonalSplit.shoulder.wape}% · MAE {result.diagnostics.seasonalSplit.shoulder.mae} · n={result.diagnostics.seasonalSplit.shoulder.count}</div>
                    </div>
                  </div>
                </div>
              )}

              {result.diagnostics?.poolHoursErrorSplit && (
                <div>
                  <div className="font-semibold text-brand-navy mb-2">Pool hours error split</div>
                  <p className="text-sm text-brand-navy/80">{result.diagnostics.poolHoursErrorSplit.scheduleRuleUsed}</p>
                </div>
              )}

              {result.worstDays?.length > 0 && (
                <div>
                  <div className="font-semibold text-brand-navy mb-2">Top 10 worst days (by abs error)</div>
                  <ul className="text-sm list-disc list-inside">
                    {result.worstDays.map((d: any) => (
                      <li key={d.date}>
                        {formatDate(d.date)}: {d.absErrorKwh} kWh
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </details>

          <details className="border border-brand-blue/20 rounded">
            <summary className="p-3 cursor-pointer font-semibold text-brand-navy bg-brand-blue/5 rounded-t">
              Deep Diagnostics / Raw Payload
            </summary>
            <div className="p-4 border-t border-brand-blue/20">
              <pre className="text-xs bg-brand-navy/5 p-3 rounded overflow-x-auto max-h-96 overflow-y-auto">
                {JSON.stringify(result, null, 2)}
              </pre>
            </div>
          </details>

          {result.ok && result.testIntervalsCount === 0 && result.message && (
            <p className="text-brand-navy/70">{result.message}</p>
          )}
        </div>
      )}
    </div>
  );
}