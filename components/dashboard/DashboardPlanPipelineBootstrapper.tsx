"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

export default function DashboardPlanPipelineBootstrapper() {
  const pathname = usePathname();
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    if (!pathname) return;

    // IMPORTANT: We DO allow triggering from /dashboard/plans as a fallback (once per short TTL).
    // This prevents the "all queued forever" experience when a user lands on Plans first after login.

    // Run once per browser session (with a short TTL so logout/login or long idle can re-trigger).
    const key = "plan_pipeline_bootstrap_v2";
    try {
      const alreadyRaw = window.sessionStorage.getItem(key);
      const alreadyAt = alreadyRaw ? Number(alreadyRaw) : Number.NaN;
      // 2 minutes: rely on server-side lock/cooldown; this is just to avoid spammy calls.
      if (Number.isFinite(alreadyAt) && Date.now() - alreadyAt < 2 * 60 * 1000) return;
      window.sessionStorage.setItem(key, String(Date.now()));
    } catch {
      // ignore storage failures; we'll still try once per mount
    }

    startedRef.current = true;

    async function kick() {
      try {
        // Match the Plans page dataset identity so the browser can reuse the cached response.
        let isRenter = "false";
        try {
          const raw = window.localStorage.getItem("dashboard_plans_is_renter");
          if (raw === "true") isRenter = "true";
        } catch {
          // ignore
        }

        const params = new URLSearchParams();
        params.set("reason", "dashboard_bootstrap");
        params.set("timeBudgetMs", "12000");
        params.set("maxTemplateOffers", "6");
        params.set("maxEstimatePlans", "25");
        params.set("isRenter", isRenter);

        // IMPORTANT: do not abort this request early.
        // Vercel can terminate the serverless function when the client disconnects/aborts,
        // which would prevent cache warm-up from ever finishing.
        await fetch(`/api/dashboard/plans/pipeline?${params.toString()}`, {
          method: "POST",
          keepalive: true,
        }).catch(() => null);

        // Also prefetch the first page of Plans so /dashboard/plans doesn't need to be the first request.
        // (Do NOT prefetch 2000 rows; that makes the server do too much work and can lead to multi-minute requests.)
        const qs = new URLSearchParams();
        qs.set("page", "1");
        qs.set("pageSize", "50");
        qs.set("sort", "kwh1000_asc");
        qs.set("_r", "0");
        qs.set("isRenter", isRenter);
        fetch(`/api/dashboard/plans?${qs.toString()}`).catch(() => null);
      } finally {
      }
    }

    kick();
    return () => {
    };
  }, [pathname]);

  return null;
}


