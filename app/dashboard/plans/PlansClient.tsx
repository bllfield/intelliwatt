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
  offers?: OfferRow[];
  bestOffers?: OfferRow[];
  bestOffersBasis?: string | null;
  bestOffersDisclaimer?: string | null;
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

function firstFiniteNumber(vals: Array<any>): number | null {
  for (const v of vals) {
    const n = typeof v === "number" ? v : Number(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function pickBest1000MetricCentsPerKwh(offer: any): number | null {
  // Prefer 1000kWh EFL avg cents/kWh (WattBuy’s anchor point), then fall back to 500/2000.
  // Keep this robust to slight schema variations without hardcoding a single guess.
  return firstFiniteNumber([
    offer?.efl?.avgPriceCentsPerKwh1000,
    offer?.avgPriceCentsPerKwh1000,
    offer?.kwh1000_cents,
    offer?.bill1000,
    offer?.bill_1000,
    offer?.price1000,
    offer?.rate1000,
    offer?.efl?.avgPriceCentsPerKwh500,
    offer?.avgPriceCentsPerKwh500,
    offer?.kwh500_cents,
    offer?.efl?.avgPriceCentsPerKwh2000,
    offer?.avgPriceCentsPerKwh2000,
    offer?.kwh2000_cents,
  ]);
}

function fmtCentsPerKwh(v: number | null | undefined): string {
  if (typeof v !== "number" || !Number.isFinite(v)) return "—";
  return `${v.toFixed(2)}¢/kWh`;
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
  const [isRenter, setIsRenter] = useState(false);
  const [sort, setSort] = useState<SortKey>("kwh1000_asc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<10 | 20 | 50>(20);
  const [refreshNonce, setRefreshNonce] = useState(0);

  const [loading, setLoading] = useState(false);
  const [resp, setResp] = useState<ApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [prefetchNote, setPrefetchNote] = useState<string | null>(null);
  const prefetchInFlightRef = useRef(false);
  const prefetchAttemptsRef = useRef(0);

  const [bestRankAllIn, setBestRankAllIn] = useState<boolean | null>(null);

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
    try {
      const raw = window.localStorage.getItem("dashboard_plans_is_renter");
      if (raw === "true") setIsRenter(true);
      if (raw === "false") setIsRenter(false);
    } catch {
      // ignore
    }
  }, []);

  const baseParams = useMemo(
    () => ({
      q,
      rateType,
      term,
      renewableMin: String(renewableMin),
      template,
      isRenter: String(isRenter),
      sort,
      page: String(page),
      pageSize: String(pageSize),
      // Used only to force a reload after background prefetch runs.
      _r: String(refreshNonce),
    }),
    [q, rateType, term, renewableMin, template, isRenter, sort, page, pageSize, refreshNonce],
  );

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setResp(null);

    async function run() {
      try {
        const qs = buildQuery(baseParams as any);
        const r = await fetch(`/api/dashboard/plans?${qs}`, { signal: controller.signal });
        const j = (await r.json()) as ApiResponse;
        if (!r.ok || !j?.ok) {
          setError(j?.error ?? j?.message ?? `Request failed (${r.status})`);
          setResp(j);
          return;
        }
        setResp(j);
      } catch (e: any) {
        if (e?.name === "AbortError") return;
        setError(e?.message ?? String(e));
      } finally {
        setLoading(false);
      }
    }

    run();
    return () => controller.abort();
  }, [baseParams]);

  // Auto-prefetch templates in the background so customer cards converge to "AVAILABLE".
  // This will only leave "QUEUED" for genuine manual-review cases.
  useEffect(() => {
    if (!resp?.ok) return;
    if (!resp?.hasUsage) return;
    if (loading) return;
    if (error) return;
    if (prefetchInFlightRef.current) return;
    if (prefetchAttemptsRef.current >= 10) return; // safety cap per page load

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
    const apiBest = Array.isArray(resp?.bestOffers) ? (resp!.bestOffers as OfferRow[]) : [];
    const pool = apiBest.length ? apiBest : offers;
    const anyOk = pool.some((o: any) => o?.intelliwatt?.trueCostEstimate?.status === "OK");
    setBestRankAllIn(anyOk);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasUsage, bestRankAllIn, resp?.bestOffers, offers]);

  const bestStripOffers = useMemo(() => {
    if (!hasUsage) return [];
    const apiBest = Array.isArray(resp?.bestOffers) ? (resp!.bestOffers as OfferRow[]) : [];
    const rankAllIn = bestRankAllIn === true;

    if (rankAllIn) {
      const pool = apiBest.length ? apiBest : offers;
      const scored = pool.map((o: any) => {
        const tce = o?.intelliwatt?.trueCostEstimate;
        const ok = tce?.status === "OK";
        const v = ok ? Number(tce?.monthlyCostDollars) : Number.POSITIVE_INFINITY;
        return { o, v: Number.isFinite(v) ? v : Number.POSITIVE_INFINITY };
      });
      scored.sort((a, b) => a.v - b.v);
      return scored.slice(0, 5).map((x) => x.o);
    }

    // Default proxy basis: use API bestOffers when available.
    if (apiBest.length > 0) return apiBest.slice(0, 5);

    // Fallback: compute client-side ranking from currently loaded offers (safe deploy).
    const scored = offers
      .map((o) => ({ o, metric: pickBest1000MetricCentsPerKwh(o) }))
      .filter((x) => typeof x.metric === "number" && Number.isFinite(x.metric as number));
    scored.sort((a, b) => (a.metric as number) - (b.metric as number));
    return scored.slice(0, 5).map((x) => x.o);
  }, [hasUsage, resp?.bestOffers, offers, bestRankAllIn]);

  return (
    <div className="flex flex-col gap-6">
      <div className="sticky top-0 z-20 -mx-4 px-4 pt-2 pb-3 bg-brand-white/90 backdrop-blur border-b border-brand-cyan/15">
        <div className="mx-auto max-w-5xl">
          <div className="rounded-3xl border border-brand-cyan/25 bg-brand-navy p-4 shadow-[0_18px_40px_rgba(10,20,60,0.35)]">
            <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
              <div className="flex-1 min-w-0">
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

              <div className="grid grid-cols-2 gap-3 md:grid-cols-5 md:gap-2">
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
                    className="mt-2 w-full rounded-2xl border border-brand-cyan/25 bg-brand-white/5 px-3 py-2 text-xs text-brand-white outline-none focus:border-brand-blue/60"
                  >
                    <option value="all">All</option>
                    <option value="fixed">Fixed</option>
                    <option value="variable">Variable</option>
                    <option value="renewable">Renewable</option>
                    <option value="unknown">Unknown</option>
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
                    className="mt-2 w-full rounded-2xl border border-brand-cyan/25 bg-brand-white/5 px-3 py-2 text-xs text-brand-white outline-none focus:border-brand-blue/60"
                  >
                    <option value="all">All</option>
                    <option value="0-6">≤ 6 mo</option>
                    <option value="7-12">7–12 mo</option>
                    <option value="13-24">13–24 mo</option>
                    <option value="25+">25+ mo</option>
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
                    className="mt-2 w-full rounded-2xl border border-brand-cyan/25 bg-brand-white/5 px-3 py-2 text-xs text-brand-white outline-none focus:border-brand-blue/60"
                  >
                    <option value={0}>Any</option>
                    <option value={50}>50%+</option>
                    <option value={100}>100%</option>
                  </select>
                </div>

                <div>
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

                <div className="flex items-end">
                  <label className="flex items-center gap-2 text-xs text-brand-cyan/75 select-none">
                    <input
                      type="checkbox"
                      checked={isRenter}
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

                <div className="col-span-2 md:col-span-1">
                  <label className="text-[0.68rem] font-semibold uppercase tracking-[0.28em] text-brand-cyan/65">
                    Sort
                  </label>
                  <select
                    value={sort}
                    onChange={(e) => {
                      setSort(e.target.value as any);
                      setPage(1);
                    }}
                    className="mt-2 w-full rounded-2xl border border-brand-cyan/25 bg-brand-white/5 px-3 py-2 text-xs text-brand-white outline-none focus:border-brand-blue/60"
                  >
                    {hasUsage ? <option value="best_for_you_proxy">Best for you (preview)</option> : null}
                    <option value="kwh1000_asc">Lowest @ 1000 kWh</option>
                    <option value="kwh500_asc">Lowest @ 500 kWh</option>
                    <option value="kwh2000_asc">Lowest @ 2000 kWh</option>
                    <option value="term_asc">Shortest term</option>
                    <option value="renewable_desc">Highest renewable</option>
                  </select>
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
                    className="rounded-full border border-brand-cyan/25 bg-brand-white/5 px-2 py-1 text-xs text-brand-white outline-none focus:border-brand-blue/60"
                  >
                    <option value={10}>10</option>
                    <option value={20}>20</option>
                    <option value={50}>50</option>
                  </select>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {hasUsage ? (
        <div className="mx-auto w-full max-w-5xl">
          <div className="rounded-3xl border border-brand-cyan/20 bg-brand-navy p-5 shadow-[0_18px_40px_rgba(10,20,60,0.35)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-sm font-semibold text-brand-white">Best plans for you (estimate)</div>
                <label className="mt-2 flex items-center gap-2 text-xs text-brand-cyan/75 select-none">
                  <input
                    type="checkbox"
                    checked={bestRankAllIn === true}
                    onChange={(e) => setBestRankAllIn(e.target.checked)}
                    className="h-4 w-4 rounded border-brand-cyan/40 bg-brand-white/10"
                  />
                  Rank by all-in estimate (incl. TDSP)
                </label>
                <div className="mt-1 text-xs text-brand-cyan/70">
                  {typeof resp?.bestOffersDisclaimer === "string" && resp.bestOffersDisclaimer.trim()
                    ? resp.bestOffersDisclaimer.trim()
                    : "Based on your last 12 months usage. Ranking uses provider estimates until IntelliWatt true-cost is enabled."}
                </div>
                {typeof resp?.bestOffersBasis === "string" && resp.bestOffersBasis.trim() ? (
                  <div className="mt-1 text-[0.7rem] text-brand-cyan/55 font-mono">
                    {resp.bestOffersBasis.trim()}
                  </div>
                ) : null}
              </div>
              <div className="text-xs text-brand-cyan/60">
                {bestStripOffers.length ? `Top ${bestStripOffers.length}` : "No results"}
              </div>
            </div>

            {bestStripOffers.length > 0 ? (
              <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap md:flex-nowrap md:overflow-x-auto">
                {bestStripOffers.map((o) => {
                  const metric = pickBest1000MetricCentsPerKwh(o);
                  const supplier = (o as any)?.supplierName ?? "Unknown supplier";
                  const plan = (o as any)?.planName ?? "Unknown plan";
                  const status = (o as any)?.intelliwatt?.statusLabel ?? "UNAVAILABLE";
                  const statusClass =
                    status === "AVAILABLE"
                      ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-200"
                      : status === "QUEUED"
                        ? "border-amber-400/40 bg-amber-500/10 text-amber-200"
                        : "border-brand-cyan/20 bg-brand-white/5 text-brand-cyan/70";

                  const tce = (o as any)?.intelliwatt?.trueCostEstimate;
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
                          <div className="text-[0.65rem] uppercase tracking-[0.25em] text-brand-cyan/55">1000</div>
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


