"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

const LAST_OFFER_KEY = "dashboard_compare_last_offer_id_v1";
const COMPARE_BOOTSTRAP_KEY = "dashboard_compare_landing_bootstrap_v1";

export default function CompareLandingClient() {
  const router = useRouter();
  const fallbackHref = useMemo(() => "/dashboard/plans", []);
  const [status, setStatus] = useState<"idle" | "finding" | "failed">("idle");

  useEffect(() => {
    // React StrictMode (dev) intentionally double-invokes effects via a mount → cleanup → remount cycle.
    // Add a short session TTL guard to avoid duplicate fetches/redirects.
    try {
      const lastRaw = window.sessionStorage.getItem(COMPARE_BOOTSTRAP_KEY);
      const lastAt = lastRaw ? Number(lastRaw) : Number.NaN;
      // 3s: enough to dedupe StrictMode's immediate remount; still allows future visits.
      if (Number.isFinite(lastAt) && Date.now() - lastAt < 3000) {
        return () => {
          // no-op
        };
      }
      window.sessionStorage.setItem(COMPARE_BOOTSTRAP_KEY, String(Date.now()));
    } catch {
      // ignore storage failures; effect remains abort-safe
    }

    let cancelled = false;
    const controller = new AbortController();

    (async () => {
      try {
        // Compare requires current plan details (so the side-by-side comparison is meaningful).
        const s = await fetch("/api/dashboard/current-plan/status", {
          cache: "no-store",
          signal: controller.signal,
        });
        const sj = await s.json().catch(() => null);
        if (!s.ok || !sj || sj.ok !== true) throw new Error("status_check_failed");
        if (!sj.hasCurrentPlan) {
          router.replace("/dashboard/current-rate");
          return;
        }

        try {
          const last = (window.localStorage.getItem(LAST_OFFER_KEY) ?? "").trim();
          if (last) {
            router.replace(`/dashboard/plans/compare/${encodeURIComponent(last)}`);
            return;
          }
        } catch {
          // ignore storage failures
        }

        if (!cancelled) setStatus("finding");
        // If the user lands directly on Compare (no offer picked yet), default to the current "best offer"
        // from the Plans API: prefer all-in true-cost best, else proxy best, else first offer.
        const r = await fetch(`/api/dashboard/plans?dataset=0&page=1&pageSize=20&sort=best_for_you_proxy&_cmp=1`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const j = await r.json().catch(() => null);
        if (!r.ok || !j || j.ok !== true) throw new Error(j?.error ?? `Request failed (${r.status})`);
        const pick = (xs: any) => (Array.isArray(xs) && xs.length > 0 ? xs[0] : null);
        const bestAllIn = pick(j.bestOffersAllIn);
        const bestProxy = pick(j.bestOffers);
        const bestFromList = pick(j.offers);
        const bestOfferId =
          (bestAllIn && String(bestAllIn.offerId || "").trim()) ||
          (bestProxy && String(bestProxy.offerId || "").trim()) ||
          (bestFromList && String(bestFromList.offerId || "").trim()) ||
          "";
        if (bestOfferId) {
          router.replace(`/dashboard/plans/compare/${encodeURIComponent(bestOfferId)}`);
          return;
        }
        if (!cancelled) setStatus("failed");
      } catch {
        // Abort (unmount or StrictMode remount) should never flip UI to "failed".
        if (cancelled || controller.signal.aborted) return;
        if (!cancelled) setStatus("failed");
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  return (
    <div className="mx-auto w-full max-w-5xl">
      <div className="mt-6 text-2xl font-semibold text-brand-white">Compare</div>
      <div className="mt-2 rounded-3xl border border-brand-cyan/20 bg-brand-navy p-6 text-brand-cyan/80 shadow-[0_18px_40px_rgba(10,20,60,0.22)]">
        {status === "finding" ? (
          <div className="text-sm text-brand-cyan/80">Finding your best plan to compare…</div>
        ) : (
          <div className="text-sm text-brand-cyan/80">
            To compare, make sure you’ve added your current plan details first. Then we’ll take you to the side-by-side Current vs New breakdown (with a termination-fee toggle).
          </div>
        )}
        {status === "failed" ? (
          <div className="mt-2 text-xs text-brand-cyan/60">
            We couldn’t auto-select a recommended plan yet. Please choose a plan from your Plans list.
          </div>
        ) : null}
        <div className="mt-4">
          <Link
            href={fallbackHref}
            className="inline-flex items-center justify-center rounded-full border border-brand-cyan/25 bg-brand-white/5 px-5 py-3 text-sm font-semibold text-brand-cyan hover:bg-brand-white/10"
          >
            Go to Plans
          </Link>
        </div>
      </div>
    </div>
  );
}
