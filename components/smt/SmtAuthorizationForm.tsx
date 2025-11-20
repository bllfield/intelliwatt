"use client";

import React, { useState, useTransition, FormEvent } from "react";

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
  } = props;

  const [customerName, setCustomerName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [consent, setConsent] = useState(false);
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

    if (!consent) {
      setSubmitError("You must provide consent before we can request your SMT data.");
      return;
    }

    startTransition(() => {
      void (async () => {
        try {
          const res = await fetch("/api/smt/authorization", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              houseAddressId,
              customerName: customerName.trim(),
              contactPhone: contactPhone.trim() || undefined,
              consent: true,
              consentTextVersion: "smt-poa-v1",
            }),
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

  const disabled = isPending || !consent;

  return (
    <div className="space-y-4 rounded-xl border border-slate-200 bg-white/80 p-4 shadow-sm backdrop-blur">
      <div className="space-y-1">
        <h3 className="text-base font-semibold text-slate-900">
          Smart Meter Texas Authorization
        </h3>
        <p className="text-sm text-slate-600">
          When you authorize IntelliWatt to access your Smart Meter Texas account, we will
          securely pull your electric usage data directly from your utility so we can show
          you accurate plan comparisons and savings opportunities.
        </p>
      </div>

      <div className="space-y-2 rounded-lg bg-slate-50 p-3 text-xs text-slate-700">
        <p className="font-medium text-slate-900">
          By checking the consent box and submitting this form, you understand and agree that:
        </p>
        <ul className="list-disc space-y-1 pl-4">
          <li>
            IntelliWatt (Intellipath Solutions LLC) will access your
            <span className="font-semibold"> electric usage data stored in Smart Meter Texas</span>,
            including 15-minute interval usage, daily meter reads, and monthly billing reads
            associated with the ESIID and service address shown below.
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
        </ul>
        <p>
          This consent does not change your current Retail Electric Provider or your utility service. It only
          allows IntelliWatt, as a registered Competitive Service Provider, to securely read your meter data
          through Smart Meter Texas.
        </p>
      </div>

      <div className="grid gap-3 rounded-lg bg-slate-50 p-3 text-xs text-slate-700 sm:grid-cols-2">
        <div className="space-y-1">
          <div className="font-semibold text-slate-900">Service Address</div>
          <div>
            <div>{serviceAddressLine1}</div>
            {serviceAddressLine2 ? <div>{serviceAddressLine2}</div> : null}
            <div>{[serviceCity, serviceState, serviceZip].filter(Boolean).join(", ")}</div>
          </div>
        </div>
        <div className="space-y-1">
          <div className="font-semibold text-slate-900">Meter & Utility</div>
          <div>
            <div>
              <span className="font-medium">ESIID:</span> {esiid || <span className="italic text-slate-500">Not available</span>}
            </div>
            <div>
              <span className="font-medium">TDSP:</span> {tdspName || tdspCode || (
                <span className="italic text-slate-500">Not available</span>
              )}
            </div>
            <div>
              <span className="font-medium">Contact Email:</span> {contactEmail}
            </div>
          </div>
        </div>
      </div>

      {hasActiveAuth && (
        <div className="space-y-1 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">
          <div className="font-semibold">Active SMT authorization already on file</div>
          <p>
            We already have a valid Smart Meter Texas authorization for this address. You can submit this form again to
            refresh or update your authorization, especially if you’ve changed providers, revoked consent in Smart Meter Texas,
            or updated your information.
          </p>
          {existingAuth?.authorizationStartDate && existingAuth?.authorizationEndDate && (
            <p className="text-emerald-800">
              Authorization window:
              <span className="font-medium">
                {` ${existingAuth.authorizationStartDate} – ${existingAuth.authorizationEndDate}`}
              </span>
            </p>
          )}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
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
              disabled={disabled}
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
              disabled={disabled}
              placeholder="We’ll only use this for account questions"
            />
          </div>
        </div>

      <div className="space-y-3 rounded-lg bg-slate-50 p-3 text-xs text-slate-700">
        <p className="leading-relaxed">
          By checking this box, you authorize Intellipath Solutions LLC d/b/a IntelliWatt (“IntelliWatt”) to act as your
          authorized agent and Competitive Service Provider (CSP) with Smart Meter Texas (“SMT”) for the ESIID(s) associated
          with the service address shown above. IntelliWatt may create, update, and terminate SMT data sharing agreements and
          subscriptions, and may access interval, usage, and billing data for up to 12 months (or until you revoke this
          authorization). You confirm you are the customer of record or an authorized agent for this address, and you may
          revoke this authorization at any time through your SMT account or by contacting IntelliWatt.
        </p>
        <label className="flex items-start gap-2 text-xs text-slate-800">
          <input
            id="consent"
            name="consent"
            type="checkbox"
            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 disabled:bg-slate-100"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            disabled={isPending}
          />
          <span className="leading-relaxed">
            I have read and agree to authorize IntelliWatt to act as my agent to access my Smart Meter Texas usage and
            billing data for this service address, and to create the necessary SMT agreements and subscriptions on my behalf.
          </span>
        </label>
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

        <div className="flex items-center justify-between">
          <button
            type="submit"
            disabled={disabled}
            className="inline-flex items-center rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-slate-400"
          >
            {hasActiveAuth ? "Update Authorization" : "Authorize Smart Meter Texas Access"}
          </button>
          {isPending && <span className="text-xs text-slate-500">Saving your authorization…</span>}
        </div>
      </form>
    </div>
  );
}

export default SmtAuthorizationForm;

