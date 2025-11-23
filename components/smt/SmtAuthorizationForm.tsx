"use client";

import React, { useState, useTransition, FormEvent } from "react";
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
  const [repPuctNumber, setRepPuctNumber] = useState<string | undefined>(undefined);
  const [isPending, startTransition] = useTransition();

  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null);

  const hasActiveAuth = Boolean(existingAuth);

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
        } catch (err) {
          console.error("SMT authorization submit error", err);
          setSubmitError(
            "We couldn’t reach the server. Please check your connection and try again.",
          );
        }
      })();
    });
  }

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-white/80 p-4 shadow-sm backdrop-blur">
      {showHeader && (
        <>
          <div className="grid gap-3 rounded-lg bg-brand-navy p-3 text-xs text-brand-cyan sm:grid-cols-2">
            <div className="space-y-1">
              <div className="text-sm font-semibold uppercase tracking-wide text-brand-cyan">
                Service Address on File
              </div>
              <div className="space-y-0.5">
                <div>{serviceAddressLine1}</div>
                {serviceAddressLine2 ? <div>{serviceAddressLine2}</div> : null}
                <div>{[serviceCity, serviceState, serviceZip].filter(Boolean).join(", ")}</div>
                <div>
                  <span className="font-semibold">ESIID · </span>
                  {esiid || <span className="italic text-brand-cyan/70">Not available</span>}
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
            <div className="space-y-1 rounded-lg border border-brand-cyan/40 bg-brand-navy p-3 text-xs text-brand-cyan">
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

      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="grid gap-4 sm:grid-cols-2">
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
        />

        <div className="space-y-1">
          <label
            htmlFor="meterNumber"
            className="block text-xs font-medium text-slate-800"
          >
            Meter number (optional)
          </label>
          <input
            id="meterNumber"
            name="meterNumber"
            type="text"
            className="w-full rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:bg-slate-100"
            value={meterNumber}
            onChange={(event) => setMeterNumber(event.target.value)}
            disabled={isPending}
            placeholder="As shown on your bill (e.g., 142606737LG)"
            inputMode="text"
            autoComplete="off"
          />
          <p className="text-[11px] text-slate-500">
            We’ll attempt to pull this automatically, but if you know it, enter the meter number from your electric bill to speed things up.
          </p>
        </div>

        <div className="space-y-2">
          <div className="max-h-48 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs leading-relaxed text-slate-700">
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
            className="w-full rounded-full bg-brand-navy px-4 py-2 text-sm font-semibold uppercase tracking-wide text-brand-cyan shadow-[0_0_20px_rgba(16,182,231,0.45)] transition focus:outline-none focus:ring-2 focus:ring-brand-cyan focus:ring-offset-2 focus:ring-offset-brand-navy disabled:cursor-not-allowed disabled:opacity-70"
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
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
            {submitError}
          </div>
        )}

        {submitSuccess && (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
            {submitSuccess}
          </div>
        )}

      </form>
    </div>
  );
}

export default SmtAuthorizationForm;

