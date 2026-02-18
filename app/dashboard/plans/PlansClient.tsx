"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import OfferCard, { type OfferCardProps } from "./OfferCard";
import IntelliwattBotPopup from "@/components/dashboard/IntelliwattBotPopup";

type UsageSummary =
  | {
      source: string;
      rangeStart?: string;
      rangeEnd?: string;
      totalKwh?: number;
      rows?: number;
      // legacy/forward-compatible fields (don’t break if server shape changes)
      annualKwh?: number;
      last12moKwh?: number;
    }
  | null;

type OfferRow = OfferCardProps["offer"];

type ApiResponse = {
  ok: boolean;
  error?: string;
  message?: string;
  hasUsage?: boolean;
  usageSummary?: UsageSummary;
  avgMonthlyKwh?: number;
  offers?: OfferRow[];
  bestOffers?: OfferRow[];
  bestOffersBasis?: string | null;
  bestOffersDisclaimer?: string | null;
  bestOffersAllIn?: OfferRow[];
  bestOffersAllInBasis?: string | null;
  bestOffersAllInDisclaimer?: string | null;
  page?: number;
  pageSize?: number;
  total?: number;
  totalPages?: number;
};

type SortKey =
  | "kwh1000_asc"
  | "kwh500_asc"
  | "kwh2000_asc"
  | "term_asc"
  | "renewable_desc"
  | "best_for_you_proxy";

type EflBucket = 500 | 1000 | 2000;

function firstFiniteNumber(vals: Array<any>): number | null {
  for (const v of vals) {
    const n = typeof v === "number" ? v : Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function selectedBestBucket(sort: SortKey): EflBucket {
  if (sort === "kwh500_asc") return 500;
  if (sort === "kwh2000_asc") return 2000;
  return 1000;
}

function pickNearestEflBucket(kwh: number): EflBucket {
  // Nearest among 500/1000/2000; ties prefer 1000.
  const buckets: EflBucket[] = [500, 1000, 2000];
  let best: EflBucket = 1000;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const b of buckets) {
    const dist = Math.abs(kwh - b);
    if (dist < bestDist) {
      best = b;
      bestDist = dist;
      continue;
    }
    if (dist === bestDist && b === 1000) {
      best = b;
    }
  }
  return best;
}

function pickMetricCentsPerKwhForBucket(offer: any, bucket: EflBucket): number | null {
  const pick500 = () =>
    firstFiniteNumber([offer?.efl?.avgPriceCentsPerKwh500, offer?.avgPriceCentsPerKwh500, offer?.kwh500_cents]);
  const pick1000 = () =>
    firstFiniteNumber([
      offer?.efl?.avgPriceCentsPerKwh1000,
      offer?.avgPriceCentsPerKwh1000,
      offer?.kwh1000_cents,
      offer?.bill1000,
      offer?.bill_1000,
      offer?.price1000,
      offer?.rate1000,
    ]);
  const pick2000 = () =>
    firstFiniteNumber([offer?.efl?.avgPriceCentsPerKwh2000, offer?.avgPriceCentsPerKwh2000, offer?.kwh2000_cents]);

  const v = bucket === 500 ? pick500() : bucket === 2000 ? pick2000() : pick1000();
  if (typeof v === "number" && Number.isFinite(v)) return v;

  // Fallback order mirrors the UI sort fallbacks.
  return bucket === 500
    ? firstFiniteNumber([pick1000(), pick2000()])
    : bucket === 2000
      ? firstFiniteNumber([pick1000(), pick500()])
      : firstFiniteNumber([pick500(), pick2000()]);
}

function fmtCentsPerKwh(v: number | null | undefined): string {
  if (typeof v !== "number" || !Number.isFinite(v)) return "—";
  return `${v.toFixed(2)}¢/kWh`;
}

function fmtKwhPerMonth(v: number | null | undefined): string {
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return "—";
  return `${Math.round(v)} kWh/mo`;
}

function buildQuery(params: Record<string, string>) {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v == null) continue;
    const s = String(v).trim();
    if (!s) continue;
    usp.set(k, s);
  }
  return usp.toString();
}

