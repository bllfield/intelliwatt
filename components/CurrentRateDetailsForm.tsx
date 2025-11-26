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
    <div className="space-y-8">
      <div className="rounded-2xl border border-brand-navy/25 bg-brand-navy/90 p-6 text-brand-cyan shadow-[0_18px_40px_rgba(16,46,90,0.35)]">
        <h2 className="text-xs font-semibold uppercase tracking-[0.3em] text-brand-cyan/70">
          Optional · +1 HitTheJackWatt™ Entry
        </h2>
        <p className="mt-3 text-base font-semibold text-brand-cyan">
          Capture today&apos;s plan so renewal pricing lines up with IntelliWatt recommendations.
        </p>
        <p className="mt-3 text-sm leading-relaxed text-brand-cyan/85">
          Upload a recent bill or enter the details manually—you still keep full usage analysis. Completing this step earns an extra
          jackpot entry and unlocks richer savings comparisons.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[0.95fr,1.05fr]">
        <div className="space-y-4 rounded-2xl border border-brand-blue/20 bg-white/95 p-6 shadow-sm">
          <h2 className="text-base font-semibold text-brand-navy">Option 1 · Upload your latest bill</h2>
          <p className="text-sm text-brand-slate">
            On mobile, snap a clear photo. On desktop, upload the PDF. We&apos;ll use it later to auto-detect your plan name, rate, and
            contract expiration.
          </p>
          <label className="flex w-full cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-brand-blue/30 bg-brand-blue/5 p-6 text-center text-sm text-brand-navy transition hover:border-brand-blue/60 hover:bg-brand-blue/10">
            <span className="font-semibold">Drag your file here or click to browse</span>
            <span className="mt-1 text-xs text-brand-slate">Accepted formats: PDF, JPG, PNG</span>
            <input
              type="file"
              accept="image/*,application/pdf"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="hidden"
            />
          </label>
          {file ? (
            <p className="rounded-lg border border-brand-blue/25 bg-brand-blue/5 px-3 py-2 text-xs text-brand-navy">
              Selected file: <span className="font-semibold">{file.name}</span>
            </p>
          ) : null}
        </div>

        <div className="space-y-4 rounded-2xl border border-brand-blue/20 bg-white/95 p-6 shadow-sm">
          <h2 className="text-base font-semibold text-brand-navy">Option 2 · Enter plan details manually</h2>
          <p className="text-sm text-brand-slate">
            Most bills list these near the header or inside the Electricity Facts Label (EFL) section.
          </p>

          <label className="block space-y-1 text-sm text-brand-navy">
            <span className="font-semibold uppercase tracking-wide text-brand-navy/80">Plan name</span>
            <input
              type="text"
              value={planName}
              onChange={(e) => setPlanName(e.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-brand-navy shadow-sm transition focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/40"
              placeholder="e.g., Free Nights & Solar Days 12"
            />
          </label>

          <label className="block space-y-1 text-sm text-brand-navy">
            <span className="font-semibold uppercase tracking-wide text-brand-navy/80">Energy rate (¢/kWh)</span>
            <input
              type="number"
              inputMode="decimal"
              value={primaryRateCentsPerKwh}
              onChange={(e) => setPrimaryRateCentsPerKwh(e.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-brand-navy shadow-sm transition focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/40"
              placeholder="e.g., 13.9"
            />
          </label>

          <label className="block space-y-1 text-sm text-brand-navy">
            <span className="font-semibold uppercase tracking-wide text-brand-navy/80">Base charge ($/month)</span>
            <input
              type="number"
              inputMode="decimal"
              value={baseFeeDollars}
              onChange={(e) => setBaseFeeDollars(e.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-brand-navy shadow-sm transition focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/40"
              placeholder="e.g., 4.95"
            />
          </label>

          <label className="block space-y-1 text-sm text-brand-navy">
            <span className="font-semibold uppercase tracking-wide text-brand-navy/80">Contract expiration date</span>
            <input
              type="date"
              value={contractExpiration}
              onChange={(e) => setContractExpiration(e.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-brand-navy shadow-sm transition focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/40"
            />
          </label>

          <label className="block space-y-1 text-sm text-brand-navy">
            <span className="font-semibold uppercase tracking-wide text-brand-navy/80">Notes (optional)</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-brand-navy shadow-sm transition focus:border-brand-blue focus:outline-none focus:ring-2 focus:ring-brand-blue/40"
              placeholder="Free nights/weekends, tiered pricing, bill credits, etc."
              rows={4}
            />
          </label>
        </div>
      </div>

      {statusMessage ? (
        <div
          className={`rounded-2xl border px-5 py-4 text-sm shadow-sm ${
            hasAwarded
              ? "border-emerald-400/40 bg-emerald-50 text-emerald-700"
              : "border-rose-400/40 bg-rose-50 text-rose-700"
          }`}
        >
          {statusMessage}
        </div>
      ) : null}

      <form onSubmit={handleSubmit} className="flex flex-col items-center gap-4 sm:flex-row sm:justify-between">
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={isSubmitting || hasAwarded}
            className="inline-flex items-center rounded-full bg-brand-navy px-5 py-2 text-sm font-semibold uppercase tracking-wide text-brand-cyan shadow-[0_8px_24px_rgba(16,46,90,0.25)] transition hover:bg-brand-navy/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {hasAwarded ? "Entry Recorded ✓" : isSubmitting ? "Saving..." : "Finish current rate details"}
          </button>
          <button
            type="button"
            onClick={onSkip}
            className="text-sm font-semibold text-brand-blue underline decoration-dashed underline-offset-4 transition hover:text-brand-blue/80"
          >
            Skip for now
          </button>
        </div>
        <p className="text-xs text-brand-slate">
          Your responses stay private—we only use them to compare renewal costs to IntelliWatt savings.
        </p>
      </form>
    </div>
  );
}

