"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import OfferCard from "./OfferCard";
import { EstimateBreakdownPopover } from "../../components/ui/EstimateBreakdownPopover";

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

type OfferRow = Parameters<typeof OfferCard>[0]["offer"];

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
      // ignore
    }
    return null;
  });
  const [sort, setSort] = useState<SortKey>("kwh1000_asc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<10 | 20 | 50>(20);
  const [refreshNonce, setRefreshNonce] = useState(0);

  const [loading, setLoading] = useState(false);
  const [resp, setResp] = useState<ApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reqSeqRef = useRef(0);

  const [prefetchNote, setPrefetchNote] = useState<string | null>(null);
  const prefetchInFlightRef = useRef(false);
  const prefetchAttemptsRef = useRef(0);

  const [bestRankAllIn, setBestRankAllIn] = useState<boolean | null>(null);
  const [mobilePanel, setMobilePanel] = useState<"none" | "search" | "filters">("none");
  const [headerCollapsed, setHeaderCollapsed] = useState(false);
  const [approxKwhPerMonth, setApproxKwhPerMonth] = useState<500 | 750 | 1000 | 1250 | 2000>(1000);
  const bestBucket = useMemo(() => selectedBestBucket(sort), [sort]);

  // Reset prefetch attempts when the *user-visible dataset* changes (filters/pagination),
  // but do NOT reset on our internal refresh nonce (otherwise we could loop forever
  // on truly manual-review items that remain QUEUED).
  const datasetKey = useMemo(
    () =>
      JSON.stringify({
        q,
        rateType,
        term,
        renewableMin,
        template,
        isRenter,
        sort,
        page,
        pageSize,
      }),
    [q, rateType, term, renewableMin, template, isRenter, sort, page, pageSize],
  );

  useEffect(() => {
    prefetchAttemptsRef.current = 0;
    prefetchInFlightRef.current = false;
    setPrefetchNote(null);
  }, [datasetKey]);

  useEffect(() => {
    if (isRenter !== null) return;
    try {
      const raw = window.localStorage.getItem("dashboard_plans_is_renter");
      if (raw === "true") setIsRenter(true);
      if (raw === "false") setIsRenter(false);
    } catch {
      // ignore
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

  const baseParams = useMemo(() => {
    const params: Record<string, string> = {
      q,
      rateType,
      term,
      renewableMin: String(renewableMin),
      template,
      sort,
      page: String(page),
      pageSize: String(pageSize),
      approxKwhPerMonth: String(approxKwhPerMonth),
      // Used only to force a reload after background prefetch runs.
      _r: String(refreshNonce),
    };
    if (isRenter !== null) {
      params.isRenter = String(isRenter);
    }
    return params;
  }, [q, rateType, term, renewableMin, template, sort, page, pageSize, approxKwhPerMonth, refreshNonce, isRenter]);

  const plansQueryString = useMemo(() => buildQuery(baseParams as any), [baseParams]);

  useEffect(() => {
    if (isRenter === null) return; // wait for stable renter value
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
  }, [plansQueryString, isRenter]);

  // Auto-prefetch templates in the background so customer cards converge to "AVAILABLE".
  // This will only leave "QUEUED" for genuine manual-review cases.
  useEffect(() => {
    if (!resp?.ok) return;
    if (!resp?.hasUsage) return;
    if (loading) return;
    if (error) return;
    if (prefetchInFlightRef.current) return;
    if (prefetchAttemptsRef.current >= 10) return; // safety cap per page load
    if (isRenter === null) return;

    const offersNow = Array.isArray(resp?.offers) ? (resp!.offers as OfferRow[]) : [];
    const queuedOffers = offersNow.filter((o) => o?.intelliwatt?.statusLabel === "QUEUED");
    if (queuedOffers.length === 0) {
      setPrefetchNote(null);
      return;
    }

    prefetchInFlightRef.current = true;
    prefetchAttemptsRef.current += 1;
    setPrefetchNote(`Preparing IntelliWatt calculations… (${queuedOffers.length} pending)`);

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      controller.abort();
    }, 12_000);

    async function runPrefetch() {
      try {
        const params = new URLSearchParams();
        params.set("timeBudgetMs", "9000");
        params.set("maxOffers", "4");
        params.set("isRenter", String(isRenter));
        const r = await fetch(`/api/dashboard/plans/prefetch?${params.toString()}`, {
          method: "POST",
          signal: controller.signal,
        });
        const j = await r.json().catch(() => null);
        if (!r.ok || !j?.ok) {
          setPrefetchNote("Preparing IntelliWatt calculations… (retrying)");
          return;
        }

        const linked = Number(j?.linked ?? 0) || 0;
        const qd = Number(j?.queued ?? 0) || 0;
        const remaining = Number(j?.remaining ?? 0) || 0;
        setPrefetchNote(`Preparing IntelliWatt calculations… linked=${linked} queued=${qd} remaining=${remaining}`);
      } catch (e: any) {
        if (e?.name === "AbortError") return;
        setPrefetchNote("Preparing IntelliWatt calculations… (retrying)");
      } finally {
        window.clearTimeout(timer);
        prefetchInFlightRef.current = false;
        // Trigger a refresh of the offers list after the prefetch attempt.
        setRefreshNonce((n) => n + 1);
      }
    }

    runPrefetch();
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resp?.ok, resp?.hasUsage, resp?.offers, isRenter, loading, error]);

  const hasUsage = Boolean(resp?.ok && resp?.hasUsage);
  const offers = Array.isArray(resp?.offers) ? resp!.offers! : [];
  const avgMonthlyKwh =
    resp?.ok && typeof (resp as any)?.avgMonthlyKwh === "number" && Number.isFinite((resp as any).avgMonthlyKwh)
      ? ((resp as any).avgMonthlyKwh as number)
      : null;
  const total = typeof resp?.total === "number" ? resp.total : 0;
  const totalPages = typeof resp?.totalPages === "number" ? resp.totalPages : 0;
  const hasUnavailable = offers.some((o: any) => o?.intelliwatt?.statusLabel === "UNAVAILABLE");
  const availableFilterOn = template === "available";

  // Default basis (only once per "hasUsage" session): if we already have OK all-in estimates, prefer them.
  useEffect(() => {
    if (!hasUsage) {
      setBestRankAllIn(null);
      return;
    }
    if (bestRankAllIn !== null) return;
    const serverAllIn = Array.isArray((resp as any)?.bestOffersAllIn) ? ((resp as any).bestOffersAllIn as OfferRow[]) : [];
    const serverEfl = Array.isArray(resp?.bestOffers) ? (resp!.bestOffers as OfferRow[]) : [];
    const pool = serverAllIn.length ? serverAllIn : serverEfl.length ? serverEfl : offers;
    const anyOk = pool.some((o: any) => o?.intelliwatt?.trueCostEstimate?.status === "OK");
    setBestRankAllIn(anyOk);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasUsage, bestRankAllIn, (resp as any)?.bestOffersAllIn, resp?.bestOffers, offers]);

  const bestStripOffers = useMemo(() => {
    if (!resp?.ok) return [];
    const rankAllIn = hasUsage && bestRankAllIn === true;
    const serverAllIn =
      Array.isArray((resp as any)?.bestOffersAllIn) && ((resp as any).bestOffersAllIn as any[]).length > 0
        ? ((resp as any).bestOffersAllIn as OfferRow[])
        : null;
    const serverEfl =
      Array.isArray(resp?.bestOffers) && (resp!.bestOffers as any[]).length > 0 ? (resp!.bestOffers as OfferRow[]) : null;

    if (rankAllIn) {
      const pool = serverAllIn ?? offers;
      const scored = pool.map((o: any) => {
        const tce = o?.intelliwatt?.trueCostEstimate;
        const ok = tce?.status === "OK";
        const v = ok ? Number(tce?.monthlyCostDollars) : Number.POSITIVE_INFINITY;
        return { o, v: Number.isFinite(v) ? v : Number.POSITIVE_INFINITY };
      });
      scored.sort((a, b) => a.v - b.v);
      return scored.slice(0, 5).map((x) => x.o);
    }

    // Proxy basis: use server bestOffers when available.
    if (serverEfl) return serverEfl.slice(0, 5);

    // Fallback: compute client-side ranking from currently loaded offers (safe deploy).
    const scored = offers
      .map((o) => ({ o, metric: pickMetricCentsPerKwhForBucket(o, bestBucket) }))
      .filter((x) => typeof x.metric === "number" && Number.isFinite(x.metric as number));
    scored.sort((a, b) => (a.metric as number) - (b.metric as number));
    return scored.slice(0, 5).map((x) => x.o);
  }, [resp?.ok, hasUsage, (resp as any)?.bestOffersAllIn, resp?.bestOffers, offers, bestRankAllIn, bestBucket]);

  const bestStripBasis = useMemo(() => {
    if (!resp?.ok) return null;
    const rankAllIn = bestRankAllIn === true;
    const basis = rankAllIn ? (resp as any)?.bestOffersAllInBasis : resp?.bestOffersBasis;
    return typeof basis === "string" && basis.trim() ? basis.trim() : null;
  }, [resp?.ok, (resp as any)?.bestOffersAllInBasis, resp?.bestOffersBasis, bestRankAllIn]);

  const bestStripDisclaimer = useMemo(() => {
    if (!resp?.ok) return null;
    const rankAllIn = bestRankAllIn === true;
    const d = rankAllIn ? (resp as any)?.bestOffersAllInDisclaimer : resp?.bestOffersDisclaimer;
    return typeof d === "string" && d.trim() ? d.trim() : null;
  }, [resp?.ok, (resp as any)?.bestOffersAllInDisclaimer, resp?.bestOffersDisclaimer, bestRankAllIn]);

  const bestStripDisclaimerWithAnchor = useMemo(() => {
    const base = bestStripDisclaimer;
    if (!base) return null;
    // If the server already injected an anchor, keep it. Otherwise append a short hint
    // so the user understands the mini-card kWh label/price matches their selected sort.
    if (base.includes("500 kWh") || base.includes("1000 kWh") || base.includes("2000 kWh")) return base;
    return `${base} (showing ${bestBucket} kWh EFL average)`;
  }, [bestStripDisclaimer, bestBucket]);

  return (
    <div className="flex flex-col gap-6">
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
                        setSort(e.target.value as any);
                        setPage(1);
                      }}
                      className="mt-2 w-full rounded-2xl border border-brand-cyan/25 bg-brand-white/5 px-3 py-2 text-xs text-brand-white outline-none focus:border-brand-blue/60 focus:bg-white focus:text-brand-navy"
                    >
                      {hasUsage ? (
                        <option className="text-brand-navy" value="best_for_you_proxy">
                          Best for you (preview)
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
                      setSort(e.target.value as any);
                      setPage(1);
                    }}
                    className="mt-2 w-full rounded-2xl border border-brand-cyan/25 bg-brand-white/5 px-3 py-2 text-xs text-brand-white outline-none focus:border-brand-blue/60 focus:bg-white focus:text-brand-navy"
                  >
                    {hasUsage ? (
                      <option className="text-brand-navy" value="best_for_you_proxy">
                        Best for you (preview)
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

      {resp?.ok ? (
        <div className="mx-auto w-full max-w-5xl">
          <div className="rounded-3xl border border-brand-cyan/20 bg-brand-navy p-5 shadow-[0_18px_40px_rgba(10,20,60,0.35)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-sm font-semibold text-brand-white">Best plans for you (estimate)</div>
                {hasUsage ? (
                  <label className="mt-2 flex items-center gap-2 text-xs text-brand-cyan/75 select-none">
                    <input
                      type="checkbox"
                      checked={bestRankAllIn === true}
                      onChange={(e) => {
                        setBestRankAllIn(e.target.checked);
                        // Force a refresh so we immediately pick up the preferred server-ranked list
                        // (and matching basis/disclaimer) when the user toggles.
                        setRefreshNonce((n) => n + 1);
                      }}
                      className="h-4 w-4 rounded border-brand-cyan/40 bg-brand-white/10"
                    />
                    Rank by all-in estimate (incl. TDSP)
                  </label>
                ) : (
                  <label className="mt-2 flex flex-wrap items-center gap-2 text-xs text-brand-cyan/75 select-none">
                    <span className="text-brand-cyan/70">Approx monthly usage:</span>
                    <select
                      value={approxKwhPerMonth}
                      onChange={(e) => {
                        const v = Number(e.target.value) as any;
                        if (v === 500 || v === 750 || v === 1000 || v === 1250 || v === 2000) {
                          setApproxKwhPerMonth(v);
                          setRefreshNonce((n) => n + 1);
                        }
                      }}
                      className="rounded-full border border-brand-cyan/25 bg-brand-white/5 px-3 py-2 text-xs text-brand-white outline-none focus:border-brand-blue/60 focus:bg-white focus:text-brand-navy"
                    >
                      <option className="text-brand-navy" value={500}>
                        500
                      </option>
                      <option className="text-brand-navy" value={750}>
                        750
                      </option>
                      <option className="text-brand-navy" value={1000}>
                        1000
                      </option>
                      <option className="text-brand-navy" value={1250}>
                        1250
                      </option>
                      <option className="text-brand-navy" value={2000}>
                        2000
                      </option>
                    </select>
                    <span className="text-brand-cyan/60">kWh/mo</span>
                  </label>
                )}
                <div className="mt-1 text-xs text-brand-cyan/70">
                  {hasUsage && avgMonthlyKwh ? (
                    <div className="mb-1">
                      Based on your historic usage of{" "}
                      <span className="font-semibold text-brand-white/90">{fmtKwhPerMonth(avgMonthlyKwh)}</span>.
                    </div>
                  ) : null}
                  {bestStripDisclaimerWithAnchor ??
                    (hasUsage
                      ? "Based on your last 12 months usage. Ranking uses provider estimates until IntelliWatt true-cost is enabled."
                      : "Pick an approximate monthly usage to rank plans by EFL averages.")}
                </div>
                {bestStripBasis ? (
                  <div className="mt-1 text-[0.7rem] text-brand-cyan/55 font-mono">
                    {bestStripBasis}
                  </div>
                ) : null}
              </div>
              <div className="text-xs text-brand-cyan/60">
                {bestStripOffers.length ? `Top ${bestStripOffers.length}` : "No results"}
              </div>
            </div>

            {bestStripOffers.length > 0 ? (
              <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                {bestStripOffers.map((o) => {
                  const tce = (o as any)?.intelliwatt?.trueCostEstimate;
                  const effCents =
                    tce?.status === "OK" &&
                    typeof tce?.effectiveCentsPerKwh === "number" &&
                    Number.isFinite(tce.effectiveCentsPerKwh)
                      ? (tce.effectiveCentsPerKwh as number)
                      : null;
                  const metric = hasUsage && effCents != null ? effCents : pickMetricCentsPerKwhForBucket(o, bestBucket);
                  const supplier = (o as any)?.supplierName ?? "Unknown supplier";
                  const plan = (o as any)?.planName ?? "Unknown plan";
                  const status = (o as any)?.intelliwatt?.statusLabel ?? "UNAVAILABLE";
                  const statusClass =
                    status === "AVAILABLE"
                      ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-200"
                      : status === "QUEUED"
                        ? "border-amber-400/40 bg-amber-500/10 text-amber-200"
                        : "border-brand-cyan/20 bg-brand-white/5 text-brand-cyan/70";

                  const tdspRatesApplied = (o as any)?.intelliwatt?.tdspRatesApplied ?? null;
                  const showEst = tce?.status === "OK" && typeof tce?.monthlyCostDollars === "number";
                  const estMonthly = showEst ? (tce.monthlyCostDollars as number) : null;
                  const c2 = showEst ? tce?.componentsV2 : null;
                  const repAnnual = c2?.rep?.energyDollars ?? tce?.annualCostDollars;
                  const totalAnnual = c2?.totalDollars ?? tce?.annualCostDollars;
                  const tdspDeliveryAnnual = c2?.tdsp?.deliveryDollars;
                  const tdspFixedAnnual = c2?.tdsp?.fixedDollars;
                  const inclTdsp = Boolean(tdspRatesApplied);

                  return (
                    <div
                      key={`best-mini-${(o as any).offerId}`}
                      className="rounded-2xl border border-brand-cyan/20 bg-brand-white/5 p-3 min-w-0 sm:w-[calc(50%-0.375rem)] md:w-[240px] md:flex-none"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-[0.7rem] text-brand-cyan/70 truncate">{supplier}</div>
                          <div className="mt-0.5 text-sm font-semibold text-brand-white truncate">{plan}</div>
                        </div>
                        <div
                          className={`shrink-0 rounded-full border px-2 py-1 text-[0.62rem] font-semibold uppercase tracking-[0.18em] ${statusClass}`}
                        >
                          {status === "AVAILABLE" ? "Available" : status === "QUEUED" ? "Queued" : "—"}
                        </div>
                      </div>

                      <div className="mt-3 flex items-end justify-between gap-3">
                        <div>
                          <div className="text-[0.65rem] uppercase tracking-[0.25em] text-brand-cyan/55">
                            {hasUsage && avgMonthlyKwh ? `${Math.round(avgMonthlyKwh)} kWh/mo` : bestBucket}
                          </div>
                          <div className="mt-0.5 text-base font-semibold text-brand-white">
                            {fmtCentsPerKwh(metric)}
                          </div>
                        </div>
                        <div className="text-[0.7rem] text-brand-cyan/60 text-right">
                          {(o as any)?.termMonths ? `${(o as any).termMonths} mo` : "Term —"}
                        </div>
                      </div>

                      {showEst && typeof repAnnual === "number" && typeof totalAnnual === "number" ? (
                        <div className="mt-2 text-xs text-brand-cyan/70">
                          <EstimateBreakdownPopover
                            side="top"
                            align="right"
                            trigger={
                              <>
                                Est. ${Number(estMonthly).toFixed(2)}/mo
                                {inclTdsp ? <span className="text-brand-cyan/60"> · incl. TDSP</span> : null}
                              </>
                            }
                            repAnnualDollars={repAnnual}
                            tdspDeliveryAnnualDollars={
                              typeof tdspDeliveryAnnual === "number" && Number.isFinite(tdspDeliveryAnnual)
                                ? tdspDeliveryAnnual
                                : undefined
                            }
                            tdspFixedAnnualDollars={
                              typeof tdspFixedAnnual === "number" && Number.isFinite(tdspFixedAnnual)
                                ? tdspFixedAnnual
                                : undefined
                            }
                            totalAnnualDollars={totalAnnual}
                            effectiveDate={tdspRatesApplied?.effectiveDate}
                          />
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

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
        {offers.length === 0 ? (
          <div className="rounded-3xl border border-brand-cyan/20 bg-brand-navy p-8 text-brand-cyan/75">
            No plans found for your current filters.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {offers.map((o) => (
              <OfferCard key={o.offerId} offer={o} />
            ))}
          </div>
        )}

        <div className="mt-6 flex items-center justify-between gap-3">
          <button
            disabled={loading || page <= 1 || totalPages <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            className="rounded-full border border-brand-cyan/25 bg-brand-navy px-4 py-2 text-sm font-semibold text-brand-cyan disabled:opacity-40"
          >
            Prev
          </button>
          <div className="text-sm text-brand-navy/70">
            Page <span className="font-semibold text-brand-navy">{page}</span>
            {totalPages ? (
              <>
                {" "}
                of <span className="font-semibold text-brand-navy">{totalPages}</span>
              </>
            ) : null}
          </div>
          <button
            disabled={loading || totalPages === 0 || page >= totalPages}
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


