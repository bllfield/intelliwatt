"use client";

import { CurrentRateDetailsForm } from "@/components/CurrentRateDetailsForm";

export default function CurrentRatePage() {
  return (
    <div className="min-h-[calc(100vh-120px)] overflow-x-hidden bg-slate-50/60 py-12">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-12 px-4 sm:px-6 lg:px-0">
        <section className="relative overflow-hidden rounded-3xl border border-brand-navy/10 bg-white shadow-[0_28px_80px_rgba(16,46,90,0.08)]">
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-brand-blue/15 via-transparent to-brand-cyan/20 opacity-80" />
          <div className="relative z-10 space-y-8 p-6 sm:p-10">
            <header className="space-y-4 text-center">
              <span className="inline-flex items-center gap-2 rounded-full bg-brand-navy px-4 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-brand-cyan">
                Current Plan Snapshot
              </span>
              <div className="space-y-3">
                <h1 className="text-3xl font-semibold tracking-tight text-brand-navy sm:text-4xl">
                  Record your current electricity rate
                </h1>
                <p className="mx-auto max-w-2xl text-sm leading-relaxed text-brand-slate">
                  Share the plan you&apos;re on today so IntelliWatt can highlight how renewal pricing compares to our recommendations.
                  Upload a bill or enter the details manually—you&apos;ll still get personalized plan matches either way.
                </p>
              </div>
            </header>

            <CurrentRateDetailsForm
              onContinue={(data) => {
                console.log("Current rate details submitted:", data);
              }}
              onSkip={() => {
                console.log("Current rate details skipped; proceed to plan analyzer.");
              }}
            />
          </div>
        </section>
      </div>
    </div>
  );
}
