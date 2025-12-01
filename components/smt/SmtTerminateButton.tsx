"use client";

import * as React from "react";

import {
  terminateSmtAgreementSelf,
  type TerminateSelfResult,
} from "@/lib/client/smt";

interface SmtTerminateButtonProps {
  agreementNumber: number | string;
  retailCustomerEmail: string;
  className?: string;
  onCompleted?: (result: TerminateSelfResult) => void;
}

export function SmtTerminateButton(props: SmtTerminateButtonProps) {
  const { agreementNumber, retailCustomerEmail, className, onCompleted } = props;

  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState<string | null>(null);

  const handleClick = async () => {
    setError(null);
    setSuccess(null);

    const confirmed = window.confirm(
      "Are you sure you want to revoke IntelliWatt's access to your Smart Meter Texas data? This will stop live usage syncing until you reconnect.",
    );
    if (!confirmed) return;

    setIsSubmitting(true);
    try {
      const result = await terminateSmtAgreementSelf({
        agreementNumber,
        retailCustomerEmail,
      });

      if (!result.ok) {
        const msg =
          result.message ??
          result.error ??
          "We couldn’t submit your termination request. Please try again.";
        setError(msg);
      } else {
        setSuccess(
          "Termination request submitted. We’ll email you once Smart Meter Texas confirms the disconnect.",
        );
      }

      onCompleted?.(result);
    } catch (err) {
      console.error("SmtTerminateButton error:", err);
      setError("Something went wrong while submitting the termination request.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className={className}>
      <button
        type="button"
        onClick={handleClick}
        disabled={isSubmitting}
        className="inline-flex items-center rounded-md border border-red-500 px-3 py-1 text-sm font-medium text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isSubmitting ? "Submitting…" : "Revoke Smart Meter Access"}
      </button>
      {error ? (
        <p className="mt-2 text-xs text-red-600">{error}</p>
      ) : null}
      {success ? (
        <p className="mt-2 text-xs text-emerald-600">{success}</p>
      ) : null}
    </div>
  );
}

