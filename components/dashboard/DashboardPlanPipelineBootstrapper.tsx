"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

export default function DashboardPlanPipelineBootstrapper() {
  const pathname = usePathname();
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    if (!pathname) return;

    // Never trigger from the plans pages (per product requirement).
    if (pathname.startsWith("/dashboard/plans")) return;

    // Run once per browser session.
    const key = "plan_pipeline_bootstrap_v1";
    try {
      const already = window.sessionStorage.getItem(key);
      if (already) return;
      window.sessionStorage.setItem(key, String(Date.now()));
    } catch {
      // ignore storage failures; we'll still try once per mount
    }

    startedRef.current = true;

    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 10_000);

    async function kick() {
      try {
        const params = new URLSearchParams();
        params.set("reason", "dashboard_bootstrap");
        params.set("timeBudgetMs", "12000");
        params.set("maxTemplateOffers", "6");
        params.set("maxEstimatePlans", "25");
        // isRenter is read on server in other places; keep false here (no reliable client signal at bootstrap).
        params.set("isRenter", "false");

        await fetch(`/api/dashboard/plans/pipeline?${params.toString()}`, {
          method: "POST",
          signal: controller.signal,
        }).catch(() => null);
      } finally {
        window.clearTimeout(timer);
      }
    }

    kick();
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [pathname]);

  return null;
}


