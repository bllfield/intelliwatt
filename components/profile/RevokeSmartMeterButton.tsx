"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface Props {
  authorizationId: string | null;
}

export function RevokeSmartMeterButton({ authorizationId }: Props) {
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);

  const handleRevoke = async () => {
    if (!authorizationId || status === "loading") {
      return;
    }

    setStatus("loading");
    setMessage(null);

    try {
      const response = await fetch("/api/smt/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ authorizationId }),
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        const errorMessage =
          payload?.error ?? "We couldn’t submit your revocation request. Please try again.";
        setStatus("error");
        setMessage(errorMessage);
        return;
      }

      setStatus("success");
      setMessage(
        "We received your revocation request. Our team will disable SMT access and follow up shortly."
      );
      if (typeof window !== "undefined") {
        Object.keys(window.localStorage)
          .filter((key) => key.startsWith("smt-email-reminder:"))
          .forEach((key) => window.localStorage.removeItem(key));
      }
      router.refresh();
    } catch (error) {
      console.error("Failed to revoke SMT access", error);
      setStatus("error");
      setMessage("Something went wrong submitting your request. Please try again.");
    } finally {
      setShowConfirm(false);
    }
  };

  if (!authorizationId) {
    return (
      <div className="mt-6 rounded-2xl border border-brand-cyan/40 bg-brand-navy/60 p-5 text-sm text-brand-cyan/70">
        You currently don’t have an active Smart Meter Texas connection for this home.
      </div>
    );
  }

  return (
    <div className="mt-6 space-y-4">
      <button
        onClick={() => setShowConfirm(true)}
        disabled={status === "loading"}
        className="inline-flex items-center rounded-full border border-rose-400/60 bg-rose-500/10 px-5 py-2 text-xs font-semibold uppercase tracking-wide text-rose-200 transition hover:border-rose-300 hover:text-rose-100 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {status === "loading" ? "Submitting..." : "Revoke SMT access"}
      </button>
      <p className="text-xs text-brand-cyan/70">
        Revoking access stops IntelliWatt from pulling Smart Meter Texas data.
      </p>
      {message ? (
        <div
          className={`rounded-lg border px-4 py-3 text-xs ${
            status === "success"
              ? "border-brand-cyan/40 bg-brand-cyan/10 text-brand-cyan"
              : "border-rose-400/40 bg-rose-500/10 text-rose-100"
          }`}
        >
          {message}
        </div>
      ) : null}

      {showConfirm ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-lg rounded-3xl border border-rose-400/30 bg-brand-navy p-6 text-brand-cyan shadow-[0_24px_60px_rgba(16,46,90,0.5)]">
            <h3 className="text-base font-semibold text-rose-200 uppercase tracking-[0.2em]">
              Confirm revocation
            </h3>
            <p className="mt-4 text-sm text-brand-cyan/80">
              Turning off Smart Meter Texas access immediately affects your IntelliWatt experience:
            </p>
            <ul className="mt-4 space-y-3 rounded-2xl border border-rose-400/30 bg-rose-500/5 p-4 text-sm text-brand-cyan/80">
              <li className="flex items-start gap-3">
                <span className="mt-1 h-2 w-2 rounded-full bg-rose-300"></span>
                Personalized plan recommendations pause because we can’t analyze your usage in real time.
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-1 h-2 w-2 rounded-full bg-rose-300"></span>
                SMT-based jackpot entries are removed, and any Home or Appliance profile entries tied to live
                usage expire.
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-1 h-2 w-2 rounded-full bg-rose-300"></span>
                Support has to manually complete the disconnect—re-authorizing later will restart the 12‑month
                history pull.
              </li>
            </ul>
            <p className="mt-4 text-xs text-brand-cyan/70">
              If you move or switch providers, consider updating your address and reauthorizing instead so you
              keep all entries and insights active.
            </p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-end">
              <button
                onClick={() => {
                  if (status !== "loading") {
                    setShowConfirm(false);
                  }
                }}
                className="rounded-full border border-brand-cyan/40 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-brand-cyan transition hover:border-brand-blue hover:text-brand-blue"
              >
                Keep SMT connected
              </button>
              <button
                onClick={handleRevoke}
                disabled={status === "loading"}
                className="rounded-full border border-rose-400 bg-rose-500/20 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-rose-100 transition hover:bg-rose-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Yes, revoke access
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}


