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
  // Customer UX guardrail:
  // Sorting/filtering/pagination should only change the list being displayed and should NOT kick off
  // background plan pipeline runs or EFL template prefetching from this page.
  // Those warmups happen via the dashboard bootstrapper and admin tooling.
  const ENABLE_PLANS_AUTO_WARMUPS = false;

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
  const lastPipelineKickAtRef = useRef<number>(0);
  const pollTimerRef = useRef<number | null>(null);
  const pollStopTimerRef = useRef<number | null>(null);
  const pollInFlightRef = useRef(false);

  const [mobilePanel, setMobilePanel] = useState<"none" | "search" | "filters">("none");
  const [headerCollapsed, setHeaderCollapsed] = useState(false);
  const [approxKwhPerMonth, setApproxKwhPerMonth] = useState<500 | 750 | 1000 | 1250 | 2000>(1000);
  const bestBucket = useMemo(() => selectedBestBucket(sort), [sort]);

  // Stable per-session dataset identity for background warmups.
  // Keep this minimal so browsing/sorting doesn't retrigger pipeline/prefetch during a session.
  const warmupKey = useMemo(() => JSON.stringify({ isRenter }), [isRenter]);

  // Server dataset identity: include all inputs that change the server response.
  const serverDatasetKey = useMemo(
    () =>
      JSON.stringify({
        isRenter,
        q: q.trim().toLowerCase(),
        rateType,
        term,
        renewableMin,
        template,
        sort,
        page,
        pageSize,
        approxKwhPerMonth,
      }),
    [isRenter, q, rateType, term, renewableMin, template, sort, page, pageSize, approxKwhPerMonth],
  );

  // Lightweight client cache so back/forward navigation instantly shows the last processed dataset
  // instead of refetching.
  // Bump when API semantics change so we don't pin users to stale session-cached payloads.
  // Bump when API semantics change so we don't pin users to stale session-cached payloads.
  const cacheKey = useMemo(() => `dashboard_plans_dataset_v4:${serverDatasetKey}`, [serverDatasetKey]);
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
  }, [warmupKey]);

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
      // Used only to force a reload after background prefetch runs.
      _r: String(refreshNonce),
      page: String(page),
      pageSize: String(pageSize),
      sort: String(sort),
      q: q.trim(),
      rateType: String(rateType),
      term: String(term),
      renewableMin: String(renewableMin),
      template: String(template),
    };
    if (typeof approxKwhPerMonth === "number") params.approxKwhPerMonth = String(approxKwhPerMonth);
    if (isRenter !== null) params.isRenter = String(isRenter);
    return params;
  }, [refreshNonce, page, pageSize, sort, q, rateType, term, renewableMin, template, approxKwhPerMonth, isRenter]);

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
  // This page is display-only; background warm-ups happen elsewhere.
  useEffect(() => {
    if (!resp?.ok) return;
    const offersNow = Array.isArray(resp?.offers) ? (resp!.offers as OfferRow[]) : [];
    const needsUsage = offersNow.filter(
      (o: any) => String((o as any)?.intelliwatt?.trueCostEstimate?.status ?? "").toUpperCase() === "MISSING_USAGE",
    ).length;
    const notComputableYet = offersNow.filter((o: any) => {
      const st = String((o as any)?.intelliwatt?.trueCostEstimate?.status ?? "").toUpperCase();
      if (st === "OK" || st === "APPROXIMATE") return false;
      if (st === "MISSING_USAGE") return false;
      return true;
    }).length;
    setAutoPreparing(false);
    if (needsUsage > 0) setPrefetchNote("Need usage to estimate some plans.");
    else if (notComputableYet > 0) setPrefetchNote("Some plans are not computable yet.");
    else setPrefetchNote(null);
  }, [resp?.ok, resp?.offers]);

  // Targeted template warm-up: if offers are QUEUED specifically because their template mapping is missing,
  // kick the lightweight EFL-prefetch endpoint to auto-parse and create/link templates (best-effort).
  // This is safe even when usage is missing (templating does not require SMT/GreenButton usage).
  useEffect(() => {
    if (!ENABLE_PLANS_AUTO_WARMUPS) return;
    if (isRenter === null) return;
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
        params.set("isRenter", String(isRenter));
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
  }, [resp?.ok, resp?.offers, isRenter, warmupKey, ENABLE_PLANS_AUTO_WARMUPS]);

  // Fallback warm-up: if the user lands on /dashboard/plans before background warm-up ran,
  // kick the plan pipeline once per session and poll until queued clears (or timeout).
  useEffect(() => {
    if (!ENABLE_PLANS_AUTO_WARMUPS) return;
    if (isRenter === null) return;
    if (!resp?.ok) return;
    if (!resp?.hasUsage) return;
    const offersNow = Array.isArray(resp?.offers) ? (resp!.offers as OfferRow[]) : [];
    const pendingCountNow = offersNow.filter((o: any) => {
      if (String(o?.intelliwatt?.statusLabel ?? "") !== "QUEUED") return false;
      const tceStatus = String((o as any)?.intelliwatt?.trueCostEstimate?.status ?? "").toUpperCase();
      const tceReason = String((o as any)?.intelliwatt?.trueCostEstimate?.reason ?? "").toUpperCase();
      // Treat CACHE_MISS as pending: the plans list endpoint is cache-only and will emit NOT_IMPLEMENTED/CACHE_MISS
      // until the background pipeline warms the materialized estimates.
      const isCacheMiss = tceStatus === "NOT_IMPLEMENTED" && tceReason === "CACHE_MISS";
      return !tceStatus || tceStatus === "QUEUED" || tceStatus === "MISSING_TEMPLATE" || isCacheMiss;
    }).length;
    if (pendingCountNow <= 0) return;

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
      try {
        window.sessionStorage.setItem(sessionKey, String(now));
      } catch {
        // ignore
      }

      prefetchInFlightRef.current = true;
      setPrefetchNote(`Preparing IntelliWatt calculations… (${pendingCountNow} pending)`);
      try {
        const params = new URLSearchParams();
        params.set("reason", "plans_fallback");
        params.set("timeBudgetMs", "25000");
        params.set("maxTemplateOffers", "6");
        params.set("maxEstimatePlans", "50");
        // Allow repeated short runs; server still enforces lock + cooldown.
        params.set("proactiveCooldownMs", "60000");
        params.set("fallbackCooldownMs", "15000");
        params.set("isRenter", String(isRenter));
        fetch(`/api/dashboard/plans/pipeline?${params.toString()}`, { method: "POST" })
          .catch(() => null)
          .finally(() => {
            prefetchInFlightRef.current = false;
          });
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
        if (Date.now() - startedAt > 120_000) {
          // Stop after 2 minutes.
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
          fetch(`/api/dashboard/plans?${qs}`)
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
  }, [resp?.ok, resp?.hasUsage, resp?.offers, isRenter, warmupKey, ENABLE_PLANS_AUTO_WARMUPS]);

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
  const offers = Array.isArray(resp?.offers) ? (resp!.offers as OfferRow[]) : [];
  const total =
    resp?.ok && typeof (resp as any)?.total === "number" && Number.isFinite((resp as any).total)
      ? ((resp as any).total as number)
      : offers.length;
  const totalPages =
    resp?.ok && typeof (resp as any)?.totalPages === "number" && Number.isFinite((resp as any).totalPages)
      ? ((resp as any).totalPages as number)
      : total === 0
        ? 0
        : 1;
  const safePage = totalPages === 0 ? 1 : Math.min(page, totalPages);
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

