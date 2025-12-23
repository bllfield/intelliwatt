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
      <div className="mt-6 text-2xl font-semibold text-brand-navy">Compare</div>
      <div className="mt-2 rounded-3xl border border-brand-blue/20 bg-brand-blue/5 p-6 text-brand-navy">
        <div className="text-sm">
          To compare, pick a plan first. We’ll take you to the side-by-side Current vs New breakdown (with a termination-fee toggle).
        </div>
        <div className="mt-4">
          <Link
            href={fallbackHref}
            className="inline-flex items-center justify-center rounded-full bg-brand-blue px-5 py-3 text-sm font-semibold text-white hover:bg-brand-blue/90"
          >
            Go to Plans
          </Link>
        </div>
      </div>
    </div>
  );
}


