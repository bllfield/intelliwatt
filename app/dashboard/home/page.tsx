'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

export default function HomePage() {
  const [hasCompleted, setHasCompleted] = useState(false);

  useEffect(() => {
    const stored = typeof window !== 'undefined' ? localStorage.getItem('intelliwatt_home_details_complete') : null;
    if (stored === 'true') {
      setHasCompleted(true);
    }
  }, []);

  const handleComplete = async () => {
    try {
      await fetch('/api/user/entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'home_details_complete', amount: 1 }),
      });
      window.dispatchEvent(new CustomEvent('entriesUpdated'));
      setHasCompleted(true);
      if (typeof window !== 'undefined') {
        localStorage.setItem('intelliwatt_home_details_complete', 'true');
      }
    } catch (error) {
      console.error('Error awarding entries:', error);
    }
  };

  return (
    <div className="min-h-[calc(100vh-120px)] overflow-x-hidden bg-slate-50/60 py-12">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-12 px-4 sm:px-6 lg:px-0">
        <section className="relative overflow-hidden rounded-3xl border border-brand-navy/10 bg-white shadow-[0_28px_80px_rgba(16,46,90,0.08)]">
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-brand-blue/20 via-transparent to-brand-cyan/25 opacity-80" />
          <div className="relative z-10 space-y-8 p-6 sm:p-10">
            <header className="space-y-4 text-center">
              <span className="inline-flex items-center gap-2 rounded-full bg-brand-navy px-4 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-brand-cyan">
                Home Profile Blueprint
              </span>
              <div className="space-y-3">
                <h1 className="text-3xl font-semibold tracking-tight text-brand-navy sm:text-4xl">
                  Shape your home story for precision plan picks
                </h1>
                <p className="mx-auto max-w-2xl text-sm leading-relaxed text-brand-slate">
                  Soon you&apos;ll be able to lock in every detail—square footage, HVAC, insulation, and more—so IntelliWatt can forecast renewal costs with laser accuracy and reward you for keeping your profile current.
                </p>
              </div>
            </header>

            <div className="space-y-6 rounded-2xl border border-brand-navy/15 bg-white/95 p-6 shadow-sm">
              <div className="rounded-2xl border border-brand-blue/20 bg-brand-blue/5 p-6 text-left">
                <h2 className="text-lg font-semibold text-brand-navy">Coming soon: guided home onboarding</h2>
                <p className="mt-3 text-sm text-brand-slate">
                  Unlock richer recommendations with a guided walkthrough that captures the way your home actually lives. Expect a fast, mobile-friendly flow that translates your answers into personalized savings intelligence.
                </p>
                <ul className="mt-4 space-y-2 text-sm text-brand-navy">
                  <li className="flex items-start gap-3">
                    <span className="mt-1 text-brand-blue">•</span>
                    <span>Room-by-room context for HVAC, insulation, and windows</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="mt-1 text-brand-blue">•</span>
                    <span>Automatic insight into baseline usage and comfort preferences</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="mt-1 text-brand-blue">•</span>
                    <span>Bonus entries when you keep the profile fresh ahead of renewals</span>
                  </li>
                </ul>
              </div>

              <div className="rounded-2xl border border-brand-navy/20 bg-brand-navy/5 p-6 text-center">
                {hasCompleted ? (
                  <p className="text-sm font-semibold text-[#BF00FF]">
                    ✓ Demo complete! You&apos;ve already claimed the Home Details jackpot entry.
                  </p>
                ) : (
                  <p className="text-sm font-semibold" style={{ color: '#39FF14' }}>
                    Complete the upcoming flow to earn +1 HitTheJackWatt™ entry the moment it launches.
                  </p>
                )}
                <button
                  onClick={handleComplete}
                  disabled={hasCompleted}
                  className="mt-4 inline-flex items-center rounded-full border-2 border-brand-navy bg-brand-navy px-5 py-2 text-sm font-semibold uppercase tracking-wide text-brand-blue transition hover:border-brand-blue disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {hasCompleted ? 'Already Completed ✓' : 'Mark as Complete (Demo)'}
                </button>
                <p className="mt-3 text-xs text-brand-slate">
                  The demo button lets you see jackpot behavior ahead of launch—no real data is being saved yet.
                </p>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
