"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";

import { kickDashboardSmtOrchestrate } from "@/components/smt/ensureDashboardSmtOrchestrate";

export default function DashboardSmtOrchestratorBootstrapper() {
  const pathname = usePathname();
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    if (!pathname) return;
    if (pathname.startsWith("/dashboard/smt-confirmation")) return;

    startedRef.current = true;
    kickDashboardSmtOrchestrate();
  }, [pathname]);

  return null;
}
