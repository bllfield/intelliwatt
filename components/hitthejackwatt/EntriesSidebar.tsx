'use client';

import Image from 'next/image';
import { useState, useEffect } from 'react';
import { getAllOpportunities, getOpportunity, type EntryType } from '@/lib/hitthejackwatt/opportunities';

interface EntryData {
  id: string;
  type: string;
  amount: number;
  createdAt: string;
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
          const opps = getAllOpportunities();
          const statusMap: OpportunityStatus[] = opps.map(opp => {
            const earnedEntries = (data.entries || []).filter(
              (e: EntryData) => e.type === opp.id
            );
            const earned = earnedEntries.reduce((sum: number, e: EntryData) => sum + e.amount, 0);
            
            // Check if available (not reached max)
            let available = true;
            if (opp.maxPerUser !== undefined) {
              available = earned < (opp.amount * (opp.maxPerUser || 1));
            }
            
            return {
              id: opp.id,
              label: opp.label,
              description: opp.description,
              amount: opp.amount,
              earned,
              available,
              maxPerUser: opp.maxPerUser,
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
              {totalEntries >= 36 ? 'Maximum standard entries reached!' : 'Earn more to increase your chances'}
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
              {opportunities.map((opp) => (
                <div
                  key={opp.id}
                  className="bg-brand-navy/80 border border-brand-blue/20 rounded-lg p-4"
                >
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-semibold" style={{ color: '#39FF14' }}>
                          {opp.label}
                        </span>
                        {opp.earned > 0 && (
                          <span
                            className="text-lg"
                            style={{ color: '#BF00FF' }}
                          >
                            ✓
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-brand-slate">
                        {opp.description}
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex items-center justify-between mt-2">
                    <span className="text-xs text-brand-slate">
                      {opp.earned > 0 ? (
                        <span>
                          <span style={{ color: '#BF00FF' }}>{opp.earned}</span>
                          {opp.maxPerUser === 1 && opp.earned >= opp.amount
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
              ))}
            </div>
          )}
        </div>

        {/* Info Footer */}
        <div className="p-6 pt-4 border-t border-brand-blue/20 mt-auto">
          <div className="text-xs text-brand-slate space-y-2">
            <p>
              <strong style={{ color: '#39FF14' }}>Standard entries:</strong> Max {36} per user
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

