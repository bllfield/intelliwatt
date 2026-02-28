"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type ActionState = "idle" | "approved" | "declined" | "refresh";

interface Props {
  homeId: string;
}

export function SmtConfirmationActions({ homeId }: Props) {
  const router = useRouter();
  const didAutoRefreshRef = useRef(false);
  const [state, setState] = useState<ActionState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isWaitingOnSmt, setIsWaitingOnSmt] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  function pollDelayMs(attempts: number): number {
    if (attempts < 6) return 5000;
    if (attempts < 20) return 15000;
    return 30000;
  }

  async function pollUsageReady(homeIdToPoll: string, attempts: number = 0): Promise<void> {
    // Cap polling to about ~20 minutes with backoff.
    if (attempts > 60) {
      setIsWaitingOnSmt(false);
      setIsProcessing(false);
      setError("Still waiting on SMT data after several minutes. Try again later.");
      return;
    }

    try {
      const res = await fetch("/api/user/smt/orchestrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ homeId: homeIdToPoll }),
        cache: "no-store",
      });
      const payload: any = await res.json().catch(() => null);

      if (res.ok && payload?.ok) {
        if (payload.phase === "ready" || payload?.usage?.ready) {
          setIsWaitingOnSmt(false);
          setIsProcessing(false);
          setStatusMessage("Your full SMT history has been ingested and your dashboard has been updated.");
          setState("idle");
          router.replace("/dashboard/smt-confirmation");
          router.refresh();
          return;
        }
        if (payload.phase === "active_waiting_usage" || payload?.usage?.status === "processing" || (payload?.usage?.rawFiles > 0 && !payload?.usage?.ready)) {
          setIsWaitingOnSmt(false);
          setIsProcessing(true);
          const coverage = payload?.usage?.coverage;
          const coverageText =
            coverage?.start && coverage?.end
              ? ` Current coverage: ${String(coverage.start).slice(0, 10)} – ${String(coverage.end).slice(0, 10)} (${coverage.days ?? "?"} day(s)).`
              : "";
          setStatusMessage(
            (payload?.usage?.message ||
              "We are processing your SMT usage. Historical backfill can take some time.") + coverageText,
          );
        }
      }
    } catch {
      // swallow transient polling errors; we will try again
    }

    setTimeout(() => {
      void pollUsageReady(homeIdToPoll, attempts + 1);
    }, pollDelayMs(attempts));
  }

  async function triggerUsageRefreshFlow() {
    try {
      // Trigger the orchestrator: refresh status (cooldown), request backfill, and kick droplet pulls.
      const usageResponse = await fetch("/api/user/smt/orchestrate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ homeId, force: true }),
      });

      let usagePayload: any = null;
      try {
        usagePayload = await usageResponse.json();
      } catch {
        usagePayload = null;
      }

      if (!usageResponse.ok || !usagePayload?.ok) {
        const message =
          usagePayload?.message || usagePayload?.error || "SMT orchestrator failed.";
        throw new Error(message);
      }

      setIsWaitingOnSmt(true);
      setIsProcessing(false);
      setStatusMessage(
        "We’re processing your Smart Meter Texas data. Once a full 12‑month window is present, refresh will be limited to once every 30 days unless gaps are detected.",
      );
      void pollUsageReady(homeId);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to refresh Smart Meter Texas data.";
      setError(message);
    }
  }

  async function postConfirmation(choice: "approved" | "declined") {
    if (state !== "idle") return;
    setState(choice);
    setError(null);
    setStatusMessage(null);
    setIsWaitingOnSmt(false);
    setIsProcessing(false);

    try {
      const confirmation = await fetch("/api/user/smt/email-confirmation", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ status: choice }),
        cache: "no-store",
      });

      let payload: any = null;
      try {
        payload = await confirmation.json();
      } catch {
        // ignore JSON parse errors; payload stays null
      }

      if (!confirmation.ok || (payload && payload.ok === false)) {
        const message =
          payload?.message ||
          payload?.error ||
          "Could not record your response. Please try again.";
        throw new Error(message);
      }

      if (choice === "approved") {
        await triggerUsageRefreshFlow();
      } else {
        await refreshAuthorizationStatus();
      }
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Unable to record your response right now. Please try again.";
      setError(message);
    } finally {
      setState("idle");
    }
  }

  async function refreshAuthorizationStatus() {
    setState("refresh");
    setError(null);
    try {
      const res = await fetch("/api/smt/authorization/status", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ homeId }),
        cache: "no-store",
      });
      const payload = (await res.json().catch(() => null)) as any;
      const statusRaw =
        typeof payload?.authorization?.smtStatus === "string"
          ? payload.authorization.smtStatus.toLowerCase()
          : null;
      const statusMessage = payload?.authorization?.smtStatusMessage?.toLowerCase?.() ?? "";
      const isActive =
        statusRaw === "active" ||
        statusRaw === "act" ||
        statusRaw === "already_active" ||
        statusMessage.includes("already active");

      if (isActive) {
        setStatusMessage("Your Smart Meter Texas authorization is active. We’ll keep pulling usage automatically.");
        setState("idle");
        router.replace("/dashboard/smt-confirmation");
        router.refresh();
        return;
      }

      router.refresh();
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Failed to refresh the agreement status. Try again in a moment.";
      setError(message);
      setState("idle");
      return;
    }
    setState("idle");
  }

  useEffect(() => {
    if (!homeId || didAutoRefreshRef.current) return;
    didAutoRefreshRef.current = true;
    void refreshAuthorizationStatus();
  }, [homeId]);

  return (
    <div className="space-y-4">
      {error ? (
        <div className="rounded-md border border-rose-400/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
          {error}
        </div>
      ) : null}
      {statusMessage ? (
        <div className="rounded-md border border-emerald-400/40 bg-emerald-500/5 px-4 py-3 text-xs text-emerald-100">
          {statusMessage}
        </div>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <button
          type="button"
          onClick={() => postConfirmation("approved")}
          disabled={state !== "idle" || isWaitingOnSmt || isProcessing}
          className="inline-flex items-center justify-center rounded-md border border-emerald-500 px-4 py-2 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {state === "approved" || isWaitingOnSmt || isProcessing
            ? isProcessing
              ? "Processing SMT data…"
              : "Waiting on SMT…"
            : "I approved the SMT email"}
        </button>

        <button
          type="button"
          onClick={() => postConfirmation("declined")}
          disabled={state !== "idle" || isWaitingOnSmt || isProcessing}
          className="inline-flex items-center justify-center rounded-md border border-rose-500 px-4 py-2 text-sm font-semibold text-rose-600 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {state === "declined" ? "Recording decline…" : "I declined the SMT email"}
        </button>

        <button
          type="button"
          onClick={refreshAuthorizationStatus}
          disabled={state !== "idle" || isWaitingOnSmt || isProcessing}
          className="inline-flex items-center justify-center rounded-md border border-blue-500 px-4 py-2 text-sm font-semibold text-brand-navy transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {state === "refresh" ? "Refreshing…" : "Refresh status"}
        </button>
      </div>
    </div>
  );
}


