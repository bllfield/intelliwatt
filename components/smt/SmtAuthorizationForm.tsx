"use client";

import { useState } from "react";

export interface SmtAuthorizationFormProps {
  userId: string;
  contactEmail: string;
  houseAddressId: string;
  houseId: string;
  esiid: string;
  serviceAddressLine1: string;
  serviceAddressLine2?: string | null;
  serviceCity: string;
  serviceState: string;
  serviceZip: string;
  tdspCode: string;
  tdspName: string;
  onAuthorized?: (authorizationId: string) => void;
}

export function SmtAuthorizationForm(props: SmtAuthorizationFormProps) {
  const [customerName, setCustomerName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successId, setSuccessId] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccessId(null);

    if (!consent) {
      setError("You must authorize access to your Smart Meter Texas data to continue.");
      return;
    }

    if (!customerName.trim()) {
      setError("Please enter the customer name as it appears on your bill.");
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch("/api/smt/authorization", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          userId: props.userId,
          contactEmail: props.contactEmail,
          houseAddressId: props.houseAddressId,
          houseId: props.houseId,
          esiid: props.esiid,
          serviceAddressLine1: props.serviceAddressLine1,
          serviceAddressLine2: props.serviceAddressLine2 ?? null,
          serviceCity: props.serviceCity,
          serviceState: props.serviceState,
          serviceZip: props.serviceZip,
          tdspCode: props.tdspCode,
          tdspName: props.tdspName,
          customerName,
          contactPhone: contactPhone || null,
          consent,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data?.ok) {
        setError(data?.error || "Failed to save SMT authorization.");
        return;
      }

      const authorizationId = String(data.authorizationId);
      setSuccessId(authorizationId);
      if (props.onAuthorized) {
        props.onAuthorized(authorizationId);
      }
    } catch (err) {
      console.error("[SmtAuthorizationForm] submit error", err);
      setError("Unexpected error while contacting the server.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Smart Meter Texas Authorization</h2>
        <p className="text-sm text-gray-600">
          Please verify the service address and ESIID, then enter the customer name as it appears
          on your bill and authorize IntelliWatt to access your Smart Meter Texas data.
        </p>
      </div>

      <div className="grid gap-2 text-sm">
        <div>
          <div className="font-medium">Service Address</div>
          <div>
            {props.serviceAddressLine1}
            {props.serviceAddressLine2 ? `, ${props.serviceAddressLine2}` : ""}
          </div>
          <div>
            {props.serviceCity}, {props.serviceState} {props.serviceZip}
          </div>
        </div>

        <div>
          <div className="font-medium">ESIID</div>
          <div>{props.esiid}</div>
        </div>

        <div>
          <div className="font-medium">Utility / TDSP</div>
          <div>
            {props.tdspName} ({props.tdspCode})
          </div>
        </div>

        <div>
          <div className="font-medium">Contact Email</div>
          <div>{props.contactEmail}</div>
        </div>
      </div>

      <div className="space-y-1">
        <label className="block text-sm font-medium" htmlFor="customerName">
          Customer Name (as it appears on your bill)
        </label>
        <input
          id="customerName"
          type="text"
          className="w-full rounded-md border px-3 py-2 text-sm"
          value={customerName}
          onChange={(event) => setCustomerName(event.target.value)}
          disabled={submitting}
        />
      </div>

      <div className="space-y-1">
        <label className="block text-sm font-medium" htmlFor="contactPhone">
          Contact Phone (optional)
        </label>
        <input
          id="contactPhone"
          type="tel"
          className="w-full rounded-md border px-3 py-2 text-sm"
          value={contactPhone}
          onChange={(event) => setContactPhone(event.target.value)}
          disabled={submitting}
        />
      </div>

      <div className="flex items-start gap-2">
        <input
          id="consent"
          type="checkbox"
          className="mt-1"
          checked={consent}
          onChange={(event) => setConsent(event.target.checked)}
          disabled={submitting}
        />
        <label htmlFor="consent" className="text-sm">
          I authorize IntelliWatt to access my Smart Meter Texas data (interval usage and billing
          history) for the next 12 months for the service address and ESIID shown above.
        </label>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {successId && (
        <p className="text-sm text-green-600">
          Authorization saved successfully. ID: {successId}
        </p>
      )}

      <button
        type="submit"
        className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
        disabled={submitting}
      >
        {submitting ? "Saving..." : "Authorize SMT Access"}
      </button>
    </form>
  );
}

export default SmtAuthorizationForm;

