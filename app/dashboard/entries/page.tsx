'use client';

import { useState, useEffect, useMemo, useCallback } from "react";
import DashboardHero from "@/components/dashboard/DashboardHero";

interface EntryData {
  id: string;
  type: string;
  amount: number;
  createdAt: string;
  status: 'ACTIVE' | 'EXPIRING_SOON' | 'EXPIRED';
  expiresAt: string | null;
  manualUsageId: string | null;
  lastValidated: string | null;
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
    description: "Connect Smart Meter Texas to unlock automated usage and earn 1 entry.",
    ctaLabel: "Go to API Connect",
    ctaHref: "/dashboard/api#smt",
  },
  {
    id: "referral",
    title: "Referrals",
    description: "Share your referral link and earn 1 entry per successful signup.",
    ctaLabel: "Invite Friends",
    ctaHref: "/dashboard/referrals",
  },
  {
    id: "current_plan_details",
    title: "Current Plan Details",
    description: "Enter your current rate plan to highlight savings opportunities and log 1 entry—earn 1 entry.",
    ctaLabel: "Add Plan Details",
    ctaHref: "/dashboard/current-rate",
  },
  {
    id: "home_details_complete",
    title: "Home Details",
    description: "Complete your home profile for personalized analysis and earn 1 entry.",
    ctaLabel: "Complete Home Details",
    ctaHref: "/dashboard/home",
  },
  {
    id: "appliance_details_complete",
    title: "Appliance Details",
    description: "List your major appliances to log an additional entry.",
    ctaLabel: "Manage Appliances",
    ctaHref: "/dashboard/appliances",
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
    () =>
      entries
        .filter((entry) => entry.status === 'ACTIVE')
        .reduce((total, entry) => total + entry.amount, 0),
    [entries],
  );

  const categoryTotals = useMemo(() => {
    const map = new Map<string, number>();
    for (const entry of entries) {
      if (entry.status !== 'ACTIVE') continue;
      const current = map.get(entry.type) ?? 0;
      map.set(entry.type, current + entry.amount);
    }
    return map;
  }, [entries]);

  const categoryExpiryMeta = useMemo(() => {
    const map = new Map<
      string,
      {
        expiringSoonCount: number;
        expiredCount: number;
        nextExpiry: Date | null;
      }
    >();

    for (const entry of entries) {
      const meta = map.get(entry.type) ?? {
        expiringSoonCount: 0,
        expiredCount: 0,
        nextExpiry: null,
      };

      if (entry.status === 'EXPIRING_SOON' && entry.expiresAt) {
        meta.expiringSoonCount += entry.amount;
        const expiryDate = new Date(entry.expiresAt);
        if (!meta.nextExpiry || expiryDate < meta.nextExpiry) {
          meta.nextExpiry = expiryDate;
        }
      } else if (entry.status === 'EXPIRED') {
        meta.expiredCount += entry.amount;
      }

      map.set(entry.type, meta);
    }

    return map;
  }, [entries]);

  const expiringSoonTotal = useMemo(
    () =>
      entries
        .filter((entry) => entry.status === 'EXPIRING_SOON')
        .reduce((sum, entry) => sum + entry.amount, 0),
    [entries],
  );

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
      <DashboardHero
        title="Jackpot"
        highlight="Entries"
        description="Track your entries and see your chances of winning the monthly jackpot drawing."
      />

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
                const meta = categoryExpiryMeta.get(card.id);
                let statusBanner: React.ReactNode = null;

                if (meta) {
                  if (meta.expiredCount > 0) {
                    statusBanner = (
                      <span className="inline-flex items-center rounded-full border border-rose-300 bg-rose-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-rose-200">
                        Entries expired
                      </span>
                    );
                  } else if (meta.expiringSoonCount > 0 && meta.nextExpiry) {
                    statusBanner = (
                      <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-400/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-amber-200">
                        Expires {meta.nextExpiry.toLocaleDateString()}
                      </span>
                    );
                  }
                }

                return (
                  <div
                    key={card.id}
                    className="flex flex-col gap-4 rounded-3xl border border-brand-cyan/40 bg-brand-navy p-6 text-brand-cyan shadow-[0_0_30px_rgba(56,189,248,0.22)]"
                  >
                    <div className="flex items-center justify-between">
                      <h3 className="text-lg font-semibold uppercase tracking-wide text-brand-cyan">
                        {card.title}
                      </h3>
                      <span className={`text-3xl font-bold ${neonValueClass(count)}`}>
                        {count}
                      </span>
                    </div>
                    {statusBanner}
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
                  {expiringSoonTotal > 0
                    ? `${expiringSoonTotal} entr${expiringSoonTotal === 1 ? 'y is' : 'ies are'} expiring soon. Refresh your usage data to keep them active.`
                    : 'Keep completing actions to boost your odds in the next drawing.'}
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
                      className="flex flex-col gap-3 rounded-2xl border border-brand-cyan/30 bg-brand-navy/70 px-5 py-4 md:flex-row md:items-center md:justify-between"
                    >
                      <div>
                        <p className="text-sm uppercase tracking-wide text-brand-cyan/60">
                          {new Date(entry.createdAt).toLocaleString()}
                        </p>
                        <p className="text-brand-cyan font-medium">
                          {entry.type.replace(/_/g, " ")}
                        </p>
                      </div>
                      <div className="flex flex-col items-start gap-2 md:flex-row md:items-center md:gap-3">
                        <span
                          className={`inline-flex items-center justify-center rounded-full px-4 py-1 text-sm font-semibold ${neonValueClass(entry.amount)}`}
                        >
                          +{entry.amount} {entry.amount === 1 ? "Entry" : "Entries"}
                        </span>
                        {entry.status !== 'ACTIVE' ? (
                          <span
                            className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold tracking-wide ${
                              entry.status === 'EXPIRING_SOON'
                                ? 'border border-amber-300 text-amber-200'
                                : 'border border-rose-300 text-rose-300'
                            }`}
                          >
                            {entry.status === 'EXPIRING_SOON'
                              ? entry.expiresAt
                                ? `Expiring ${new Date(entry.expiresAt).toLocaleDateString()}`
                                : 'Expiring soon'
                              : 'Expired'}
                          </span>
                        ) : null}
                      </div>
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
            <div className="bg-brand-navy/95 p-6 rounded-3xl border-2 border-[#39FF14]/40 shadow-[0_15px_35px_rgba(15,23,42,0.4)]">
              <h3 className="text-xl font-bold mb-4" style={{ color: '#39FF14' }}>Connect Smart Meter</h3>
              <p className="mb-4 text-brand-white/80">
                Link your Smart Meter Texas account for automated usage and <span style={{ color: '#39FF14' }}>1 entry</span>.
              </p>
              <a
                href="/dashboard/api#smt"
                className="inline-flex items-center rounded-full border border-[#39FF14]/70 bg-[#39FF14]/10 px-5 py-2 text-sm font-semibold uppercase tracking-wide text-[#39FF14] transition hover:bg-[#39FF14]/20"
              >
                Connect SMT
              </a>
            </div>

            <div className="bg-brand-navy/95 p-6 rounded-3xl border-2 border-[#BF00FF]/40 shadow-[0_15px_35px_rgba(15,23,42,0.4)]">
              <h3 className="text-xl font-bold mb-4" style={{ color: '#BF00FF' }}>Current Plan Details</h3>
              <p className="mb-4 text-brand-white/80">
                Upload your current electric plan or enter details manually to spotlight savings—and earn <span style={{ color: '#BF00FF' }}>1 entry</span>.
              </p>
              <a
                href="/dashboard/home#current-plan-details"
                className="inline-flex items-center rounded-full border border-[#BF00FF]/70 bg-[#BF00FF]/10 px-5 py-2 text-sm font-semibold uppercase tracking-wide text-[#BF00FF] transition hover:bg-[#BF00FF]/20"
              >
                Add Plan Details
              </a>
            </div>

            <div className="bg-brand-navy/95 p-6 rounded-3xl border-2 border-[#FF52FF]/40 shadow-[0_15px_35px_rgba(15,23,42,0.4)]">
              <h3 className="text-xl font-bold mb-4" style={{ color: '#FF52FF' }}>Refer Friends</h3>
              <p className="mb-4 text-brand-white/80">
                Invite friends and family—earn <span style={{ color: '#FF52FF' }}>1 entry</span> for each successful referral.
              </p>
              <a
                href="/dashboard/referrals"
                className="inline-flex items-center rounded-full border border-[#FF52FF]/70 bg-[#FF52FF]/10 px-5 py-2 text-sm font-semibold uppercase tracking-wide text-[#FF52FF] transition hover:bg-[#FF52FF]/20"
              >
                Share Referral Link
              </a>
            </div>

            <div className="bg-brand-navy/95 p-6 rounded-3xl border-2 border-[#FFA7FF]/40 shadow-[0_15px_35px_rgba(15,23,42,0.4)]">
              <h3 className="text-xl font-bold mb-4" style={{ color: '#FFA7FF' }}>Appliance Details</h3>
              <p className="mb-4 text-brand-white/80">
                Add your major appliances so we can tailor upgrade tips—and earn <span style={{ color: '#FFA7FF' }}>1 entry</span>.
              </p>
              <a
                href="/dashboard/appliances"
                className="inline-flex items-center rounded-full border border-[#FFA7FF]/70 bg-[#FFA7FF]/10 px-5 py-2 text-sm font-semibold uppercase tracking-wide text-[#FFA7FF] transition hover:bg-[#FFA7FF]/20"
              >
                Manage Appliances
              </a>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
} 