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
        "We received your revocation request. Our team will turn off SMT access and follow up shortly."
      );
      router.refresh();
    } catch (error) {
      console.error("Failed to revoke SMT access", error);
      setStatus("error");
      setMessage("Something went wrong submitting your request. Please try again.");
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
        onClick={handleRevoke}
        disabled={status === "loading"}
        className="inline-flex items-center rounded-full border border-rose-400/60 bg-rose-500/10 px-5 py-2 text-xs font-semibold uppercase tracking-wide text-rose-200 transition hover:border-rose-300 hover:text-rose-100 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {status === "loading" ? "Submitting..." : "Revoke SMT access"}
      </button>
      <p className="text-xs text-brand-cyan/70">
        When you revoke access, IntelliWatt stops pulling Smart Meter Texas data. We will confirm the
        disconnect via email once our support team finalizes the change.
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
    </div>
  );
}


