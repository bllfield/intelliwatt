'use client';

import { useState, useEffect } from 'react';
import DashboardHero from '@/components/dashboard/DashboardHero';

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
    <div className="min-h-screen bg-brand-white">
      <DashboardHero
        eyebrow="Home Profile Blueprint"
        title="Home"
        highlight="Details"
        description="Soon you’ll be able to lock in every detail—square footage, HVAC, insulation, and more—so IntelliWatt can forecast renewal costs with laser accuracy and reward you for keeping your profile current."
      />

      <section className="bg-brand-white py-12 px-4">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-10">
          <div className="rounded-3xl border border-brand-cyan/30 bg-brand-navy p-8 text-brand-cyan shadow-[0_30px_60px_rgba(10,20,60,0.45)]">
            <h2 className="text-2xl font-semibold text-brand-cyan">Coming Soon: Guided Home Onboarding</h2>
            <p className="mt-4 text-brand-cyan/80 leading-relaxed">
              Unlock richer recommendations with a guided walkthrough that captures the way your home actually lives.
              Expect a fast, mobile-friendly flow that translates your answers into personalized savings intelligence.
            </p>
            <ul className="mt-6 space-y-3 text-sm text-brand-cyan/75">
              <li className="flex items-start gap-3">
                <span className="mt-1 text-brand-blue">•</span>
                <span>Room-by-room context for HVAC, insulation, and windows.</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-1 text-brand-blue">•</span>
                <span>Automatic insight into baseline usage and comfort preferences.</span>
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-1 text-brand-blue">•</span>
                <span>Bonus entries when you keep the profile fresh ahead of renewals.</span>
              </li>
            </ul>
          </div>

          <div className="rounded-3xl border border-brand-cyan/25 bg-brand-navy/80 p-8 text-center text-brand-cyan shadow-[0_24px_50px_rgba(10,20,60,0.4)]">
            {hasCompleted ? (
              <p className="text-sm font-semibold text-[#BF00FF]">
                ✓ Demo complete! You&apos;ve already claimed the Home Details jackpot entry.
              </p>
            ) : (
              <p className="text-sm font-semibold text-[#39FF14]">
                Complete the upcoming flow to earn +1 IntelliWatt™ entry the moment it launches.
              </p>
            )}
            <button
              onClick={handleComplete}
              disabled={hasCompleted}
              className="mt-5 inline-flex items-center rounded-full border border-brand-blue/60 bg-brand-blue/15 px-6 py-2 text-sm font-semibold uppercase tracking-wide text-brand-blue transition hover:border-brand-blue hover:bg-brand-blue/25 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {hasCompleted ? 'Already Completed ✓' : 'Mark as Complete (Demo)'}
            </button>
            <p className="mt-4 text-xs text-brand-cyan/60">
              The demo button lets you preview jackpot behavior ahead of launch—no real data is being saved yet.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
