"use client";

import React, { useEffect, useState, useTransition, FormEvent, useRef } from "react";
import { useRouter } from "next/navigation";
import { RepSelector } from "@/components/smt/RepSelector";

type SmtAuthorizationFormProps = {
  houseAddressId: string;
  houseId?: string | null;
  esiid?: string | null;
  tdspCode?: string | null;
  tdspName?: string | null;
  serviceAddressLine1?: string | null;
  serviceAddressLine2?: string | null;
  serviceCity?: string | null;
  serviceState?: string | null;
  serviceZip?: string | null;
  contactEmail: string;
  existingAuth?: any | null;
  initialMeterNumber?: string | null;
  showHeader?: boolean;
};

type ApiError = {
  error?: string;
  details?: Record<string, unknown>;
};

export function SmtAuthorizationForm(props: SmtAuthorizationFormProps) {
  const {
    houseAddressId,
    houseId,
    esiid,
    tdspCode,
    tdspName,
    serviceAddressLine1,
    serviceAddressLine2,
    serviceCity,
    serviceState,
    serviceZip,
    contactEmail,
    existingAuth,
    initialMeterNumber,
    showHeader = true,
  } = props;

  const [customerName, setCustomerName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [meterNumber, setMeterNumber] = useState(
    typeof initialMeterNumber === "string" ? initialMeterNumber.trim() : "",
  );
  const [preferredProviderName, setPreferredProviderName] = useState<string | null>(null);
  const [repPuctNumber, setRepPuctNumber] = useState<string | undefined>(undefined);
  const [isPending, startTransition] = useTransition();

  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null);
  const [showEmailReminder, setShowEmailReminder] = useState(false);
  const [emailConfirmationSubmitting, setEmailConfirmationSubmitting] = useState<
    "idle" | "approved" | "declined"
  >("idle");
  const [emailConfirmationError, setEmailConfirmationError] = useState<string | null>(null);
  const router = useRouter();

  const reminderStorageKey = `smt-email-reminder:${houseAddressId}`;
  const hasActiveAuth = Boolean(existingAuth);

  const [autoEsiid, setAutoEsiid] = useState(esiid ?? "");
  const [autoServiceAddressLine1, setAutoServiceAddressLine1] = useState(serviceAddressLine1 ?? "");
  const [autoServiceAddressLine2, setAutoServiceAddressLine2] = useState(serviceAddressLine2 ?? null);
  const [autoServiceCity, setAutoServiceCity] = useState(serviceCity ?? "");
  const [autoServiceState, setAutoServiceState] = useState(serviceState ?? "");
  const [autoServiceZip, setAutoServiceZip] = useState(serviceZip ?? "");

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const storedReminder = window.localStorage.getItem(reminderStorageKey);
    if (storedReminder === "pending") {
      setShowEmailReminder(true);
    }
  }, [reminderStorageKey]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const targetHouseId = houseId ?? houseAddressId;
    if (!targetHouseId) {
      return;
    }

    const hydrateFromSmtInit = async () => {
      try {
        const res = await fetch(
          `/api/smt/init?houseId=${encodeURIComponent(targetHouseId)}`,
          { method: "GET", cache: "no-store" },
        );
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.ok) {
          return;
        }

        if (!autoEsiid && typeof data.esiid === "string" && data.esiid.trim().length > 0) {
          setAutoEsiid(data.esiid.trim());
        }

        if (!meterNumber && typeof data.meterNumber === "string" && data.meterNumber.trim().length > 0) {
          setMeterNumber(data.meterNumber.trim());
        }

        if (!customerName && typeof data.customerName === "string" && data.customerName.trim().length > 0) {
          setCustomerName(data.customerName.trim());
        }

        if (!preferredProviderName && typeof data.providerName === "string" && data.providerName.trim().length > 0) {
          setPreferredProviderName(data.providerName.trim());
        }

        const addr = data.serviceAddress ?? {};
        if (!autoServiceAddressLine1 && typeof addr.line1 === "string" && addr.line1.trim().length > 0) {
          setAutoServiceAddressLine1(addr.line1.trim());
        }
        if (!autoServiceCity && typeof addr.city === "string" && addr.city.trim().length > 0) {
          setAutoServiceCity(addr.city.trim());
        }
        if (!autoServiceState && typeof addr.state === "string" && addr.state.trim().length > 0) {
          setAutoServiceState(addr.state.trim());
        }
        if (!autoServiceZip && typeof addr.zip === "string" && addr.zip.trim().length > 0) {
          setAutoServiceZip(addr.zip.trim());
        }
      } catch {
        // best-effort; ignore errors
      }
    };

    void hydrateFromSmtInit();

    const handleUpdated = () => {
      void hydrateFromSmtInit();
    };

    window.addEventListener("smt-init-updated", handleUpdated);
    return () => {
      window.removeEventListener("smt-init-updated", handleUpdated);
    };
  }, [
    houseAddressId,
    houseId,
    autoEsiid,
    autoServiceAddressLine1,
    autoServiceCity,
    autoServiceState,
    autoServiceZip,
    customerName,
    meterNumber,
    preferredProviderName,
  ]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handleConfirmed = () => {
      setShowEmailReminder(false);
      window.localStorage.removeItem(reminderStorageKey);
    };

    window.addEventListener("smt-email-confirmed", handleConfirmed);
    return () => {
      window.removeEventListener("smt-email-confirmed", handleConfirmed);
    };
  }, [reminderStorageKey]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.removeItem(reminderStorageKey);
  }, [reminderStorageKey]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    setSubmitSuccess(null);

    if (!customerName.trim()) {
      setSubmitError("Please enter the name that appears on your electric bill.");
      return;
    }

    if (!repPuctNumber) {
      setSubmitError("Please select your Retail Electric Provider before submitting.");
      return;
    }

    startTransition(() => {
      void (async () => {
        try {
          const payload: Record<string, unknown> = {
            houseAddressId,
            customerName: customerName.trim(),
            contactPhone: contactPhone.trim() || undefined,
            consent: true,
            consentTextVersion: "smt-poa-v1",
          };
          payload.repPuctNumber = repPuctNumber;
          const trimmedMeter = meterNumber.trim();
          if (trimmedMeter.length > 0) {
            payload.meterNumber = trimmedMeter;
          }

          const res = await fetch("/api/smt/authorization", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(payload),
          });

          if (!res.ok) {
            let message = "Something went wrong while saving your authorization.";
            let json: ApiError | null = null;

            try {
              json = (await res.json()) as ApiError;
            } catch {
              // ignore JSON parse errors; fall back to generic message
            }

            if (json?.error) {
              message = json.error;
            }

            setSubmitError(message);
            return;
          }

          setSubmitSuccess(
            "Your Smart Meter Texas authorization has been saved. We’ll begin pulling your interval and billing data shortly.",
          );
          setShowEmailReminder(true);
          if (typeof window !== "undefined") {
            window.dispatchEvent(new CustomEvent("entriesUpdated"));
          }
          router.push("/dashboard/smt-confirmation");
        } catch (err) {
          console.error("SMT authorization submit error", err);
          setSubmitError(
            "We couldn’t reach the server. Please check your connection and try again.",
          );
        }
      })();
    });
  }

  async function handleEmailConfirmationChoice(choice: "approved" | "declined") {
    if (emailConfirmationSubmitting !== "idle") {
      return;
    }

    setEmailConfirmationSubmitting(choice);
    setEmailConfirmationError(null);

    try {
      const response = await fetch("/api/user/smt/email-confirmation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: choice }),
      });

      if (!response.ok) {
        const data = await response
          .json()
          .catch(() => ({ error: "Unable to record confirmation status" }));
        throw new Error(data?.error ?? "Unable to record confirmation status");
      }

      if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("entriesUpdated"));
      }

      setShowEmailReminder(false);
      if (typeof window !== "undefined") {
        window.localStorage.removeItem(reminderStorageKey);
      }
      router.refresh();
    } catch (error) {
      console.error("Failed to update SMT email confirmation status", error);
      setEmailConfirmationError(
        error instanceof Error
          ? error.message
          : "We could not record your response right now. Please try again.",
      );
    } finally {
      setEmailConfirmationSubmitting("idle");
    }
  }

  const containerClasses = showHeader
    ? "w-full max-w-full space-y-3 rounded-xl border border-slate-200 bg-white/80 p-4 shadow-sm backdrop-blur"
    : "w-full max-w-full space-y-3 rounded-2xl border border-brand-blue/10 bg-white p-4 shadow";

  return (
    <div className={containerClasses}>
      {showHeader && (
        <>
          <div className="grid gap-3 rounded-lg border-2 border-brand-blue bg-brand-navy p-3 text-center text-xs text-brand-cyan sm:grid-cols-2">
            <div className="space-y-1">
              <div className="text-sm font-semibold uppercase tracking-wide text-brand-cyan">
                Service Address on File
              </div>
              <div className="space-y-0.5">
                <div>{autoServiceAddressLine1}</div>
                {autoServiceAddressLine2 ? <div>{autoServiceAddressLine2}</div> : null}
                <div>{[autoServiceCity, autoServiceState, autoServiceZip].filter(Boolean).join(", ")}</div>
                <div>
                  <span className="font-semibold">ESIID · </span>
                  {autoEsiid || <span className="italic text-brand-cyan/70">Not available</span>}
                </div>
                <div>
                  <span className="font-semibold">Utility · </span>
                  {tdspName || tdspCode || <span className="italic text-brand-cyan/70">Not available</span>}
                </div>
              </div>
            </div>
            <div className="space-y-1">
              <div className="text-sm font-semibold uppercase tracking-wide text-brand-cyan">
                Utility Integrations
              </div>
              <div className="space-y-0.5">
                <div>
                  <span className="font-semibold">Contact Email · </span>
                  {contactEmail}
                </div>
              </div>
            </div>
          </div>

          {hasActiveAuth && (
            <div className="space-y-1 rounded-lg border-2 border-brand-blue bg-brand-navy p-3 text-center text-xs text-brand-cyan">
              <div className="text-sm font-semibold uppercase tracking-wide">
                Active SMT authorization already on file
              </div>
              <p className="leading-relaxed">
                We already have a valid Smart Meter Texas authorization for this address. You can submit this form again to
                refresh or update your authorization, especially if you’ve changed providers, revoked consent in Smart Meter Texas,
                or updated your information.
              </p>
            </div>
          )}
        </>
      )}

      <form
        onSubmit={handleSubmit}
        className={`space-y-3 ${showHeader ? "" : "pt-2"}`}
      >
        <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-[11px] leading-relaxed text-slate-700">
          <p>
            By continuing, you authorize{" "}
            <strong>IntelliPath Solutions LLC (IntelliWatt™)</strong> to access your
            electricity usage information from Smart Meter Texas, your Transmission and Distribution Service Provider (TDSP),
            and your Retail Electric Provider (REP). This access is limited to analyzing your usage and identifying better rate plans.
          </p>
          <p>
            You also authorize IntelliPath Solutions LLC to electronically sign any required Letters of Authorization on your behalf,
            consistent with ERCOT and SMT rules, so we can retrieve up to 12 months of interval, meter, and billing data.
            This authorization does not enroll you in a new plan or change your service without your separate confirmation.
          </p>
          <p>
            A copy of the authorization terms is available on request and will reflect the details you provide in this portal at the
            time of consent.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <label
              htmlFor="customerName"
              className="block text-xs font-medium text-slate-800"
            >
              Name on electric bill
            </label>
            <input
              id="customerName"
              name="customerName"
              type="text"
              autoComplete="name"
              className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:bg-slate-100"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              disabled={isPending}
              placeholder="First and last name as it appears on your bill"
            />
          </div>

          <div className="space-y-1">
            <label
              htmlFor="contactPhone"
              className="block text-xs font-medium text-slate-800"
            >
              Mobile phone (optional)
            </label>
            <input
              id="contactPhone"
              name="contactPhone"
              type="tel"
              autoComplete="tel"
              className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:bg-slate-100"
              value={contactPhone}
              onChange={(e) => setContactPhone(e.target.value)}
              disabled={isPending}
              placeholder="We’ll only use this for account questions"
            />
          </div>
        </div>

        <RepSelector
          repPuctNumber={repPuctNumber}
          onChange={setRepPuctNumber}
          preferredProviderName={preferredProviderName}
        />

        <div className="space-y-1">
          <label
            htmlFor="meterNumber"
            className="block text-xs font-medium text-slate-800"
          >
            Enter your meter number
          </label>
          <input
            id="meterNumber"
            name="meterNumber"
            type="text"
            className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:bg-slate-100"
            value={meterNumber}
            onChange={(event) => setMeterNumber(event.target.value)}
            disabled={isPending}
            placeholder="Meter number from your bill (e.g., 123456789LG)"
            inputMode="text"
            autoComplete="off"
            required
          />
          <p className="text-[11px] text-slate-500">
            You can find this printed near “Meter Number” or “ESI Meter” on your electric bill, or on the faceplate of your physical meter next to the barcode.
          </p>
        </div>

        <div className="space-y-2">
          <div className="max-h-48 overflow-y-auto rounded-lg border border-brand-navy bg-white/10 p-3 text-xs leading-relaxed text-slate-700">
            <p className="font-medium text-slate-900">Smart Meter Texas Authorization Terms</p>
            <ul className="mt-2 list-disc space-y-1 pl-4">
              <li>
                IntelliWatt (Intellipath Solutions LLC) will access your
                <span className="font-semibold"> electric usage data stored in Smart Meter Texas</span>,
                including 15-minute interval usage, daily meter reads, and monthly billing reads
                associated with the ESIID and service address shown above.
              </li>
              <li>
                Your consent authorizes access for up to <span className="font-semibold">12 months</span>
                from the authorization start date saved in our system, unless you revoke that consent earlier.
              </li>
              <li>
                Your data will be used <span className="font-semibold">only for energy analysis, plan matching, and optimization services</span>
                provided by IntelliWatt. We do not sell your SMT data.
              </li>
              <li>
                You may revoke this authorization at any time by terminating the data sharing agreement in
                your Smart Meter Texas account or by contacting IntelliWatt using the email or phone number
                listed in your dashboard communications.
              </li>
              <li>
                This consent does not change your current Retail Electric Provider or your utility service. It only
                allows IntelliWatt, as a registered Competitive Service Provider, to securely read your meter data
                through Smart Meter Texas.
              </li>
            </ul>
          </div>

          <button
            type="submit"
            disabled={isPending}
            className="w-full rounded-full bg-brand-navy px-4 py-2 text-sm font-semibold uppercase tracking-wide text-brand-cyan shadow-[0_0_20px_rgba(16,182,231,0.45)] transition focus:outline-none focus:ring-2 focus:ring-brand-cyan focus:ring-offset-2 focus:ring-offset-brand-navy disabled:cursor-not-allowed disabled:opacity-70 max-[480px]:text-xs"
          >
            AUTHORIZE OR UPDATE AUTHORIZATION
          </button>
          {isPending && (
            <p className="text-center text-[11px] uppercase tracking-wide text-slate-500">
              Submitting authorization…
            </p>
          )}
        </div>

        {submitError && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-center text-xs text-red-800">
            {submitError}
          </div>
        )}

        {submitSuccess && (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-center text-xs text-emerald-800">
            {submitSuccess}
          </div>
        )}

      </form>
      {showEmailReminder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="smt-email-reminder-title"
            className="w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-3xl border border-brand-blue/40 bg-brand-navy p-6 text-brand-cyan shadow-[0_24px_60px_rgba(16,46,90,0.55)] sm:p-8"
          >
            <h3
              id="smt-email-reminder-title"
              className="text-lg font-semibold uppercase tracking-[0.3em] text-brand-cyan/60"
            >
              Check your inbox — action required
            </h3>
            <p className="mt-4 text-sm leading-relaxed text-brand-cyan/80">
              We just asked Smart Meter Texas to authorize IntelliWatt. Look for an email from{" "}
              <span className="font-semibold text-brand-cyan">info@communications.smartmetertexas.com</span> with the
              subject “Authorization to allow Intelliwatt to access your electricity information”.
            </p>
            <ul className="mt-4 space-y-3 rounded-2xl border border-brand-blue/30 bg-brand-blue/5 px-4 py-3 text-sm text-brand-cyan/85">
              <li>
                • Open the email and click <span className="font-semibold text-brand-cyan">Confirm</span> to approve the
                request before it expires.
              </li>
              <li>
                • If you did not expect the request, choose <span className="font-semibold text-brand-cyan">Did Not Request</span>{" "}
                or contact support immediately.
              </li>
              <li>
                • You can always revoke this authorization later from your IntelliWatt profile.
              </li>
            </ul>
            <p className="mt-4 text-xs uppercase tracking-wide text-brand-cyan/60">
              Confirm the email first, then choose the option that reflects what you did.
            </p>
            {emailConfirmationError ? (
              <div className="mt-4 rounded-md border border-rose-400/40 bg-rose-400/10 px-4 py-3 text-xs text-rose-200">
                {emailConfirmationError}
              </div>
            ) : null}
            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={() => handleEmailConfirmationChoice("declined")}
                disabled={emailConfirmationSubmitting !== "idle"}
                className="inline-flex items-center justify-center rounded-full border border-rose-400/60 bg-rose-400/10 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-rose-200 transition hover:border-rose-300 hover:text-rose-100 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {emailConfirmationSubmitting === "declined"
                  ? "Recording decline…"
                  : "I declined or revoked the SMT email"}
              </button>
              <button
                type="button"
                onClick={() => handleEmailConfirmationChoice("approved")}
                disabled={emailConfirmationSubmitting !== "idle"}
                className="inline-flex items-center justify-center rounded-full border border-brand-cyan/60 bg-brand-cyan/10 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-brand-cyan transition hover:border-brand-blue hover:text-brand-blue disabled:cursor-not-allowed disabled:opacity-60"
              >
                {emailConfirmationSubmitting === "approved"
                  ? "Saving approval…"
                  : "I approved the email from SMT"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default SmtAuthorizationForm;

