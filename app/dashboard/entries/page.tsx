'use client';

import { useState, useEffect, useMemo, useCallback } from "react";

interface EntryData {
  id: string;
  type: string;
  amount: number;
  createdAt: string;
}

type CategoryConfig = {
  id: string;
  title: string;
  description: string;
  ctaLabel?: string;
  ctaHref?: string;
};

const CATEGORY_CARDS: CategoryConfig[] = [
  {
    id: "smart_meter_connect",
    title: "Smart Meter Authorization",
    description: "Connect Smart Meter Texas to unlock automated usage and +10 entries.",
    ctaLabel: "Go to API Connect",
    ctaHref: "/dashboard/api#smt",
  },
  {
    id: "referral",
    title: "Referrals",
    description: "Share your referral link and earn +5 entries per successful signup.",
    ctaLabel: "Invite Friends",
    ctaHref: "/dashboard/referrals",
  },
  {
    id: "current_plan_details",
    title: "Current Plan Details",
    description: "Enter your current rate plan to highlight savings opportunities.",
    ctaLabel: "Add Plan Details",
    ctaHref: "/dashboard/home#current-plan-details",
  },
  {
    id: "home_details_complete",
    title: "Home Details",
    description: "Complete your home profile for personalized analysis and +10 entries.",
    ctaLabel: "Complete Home Details",
    ctaHref: "/dashboard/home",
  },
];

