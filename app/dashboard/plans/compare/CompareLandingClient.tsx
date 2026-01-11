"use client";

import Link from "next/link";
import { useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";

const LAST_OFFER_KEY = "dashboard_compare_last_offer_id_v1";

export default function CompareLandingClient() {
  const router = useRouter();
  const fallbackHref = useMemo(() => "/dashboard/plans", []);

  useEffect(() => {
    try {
      const last = (window.localStorage.getItem(LAST_OFFER_KEY) ?? "").trim();
      if (last) {
        router.replace(`/dashboard/plans/compare/${encodeURIComponent(last)}`);
      }
    } catch {
      // ignore storage failures
    }
  }, [router]);

  return (
    <div className="mx-auto w-full max-w-5xl">
      <div className="mt-6 text-2xl font-semibold text-brand-white">Compare</div>
      <div className="mt-2 rounded-3xl border border-brand-cyan/20 bg-brand-navy p-6 text-brand-cyan/80 shadow-[0_18px_40px_rgba(10,20,60,0.22)]">
        <div className="text-sm text-brand-cyan/80">
          To compare, pick a plan first. We’ll take you to the side-by-side Current vs New breakdown (with a termination-fee toggle).
        </div>
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


