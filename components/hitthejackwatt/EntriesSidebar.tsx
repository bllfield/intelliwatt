'use client';

import Image from 'next/image';
import { useState, useEffect } from 'react';
import { getAllOpportunities, MAX_STANDARD_ENTRIES, type EntryType } from '@/lib/hitthejackwatt/opportunities';

interface EntryData {
  id: string;
  type: string;
  amount: number;
  createdAt: string;
  status: 'ACTIVE' | 'EXPIRING_SOON' | 'EXPIRED';
  expiresAt: string | null;
}

interface EntriesSidebarProps {
  className?: string;
}

interface OpportunityStatus {
  id: EntryType;
  label: string;
  description: string;
  amount: number;
  earned: number;
  available: boolean;
  maxPerUser?: number;
  expiringSoon: number;
  expired: number;
  nextExpiry: Date | null;
}

export default function EntriesSidebar({ className = '' }: EntriesSidebarProps) {
  const [entries, setEntries] = useState<EntryData[]>([]);
  const [totalEntries, setTotalEntries] = useState(0);
  const [loading, setLoading] = useState(true);
  const [opportunities, setOpportunities] = useState<OpportunityStatus[]>([]);

  useEffect(() => {
    const fetchEntries = async () => {
      try {
        const response = await fetch('/api/user/entries');
        if (response.ok) {
          const data = await response.json();
          setEntries(data.entries || []);
          setTotalEntries(data.total || 0);
          
          // Build opportunity status
          const allEntries: EntryData[] = data.entries || [];
          const opps = getAllOpportunities();
          const statusMap: OpportunityStatus[] = opps.map(opp => {
            const entriesForType = allEntries.filter((entry) => entry.type === opp.id);
            const activeEntries = entriesForType.filter((entry) => entry.status === 'ACTIVE');
            const expiringSoonEntries = entriesForType.filter((entry) => entry.status === 'EXPIRING_SOON');
            const expiredEntries = entriesForType.filter((entry) => entry.status === 'EXPIRED');

            const earned = activeEntries.reduce((sum, entry) => sum + entry.amount, 0);
            const expiringSoon = expiringSoonEntries.reduce((sum, entry) => sum + entry.amount, 0);
            const expired = expiredEntries.reduce((sum, entry) => sum + entry.amount, 0);

            let available = true;
            if (opp.maxPerUser !== undefined) {
              const totalClaimed = earned + expiringSoon;
              available = totalClaimed < opp.amount * (opp.maxPerUser || 1);
            }

            const nextExpiry =
              expiringSoonEntries.length > 0
                ? expiringSoonEntries
                    .filter((entry) => entry.expiresAt)
                    .map((entry) => new Date(entry.expiresAt as string))
                    .sort((a, b) => a.getTime() - b.getTime())[0] ?? null
                : null;

            return {
              id: opp.id,
              label: opp.label,
              description: opp.description,
              amount: opp.amount,
              earned,
              available,
              maxPerUser: opp.maxPerUser,
              expiringSoon,
              expired,
              nextExpiry,
            };
          });
          
          setOpportunities(statusMap);
        }
      } catch (error) {
        console.error('Error fetching entries:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchEntries();

    // Listen for entries update events
    const handleEntriesUpdate = () => {
      fetchEntries();
    };
    window.addEventListener('entriesUpdated', handleEntriesUpdate);

    return () => {
      window.removeEventListener('entriesUpdated', handleEntriesUpdate);
    };
  }, []);

  return (
    <aside className={`bg-brand-navy border-r border-brand-blue/20 ${className}`}>
      <div className="sticky top-0 h-screen overflow-y-auto">
        {/* Logo */}
        <div className="p-6 border-b border-brand-blue/20">
          <div className="flex items-center justify-center">
            <Image
              src="/Hitthejackwatt-Logo.png"
              alt="HitTheJackWatt Logo"
              width={200}
              height={80}
              className="object-contain"
              unoptimized
            />
          </div>
        </div>

        {/* Total Entries */}
        <div className="p-6 border-b border-brand-blue/20">
          <div className="text-center">
            <div className="text-sm text-brand-slate mb-2">Total Entries</div>
            <div className="text-4xl font-bold text-[#39FF14]" style={{ color: '#39FF14' }}>
              {loading ? '...' : totalEntries}
            </div>
            <div className="text-xs text-brand-slate mt-2">
              {totalEntries >= MAX_STANDARD_ENTRIES
                ? 'Maximum standard entries reached!'
                : 'Earn more to increase your chances'}
            </div>
          </div>
        </div>

        {/* Entries Breakdown */}
        <div className="p-6">
          <h3 className="text-lg font-bold mb-4" style={{ color: '#39FF14' }}>
            Your Entries
          </h3>
          
          {loading ? (
            <div className="text-brand-slate text-sm">Loading...</div>
          ) : (
            <div className="space-y-3">
              {opportunities.map((opp) => {
                const activeOrPending = opp.earned + opp.expiringSoon;
                return (
                  <div
                    key={opp.id}
                    className="rounded-lg border border-brand-blue/20 bg-brand-navy/80 p-4"
                  >
                    <div className="mb-2 flex items-start justify-between">
                      <div className="flex-1">
                        <div className="mb-1 flex items-center gap-2">
                          <span className="text-sm font-semibold" style={{ color: '#39FF14' }}>
                            {opp.label}
                          </span>
                          {activeOrPending > 0 ? (
                            <span className="text-lg" style={{ color: '#BF00FF' }}>
                              ✓
                            </span>
                          ) : null}
                        </div>
                        <div className="text-xs text-brand-slate">{opp.description}</div>
                      </div>
                    </div>

                    {opp.expiringSoon > 0 && opp.nextExpiry ? (
                      <div className="mb-2 inline-flex items-center rounded-full border border-amber-200 bg-amber-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-amber-200">
                        Expiring {opp.nextExpiry.toLocaleDateString()}
                      </div>
                    ) : null}

                    {opp.expired > 0 ? (
                      <div className="mb-2 inline-flex items-center rounded-full border border-rose-300 bg-rose-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-rose-200">
                        {opp.expired} expired
                      </div>
                    ) : null}

                    <div className="mt-2 flex items-center justify-between">
                      <span className="text-xs text-brand-slate">
                        {activeOrPending > 0 ? (
                          <span>
                            <span style={{ color: '#BF00FF' }}>{activeOrPending}</span>
                            {opp.maxPerUser === 1 && activeOrPending >= opp.amount
                              ? ' / ' + opp.amount + ' earned'
                              : opp.available
                              ? ' / ' + opp.amount + ' possible'
                              : ' earned'}
                          </span>
                        ) : (
                          <span style={{ color: '#39FF14' }}>
                            {opp.amount} {opp.amount === 1 ? 'entry' : 'entries'} available
                          </span>
                        )}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Info Footer */}
        <div className="p-6 pt-4 border-t border-brand-blue/20 mt-auto">
          <div className="text-xs text-brand-slate space-y-2">
            <p>
              <strong style={{ color: '#39FF14' }}>Standard entries:</strong> Max {MAX_STANDARD_ENTRIES} per user
            </p>
            <p>
              <strong style={{ color: '#39FF14' }}>Bonus entries:</strong> Unlimited from referrals
            </p>
            <p className="text-[10px] text-brand-slate/60 mt-4">
              Entries remain valid for all future monthly drawings unless withdrawn by request.
            </p>
          </div>
        </div>
      </div>
    </aside>
  );
}


