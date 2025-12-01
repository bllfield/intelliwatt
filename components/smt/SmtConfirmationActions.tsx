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

  async function postConfirmation(choice: "approved" | "declined") {
    if (state !== "idle") return;
    setState(choice);
    setError(null);

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

      await refreshAuthorizationStatus();
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
      await fetch("/api/smt/authorization/status", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ homeId }),
      });
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

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <button
          type="button"
          onClick={() => postConfirmation("approved")}
          disabled={state !== "idle"}
          className="inline-flex items-center justify-center rounded-md border border-emerald-500 px-4 py-2 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {state === "approved" ? "Saving approval…" : "I approved the SMT email"}
        </button>

        <button
          type="button"
          onClick={() => postConfirmation("declined")}
          disabled={state !== "idle"}
          className="inline-flex items-center justify-center rounded-md border border-rose-500 px-4 py-2 text-sm font-semibold text-rose-600 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {state === "declined" ? "Recording decline…" : "I declined the SMT email"}
        </button>

        <button
          type="button"
          onClick={refreshAuthorizationStatus}
          disabled={state !== "idle"}
          className="inline-flex items-center justify-center rounded-md border border-blue-500 px-4 py-2 text-sm font-semibold text-blue-600 transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {state === "refresh" ? "Refreshing…" : "Refresh status"}
        </button>
      </div>
    </div>
  );
}


