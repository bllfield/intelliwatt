'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

import { ENTRY_OPPORTUNITIES } from '@/lib/hitthejackwatt/opportunities';

type EntryResponse = {
  entries: Array<{
    id: string;
    type: string;
    amount: number;
    status: 'ACTIVE' | 'EXPIRING_SOON' | 'EXPIRED';
  }>;
  total: number;
};

type ChecklistItem = {
  id: keyof typeof ENTRY_OPPORTUNITIES;
  title: string;
  detail: string;
  href: string;
  unlimited?: boolean;
  note?: string;
};

const CHECKLIST: ChecklistItem[] = [
  {
    id: 'smart_meter_connect',
    title: 'Usage Data (Auto or Manual)',
    detail: '1 Entry',
    href: '/dashboard/api',
  },
  {
    id: 'current_plan_details',
    title: 'Current Plan',
    detail: '1 Entry',
    href: '/dashboard/current-rate',
  },
  {
    id: 'home_details_complete',
    title: 'Home Info',
    detail: '1 Entry',
    href: '/dashboard/home',
  },
  {
    id: 'appliance_details_complete',
    title: 'Appliances',
    detail: '1 Entry',
    href: '/dashboard/appliances',
  },
  {
    id: 'referral',
    title: 'Referrals',
    detail: 'Unlimited entries and they never expire',
    href: '/dashboard/referrals',
    unlimited: true,
  },
  {
    id: 'testimonial',
    title: 'Testimonial',
    detail: '1 Entry',
    note: 'Available after a plan switch with IntelliWatt',
    href: '/dashboard/profile',
  },
];

const NEON_PURPLE = '#BF00FF';
const NEON_GREEN = '#39FF14';
const NEON_PINK = '#FF52FF';

export default function EntriesChecklistSidebar() {
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<EntryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchEntries = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch('/api/user/entries', {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({ error: 'Unable to load entries' }));
        throw new Error(payload?.error ?? 'Unable to load entries');
      }

      const payload = (await response.json()) as EntryResponse;
      setData(payload);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : 'Unable to load entries');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEntries();

    const handler = () => {
      fetchEntries().catch(() => {
        /* handled above */
      });
    };

    window.addEventListener('entriesUpdated', handler);
    return () => window.removeEventListener('entriesUpdated', handler);
  }, []);

  const totalsByType = useMemo(() => {
    const map = new Map<string, number>();
    data?.entries.forEach((entry) => {
      const current = map.get(entry.type) ?? 0;
      map.set(entry.type, current + entry.amount);
    });
    return map;
  }, [data]);

  const checklistRows = useMemo(() => {
    return CHECKLIST.map((item) => {
      const goal = ENTRY_OPPORTUNITIES[item.id];
      const earned = totalsByType.get(item.id) ?? 0;
      const amountNeeded = goal.amount ?? 1;
      const isComplete = item.unlimited ? earned > 0 : earned >= amountNeeded;

      let statusText: string;
      if (item.unlimited) {
        statusText = earned > 0 ? `${earned} entries earned` : 'No entries earned yet';
      } else {
        statusText = isComplete ? `${amountNeeded} entry earned` : `${amountNeeded} entry available`;
      }

      return {
        ...item,
        isComplete,
        earned,
        statusText,
      };
    });
  }, [totalsByType]);

  const totalEntries = data?.total ?? 0;

  const toggleOpen = () => {
    setIsOpen((prev) => !prev);
  };

  return (
    <div className="fixed left-0 top-1/2 z-50 -translate-y-1/2">
      <button
        type="button"
        onClick={toggleOpen}
        className="group relative flex -translate-x-[75%] items-center justify-center rounded-r-3xl border border-[#39FF14]/60 bg-[#39FF14] px-3 py-2 text-xs font-bold uppercase tracking-[0.3em] text-brand-navy transition hover:-translate-x-[65%] hover:shadow-[0_0_25px_rgba(57,255,20,0.55)]"
        aria-expanded={isOpen}
        aria-controls="entries-checklist-panel"
      >
        <span className="text-xs" style={{ writingMode: 'vertical-rl' }}>
          ENTRIES DETAILS
        </span>
      </button>

      {isOpen ? (
        <div
          id="entries-checklist-panel"
          className="ml-3 w-[300px] max-w-[85vw] rounded-3xl border-2 border-[#39FF14]/40 bg-brand-navy p-5 text-brand-cyan shadow-[0_30px_80px_rgba(10,20,60,0.55)]"
        >
          <div className="mb-4 text-center">
            <h2
              className="text-lg font-semibold uppercase tracking-[0.3em]"
              style={{ color: NEON_GREEN }}
            >
              Get your Entries! to Win!!
            </h2>
          </div>

          {loading ? (
            <p className="text-center text-sm text-brand-cyan/70">Loading…</p>
          ) : error ? (
            <p className="text-center text-sm text-rose-300">{error}</p>
          ) : (
            <div className="space-y-4">
              {checklistRows.map((item) => (
                <div
                  key={item.id}
                  className="flex items-start gap-3 rounded-3xl border border-[#BF00FF]/50 bg-brand-navy/80 p-4 shadow-[0_10px_30px_rgba(10,20,60,0.35)]"
                >
                  <span
                    className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full border-2 text-xl font-bold shadow-[0_0_18px_rgba(191,0,255,0.35)] ${
                      item.isComplete
                        ? 'border-[#BF00FF] text-[#39FF14]'
                        : 'border-[#BF00FF] text-[#FF52FF]'
                    }`}
                    aria-hidden="true"
                  >
                    {item.isComplete ? '✔' : '✖'}
                  </span>
                  <div className="space-y-1">
                    <div className="text-sm font-semibold" style={{ color: NEON_PURPLE }}>
                      {item.title}
                    </div>
                    <div className="text-xs font-semibold" style={{ color: NEON_GREEN }}>
                      {item.statusText}
                    </div>
                    <div className="text-xs" style={{ color: NEON_GREEN }}>
                      {item.detail}
                    </div>
                    {item.note ? (
                      <div className="text-[11px] text-brand-cyan/70">{item.note}</div>
                    ) : null}
                    <Link
                      href={item.href}
                      className="inline-flex text-[11px] font-semibold uppercase tracking-wide text-[#39FF14] underline-offset-4 hover:underline"
                    >
                      Go to {item.title}
                    </Link>
                  </div>
                </div>
              ))}

              <div className="rounded-3xl border border-[#39FF14]/60 bg-brand-navy/80 p-4 text-center shadow-[0_10px_30px_rgba(10,20,60,0.35)]">
                <span className="text-sm font-semibold uppercase tracking-[0.3em]" style={{ color: NEON_PURPLE }}>
                  Total Entries
                </span>
                <div className="mt-2 text-3xl font-bold" style={{ color: NEON_GREEN }}>
                  {totalEntries}
                </div>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
