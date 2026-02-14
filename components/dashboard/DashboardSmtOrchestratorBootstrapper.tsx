"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

type OrchestrateResponse = {
  ok: boolean;
  done?: boolean;
  phase?: string;
  nextPollMs?: number | null;
};

export default function DashboardSmtOrchestratorBootstrapper() {
  const pathname = usePathname();
  const startedRef = useRef(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (startedRef.current) return;
    if (!pathname) return;
    if (pathname.startsWith("/dashboard/smt-confirmation")) return;

    const key = "smt_orchestrator_bootstrap_v1";
    try {
      const alreadyRaw = window.sessionStorage.getItem(key);
      const alreadyAt = alreadyRaw ? Number(alreadyRaw) : Number.NaN;
      // 30s TTL to avoid spammy calls across route transitions.
      if (Number.isFinite(alreadyAt) && Date.now() - alreadyAt < 30_000) return;
      window.sessionStorage.setItem(key, String(Date.now()));
    } catch {
      // ignore
    }

    startedRef.current = true;

    let cancelled = false;

    async function tick() {
      if (cancelled) return;
      try {
        const res = await fetch("/api/user/smt/orchestrate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
          // Keepalive helps for page transitions; request is small.
          keepalive: true,
          cache: "no-store",
        });
        const json = (await res.json().catch(() => null)) as OrchestrateResponse | null;
        const next = json?.ok ? json?.nextPollMs : null;
        const done = Boolean(json?.done);
        if (!done && typeof next === "number" && next > 0) {
          timerRef.current = window.setTimeout(() => void tick(), next);
        }
      } catch {
        // swallow; we'll try again later (but don't set tight retry loops)
        timerRef.current = window.setTimeout(() => void tick(), 60_000);
      }
    }

    void tick();

    return () => {
      cancelled = true;
      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [pathname]);

  return null;
}

