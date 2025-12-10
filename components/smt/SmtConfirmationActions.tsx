"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type ActionState = "idle" | "approved" | "declined" | "refresh";

interface Props {
  homeId: string;
}

export function SmtConfirmationActions({ homeId }: Props) {
  const router = useRouter();
  const [state, setState] = useState<ActionState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isWaitingOnSmt, setIsWaitingOnSmt] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);

  async function pollUsageReady(homeIdToPoll: string, attempts: number = 0): Promise<void> {
    // Cap polling to about 8 minutes at 5s intervals (~96 attempts).
    if (attempts > 96) {
      setIsWaitingOnSmt(false);
      setIsProcessing(false);
      setError("Still waiting on SMT data after several minutes. Try again later.");
      return;
    }

    try {
      const res = await fetch("/api/user/usage/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ homeId: homeIdToPoll }),
        cache: "no-store",
      });
      const payload: any = await res.json().catch(() => null);

      if (res.ok && payload?.ok) {
        if (payload.status === "ready" || payload.ready) {
          setIsWaitingOnSmt(false);
          setIsProcessing(false);
          setStatusMessage("Your SMT usage data has arrived and your dashboard has been updated.");
          setState("idle");
          router.push("/dashboard/api");
          return;
        }
        if (payload.status === "processing" || (payload.rawFiles > 0 && !payload.ready)) {
          setIsWaitingOnSmt(false);
          setIsProcessing(true);
          setStatusMessage(
            "We received your SMT data package and are processing your usage. This can take a few minutes.",
          );
        }
      }
    } catch {
      // swallow transient polling errors; we will try again
    }

    setTimeout(() => {
      void pollUsageReady(homeIdToPoll, attempts + 1);
    }, 5000);
  }

  async function triggerUsageRefreshFlow() {
    try {
      // 1) Re-check authorization status (same as refresh button)
      const statusResponse = await fetch("/api/smt/authorization/status", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ homeId }),
      });
      const statusPayload: any = await statusResponse.json().catch(() => null);
      if (!statusResponse.ok || !statusPayload?.ok) {
        const message =
          statusPayload?.message ||
          statusPayload?.error ||
          `SMT status refresh failed (${statusResponse.status})`;
        throw new Error(message);
      }

      // 2) Trigger usage refresh (pull + backfill + normalize)
      const usageResponse = await fetch("/api/user/usage/refresh", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ homeId }),
      });

      let usagePayload: any = null;
      try {
        usagePayload = await usageResponse.json();
      } catch {
        usagePayload = null;
      }

      if (!usageResponse.ok || !usagePayload?.ok) {
        const message =
          usagePayload?.normalization?.message ||
          usagePayload?.homes?.[0]?.pull?.message ||
          "Usage refresh failed.";
        throw new Error(message);
      }

      const homeSummary = usagePayload.homes?.find((home: any) => home.homeId === homeId);
      const summaryMessages: string[] = [];

      if (homeSummary) {
        if (homeSummary.authorizationRefreshed) {
          summaryMessages.push("SMT authorization refreshed.");
        } else if (homeSummary.authorizationMessage) {
          summaryMessages.push(homeSummary.authorizationMessage);
        }

        if (homeSummary.pull.attempted) {
          summaryMessages.push(
            homeSummary.pull.ok
              ? homeSummary.pull.message ?? "SMT usage pull triggered."
              : homeSummary.pull.message ?? "SMT usage pull failed.",
          );
        }
      }

      if (usagePayload.normalization?.attempted) {
        summaryMessages.push(
          usagePayload.normalization.ok
            ? usagePayload.normalization.message ?? "Usage normalization triggered."
            : usagePayload.normalization.message ?? "Usage normalization failed.",
        );
      }

      setIsWaitingOnSmt(true);
      setIsProcessing(false);
      setStatusMessage(
        (summaryMessages.filter(Boolean).join(" ") || "SMT usage refresh triggered.") +
          " We requested your SMT data and are waiting for it to be delivered. This can take a few minutes.",
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
      });

      let payload: any = null;
      try {
        payload = await confirmation.json();
      } catch {
        // ignore JSON parse errors; payload stays null
      }

      if (!confirmation.ok || (payload && payload.ok === false)) {
        const message =
          payload?.error ||
          payload?.message ||
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
      });
      const payload = (await res.json().catch(() => null)) as any;
      const statusRaw =
        typeof payload?.authorization?.smtStatus === "string"
          ? payload.authorization.smtStatus.toLowerCase()
          : null;
      const statusMessage = payload?.authorization?.smtStatusMessage?.toLowerCase?.() ?? "";
      const isActive =
        statusRaw === "active" ||
        statusRaw === "already_active" ||
        statusMessage.includes("already active");

      if (isActive) {
        setState("idle");
        router.push("/dashboard/api");
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
          className="inline-flex items-center justify-center rounded-md border border-blue-500 px-4 py-2 text-sm font-semibold text-blue-600 transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {state === "refresh" ? "Refreshing…" : "Refresh status"}
        </button>
      </div>
    </div>
  );
}