export default function EntriesPage() {
  const [entries, setEntries] = useState<EntryData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchEntries = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch("/api/user/entries", {
        credentials: "include",
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error ?? "Failed to load entries");
      }

      const payload = await response.json();
      setEntries(payload.entries ?? []);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to load entries.";
      setError(message);
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchEntries();

    const handler = () => {
      void fetchEntries();
    };

    window.addEventListener("entriesUpdated", handler);
    return () => window.removeEventListener("entriesUpdated", handler);
  }, [fetchEntries]);

  const totalEntries = useMemo(
    () => entries.reduce((total, entry) => total + entry.amount, 0),
    [entries],
  );

  const categoryTotals = useMemo(() => {
    const map = new Map<string, number>();
    for (const entry of entries) {
      const current = map.get(entry.type) ?? 0;
      map.set(entry.type, current + entry.amount);
    }
    return map;
  }, [entries]);

  const neonValueClass = (count: number) =>
    count > 0 ? "text-[#39FF14]" : "text-[#ff1493]";

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="animate-pulse text-brand-navy">Loading entries…</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white">
      {/* Hero Section */}
      <section className="relative bg-brand-navy py-20 px-4 overflow-hidden">
        {/* Background Pattern */}
        <div className="absolute inset-0 bg-gradient-to-br from-brand-navy via-brand-navy to-brand-navy/95">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(0,240,255,0.1),transparent_50%)]"></div>
        </div>
        
        <div className="relative z-10 max-w-4xl mx-auto text-center">
          <h1 className="text-4xl md:text-6xl font-bold text-brand-white mb-6">
            Jackpot <span className="text-brand-blue">Entries</span>
          </h1>
          <p className="text-xl text-brand-white mb-8 max-w-2xl mx-auto leading-relaxed">
            Track your entries and see your chances of winning the monthly jackpot drawing.
          </p>
        </div>
      </section>

      {/* Entries Overview */}
      <section className="py-16 px-4 bg-white">
        <div className="max-w-5xl mx-auto">
          <div className="bg-white p-8 rounded-3xl border border-brand-cyan/20 shadow-[0_0_35px_rgba(56,189,248,0.2)] mb-10">
            <h2 className="text-2xl font-bold text-brand-navy mb-2 text-center">Your Entries Summary</h2>
            <p className="text-sm text-brand-slate/80 text-center mb-10">
              Every action below contributes to your monthly jackpot chances. Keep the neon numbers glowing green!
            </p>

            {error ? (
              <div className="rounded-2xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-600 text-center mb-10">
                {error}
              </div>
            ) : null}

            <div className="grid gap-6 md:grid-cols-2">
              {CATEGORY_CARDS.map((card) => {
                const count = categoryTotals.get(card.id) ?? 0;
                return (
                  <div
                    key={card.id}
                    className="rounded-3xl border border-brand-cyan/40 bg-brand-navy p-6 text-brand-cyan shadow-[0_0_30px_rgba(56,189,248,0.22)] flex flex-col gap-4"
                  >
                    <div className="flex items-center justify-between">
                      <h3 className="text-lg font-semibold uppercase tracking-wide text-brand-cyan">
                        {card.title}
                      </h3>
                      <span
                        className={`text-3xl font-bold ${neonValueClass(count)}`}
                      >
                        {count}
                      </span>
                    </div>
                    <p className="text-sm text-brand-cyan/80 leading-relaxed">
                      {card.description}
                    </p>
                    {card.ctaHref && card.ctaLabel ? (
                      <a
                        href={card.ctaHref}
                        className="inline-flex w-fit items-center rounded-full border border-brand-cyan/50 bg-brand-cyan/10 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-brand-cyan transition hover:border-brand-blue hover:text-brand-blue"
                      >
                        {card.ctaLabel}
                      </a>
                    ) : null}
                  </div>
                );
              })}
              <div className="rounded-3xl border border-brand-cyan/40 bg-brand-navy p-6 text-brand-cyan shadow-[0_0_30px_rgba(56,189,248,0.22)] flex flex-col items-center justify-center gap-3">
                <h3 className="text-lg font-semibold uppercase tracking-wide text-brand-cyan">
                  Total Jackpot Entries
                </h3>
                <span className={`text-4xl font-bold ${neonValueClass(totalEntries)}`}>
                  {totalEntries}
                </span>
                <p className="text-sm text-brand-cyan/80 text-center">
                  Keep completing actions to boost your odds in the next drawing.
                </p>
              </div>
            </div>
          </div>

          <div className="bg-brand-navy rounded-3xl border border-brand-cyan/30 p-8 text-brand-cyan shadow-[0_0_30px_rgba(56,189,248,0.18)]">
            <h3 className="text-xl font-semibold uppercase tracking-[0.3em] text-brand-cyan/70 text-center mb-6">
              Recent Entry Activity
            </h3>
            {entries.length === 0 ? (
              <div className="py-10 text-center text-brand-cyan/70">
                No entries yet. Complete your profile, connect SMT, or invite a friend to start earning.
              </div>
            ) : (
              <div className="grid gap-4">
                {entries
                  .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
                  .map((entry) => (
                    <div
                      key={entry.id}
                      className="flex flex-col rounded-2xl border border-brand-cyan/30 bg-brand-navy/70 px-5 py-4 md:flex-row md:items-center md:justify-between"
                    >
                      <div>
                        <p className="text-sm uppercase tracking-wide text-brand-cyan/60">
                          {new Date(entry.createdAt).toLocaleString()}
                        </p>
                        <p className="text-brand-cyan font-medium">
                          {entry.type.replace(/_/g, " ")}
                        </p>
                      </div>
                      <span
                        className={`mt-3 inline-flex items-center justify-center rounded-full px-4 py-1 text-sm font-semibold md:mt-0 ${neonValueClass(entry.amount)}`}
                      >
                        +{entry.amount} {entry.amount === 1 ? "Entry" : "Entries"}
                      </span>
                    </div>
                  ))}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* How to Earn More */}
      <section className="py-16 px-4 bg-brand-navy">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl font-bold text-brand-white text-center mb-12">
            How to <span className="text-brand-blue">Earn More</span> Entries
          </h2>

          <div className="grid md:grid-cols-2 gap-8 text-center">
            <div className="bg-white p-6 rounded-3xl border-2 border-brand-navy shadow-[0_15px_35px_rgba(15,23,42,0.2)]">
              <h3 className="text-xl font-bold text-brand-navy mb-4">Complete Your Profile</h3>
              <p className="text-brand-navy/80 mb-4">
                Add your home details and preferences to earn your first jackpot entries.
              </p>
              <a
                href="/dashboard/profile"
                className="inline-flex items-center rounded-full border border-brand-navy px-5 py-2 text-sm font-semibold uppercase tracking-wide text-brand-navy transition hover:border-brand-blue hover:text-brand-blue"
              >
                Update Profile
              </a>
            </div>

            <div className="bg-white p-6 rounded-3xl border-2 border-brand-navy shadow-[0_15px_35px_rgba(15,23,42,0.2)]">
              <h3 className="text-xl font-bold text-brand-navy mb-4">Connect Smart Meter</h3>
              <p className="text-brand-navy/80 mb-4">
                Link your Smart Meter Texas account for automated usage and +10 entries.
              </p>
              <a
                href="/dashboard/api#smt"
                className="inline-flex items-center rounded-full border border-brand-navy px-5 py-2 text-sm font-semibold uppercase tracking-wide text-brand-navy transition hover:border-brand-blue hover:text-brand-blue"
              >
                Connect SMT
              </a>
            </div>

            <div className="bg-white p-6 rounded-3xl border-2 border-brand-navy shadow-[0_15px_35px_rgba(15,23,42,0.2)]">
              <h3 className="text-xl font-bold text-brand-navy mb-4">Current Plan Details</h3>
              <p className="text-brand-navy/80 mb-4">
                Upload your current electric plan or enter details manually to spotlight savings.
              </p>
              <a
                href="/dashboard/home#current-plan-details"
                className="inline-flex items-center rounded-full border border-brand-navy px-5 py-2 text-sm font-semibold uppercase tracking-wide text-brand-navy transition hover:border-brand-blue hover:text-brand-blue"
              >
                Add Plan Details
              </a>
            </div>

            <div className="bg-white p-6 rounded-3xl border-2 border-brand-navy shadow-[0_15px_35px_rgba(15,23,42,0.2)]">
              <h3 className="text-xl font-bold text-brand-navy mb-4">Refer Friends</h3>
              <p className="text-brand-navy/80 mb-4">
                Invite friends and family—earn +5 entries for each successful referral.
              </p>
              <a
                href="/dashboard/referrals"
                className="inline-flex items-center rounded-full border border-brand-navy px-5 py-2 text-sm font-semibold uppercase tracking-wide text-brand-navy transition hover:border-brand-blue hover:text-brand-blue"
              >
                Share Referral Link
              </a>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
                </div>
              ) : (
                entries.map(entry => (
                  <div key={entry.id} className="flex flex-col items-center gap-3 p-4 bg-brand-navy border border-brand-navy rounded-lg text-center">
                    <span className="text-brand-blue text-xl">🔲</span>
                    <span className="text-brand-white font-medium">{entry.type}</span>
                    <span className="bg-brand-white text-brand-navy px-3 py-1 rounded-full text-sm font-semibold">
                      {entry.amount} {entry.amount === 1 ? 'Entry' : 'Entries'}
                    </span>
                  </div>
                ))
              )}

              <div className="flex flex-col items-center gap-3 p-4 bg-brand-navy border border-brand-navy rounded-lg text-center">
                <span className="text-brand-blue text-xl">🔲</span>
                <span className="text-brand-white font-medium">Referred Friends</span>
                <span className="bg-brand-white text-brand-navy px-3 py-1 rounded-full text-sm font-semibold">5+ Entries</span>
              </div>
            </div>
          </div>
          
          <div className="bg-brand-navy p-6 rounded-2xl text-center border-2 border-brand-navy">
            <p className="text-brand-blue font-bold text-lg mb-2">Total Entries Earned</p>
            <p className="text-brand-blue text-4xl font-bold">
              {entries.reduce((total, entry) => total + entry.amount, 0)}
            </p>
            <p className="text-brand-blue text-sm mt-2">Keep completing actions to earn more entries!</p>
          </div>
        </div>
      </section>

      {/* How to Earn More */}
      <section className="py-16 px-4 bg-brand-navy">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl font-bold text-brand-white text-center mb-12">
            How to <span className="text-brand-blue">Earn More</span> Entries
          </h2>
          
          <div className="grid md:grid-cols-2 gap-8 text-center">
            <div className="bg-brand-white p-6 rounded-2xl border-2 border-brand-navy">
              <h3 className="text-xl font-bold text-brand-navy mb-4">Complete Your Profile</h3>
              <p className="text-brand-navy mb-4">Add your home details and preferences to earn your first entry.</p>
              <button className="bg-brand-navy text-brand-blue font-bold py-2 px-4 rounded-lg border-2 border-brand-navy hover:border-brand-blue transition-all duration-300 mx-auto">
                Complete Profile
              </button>
            </div>
            
            <div className="bg-brand-white p-6 rounded-2xl border-2 border-brand-navy">
              <h3 className="text-xl font-bold text-brand-navy mb-4">Connect Smart Meter</h3>
              <p className="text-brand-navy mb-4">Link your Smart Meter Texas account for automatic data access.</p>
              <button className="bg-brand-navy text-brand-blue font-bold py-2 px-4 rounded-lg border-2 border-brand-navy hover:border-brand-blue transition-all duration-300 mx-auto">
                Connect Meter
              </button>
            </div>
            
            <div className="bg-brand-white p-6 rounded-2xl border-2 border-brand-navy">
              <h3 className="text-xl font-bold text-brand-navy mb-4">Tag Appliances</h3>
              <p className="text-brand-navy mb-4">Add your major appliances to get more accurate recommendations.</p>
              <button className="bg-brand-navy text-brand-blue font-bold py-2 px-4 rounded-lg border-2 border-brand-navy hover:border-brand-blue transition-all duration-300 mx-auto">
                Add Appliances
              </button>
            </div>
            
            <div className="bg-brand-white p-6 rounded-2xl border-2 border-brand-navy">
              <h3 className="text-xl font-bold text-brand-navy mb-4">Refer Friends</h3>
              <p className="text-brand-navy mb-4">Invite friends and family to earn entries for each successful referral.</p>
              <button className="bg-brand-navy text-brand-blue font-bold py-2 px-4 rounded-lg border-2 border-brand-navy hover:border-brand-blue transition-all duration-300 mx-auto">
                Invite Friends
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
} 