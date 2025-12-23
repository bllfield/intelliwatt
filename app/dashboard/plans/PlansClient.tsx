"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
  const [q, setQ] = useState("");
  const [rateType, setRateType] = useState<"all" | "fixed" | "variable" | "renewable" | "unknown">("all");
  const [term, setTerm] = useState<"all" | "0-6" | "7-12" | "13-24" | "25+">("all");
  const [renewableMin, setRenewableMin] = useState<0 | 50 | 100>(0);
  const [template, setTemplate] = useState<"all" | "available">("all");
  // Tri-state: don't fetch until we have a stable value (prevents double-fetch on initial localStorage hydrate).
  const [isRenter, setIsRenter] = useState<boolean | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const raw = window.localStorage.getItem("dashboard_plans_is_renter");
      if (raw === "true") return true;
      if (raw === "false") return false;
    } catch {
      // Some mobile browsers (or private mode) can block localStorage.
      // Keep tri-state behavior: return null and let the effect below choose a stable default.
    }
    return null;
  });
  const [sort, setSort] = useState<SortKey>("kwh1000_asc");
  const userTouchedSortRef = useRef(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<10 | 20 | 50>(20);
  const [refreshNonce, setRefreshNonce] = useState(0);

  const [loading, setLoading] = useState(false);
  const [resp, setResp] = useState<ApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reqSeqRef = useRef(0);

  const [prefetchNote, setPrefetchNote] = useState<string | null>(null);
  const prefetchInFlightRef = useRef(false);
  const [autoPreparing, setAutoPreparing] = useState(false);
  const pipelineKickRef = useRef(false);
  const pollTimerRef = useRef<number | null>(null);
  const pollStopTimerRef = useRef<number | null>(null);

  const [mobilePanel, setMobilePanel] = useState<"none" | "search" | "filters">("none");
  const [headerCollapsed, setHeaderCollapsed] = useState(false);
  const [approxKwhPerMonth, setApproxKwhPerMonth] = useState<500 | 750 | 1000 | 1250 | 2000>(1000);
  const bestBucket = useMemo(() => selectedBestBucket(sort), [sort]);

  // Server dataset identity: only changes when inputs that affect the actual offer dataset changes.
  // Sort/filter/pagination should be client-only (no fetch).
  const serverDatasetKey = useMemo(
    () =>
      JSON.stringify({
        isRenter,
      }),
    [isRenter],
  );

  // Lightweight client cache so back/forward navigation instantly shows the last processed dataset
  // instead of refetching.
  const cacheKey = useMemo(() => `dashboard_plans_dataset_v1:${serverDatasetKey}`, [serverDatasetKey]);
  // This is NOT the plan-engine cache (engine outputs are persisted in the WattBuy Offers DB).
  // This is only a UX cache for the API response to avoid flashing loading states on navigation.
  // Keep it long-lived; correctness still comes from server-side canonical inputs + DB-stored estimates.
  const cacheTtlMs = 60 * 60 * 1000;

  useEffect(() => {
    if (isRenter === null) return; // wait for stable dataset identity
    try {
      const raw = window.sessionStorage.getItem(cacheKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as { t: number; resp: ApiResponse };
      if (!parsed || typeof parsed.t !== "number" || !parsed.resp) return;
      if (Date.now() - parsed.t > cacheTtlMs) return;
      setResp(parsed.resp);
      setError(null);
      setLoading(false);
    } catch {
      // ignore cache failures
    }
  }, [cacheKey, cacheTtlMs, isRenter]);

  useEffect(() => {
    prefetchInFlightRef.current = false;
    setPrefetchNote(null);
    pipelineKickRef.current = false;
    if (pollTimerRef.current) window.clearInterval(pollTimerRef.current);
    pollTimerRef.current = null;
    if (pollStopTimerRef.current) window.clearTimeout(pollStopTimerRef.current);
    pollStopTimerRef.current = null;
  }, [serverDatasetKey]);

  useEffect(() => {
    if (isRenter !== null) return;
    try {
      const raw = window.localStorage.getItem("dashboard_plans_is_renter");
      if (raw === "true") setIsRenter(true);
      else setIsRenter(false); // default when unset or explicitly "false"
    } catch {
      // localStorage not accessible (mobile/private mode). Proceed with default.
      setIsRenter(false);
    }
  }, [isRenter]);

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

  // Fetch a single large dataset once; all sort/filter/paging happens client-side.
  const baseParams = useMemo(() => {
    const params: Record<string, string> = {
      dataset: "1",
      pageSize: "2000",
      sort: "kwh1000_asc",
      // Used only to force a reload after background prefetch runs.
      _r: String(refreshNonce),
    };
    if (isRenter !== null) params.isRenter = String(isRenter);
    return params;
  }, [refreshNonce, isRenter]);

  const plansQueryString = useMemo(() => buildQuery(baseParams as any), [baseParams]);

  useEffect(() => {
    if (isRenter === null) return; // wait for stable renter value

    // If we have a fresh cached response for this dataset and we're not forcing a refresh,
    // skip the network call entirely. This prevents "recalculations" on back/forward navigation.
    if (refreshNonce === 0) {
      try {
        const raw = window.sessionStorage.getItem(cacheKey);
        if (raw) {
          const parsed = JSON.parse(raw) as { t: number; resp: ApiResponse };
          if (parsed && typeof parsed.t === "number" && parsed.resp && Date.now() - parsed.t <= cacheTtlMs) {
            setResp(parsed.resp);
            setError(null);
            setLoading(false);
            return;
          }
        }
      } catch {
        // ignore
      }
    }

    const controller = new AbortController();
    const mySeq = ++reqSeqRef.current;
    setLoading(true);
    setError(null);

    async function run() {
      try {
        const r = await fetch(`/api/dashboard/plans?${plansQueryString}`, { signal: controller.signal });
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
      } finally {
        if (controller.signal.aborted) return;
        if (mySeq !== reqSeqRef.current) return;
        setLoading(false);
      }
    }

    run();
    return () => controller.abort();
  }, [plansQueryString, isRenter, refreshNonce, cacheKey, cacheTtlMs]);

  // IMPORTANT: /dashboard/plans must never trigger/retrigger the plan pipeline.
  // Pipeline warm-up happens proactively (dashboard bootstrap + usage ingest).
  // Here we only display a "preparing" UI if estimates are still QUEUED.
  useEffect(() => {
    if (!resp?.ok) return;
    const offersNow = Array.isArray(resp?.offers) ? (resp!.offers as OfferRow[]) : [];
    const queuedEstimates = offersNow.filter(
      (o) =>
        o?.intelliwatt?.statusLabel === "AVAILABLE" &&
        String((o as any)?.intelliwatt?.trueCostEstimate?.status ?? "").toUpperCase() === "QUEUED",
    );
    const isCalculating = queuedEstimates.length > 0;
    setAutoPreparing(isCalculating);
    setPrefetchNote(isCalculating ? `Preparing IntelliWatt calculations… (${queuedEstimates.length} pending)` : null);
  }, [resp?.ok, resp?.offers]);

  // Fallback warm-up: if the user lands on /dashboard/plans before background warm-up ran,
  // kick the plan pipeline once per session and poll until queued clears (or timeout).
  useEffect(() => {
    if (isRenter === null) return;
    if (!resp?.ok) return;
    if (!resp?.hasUsage) return;
    const offersNow = Array.isArray(resp?.offers) ? (resp!.offers as OfferRow[]) : [];
    const queuedCountNow = offersNow.filter(
      (o) =>
        o?.intelliwatt?.statusLabel === "AVAILABLE" &&
        String((o as any)?.intelliwatt?.trueCostEstimate?.status ?? "").toUpperCase() === "QUEUED",
    ).length;
    if (queuedCountNow <= 0) return;

    const sessionKey = `plans_pipeline_kick_v2:${serverDatasetKey}`;
    try {
      const raw = window.sessionStorage.getItem(sessionKey);
      if (raw) {
        pipelineKickRef.current = true;
      }
    } catch {
      // ignore
    }

    if (!pipelineKickRef.current) {
      pipelineKickRef.current = true;
      try {
        window.sessionStorage.setItem(sessionKey, String(Date.now()));
      } catch {
        // ignore
      }

      // Kick pipeline in the background (best-effort).
      prefetchInFlightRef.current = true;
      setPrefetchNote(`Preparing IntelliWatt calculations… (${queuedCountNow} pending)`);
      try {
        const params = new URLSearchParams();
        params.set("reason", "plans_page_fallback");
        params.set("timeBudgetMs", "25000");
        params.set("maxTemplateOffers", "6");
        params.set("maxEstimatePlans", "50");
        params.set("isRenter", String(isRenter));
        fetch(`/api/dashboard/plans/pipeline?${params.toString()}`, { method: "POST" }).catch(() => null);
      } catch {
        // ignore
      }
    }

    // Poll the offers dataset until queued clears (or timeout).
    if (pollTimerRef.current == null) {
      pollTimerRef.current = window.setInterval(() => {
        if (document.visibilityState === "hidden") return;
        try {
          const usp = new URLSearchParams();
          usp.set("dataset", "1");
          usp.set("pageSize", "2000");
          usp.set("sort", "kwh1000_asc");
          usp.set("isRenter", String(isRenter));
          usp.set("_r", String(Date.now())); // bypass browser cache; sessionStorage will still store latest
          fetch(`/api/dashboard/plans?${usp.toString()}`)
            .then((r) => r.json().catch(() => null))
            .then((j) => {
              if (!j || j.ok !== true) return;
              setResp(j);
              try {
                window.sessionStorage.setItem(cacheKey, JSON.stringify({ t: Date.now(), resp: j }));
              } catch {
                // ignore
              }
            })
            .catch(() => null);
        } catch {
          // ignore
        }
      }, 8000);

      // Hard stop after 2 minutes so we never spin forever.
      pollStopTimerRef.current = window.setTimeout(() => {
        if (pollTimerRef.current) window.clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
        prefetchInFlightRef.current = false;
      }, 120_000);
    }

    return () => {
      // keep timers running across renders; cleaned up in serverDatasetKey effect
    };
  }, [resp?.ok, resp?.hasUsage, resp?.offers, isRenter, serverDatasetKey, cacheKey]);

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
  const datasetOffers = Array.isArray(resp?.offers) ? resp!.offers! : [];
  const avgMonthlyKwh =
    resp?.ok && typeof (resp as any)?.avgMonthlyKwh === "number" && Number.isFinite((resp as any).avgMonthlyKwh)
      ? ((resp as any).avgMonthlyKwh as number)
      : null;

  const normalizedQ = q.trim().toLowerCase();

  const filteredSortedAll = useMemo(() => {
    let out = datasetOffers.slice();

    // Search
    if (normalizedQ) {
      out = out.filter((o: any) => {
        const supplier = String(o?.supplierName ?? "").toLowerCase();
        const plan = String(o?.planName ?? "").toLowerCase();
        return supplier.includes(normalizedQ) || plan.includes(normalizedQ);
      });
    }

    // Filters
    if (rateType !== "all") {
      out = out.filter((o: any) => {
        const rt = String(o?.rateType ?? "").toUpperCase();
        const renewablePct = typeof o?.renewablePercent === "number" && Number.isFinite(o.renewablePercent) ? (o.renewablePercent as number) : null;
        if (rateType === "fixed") return rt === "FIXED";
        if (rateType === "variable") return rt === "VARIABLE";
        if (rateType === "renewable") return renewablePct != null && renewablePct >= 100;
        if (rateType === "unknown") return !rt;
        return true;
      });
    }

    if (term !== "all") {
      out = out.filter((o: any) => {
        const m = typeof o?.termMonths === "number" && Number.isFinite(o.termMonths) ? (o.termMonths as number) : null;
        if (m == null) return false;
        if (term === "0-6") return m >= 0 && m <= 6;
        if (term === "7-12") return m >= 7 && m <= 12;
        if (term === "13-24") return m >= 13 && m <= 24;
        if (term === "25+") return m >= 25;
        return true;
      });
    }

    if (renewableMin > 0) {
      out = out.filter((o: any) => {
        const p = typeof o?.renewablePercent === "number" && Number.isFinite(o.renewablePercent) ? (o.renewablePercent as number) : null;
        return p != null && p >= renewableMin;
      });
    }

    if (template === "available") {
      out = out.filter((o: any) => String(o?.intelliwatt?.statusLabel ?? "") === "AVAILABLE");
    }

    // Sort
    const withIdx = out.map((o, idx) => ({ o, idx }));

    const numOrInf = (n: any) => {
      const v = typeof n === "number" ? n : Number(n);
      return Number.isFinite(v) ? v : Number.POSITIVE_INFINITY;
    };

    const numOrNegInf = (n: any) => {
      const v = typeof n === "number" ? n : Number(n);
      return Number.isFinite(v) ? v : Number.NEGATIVE_INFINITY;
    };

    const keyFn = (o: any) => {
      if (sort === "term_asc") return numOrInf(o?.termMonths);
      if (sort === "renewable_desc") return numOrNegInf(o?.renewablePercent);

      if (sort === "best_for_you_proxy") {
        if (hasUsage) {
          const tce = o?.intelliwatt?.trueCostEstimate;
          if (tce?.status !== "OK") return Number.POSITIVE_INFINITY;
          return numOrInf(tce?.monthlyCostDollars);
        }
        const bucket = pickNearestEflBucket(approxKwhPerMonth ?? 1000);
        return numOrInf(pickMetricCentsPerKwhForBucket(o, bucket as any));
      }

      if (sort === "kwh500_asc") return numOrInf(pickMetricCentsPerKwhForBucket(o, 500));
      if (sort === "kwh2000_asc") return numOrInf(pickMetricCentsPerKwhForBucket(o, 2000));
      // Default: 1000
      return numOrInf(pickMetricCentsPerKwhForBucket(o, 1000));
    };

    withIdx.sort((a, b) => {
      const ka = keyFn(a.o);
      const kb = keyFn(b.o);
      if (ka < kb) return -1;
      if (ka > kb) return 1;
      const pa = String(a.o?.planName ?? "").toLowerCase();
      const pb = String(b.o?.planName ?? "").toLowerCase();
      if (pa < pb) return -1;
      if (pa > pb) return 1;
      return a.idx - b.idx;
    });

    if (sort === "renewable_desc") {
      withIdx.sort((a, b) => {
        const ka = numOrNegInf(a.o?.renewablePercent);
        const kb = numOrNegInf(b.o?.renewablePercent);
        if (ka > kb) return -1;
        if (ka < kb) return 1;
        const pa = String(a.o?.planName ?? "").toLowerCase();
        const pb = String(b.o?.planName ?? "").toLowerCase();
        if (pa < pb) return -1;
        if (pa > pb) return 1;
        return a.idx - b.idx;
      });
    }

    return withIdx.map((x) => x.o) as OfferRow[];
  }, [datasetOffers, normalizedQ, rateType, term, renewableMin, template, sort, hasUsage, approxKwhPerMonth]);

  const total = filteredSortedAll.length;
  const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);
  const safePage = totalPages === 0 ? 1 : Math.min(page, totalPages);

  useEffect(() => {
    if (totalPages === 0) return;
    if (page > totalPages) setPage(totalPages);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalPages]);

  const offers = useMemo(() => {
    const startIdx = (safePage - 1) * pageSize;
    return filteredSortedAll.slice(startIdx, startIdx + pageSize);
  }, [filteredSortedAll, safePage, pageSize]);

  const hasUnavailable = filteredSortedAll.some((o: any) => o?.intelliwatt?.statusLabel === "UNAVAILABLE");
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
    () => filteredSortedAll.filter((o: any) => o?.intelliwatt?.statusLabel === "QUEUED").length,
    [filteredSortedAll],
  );
  const isStillWorking = Boolean(loading || autoPreparing);
  const showRecommendedBadge = Boolean(recommendedOfferId && !isStillWorking);
  const showCalcBot =
    Boolean(hasUsage && sort === "best_for_you_proxy" && (isStillWorking || queuedCount > 0));

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
                        userTouchedSortRef.current = true;
                        setSort(e.target.value as any);
                        setPage(1);
                      }}
                      className="mt-2 w-full rounded-2xl border border-brand-cyan/25 bg-brand-white/5 px-3 py-2 text-xs text-brand-white outline-none focus:border-brand-blue/60 focus:bg-white focus:text-brand-navy"
                    >
                      {hasUsage ? (
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
                              setTemplate(e.target.checked ? "available" : "all");
                              setPage(1);
                            }}
                            className="h-4 w-4 rounded border-brand-cyan/40 bg-brand-white/10"
                          />
                          Show only AVAILABLE templates
                        </label>
                      </div>
                    </div>

                    <div className="flex items-end">
                      <label className="flex items-center gap-2 text-xs text-brand-cyan/75 select-none">
                        <input
                          type="checkbox"
                          checked={isRenter === true}
                          onChange={(e) => {
                            const next = e.target.checked;
                            setIsRenter(next);
                            setPage(1);
                            try {
                              window.localStorage.setItem("dashboard_plans_is_renter", String(next));
                            } catch {
                              // ignore
                            }
                          }}
                          className="h-4 w-4 rounded border-brand-cyan/40 bg-brand-white/10"
                        />
                        Renter (filters eligible plans)
                      </label>
                    </div>
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
                      userTouchedSortRef.current = true;
                      setSort(e.target.value as any);
                      setPage(1);
                    }}
                    className="mt-2 w-full rounded-2xl border border-brand-cyan/25 bg-brand-white/5 px-3 py-2 text-xs text-brand-white outline-none focus:border-brand-blue/60 focus:bg-white focus:text-brand-navy"
                  >
                    {hasUsage ? (
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
                          setTemplate(e.target.checked ? "available" : "all");
                          setPage(1);
                        }}
                        className="h-4 w-4 rounded border-brand-cyan/40 bg-brand-white/10"
                      />
                      Show only AVAILABLE templates
                    </label>
                  </div>
                </div>

                <div className="flex items-end">
                  <label className="flex items-center gap-2 text-xs text-brand-cyan/75 select-none">
                    <input
                      type="checkbox"
                      checked={isRenter === true}
                      onChange={(e) => {
                        const next = e.target.checked;
                        setIsRenter(next);
                        setPage(1);
                        try {
                          window.localStorage.setItem("dashboard_plans_is_renter", String(next));
                        } catch {
                          // ignore
                        }
                      }}
                      className="h-4 w-4 rounded border-brand-cyan/40 bg-brand-white/10"
                    />
                    Renter (filters eligible plans)
                  </label>
                </div>
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
                  <span className="text-brand-cyan/80">{prefetchNote}</span>
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
                      setPageSize(Number(e.target.value) as any);
                      setPage(1);
                    }}
                    className="rounded-full border border-brand-cyan/25 bg-brand-white/5 px-2 py-1 text-xs text-brand-white outline-none focus:border-brand-blue/60 focus:bg-white focus:text-brand-navy"
                  >
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
                  {queuedCount > 0 ? (
                    <span className="ml-2 text-brand-cyan/60">({queuedCount} still processing)</span>
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