export default function PlansClient() {
  // Customer UX guardrail:
  // Sorting/filtering/pagination should only change the list being displayed and should NOT kick off
  // background plan pipeline runs or EFL template prefetching from this page.
  // Those warmups happen via the dashboard bootstrapper and admin tooling.
  // NOTE: We intentionally keep the warmups bounded + throttled; this flips cards from
  // CALCULATING → AVAILABLE as soon as the background pipeline materializes estimates.
  const ENABLE_PLANS_AUTO_WARMUPS = true;

  const [q, setQ] = useState("");
  const [rateType, setRateType] = useState<"all" | "fixed" | "variable" | "renewable" | "unknown">("all");
  const [term, setTerm] = useState<"all" | "0-6" | "7-12" | "13-24" | "25+">("all");
  const [renewableMin, setRenewableMin] = useState<0 | 50 | 100>(0);
  const [template, setTemplate] = useState<"all" | "available">("all");
  // NOTE:
  // Renter is captured during address save (QuickAddressEntry) and persisted on HouseAddress.
  // /dashboard/plans should not own it as a filter.
  const [sort, setSort] = useState<SortKey>("kwh1000_asc");
  const userTouchedSortRef = useRef(false);
  const [page, setPage] = useState(1);
  // Default to ALL plans (API uses dataset=1 with pageSize up to 2000).
  const [pageSize, setPageSize] = useState<10 | 20 | 50 | 2000>(2000);
  const userTouchedPageSizeRef = useRef(false);
  // Once the user touches ANY control in the Search/Sort/Filter section, this page must remain
  // display-only: never kick any background warmups (template prefetch or pipeline).
  // This prevents "changing filters triggers calculations" regressions.
  const [userTouchedSearchOrFilters, setUserTouchedSearchOrFilters] = useState(false);
  const markUserTouchedSearchOrFilters = useCallback(() => setUserTouchedSearchOrFilters(true), []);
  const [refreshNonce, setRefreshNonce] = useState(0);

  const [loading, setLoading] = useState(false);
  const [resp, setResp] = useState<ApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reqSeqRef = useRef(0);

  const [prefetchNote, setPrefetchNote] = useState<string | null>(null);
  const prefetchInFlightRef = useRef(false);
  const [autoPreparing, setAutoPreparing] = useState(false);
  const pipelineKickRef = useRef(false);
  const lastPipelineKickAtRef = useRef<number>(0);
  const [lastPipelineKickResult, setLastPipelineKickResult] = useState<any | null>(null);
  const pollTimerRef = useRef<number | null>(null);
  const pollStopTimerRef = useRef<number | null>(null);
  const pollInFlightRef = useRef(false);

  const [mobilePanel, setMobilePanel] = useState<"none" | "search" | "filters">("none");
  const [headerCollapsed, setHeaderCollapsed] = useState(false);
  const [approxKwhPerMonth, setApproxKwhPerMonth] = useState<500 | 750 | 1000 | 1250 | 2000>(1000);
  const bestBucket = useMemo(() => selectedBestBucket(sort), [sort]);
  const datasetMode = pageSize === 2000;
  // Stable per-session dataset identity for background warmups.
  // Keep this minimal so browsing/sorting doesn't retrigger pipeline/prefetch during a session.
  const warmupKey = useMemo(() => "default", []);
  const [warmupSessionActive, setWarmupSessionActive] = useState(false);

  // Once we start a warmup session for this renter-mode dataset, keep it running even if the user
  // touches filters/sort/search. Those interactions must not *start* warmups, but they also must not
  // accidentally stop an in-progress warmup that is trying to drain pending cards to 0.
  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(`plans_warmup_active_v1:${warmupKey}`);
      if (raw === "1") setWarmupSessionActive(true);
    } catch {
      // ignore
    }
    // Only depends on warmupKey so a renter toggle resets the warmup session.
  }, [warmupKey]);

  // Only allow the Plans page to *kick* background warmups in the default landing view.
  // Any sort/filter/pagination interaction should be read-only: fetch + display DB state, never restart warmups.
  const allowWarmupKicksFromThisView = useMemo(() => {
    const defaultFilters =
      q.trim() === "" &&
      rateType === "all" &&
      term === "all" &&
      renewableMin === 0 &&
      template === "all" &&
      page === 1;
    // If the user explicitly changes sort, do not kick background work from this page.
    const userHasSorted = Boolean(userTouchedSortRef.current);
    const userChangedPageSize = Boolean(userTouchedPageSizeRef.current);
    return defaultFilters && !userHasSorted && !userChangedPageSize && !userTouchedSearchOrFilters;
  }, [q, rateType, term, renewableMin, template, page, pageSize, userTouchedSearchOrFilters]);

  // Server dataset identity: include only inputs that actually change the SERVER response.
  // In datasetMode (pageSize=2000), the server returns a single large dataset and ALL filtering/sorting is client-side.
  const serverDatasetKey = useMemo(() => {
    if (datasetMode) {
      return JSON.stringify({
        datasetMode: true,
        pageSize,
        // Keep approxKwhPerMonth in the key only for no-usage cases (server can use it for proxy strips).
        approxKwhPerMonth,
      });
    }
    return JSON.stringify({
      datasetMode: false,
      q: q.trim().toLowerCase(),
      rateType,
      term,
      renewableMin,
      template,
      sort,
      page,
      pageSize,
      approxKwhPerMonth,
    });
  }, [datasetMode, pageSize, approxKwhPerMonth, q, rateType, term, renewableMin, template, sort, page]);

  // Lightweight client cache so back/forward navigation instantly shows the last processed dataset
  // instead of refetching.
  // Bump when API semantics change so we don't pin users to stale session-cached payloads.
  // Bump when API semantics change so we don't pin users to stale session-cached payloads.
  const cacheKey = useMemo(() => `dashboard_plans_dataset_v6:${serverDatasetKey}`, [serverDatasetKey]);
  // This is NOT the plan-engine cache (engine outputs are persisted in the WattBuy Offers DB).
  // This is only a UX cache for the API response to avoid flashing loading states on navigation.
  // Keep it long-lived; correctness still comes from server-side canonical inputs + DB-stored estimates.
  const cacheTtlMs = 60 * 60 * 1000;

  const responseHasPending = (r: ApiResponse | null): boolean => {
    if (!r?.ok) return false;
    const offersNow = Array.isArray(r?.offers) ? (r!.offers as OfferRow[]) : [];
    // IMPORTANT:
    // Do not pin the UI to a cached response when ANY offers are QUEUED.
    // Admin actions (manual EFL processing, pipeline runs) can flip QUEUED → AVAILABLE and the user must see it.
    return offersNow.some((o: any) => String(o?.intelliwatt?.statusLabel ?? "") === "QUEUED");
  };

  const pendingCountFromResponse = (r: ApiResponse | null): number => {
    if (!r?.ok) return 0;
    if (!r?.hasUsage) return 0;
    const offersNow = Array.isArray(r?.offers) ? (r!.offers as OfferRow[]) : [];
    return offersNow.filter((o: any) => {
      // Pending = expected to eventually compute (not UNSUPPORTED/NOT_COMPUTABLE).
      if (String(o?.intelliwatt?.statusLabel ?? "") !== "QUEUED") return false;
      const tceStatus = String((o as any)?.intelliwatt?.trueCostEstimate?.status ?? "").toUpperCase();
      const tceReason = String((o as any)?.intelliwatt?.trueCostEstimate?.reason ?? "").toUpperCase();
      const isCacheMiss = tceStatus === "NOT_IMPLEMENTED" && tceReason === "CACHE_MISS";
      return !tceStatus || tceStatus === "QUEUED" || tceStatus === "MISSING_TEMPLATE" || isCacheMiss;
    }).length;
  };

  // IMPORTANT:
  // Sort/filter must be display-only: it must never *start* any background warmups.
  // Warmups may only start from the default landing view, and may continue only if a warmup session
  // was already started from that default view.
  const allowWarmupInBackground = allowWarmupKicksFromThisView || warmupSessionActive;

  useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(cacheKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { t: number; resp: ApiResponse };
      if (!parsed || typeof parsed.t !== "number" || !parsed.resp) return;
      if (Date.now() - parsed.t > cacheTtlMs) return;
      // If the cached payload still has pending calculations, don't "pin" the UI to it.
      // We want the next render to fetch fresh so cards can flip to AVAILABLE quickly after
      // the pipeline finishes.
      if (responseHasPending(parsed.resp)) return;
      setResp(parsed.resp);
      setError(null);
      setLoading(false);
    } catch {
      // ignore cache failures
    }
  }, [cacheKey, cacheTtlMs]);

  useEffect(() => {
    prefetchInFlightRef.current = false;
    setPrefetchNote(null);
    pipelineKickRef.current = false;
    if (pollTimerRef.current) window.clearInterval(pollTimerRef.current);
    pollTimerRef.current = null;
    if (pollStopTimerRef.current) window.clearTimeout(pollStopTimerRef.current);
    pollStopTimerRef.current = null;
  }, [warmupKey]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem("dashboard_plans_header_collapsed");
      if (raw === "true") setHeaderCollapsed(true);
      if (raw === "false") setHeaderCollapsed(false);
    } catch {
      // ignore
    }
  }, []);

  const setCollapsed = (next: boolean) => {
    setHeaderCollapsed(next);
    if (next) setMobilePanel("none");
    try {
      window.localStorage.setItem("dashboard_plans_header_collapsed", String(next));
    } catch {
      // ignore
    }
  };

  const openHeader = (panel?: "search" | "filters") => {
    setCollapsed(false);
    if (panel) setMobilePanel(panel);
  };

  // Fetch a single large dataset once; all sort/filter/paging happens client-side in datasetMode.
  const baseParams = useMemo(() => {
    const params: Record<string, string> = {
      // Used only to force a reload after background prefetch runs.
      _r: String(refreshNonce),
      page: String(datasetMode ? 1 : page),
      pageSize: String(pageSize),
      // In datasetMode, keep the SERVER request stable so sort/filter changes do not refetch or trigger any work.
      sort: String(datasetMode ? "kwh1000_asc" : sort),
      ...(datasetMode
        ? {}
        : {
            q: q.trim(),
            rateType: String(rateType),
            term: String(term),
            renewableMin: String(renewableMin),
            template: String(template),
          }),
    };
    if (typeof approxKwhPerMonth === "number") params.approxKwhPerMonth = String(approxKwhPerMonth);
    if (datasetMode) params.dataset = "1";
    return params;
  }, [refreshNonce, page, pageSize, sort, q, rateType, term, renewableMin, template, approxKwhPerMonth, datasetMode]);

  const plansQueryString = useMemo(() => buildQuery(baseParams as any), [baseParams]);

  // Polling uses an interval closure; keep the latest query string in a ref to avoid stale polling
  // when inputs (e.g. refreshNonce) change.
  const plansQueryStringRef = useRef<string>("");
  const cacheKeyRef = useRef<string>("");
  useEffect(() => {
    plansQueryStringRef.current = plansQueryString;
  }, [plansQueryString]);
  useEffect(() => {
    cacheKeyRef.current = cacheKey;
  }, [cacheKey]);

  useEffect(() => {
    // IMPORTANT: Do not ever "pin" the UI to a cached response.
    // We can hydrate from cache for instant back/forward nav, but we must still revalidate.
    // This prevents issues like seeing a stale 7-offer payload after the backend is fixed to return 56.
    let hydratedFromCache = false;
    if (refreshNonce === 0) {
      try {
        const raw = window.sessionStorage.getItem(cacheKey);
        if (raw) {
          const parsed = JSON.parse(raw) as { t: number; resp: ApiResponse };
          if (parsed && typeof parsed.t === "number" && parsed.resp && Date.now() - parsed.t <= cacheTtlMs) {
            if (!responseHasPending(parsed.resp)) {
              hydratedFromCache = true;
              setResp(parsed.resp);
              setError(null);
              setLoading(false);
            }
          }
        }
      } catch {
        // ignore
      }
    }

    const controller = new AbortController();
    const mySeq = ++reqSeqRef.current;
    if (!hydratedFromCache) setLoading(true);
    setError(null);

    async function run() {
      try {
        const r = await fetch(`/api/dashboard/plans?${plansQueryString}`, {
          signal: controller.signal,
          cache: "no-store",
        });
        const j = (await r.json().catch(() => null)) as ApiResponse | null;
        if (controller.signal.aborted) return;
        if (mySeq !== reqSeqRef.current) return; // stale response
        if (!r.ok || !j?.ok) {
          setError(j?.error ?? j?.message ?? `Request failed (${r.status})`);
          setResp(j ?? null);
          return;
        }
        setResp(j);
        try {
          window.sessionStorage.setItem(cacheKey, JSON.stringify({ t: Date.now(), resp: j }));
        } catch {
          // ignore
        }
      } catch (e: any) {
        if (controller.signal.aborted) return;
        if (mySeq !== reqSeqRef.current) return;
        if (e?.name === "AbortError") return;
        setError(e?.message ?? String(e));
        // Keep existing resp if we hydrated from cache; otherwise the UI would flash empty.
        if (!hydratedFromCache) setResp(null);
      } finally {
        if (controller.signal.aborted) return;
        if (mySeq !== reqSeqRef.current) return;
        setLoading(false);
      }
    }

    run();
    return () => controller.abort();
  }, [plansQueryString, refreshNonce, cacheKey, cacheTtlMs]);

  // IMPORTANT: /dashboard/plans must never trigger/retrigger the plan pipeline.
  // This page is display-only; background warm-ups happen elsewhere.
  useEffect(() => {
    if (!resp?.ok) return;
    const offersNow = Array.isArray(resp?.offers) ? (resp!.offers as OfferRow[]) : [];
    const pending = pendingCountFromResponse(resp);
    const classify = (o: any): "AVAILABLE" | "NEED_USAGE" | "CALCULATING" | "UNAVAILABLE" => {
      const tce = (o as any)?.intelliwatt?.trueCostEstimate;
      const tceStatus = String(tce?.status ?? "").toUpperCase();
      const tceReason = String(tce?.reason ?? (o as any)?.intelliwatt?.statusReason ?? "").toUpperCase();
      const statusLabel = String((o as any)?.intelliwatt?.statusLabel ?? "").toUpperCase();
      if (tceStatus === "OK" || tceStatus === "APPROXIMATE") return "AVAILABLE";
      if (tceStatus === "MISSING_USAGE") return "NEED_USAGE";
      if (tceStatus === "NOT_IMPLEMENTED" && tceReason === "MISSING_BUCKETS") return "NEED_USAGE";

      // "Calculating" means: expected to resolve once templates/usage buckets/estimates materialize.
      // Keep this aligned with OfferCard's customer-facing language.
      const calculating =
        tceStatus === "MISSING_TEMPLATE" ||
        (tceStatus === "NOT_IMPLEMENTED" &&
          (tceReason === "CACHE_MISS" ||
            tceReason.includes("MISSING TEMPLATE") ||
            tceReason.includes("MISSING BUCKET"))) ||
        (statusLabel === "QUEUED" &&
          tce?.status !== "OK" &&
          tce?.status !== "APPROXIMATE");
      if (calculating) return "CALCULATING";

      // Everything else is currently unavailable (true defects, temporary lookups, etc).
      return "UNAVAILABLE";
    };

    let availableCount = 0;
    let needUsageCount = 0;
    let calculatingCount = 0;
    let unavailableCount = 0;
    for (const o of offersNow) {
      const k = classify(o);
      if (k === "AVAILABLE") availableCount++;
      else if (k === "NEED_USAGE") needUsageCount++;
      else if (k === "CALCULATING") calculatingCount++;
      else unavailableCount++;
    }
    setAutoPreparing(false);
    if (allowWarmupInBackground && pending > 0) {
      setPrefetchNote(`Preparing IntelliWatt calculations… (${pending} pending)`);
      return;
    }

    // Summary note: never let one uncomputable plan make the whole page feel "stuck calculating".
    if (calculatingCount > 0 || unavailableCount > 0 || needUsageCount > 0) {
      const parts: string[] = [];
      parts.push(`${availableCount} available`);
      if (calculatingCount > 0) parts.push(`${calculatingCount} calculating`);
      if (unavailableCount > 0) parts.push(`${unavailableCount} not computable`);
      if (needUsageCount > 0) parts.push(`${needUsageCount} need usage`);
      setPrefetchNote(`IntelliWatt estimates: ${parts.join(" • ")}`);
      return;
    }

    setPrefetchNote(null);
  }, [resp?.ok, resp?.offers, allowWarmupInBackground]);

  // When pending reaches 0, end the warmup session so future browsing doesn't keep background-kicking.
  useEffect(() => {
    if (!warmupSessionActive) return;
    const pendingNow = pendingCountFromResponse(resp);
    if (pendingNow > 0) return;
    setWarmupSessionActive(false);
    try {
      window.sessionStorage.removeItem(`plans_warmup_active_v1:${warmupKey}`);
    } catch {
      // ignore
    }
  }, [resp, warmupKey, warmupSessionActive]);

  // Targeted template warm-up: if offers are QUEUED specifically because their template mapping is missing,
  // kick the lightweight EFL-prefetch endpoint to auto-parse and create/link templates (best-effort).
  // This is safe even when usage is missing (templating does not require SMT/GreenButton usage).
  useEffect(() => {
    if (!ENABLE_PLANS_AUTO_WARMUPS) return;
    if (!allowWarmupInBackground) return;
    if (!resp?.ok) return;
    const offersNow = Array.isArray(resp?.offers) ? (resp!.offers as OfferRow[]) : [];
    const missingTemplate = offersNow
      .filter((o) => String(o?.intelliwatt?.statusLabel ?? "") === "QUEUED")
      .filter((o) => {
        const tceStatus = String((o as any)?.intelliwatt?.trueCostEstimate?.status ?? "").toUpperCase();
        const templateAvailableRaw = (o as any)?.intelliwatt?.templateAvailable;
        // Target only "missing template" queueing, not "missing usage" queueing.
        // NOTE: do not coerce: Boolean(undefined) === false would incorrectly match legacy/partial payloads.
        return tceStatus === "MISSING_TEMPLATE" || templateAvailableRaw === false;
      })
      .filter((o) => Boolean((o as any)?.offerId))
      .slice(0, 6);

    if (missingTemplate.length <= 0) return;

    // Warmups may only START from the default landing view.
    // If the user has interacted with sort/filter/search, we must not start any background work.
    if (!warmupSessionActive && !allowWarmupKicksFromThisView) return;

    // Start the warmup session as soon as we know we need it (default landing view only).
    if (!warmupSessionActive) {
      setWarmupSessionActive(true);
      try {
        window.sessionStorage.setItem(`plans_warmup_active_v1:${warmupKey}`, "1");
      } catch {
        // ignore
      }
    }

    // Throttle is per-session warmup cycle (warmupKey), not per-filter:
    // changing search/filters should never reset or restart background warmups from this page.
    const sessionKey = `plans_template_prefetch_v3:${warmupKey}`;
    const now = Date.now();
    let lastKickAt: number | null = null;
    try {
      const raw = window.sessionStorage.getItem(sessionKey);
      const n = raw ? Number(raw) : Number.NaN;
      if (Number.isFinite(n)) lastKickAt = n;
    } catch {
      // ignore
    }

    // Avoid thrash: run at most once per ~75s while templates are missing.
    const kickEligible = lastKickAt == null || now - lastKickAt >= 75_000;
    if (!kickEligible) return;
    if (prefetchInFlightRef.current) return;

    try {
      window.sessionStorage.setItem(sessionKey, String(now));
    } catch {
      // ignore
    }

    prefetchInFlightRef.current = true;
    setPrefetchNote(`Parsing plan fact labels… (${missingTemplate.length} queued)`);

    const controller = new AbortController();
    const run = async () => {
      try {
        const params = new URLSearchParams();
        params.set("timeBudgetMs", "12000");
        params.set("maxOffers", String(Math.min(6, Math.max(1, missingTemplate.length))));
        await fetch(`/api/dashboard/plans/prefetch?${params.toString()}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ focusOfferIds: missingTemplate.map((o) => String((o as any).offerId)) }),
          signal: controller.signal,
        }).catch(() => null);
      } finally {
        prefetchInFlightRef.current = false;
        // Force a refresh so the UI can pick up newly linked templates.
        setRefreshNonce((n) => n + 1);
      }
    };

    run();
    return () => controller.abort();
  }, [resp?.ok, resp?.offers, warmupKey, ENABLE_PLANS_AUTO_WARMUPS, allowWarmupInBackground, warmupSessionActive]);

  // Fallback warm-up: if the user lands on /dashboard/plans before background warm-up ran,
  // kick the plan pipeline once per session and poll until queued clears (or timeout).
  useEffect(() => {
    if (!ENABLE_PLANS_AUTO_WARMUPS) return;
    if (!allowWarmupInBackground) return;
    if (!resp?.ok) return;
    if (!resp?.hasUsage) return;
    const offersNow = Array.isArray(resp?.offers) ? (resp!.offers as OfferRow[]) : [];
    const pendingCountNow = pendingCountFromResponse(resp);
    if (pendingCountNow <= 0) return;

    // Warmups may only START from the default landing view.
    // If the user has interacted with sort/filter/search, we must not start any background work.
    if (!warmupSessionActive && !allowWarmupKicksFromThisView) return;

    // Start the warmup session once we detect pending estimates (default landing view only).
    if (!warmupSessionActive) {
      setWarmupSessionActive(true);
      try {
        window.sessionStorage.setItem(`plans_warmup_active_v1:${warmupKey}`, "1");
      } catch {
        // ignore
      }
    }

    // Throttle is per-session warmup cycle (warmupKey), not per-filter:
    // changing search/filters should never reset or restart background warmups from this page.
    const sessionKey = `plans_pipeline_kick_v6:${warmupKey}`;
    const now = Date.now();
    let lastKickAt: number | null = null;
    try {
      const raw = window.sessionStorage.getItem(sessionKey);
      const n = raw ? Number(raw) : Number.NaN;
      if (Number.isFinite(n)) lastKickAt = n;
    } catch {
      // ignore
    }

    // Re-kick at most once per ~75s while there are pending estimates.
    // The pipeline is bounded (timeBudget + maxEstimatePlans) so it typically needs multiple runs.
    const kickEligible = lastKickAt == null || now - lastKickAt >= 75_000;
    if (kickEligible && !prefetchInFlightRef.current && now - lastPipelineKickAtRef.current >= 30_000) {
      pipelineKickRef.current = true;
      lastPipelineKickAtRef.current = now;

      prefetchInFlightRef.current = true;
      setPrefetchNote(`Preparing IntelliWatt calculations… (${pendingCountNow} pending)`);
      try {
        const params = new URLSearchParams();
        params.set("reason", "plans_fallback");
        // Keep each pipeline run short to avoid gateway/serverless timeouts; repeated runs are expected.
        // IMPORTANT: Vercel can 504 long-running pipeline kicks (we've seen ~25s do this in prod).
        params.set("timeBudgetMs", "12000");
        params.set("maxTemplateOffers", "6");
        // When showing ALL plans, allow a bit more per run, but stay conservative to keep runtime bounded.
        params.set("maxEstimatePlans", datasetMode ? "80" : "50");
        // Allow repeated short runs; server still enforces lock + cooldown.
        params.set("proactiveCooldownMs", "60000");
        params.set("fallbackCooldownMs", "15000");
        (async () => {
          try {
            const r = await fetch(`/api/dashboard/plans/pipeline?${params.toString()}`, {
              method: "POST",
              // Best-effort: avoid client disconnects aborting the request mid-flight.
              keepalive: true,
            });
            const j = await r.json().catch(() => null);
            setLastPipelineKickResult(j);
            const started = Boolean(j?.ok === true && j?.started === true);
            // Only throttle on a successful "started" run. If the call was blocked (cooldown/already_running)
            // or failed, allow a prompt retry in the next effect tick.
            if (started) {
              try {
                window.sessionStorage.setItem(sessionKey, String(now));
              } catch {
                // ignore
              }
            } else {
              const why = typeof j?.reason === "string" && j.reason ? j.reason : typeof j?.error === "string" ? j.error : null;
              if (why) setPrefetchNote(`Preparing IntelliWatt calculations… (${pendingCountNow} pending) · ${why}`);
            }
          } catch (e: any) {
            setLastPipelineKickResult({ ok: false, error: e?.message ?? String(e) });
          } finally {
            prefetchInFlightRef.current = false;
          }
        })();
      } catch {
        prefetchInFlightRef.current = false;
      }
    }

    // Poll until queued clears (or timeout), but NEVER overlap requests.
    if (pollTimerRef.current == null) {
      const startedAt = Date.now();
      const tick = () => {
        if (pollInFlightRef.current) return;
        if (document.visibilityState === "hidden") return;
        if (Date.now() - startedAt > 10 * 60_000) {
          // Stop after 10 minutes (pipeline runs are bounded and may require multiple kicks).
          if (pollTimerRef.current) window.clearInterval(pollTimerRef.current);
          pollTimerRef.current = null;
          prefetchInFlightRef.current = false;
          return;
        }

        pollInFlightRef.current = true;
        try {
          // Poll the same query the user is currently viewing (server-side paging/filtering).
          // This avoids the legacy dataset=1/pageSize=2000 call pattern which can take minutes.
          const qs = plansQueryStringRef.current || plansQueryString;
          // Poll must bypass any HTTP/disk caches; otherwise the UI can get stuck on stale responses.
          // Add a tiny cache-bust param that is NOT part of serverDatasetKey.
          const cacheBust = String(Date.now());
          fetch(`/api/dashboard/plans?${qs}&_poll=${encodeURIComponent(cacheBust)}`, { cache: "no-store" })
            .then((r) => r.json().catch(() => null))
            .then((j) => {
              if (!j || j.ok !== true) return;
              setResp(j);
              try {
                const ck = cacheKeyRef.current || cacheKey;
                window.sessionStorage.setItem(ck, JSON.stringify({ t: Date.now(), resp: j }));
              } catch {
                // ignore
              }
            })
            .catch(() => null)
            .finally(() => {
              pollInFlightRef.current = false;
            });
        } catch {
          pollInFlightRef.current = false;
        }
      };

      // Use interval scheduler, but tick() enforces inFlight + timeout.
      pollTimerRef.current = window.setInterval(tick, 15_000);
      // Kick once immediately.
      tick();
    }

    return () => {
      // keep timers running across renders; cleaned up in serverDatasetKey effect
    };
  }, [resp?.ok, resp?.hasUsage, resp?.offers, warmupKey, ENABLE_PLANS_AUTO_WARMUPS, allowWarmupInBackground, datasetMode, warmupSessionActive]);

  // Cleanup on unmount (defensive: prevents polling leaks if the component tree changes).
  useEffect(() => {
    return () => {
      if (pollTimerRef.current) window.clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
      if (pollStopTimerRef.current) window.clearTimeout(pollStopTimerRef.current);
      pollStopTimerRef.current = null;
    };
  }, []);

  const hasUsage = Boolean(resp?.ok && resp?.hasUsage);
  // Keep "has usage" sticky across refetches so the Sort dropdown doesn't temporarily lose
  // the "Best for you" option while a request is in-flight (e.g. switching sort to 1000 kWh).
  // If the home truly has no usage, this stays false.
  const hasUsageEverRef = useRef(false);
  useEffect(() => {
    if (hasUsage) hasUsageEverRef.current = true;
  }, [hasUsage]);
  const hasUsageForUi = hasUsage || hasUsageEverRef.current;
  const offersRaw = Array.isArray(resp?.offers) ? (resp!.offers as OfferRow[]) : [];
  // In datasetMode, the server returns the full dataset and we apply all sort/filter/paging client-side.
  const offers = useMemo(() => {
    if (!datasetMode) return offersRaw;
    let xs = offersRaw.slice();

    const qNorm = q.trim().toLowerCase();
    if (qNorm) {
      xs = xs.filter((o: any) => {
        const s = `${String(o?.supplierName ?? "")} ${String(o?.planName ?? "")}`.toLowerCase();
        return s.includes(qNorm);
      });
    }

    if (rateType !== "all") {
      xs = xs.filter((o: any) => {
        const rt = String(o?.rateType ?? "").trim().toLowerCase();
        if (!rt) return rateType === "unknown";
        if (rateType === "fixed") return rt.includes("fixed");
        if (rateType === "variable") return rt.includes("variable") || rt.includes("indexed");
        if (rateType === "renewable") return true; // renewable is a separate filter below
        if (rateType === "unknown") return false;
        return true;
      });
    }

    if (renewableMin > 0) {
      xs = xs.filter((o: any) => {
        const r = Number(o?.renewablePercent);
        return Number.isFinite(r) && r >= renewableMin;
      });
    }

    if (term !== "all") {
      xs = xs.filter((o: any) => {
        const m = Number(o?.termMonths);
        if (!Number.isFinite(m)) return false;
        if (term === "0-6") return m >= 0 && m <= 6;
        if (term === "7-12") return m >= 7 && m <= 12;
        if (term === "13-24") return m >= 13 && m <= 24;
        if (term === "25+") return m >= 25;
        return true;
      });
    }

    if (template === "available") {
      xs = xs.filter((o: any) => String(o?.intelliwatt?.statusLabel ?? "") === "AVAILABLE");
    }

    // Sorting (client-side)
    const num = (v: any) => (typeof v === "number" && Number.isFinite(v) ? v : Number.POSITIVE_INFINITY);
    const efl = (o: any, k: "avgPriceCentsPerKwh500" | "avgPriceCentsPerKwh1000" | "avgPriceCentsPerKwh2000") =>
      num(o?.efl?.[k]);
    const tce = (o: any) => o?.intelliwatt?.trueCostEstimate;
    const tceMonthly = (o: any) => {
      const est = tce(o);
      const st = String(est?.status ?? "").toUpperCase();
      if (st === "OK" || st === "APPROXIMATE") return num(est?.monthlyCostDollars);
      return Number.POSITIVE_INFINITY;
    };

    xs.sort((a: any, b: any) => {
      if (sort === "kwh500_asc") return efl(a, "avgPriceCentsPerKwh500") - efl(b, "avgPriceCentsPerKwh500");
      if (sort === "kwh2000_asc") return efl(a, "avgPriceCentsPerKwh2000") - efl(b, "avgPriceCentsPerKwh2000");
      if (sort === "term_asc") return num(a?.termMonths) - num(b?.termMonths);
      if (sort === "renewable_desc") return num(b?.renewablePercent) - num(a?.renewablePercent);
      if (sort === "best_for_you_proxy") return tceMonthly(a) - tceMonthly(b);
      return efl(a, "avgPriceCentsPerKwh1000") - efl(b, "avgPriceCentsPerKwh1000");
    });

    return xs;
  }, [datasetMode, offersRaw, q, rateType, term, renewableMin, template, sort]);

  const total = offers.length;
  const totalPages = datasetMode ? (total === 0 ? 0 : 1) : Math.max(0, Math.ceil(total / Math.max(1, pageSize)));
  const safePage = datasetMode ? 1 : totalPages === 0 ? 1 : Math.min(page, totalPages);
  const avgMonthlyKwh =
    resp?.ok && typeof (resp as any)?.avgMonthlyKwh === "number" && Number.isFinite((resp as any).avgMonthlyKwh)
      ? ((resp as any).avgMonthlyKwh as number)
      : null;

  useEffect(() => {
    if (totalPages === 0) return;
    if (page > totalPages) setPage(totalPages);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalPages]);

  // Universal truth: the customer UI never shows internal queue jargon (no "QUEUED").
  const hasUnavailable = false;
  const availableFilterOn = template === "available";

  // Default sort:
  // - if usage is present: "Best for you"
  // - if no usage: "Lowest @ 1000 kWh"
  // Only auto-apply until the user manually changes the sort dropdown.
  useEffect(() => {
    if (userTouchedSortRef.current) return;
    if (!resp?.ok) return;
    const desired: SortKey = resp?.hasUsage ? "best_for_you_proxy" : "kwh1000_asc";
    if (sort !== desired) setSort(desired);
  }, [resp?.ok, resp?.hasUsage, sort]);

  const recommendedOfferId = useMemo(() => {
    if (!hasUsage) return null;
    if (sort !== "best_for_you_proxy") return null;
    if (safePage !== 1) return null;
    const first = offers?.[0] as any;
    if (!first?.offerId) return null;
    const tce = first?.intelliwatt?.trueCostEstimate;
    if (!tce || tce.status !== "OK") return null;
    return String(first.offerId);
  }, [hasUsage, sort, safePage, offers]);

  const queuedCount = useMemo(
    () => offers.filter((o: any) => o?.intelliwatt?.statusLabel === "QUEUED").length,
    [offers],
  );
  const pendingCount = useMemo(() => {
    // Pending = expected to eventually compute (not UNSUPPORTED/NOT_COMPUTABLE).
    return offers.filter((o: any) => {
      if (String(o?.intelliwatt?.statusLabel ?? "") !== "QUEUED") return false;
      const tceStatus = String((o as any)?.intelliwatt?.trueCostEstimate?.status ?? "").toUpperCase();
      const tceReason = String((o as any)?.intelliwatt?.trueCostEstimate?.reason ?? "").toUpperCase();
      const isCacheMiss = tceStatus === "NOT_IMPLEMENTED" && tceReason === "CACHE_MISS";
      return !tceStatus || tceStatus === "QUEUED" || tceStatus === "MISSING_TEMPLATE" || isCacheMiss;
    }).length;
  }, [offers]);
  const isStillWorking = Boolean(loading || autoPreparing);
  const showRecommendedBadge = Boolean(recommendedOfferId && !isStillWorking);
  const showCalcBot =
    Boolean(hasUsage && sort === "best_for_you_proxy" && (isStillWorking || pendingCount > 0));

  const defaultCalcMsg =
    "I'm calculating all your options using your actual usage to determine which plan is best based on your energy usage habits.\n\nYour results will be available soon.";
  const [calcBotMsg, setCalcBotMsg] = useState<string>(defaultCalcMsg);
  const calcBotLoadedRef = useRef(false);

  useEffect(() => {
    if (!showCalcBot) return;
    if (calcBotLoadedRef.current) return;
    calcBotLoadedRef.current = true;
    const controller = new AbortController();
    async function run() {
      try {
        const r = await fetch(`/api/bot/message?path=${encodeURIComponent("/dashboard/plans")}&event=calculating_best`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const j = await r.json().catch(() => null);
        const msg = j?.ok && typeof j?.message === "string" ? String(j.message).trim() : "";
        if (msg) setCalcBotMsg(msg);
      } catch {
        // keep default
      }
    }
    run();
    return () => controller.abort();
  }, [showCalcBot]);

  return (
    <div className="flex flex-col gap-6">
      <IntelliwattBotPopup
        visible={showCalcBot}
        storageKey="iw_bot_plans_calc_v1"
        ttlMs={15 * 60 * 1000}
        message={calcBotMsg}
      />
      <div className="sticky top-0 z-20 -mx-4 px-4 pt-2 pb-3 bg-brand-white/90 backdrop-blur border-b border-brand-cyan/15">
        <div className="mx-auto max-w-5xl">
          <div className="rounded-3xl border border-brand-cyan/25 bg-brand-navy p-4 shadow-[0_18px_40px_rgba(10,20,60,0.35)]">
            {/* Always-visible tiny bar (lets user collapse the whole search/filter UI) */}
            <div className="flex items-center justify-between gap-2">
              {headerCollapsed ? (
                <div className="flex items-center gap-2 min-w-0">
                  <button
                    type="button"
                    className="rounded-full border border-brand-cyan/25 bg-brand-white/5 px-3 py-2 text-xs font-semibold text-brand-cyan hover:bg-brand-white/10"
                    onClick={() => openHeader("search")}
                  >
                    Search
                  </button>
                  <button
                    type="button"
                    className="rounded-full border border-brand-cyan/25 bg-brand-white/5 px-3 py-2 text-xs font-semibold text-brand-cyan hover:bg-brand-white/10"
                    onClick={() => openHeader("filters")}
                  >
                    Filters
                  </button>
                  <div className="ml-1 truncate text-xs text-brand-cyan/60">
                    {loading ? (
                      <span>Loading…</span>
                    ) : (
                      <span>
                        Showing <span className="text-brand-white font-semibold">{offers.length}</span> of{" "}
                        <span className="text-brand-white font-semibold">{total}</span>
                      </span>
                    )}
                  </div>
                </div>
              ) : (
                <div className="text-xs text-brand-cyan/60">Search & filters</div>
              )}

              <button
                type="button"
                className="shrink-0 rounded-full border border-brand-cyan/25 bg-brand-white/5 px-3 py-2 text-xs font-semibold text-brand-cyan hover:bg-brand-white/10"
                onClick={() => setCollapsed(!headerCollapsed)}
              >
                {headerCollapsed ? "Expand" : "Collapse"}
              </button>
            </div>

            {headerCollapsed ? null : (
              <>
            {/* Mobile: collapsible (so cards are visible) */}
            <div className="md:hidden">
              <div className="flex items-center justify-between gap-2">
                <div className="inline-flex rounded-full border border-brand-cyan/25 bg-brand-white/5 p-1">
                  <button
                    type="button"
                    className={`rounded-full px-3 py-2 text-xs font-semibold ${
                      mobilePanel === "search" ? "bg-brand-white/10 text-brand-white" : "text-brand-cyan"
                    }`}
                    onClick={() => setMobilePanel((p) => (p === "search" ? "none" : "search"))}
                  >
                    Search
                  </button>
                  <button
                    type="button"
                    className={`rounded-full px-3 py-2 text-xs font-semibold ${
                      mobilePanel === "filters" ? "bg-brand-white/10 text-brand-white" : "text-brand-cyan"
                    }`}
                    onClick={() => setMobilePanel((p) => (p === "filters" ? "none" : "filters"))}
                  >
                    Filters
                  </button>
                </div>

                {mobilePanel !== "none" ? (
                  <button
                    type="button"
                    className="rounded-full border border-brand-cyan/25 bg-brand-white/5 px-3 py-2 text-xs font-semibold text-brand-cyan hover:bg-brand-white/10"
                    onClick={() => setMobilePanel("none")}
                  >
                    Close
                  </button>
                ) : null}
              </div>

              {mobilePanel === "search" ? (
                <div className="mt-3">
                  <label className="text-[0.68rem] font-semibold uppercase tracking-[0.28em] text-brand-cyan/65">
                    Search
                  </label>
                  <input
                    value={q}
                    onChange={(e) => {
                      markUserTouchedSearchOrFilters();
                      setQ(e.target.value);
                      setPage(1);
                    }}
                    placeholder="Plan name, provider…"
                    className="mt-2 w-full rounded-2xl border border-brand-cyan/25 bg-brand-white/5 px-4 py-2 text-sm text-brand-white placeholder:text-brand-cyan/40 outline-none focus:border-brand-blue/60"
                  />
                </div>
              ) : null}

              {mobilePanel === "filters" ? (
                <div className="mt-3 grid grid-cols-1 gap-3">
                  <div>
                    <label className="text-[0.68rem] font-semibold uppercase tracking-[0.28em] text-brand-cyan/65">
                      Sort
                    </label>
                    <select
                      value={sort}
                      onChange={(e) => {
                        markUserTouchedSearchOrFilters();
                        userTouchedSortRef.current = true;
                        setSort(e.target.value as any);
                        setPage(1);
                      }}
                      className="mt-2 w-full rounded-2xl border border-brand-cyan/25 bg-brand-white/5 px-3 py-2 text-xs text-brand-white outline-none focus:border-brand-blue/60 focus:bg-white focus:text-brand-navy"
                    >
                      {hasUsageForUi ? (
                        <option className="text-brand-navy" value="best_for_you_proxy">
                          Best for you
                        </option>
                      ) : null}
                      <option className="text-brand-navy" value="kwh1000_asc">
                        Lowest @ 1000 kWh
                      </option>
                      <option className="text-brand-navy" value="kwh500_asc">
                        Lowest @ 500 kWh
                      </option>
                      <option className="text-brand-navy" value="kwh2000_asc">
                        Lowest @ 2000 kWh
                      </option>
                      <option className="text-brand-navy" value="term_asc">
                        Shortest term
                      </option>
                      <option className="text-brand-navy" value="renewable_desc">
                        Highest renewable
                      </option>
                    </select>
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label className="text-[0.68rem] font-semibold uppercase tracking-[0.28em] text-brand-cyan/65">
                        Rate
                      </label>
                      <select
                        value={rateType}
                        onChange={(e) => {
                          markUserTouchedSearchOrFilters();
                          setRateType(e.target.value as any);
                          setPage(1);
                        }}
                        className="mt-2 w-full rounded-2xl border border-brand-cyan/25 bg-brand-white/5 px-3 py-2 text-xs text-brand-white outline-none focus:border-brand-blue/60 focus:bg-white focus:text-brand-navy"
                      >
                        <option className="text-brand-navy" value="all">
                          All
                        </option>
                        <option className="text-brand-navy" value="fixed">
                          Fixed
                        </option>
                        <option className="text-brand-navy" value="variable">
                          Variable
                        </option>
                        <option className="text-brand-navy" value="renewable">
                          Renewable
                        </option>
                        <option className="text-brand-navy" value="unknown">
                          Unknown
                        </option>
                      </select>
                    </div>

                    <div>
                      <label className="text-[0.68rem] font-semibold uppercase tracking-[0.28em] text-brand-cyan/65">
                        Term
                      </label>
                      <select
                        value={term}
                        onChange={(e) => {
                          markUserTouchedSearchOrFilters();
                          setTerm(e.target.value as any);
                          setPage(1);
                        }}
                        className="mt-2 w-full rounded-2xl border border-brand-cyan/25 bg-brand-white/5 px-3 py-2 text-xs text-brand-white outline-none focus:border-brand-blue/60 focus:bg-white focus:text-brand-navy"
                      >
                        <option className="text-brand-navy" value="all">
                          All
                        </option>
                        <option className="text-brand-navy" value="0-6">
                          ≤ 6 mo
                        </option>
                        <option className="text-brand-navy" value="7-12">
                          7–12 mo
                        </option>
                        <option className="text-brand-navy" value="13-24">
                          13–24 mo
                        </option>
                        <option className="text-brand-navy" value="25+">
                          25+ mo
                        </option>
                      </select>
                    </div>

                    <div>
                      <label className="text-[0.68rem] font-semibold uppercase tracking-[0.28em] text-brand-cyan/65">
                        Green
                      </label>
                      <select
                        value={renewableMin}
                        onChange={(e) => {
                          markUserTouchedSearchOrFilters();
                          setRenewableMin(Number(e.target.value) as any);
                          setPage(1);
                        }}
                        className="mt-2 w-full rounded-2xl border border-brand-cyan/25 bg-brand-white/5 px-3 py-2 text-xs text-brand-white outline-none focus:border-brand-blue/60 focus:bg-white focus:text-brand-navy"
                      >
                        <option className="text-brand-navy" value={0}>
                          Any
                        </option>
                        <option className="text-brand-navy" value={50}>
                          50%+
                        </option>
                        <option className="text-brand-navy" value={100}>
                          100%
                        </option>
                      </select>
                    </div>

                    <div className="flex items-end">
                      <div className="w-full">
                        <label className="text-[0.68rem] font-semibold uppercase tracking-[0.28em] text-brand-cyan/65">
                          IntelliWatt
                        </label>
                        <label className="mt-2 flex items-center gap-2 text-xs text-brand-cyan/75 select-none">
                          <input
                            type="checkbox"
                            checked={template === "available"}
                            onChange={(e) => {
                              markUserTouchedSearchOrFilters();
                              setTemplate(e.target.checked ? "available" : "all");
                              setPage(1);
                            }}
                            className="h-4 w-4 rounded border-brand-cyan/40 bg-brand-white/10"
                          />
                          Show only AVAILABLE templates
                        </label>
                      </div>
                    </div>

                    {/* Renter selection moved to Address save (QuickAddressEntry). */}
                  </div>
                </div>
              ) : null}
            </div>

            {/* Desktop: grid (prevents overlap / label collisions) */}
            <div className="hidden md:block">
              <div className="grid grid-cols-[minmax(0,1fr)_260px] items-end gap-3">
                <div className="min-w-0">
                  <label className="text-[0.68rem] font-semibold uppercase tracking-[0.28em] text-brand-cyan/65">
                    Search
                  </label>
                  <input
                    value={q}
                    onChange={(e) => {
                      markUserTouchedSearchOrFilters();
                      setQ(e.target.value);
                      setPage(1);
                    }}
                    placeholder="Plan name, provider…"
                    className="mt-2 w-full rounded-2xl border border-brand-cyan/25 bg-brand-white/5 px-4 py-2 text-sm text-brand-white placeholder:text-brand-cyan/40 outline-none focus:border-brand-blue/60"
                  />
                </div>

                <div className="min-w-0">
                  <label className="text-[0.68rem] font-semibold uppercase tracking-[0.28em] text-brand-cyan/65">
                    Sort
                  </label>
                  <select
                    value={sort}
                    onChange={(e) => {
                      markUserTouchedSearchOrFilters();
                      userTouchedSortRef.current = true;
                      setSort(e.target.value as any);
                      setPage(1);
                    }}
                    className="mt-2 w-full rounded-2xl border border-brand-cyan/25 bg-brand-white/5 px-3 py-2 text-xs text-brand-white outline-none focus:border-brand-blue/60 focus:bg-white focus:text-brand-navy"
                  >
                    {hasUsageForUi ? (
                      <option className="text-brand-navy" value="best_for_you_proxy">
                        Best for you
                      </option>
                    ) : null}
                    <option className="text-brand-navy" value="kwh1000_asc">
                      Lowest @ 1000 kWh
                    </option>
                    <option className="text-brand-navy" value="kwh500_asc">
                      Lowest @ 500 kWh
                    </option>
                    <option className="text-brand-navy" value="kwh2000_asc">
                      Lowest @ 2000 kWh
                    </option>
                    <option className="text-brand-navy" value="term_asc">
                      Shortest term
                    </option>
                    <option className="text-brand-navy" value="renewable_desc">
                      Highest renewable
                    </option>
                  </select>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-5 gap-2">
                <div>
                  <label className="text-[0.68rem] font-semibold uppercase tracking-[0.28em] text-brand-cyan/65">
                    Rate
                  </label>
                  <select
                    value={rateType}
                    onChange={(e) => {
                      markUserTouchedSearchOrFilters();
                      setRateType(e.target.value as any);
                      setPage(1);
                    }}
                    className="mt-2 w-full rounded-2xl border border-brand-cyan/25 bg-brand-white/5 px-3 py-2 text-xs text-brand-white outline-none focus:border-brand-blue/60 focus:bg-white focus:text-brand-navy"
                  >
                    <option className="text-brand-navy" value="all">
                      All
                    </option>
                    <option className="text-brand-navy" value="fixed">
                      Fixed
                    </option>
                    <option className="text-brand-navy" value="variable">
                      Variable
                    </option>
                    <option className="text-brand-navy" value="renewable">
                      Renewable
                    </option>
                    <option className="text-brand-navy" value="unknown">
                      Unknown
                    </option>
                  </select>
                </div>

                <div>
                  <label className="text-[0.68rem] font-semibold uppercase tracking-[0.28em] text-brand-cyan/65">
                    Term
                  </label>
                  <select
                    value={term}
                    onChange={(e) => {
                      markUserTouchedSearchOrFilters();
                      setTerm(e.target.value as any);
                      setPage(1);
                    }}
                    className="mt-2 w-full rounded-2xl border border-brand-cyan/25 bg-brand-white/5 px-3 py-2 text-xs text-brand-white outline-none focus:border-brand-blue/60 focus:bg-white focus:text-brand-navy"
                  >
                    <option className="text-brand-navy" value="all">
                      All
                    </option>
                    <option className="text-brand-navy" value="0-6">
                      ≤ 6 mo
                    </option>
                    <option className="text-brand-navy" value="7-12">
                      7–12 mo
                    </option>
                    <option className="text-brand-navy" value="13-24">
                      13–24 mo
                    </option>
                    <option className="text-brand-navy" value="25+">
                      25+ mo
                    </option>
                  </select>
                </div>

                <div>
                  <label className="text-[0.68rem] font-semibold uppercase tracking-[0.28em] text-brand-cyan/65">
                    Green
                  </label>
                  <select
                    value={renewableMin}
                    onChange={(e) => {
                      markUserTouchedSearchOrFilters();
                      setRenewableMin(Number(e.target.value) as any);
                      setPage(1);
                    }}
                    className="mt-2 w-full rounded-2xl border border-brand-cyan/25 bg-brand-white/5 px-3 py-2 text-xs text-brand-white outline-none focus:border-brand-blue/60 focus:bg-white focus:text-brand-navy"
                  >
                    <option className="text-brand-navy" value={0}>
                      Any
                    </option>
                    <option className="text-brand-navy" value={50}>
                      50%+
                    </option>
                    <option className="text-brand-navy" value={100}>
                      100%
                    </option>
                  </select>
                </div>

                <div className="flex items-end">
                  <div className="w-full">
                    <label className="text-[0.68rem] font-semibold uppercase tracking-[0.28em] text-brand-cyan/65">
                      IntelliWatt
                    </label>
                    <label className="mt-2 flex items-center gap-2 text-xs text-brand-cyan/75 select-none">
                      <input
                        type="checkbox"
                        checked={template === "available"}
                        onChange={(e) => {
                          markUserTouchedSearchOrFilters();
                          setTemplate(e.target.checked ? "available" : "all");
                          setPage(1);
                        }}
                        className="h-4 w-4 rounded border-brand-cyan/40 bg-brand-white/10"
                      />
                      Show only AVAILABLE templates
                    </label>
                  </div>
                </div>

                {/* Renter selection moved to Address save (QuickAddressEntry). */}
                {/* Renter selection moved to Address save (QuickAddressEntry). */}
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs text-brand-cyan/70">
              <div>
                {loading ? (
                  <span>Loading plans…</span>
                ) : error ? (
                  <span className="text-amber-200">{error}</span>
                ) : resp?.message ? (
                  <span>{resp.message}</span>
                ) : prefetchNote ? (
                  <span className="text-brand-cyan/80">
                    {prefetchNote}
                    {lastPipelineKickResult ? (
                      <span className="ml-2 text-brand-cyan/55">
                        (pipeline:{" "}
                        {lastPipelineKickResult?.ok === true
                          ? lastPipelineKickResult?.started === true
                            ? "started"
                            : String(lastPipelineKickResult?.reason ?? "not_started")
                          : String(lastPipelineKickResult?.error ?? "error")}
                        )
                      </span>
                    ) : null}
                  </span>
                ) : (
                  <span>
                    Showing <span className="text-brand-white font-semibold">{offers.length}</span> of{" "}
                    <span className="text-brand-white font-semibold">{total}</span>
                  </span>
                )}
              </div>

              <div className="flex items-center gap-3">
                <div className="text-brand-cyan/60">
                  Usage:{" "}
                  <span className="text-brand-white font-semibold">
                    {hasUsage ? resp?.usageSummary?.source ?? "Available" : "Not connected"}
                  </span>
                </div>
                <div className="hidden sm:block h-4 w-px bg-brand-cyan/15" />
                <div className="flex items-center gap-2">
                  <span className="text-brand-cyan/60">Page size</span>
                  <select
                    value={pageSize}
                    onChange={(e) => {
                      markUserTouchedSearchOrFilters();
                      userTouchedPageSizeRef.current = true;
                      setPageSize(Number(e.target.value) as any);
                      setPage(1);
                    }}
                    className="rounded-full border border-brand-cyan/25 bg-brand-white/5 px-2 py-1 text-xs text-brand-white outline-none focus:border-brand-blue/60 focus:bg-white focus:text-brand-navy"
                  >
                    <option className="text-brand-navy" value={2000}>
                      All
                    </option>
                    <option className="text-brand-navy" value={10}>
                      10
                    </option>
                    <option className="text-brand-navy" value={20}>
                      20
                    </option>
                    <option className="text-brand-navy" value={50}>
                      50
                    </option>
                  </select>
                </div>
              </div>
            </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Removed the "Top 5" strip: sorting the main plan list is the source of truth. */}

      {hasUnavailable && !availableFilterOn ? (
        <div className="mx-auto w-full max-w-5xl">
          <div className="rounded-2xl border border-brand-cyan/20 bg-brand-navy px-4 py-3 text-brand-cyan/75">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-brand-white">
                  Some plans are missing IntelliWatt templates
                </div>
                <div className="mt-0.5 text-xs text-brand-cyan/70">
                  You can still compare provider estimates, but IntelliWatt true-cost ranking requires a parsed EFL template.
                  <span className="ml-2 text-brand-cyan/55">Templates are added continuously.</span>
                </div>
              </div>
              <button
                className="shrink-0 rounded-full border border-brand-cyan/25 bg-brand-white/5 px-3 py-2 text-xs font-semibold text-brand-cyan hover:bg-brand-white/10"
                onClick={() => {
                  markUserTouchedSearchOrFilters();
                  setTemplate("available");
                  setPage(1);
                }}
              >
                Show AVAILABLE only
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="mx-auto w-full max-w-5xl">
        {isStillWorking ? (
          <div className="mb-4 rounded-3xl border border-brand-cyan/20 bg-brand-navy px-5 py-4 text-brand-cyan/80 shadow-[0_18px_40px_rgba(10,20,60,0.22)]">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 h-4 w-4 shrink-0 rounded-full border-2 border-brand-cyan/30 border-t-brand-blue animate-spin" />
              <div className="min-w-0">
                <div className="text-sm font-semibold text-brand-white">Calculating your best plan…</div>
                <div className="mt-1 text-xs text-brand-cyan/75">
                  We’re loading all plan options and applying IntelliWatt calculations using your usage.
                  {pendingCount > 0 ? (
                    <span className="ml-2 text-brand-cyan/60">({pendingCount} still processing)</span>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        ) : null}
        {resp == null || (resp?.ok !== true && loading) ? (
          <div className="rounded-3xl border border-brand-cyan/20 bg-brand-navy p-8 text-brand-cyan/75">
            Loading plans…
          </div>
        ) : resp?.ok !== true ? (
          <div className="rounded-3xl border border-amber-400/25 bg-brand-navy p-8 text-amber-200">
            {error ? `Error: ${error}` : resp?.message ? resp.message : "Unable to load plans."}
          </div>
        ) : offers.length === 0 ? (
          <div className="rounded-3xl border border-brand-cyan/20 bg-brand-navy p-8 text-brand-cyan/75">
            No plans found for your current filters.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {offers.map((o) => (
              <OfferCard
                key={o.offerId}
                offer={o}
                recommended={showRecommendedBadge ? o.offerId === recommendedOfferId : false}
              />
            ))}
          </div>
        )}

        <div className="mt-6 flex items-center justify-between gap-3">
          <button
            disabled={loading || safePage <= 1 || totalPages <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="rounded-full border border-brand-cyan/25 bg-brand-navy px-4 py-2 text-sm font-semibold text-brand-cyan disabled:opacity-40"
          >
            Prev
          </button>
          <div className="text-sm text-brand-navy/70">
            Page <span className="font-semibold text-brand-navy">{safePage}</span>
            {totalPages ? (
              <>
                {" "}
                of <span className="font-semibold text-brand-navy">{totalPages}</span>
              </>
            ) : null}
          </div>
          <button
            disabled={loading || totalPages === 0 || safePage >= totalPages}
            onClick={() => setPage((p) => p + 1)}
            className="rounded-full border border-brand-cyan/25 bg-brand-navy px-4 py-2 text-sm font-semibold text-brand-cyan disabled:opacity-40"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}

