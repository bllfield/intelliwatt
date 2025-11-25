"use client";

import React, { useState, FormEvent, useEffect } from "react";

type CurrentRateDetailsFormProps = {
  onContinue?: (data: {
    planName: string;
    primaryRateCentsPerKwh: string;
    baseFeeDollars: string;
    contractExpiration: string;
    notes: string;
    hasUpload: boolean;
  }) => void;
  onSkip?: () => void;
};

export function CurrentRateDetailsForm({
  onContinue,
  onSkip,
}: CurrentRateDetailsFormProps) {
  const [planName, setPlanName] = useState("");
  const [primaryRateCentsPerKwh, setPrimaryRateCentsPerKwh] = useState("");
  const [baseFeeDollars, setBaseFeeDollars] = useState("");
  const [contractExpiration, setContractExpiration] = useState("");
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasAwarded, setHasAwarded] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("intelliwatt_current_plan_details_complete");
      if (stored === "true") {
        setHasAwarded(true);
      }
    }
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setIsSubmitting(true);
    setStatusMessage(null);

    const payload = {
      planName,
      primaryRateCentsPerKwh,
      baseFeeDollars,
      contractExpiration,
      notes,
      hasUpload: !!file,
    };

    try {
      const response = await fetch("/api/user/entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "current_plan_details", amount: 1 }),
      });

      if (response.ok) {
        const data = await response.json().catch(() => null);
        const alreadyAwarded = data?.message === "Entry already awarded";

        setHasAwarded(true);
        setStatusMessage(
          alreadyAwarded
            ? "You've already earned an entry for sharing your current plan details."
            : "✓ Entry added! Your current plan details are now counted toward the jackpot."
        );
        if (typeof window !== "undefined") {
          localStorage.setItem("intelliwatt_current_plan_details_complete", "true");
        }
        window.dispatchEvent(new CustomEvent("entriesUpdated"));
      } else {
        const errorData = await response.json().catch(() => null);
        throw new Error(errorData?.error ?? "Something went wrong awarding your entry.");
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to record your entry right now.";
      setStatusMessage(message);
    } finally {
      setIsSubmitting(false);
      onContinue?.(payload);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">
          Current Rate Details{" "}
          <span className="text-sm font-normal text-slate-500">
            (Optional, +1{' '}
            <a
              href="https://www.hitthejackwatt.com"
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-brand-blue underline decoration-transparent transition hover:decoration-brand-blue"
            >
              HitTheJackWatt™
            </a>{' '}
            entry)
          </span>
        </h1>
        <p className="text-sm text-slate-600">
          Add your current electricity plan so we can show how your costs will change when your
          plan comes due, assuming similar usage. If you skip this step, we&apos;ll still analyze
          your real usage and recommend the best plans. Completing it earns{" "}
          <strong>
            +1{' '}
            <a
              href="https://www.hitthejackwatt.com"
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand-blue underline decoration-transparent transition hover:decoration-brand-blue"
            >
              HitTheJackWatt™
            </a>{" "}
            jackpot entry
          </strong>{" "}
          and unlocks a richer comparison.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <div className="space-y-3 rounded-xl border bg-white p-4 text-center">
          <h2 className="text-base font-medium">Option 1: Upload your bill</h2>
          <p className="text-xs text-slate-500">
            On mobile, take a clear photo of the first page of your bill. On desktop, upload a PDF
            or image file. We&apos;ll use this later to auto-read your plan name, rate, and contract
            expiration.
          </p>
          <input
            type="file"
            accept="image/*,application/pdf"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm text-center"
          />
          {file ? (
            <p className="text-xs text-slate-500">
              Selected: {file.name}
            </p>
          ) : null}
        </div>

        <div className="space-y-3 rounded-xl border bg-white p-4">
          <h2 className="text-base font-medium">Option 2: Enter it manually</h2>
          <p className="text-xs text-slate-500">
            You can usually find this near the top of your bill or in the Electricity Facts Label
            section.
          </p>

          <label className="block space-y-1 text-sm">
            <span>Plan name</span>
            <input
              type="text"
              value={planName}
              onChange={(e) => setPlanName(e.target.value)}
              className="mt-1 w-full rounded-md border px-2 py-1 text-sm"
              placeholder="e.g. Free Nights & Solar Days 12"
            />
          </label>

          <label className="block space-y-1 text-sm">
            <span>Energy rate (¢/kWh)</span>
            <input
              type="number"
              inputMode="decimal"
              value={primaryRateCentsPerKwh}
              onChange={(e) => setPrimaryRateCentsPerKwh(e.target.value)}
              className="mt-1 w-full rounded-md border px-2 py-1 text-sm"
              placeholder="e.g. 13.9"
            />
          </label>

          <label className="block space-y-1 text-sm">
            <span>Base charge ($/month, if any)</span>
            <input
              type="number"
              inputMode="decimal"
              value={baseFeeDollars}
              onChange={(e) => setBaseFeeDollars(e.target.value)}
              className="mt-1 w-full rounded-md border px-2 py-1 text-sm"
              placeholder="e.g. 4.95"
            />
          </label>

          <label className="block space-y-1 text-sm">
            <span>Contract expiration date</span>
            <input
              type="date"
              value={contractExpiration}
              onChange={(e) => setContractExpiration(e.target.value)}
              className="mt-1 w-full rounded-md border px-2 py-1 text-sm"
            />
          </label>

          <label className="block space-y-1 text-sm">
            <span>Notes (optional)</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="mt-1 w-full rounded-md border px-2 py-1 text-sm"
              placeholder="Free nights/weekends, tiered pricing, bill credits, etc."
              rows={4}
            />
          </label>
        </div>
      </div>

      {statusMessage ? (
        <div
          className={`rounded-xl border px-4 py-3 text-sm ${
            hasAwarded ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "border-rose-300 bg-rose-50 text-rose-600"
          }`}
        >
          {statusMessage}
        </div>
      ) : null}

      <form onSubmit={handleSubmit} className="flex items-center gap-3">
        <button
          type="submit"
          disabled={isSubmitting || hasAwarded}
          className="inline-flex items-center rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {hasAwarded ? "Entry Recorded ✓" : isSubmitting ? "Saving..." : "Continue with these details"}
        </button>
        <button
          type="button"
          onClick={onSkip}
          className="text-sm text-slate-500 underline underline-offset-4 hover:text-slate-700"
        >
          Skip this step and go to plan results
        </button>
      </form>
    </div>
  );
}

