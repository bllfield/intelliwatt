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
const TAB_LABEL = ['E', 'N', 'T', 'R', 'I', 'E', 'S'];
export default function EntriesChecklistSidebar() {
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<EntryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [supportsVerticalLabel, setSupportsVerticalLabel] = useState<boolean | null>(null);

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

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const cssSupports = typeof window.CSS?.supports === 'function';
    if (!cssSupports) {
      setSupportsVerticalLabel(false);
      return;
    }

    const hasWritingMode = window.CSS.supports('writing-mode', 'vertical-rl');
    const hasTextOrientation = window.CSS.supports('text-orientation', 'upright');

    setSupportsVerticalLabel(hasWritingMode && hasTextOrientation);
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
        statusText = earned > 0 ? `${earned} Entries Earned` : 'No Entries Earned Yet';
      } else {
        statusText = isComplete ? '1 Entry Earned' : '1 Entry Available';
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

  const rows = useMemo(() => checklistRows, [checklistRows]);

  return (
    <div className="fixed left-0 top-1/2 z-50 -translate-y-1/2">
      <button
        type="button"
        onClick={toggleOpen}
        className="group relative flex -translate-x-[15%] items-center justify-center rounded-r-3xl border border-[#BF00FF]/70 bg-[#39FF14] px-2 py-3 text-xs font-bold uppercase text-[#BF00FF] transition hover:-translate-x-[2%] hover:shadow-[0_0_25px_rgba(191,0,255,0.55)] sm:-translate-x-[35%] sm:hover:-translate-x-[25%]"
        aria-expanded={isOpen}
        aria-controls="entries-checklist-panel"
      >
        {supportsVerticalLabel === null ? (
          <span
            className="flex flex-col items-center gap-[0.35rem] text-sm font-semibold leading-none"
            style={{ color: NEON_PURPLE, textShadow: '0 0 12px rgba(191,0,255,0.75)' }}
          >
            {TAB_LABEL.map((char, index) => (
              <span key={`${char}-${index}`} className="block">
                {char}
              </span>
            ))}
            <span className="sr-only">Entries checklist</span>
          </span>
        ) : supportsVerticalLabel ? (
          <span
            className="text-sm font-semibold leading-tight"
            style={{
              writingMode: 'vertical-rl',
              textOrientation: 'upright',
              letterSpacing: '0.4em',
              color: NEON_PURPLE,
              textShadow: '0 0 12px rgba(191,0,255,0.75)',
            }}
          >
            ENTRIES
            <span className="sr-only">Entries checklist</span>
          </span>
        ) : (
          <span
            className="flex flex-col items-center gap-[0.35rem] text-sm font-semibold leading-none"
            style={{ color: NEON_PURPLE, textShadow: '0 0 12px rgba(191,0,255,0.75)' }}
          >
            {TAB_LABEL.map((char, index) => (
              <span key={`${char}-${index}`} className="block">
                {char}
              </span>
            ))}
            <span className="sr-only">Entries checklist</span>
          </span>
        )}
      </button>

      {isOpen ? (
        <div
          id="entries-checklist-panel"
          className="ml-3 w-[240px] max-w-[80vw] rounded-3xl border-2 border-[#39FF14]/40 bg-brand-navy p-4 text-brand-cyan shadow-[0_30px_80px_rgba(10,20,60,0.55)]"
        >
          <div className="mb-4 text-center">
            <h2
              className="text-lg font-semibold uppercase tracking-[0.3em]"
              style={{ color: NEON_GREEN }}
            >
              Get your Entries! to Win!!
            </h2>
            <button
              type="button"
              onClick={toggleOpen}
              className="mt-2 inline-flex h-6 w-6 items-center justify-center rounded-full border border-[#FF52FF]/60 text-[#FF52FF] text-sm font-bold shadow-[0_0_18px_rgba(255,82,255,0.45)]"
              aria-label="Close entries checklist"
            >
              ✖
            </button>
          </div>

          {loading ? (
            <p className="text-center text-sm text-brand-cyan/70">Loading…</p>
          ) : error ? (
            <p className="text-center text-sm text-rose-300">{error}</p>
          ) : (
            <div className="max-h-[50vh] space-y-3 overflow-y-auto pr-1">
              {rows.map((item) => (
                <div
                  key={item.id}
                  className="flex items-start gap-3 rounded-3xl border border-[#BF00FF]/50 bg-brand-navy/80 p-3 shadow-[0_10px_30px_rgba(10,20,60,0.35)]"
                >
                  <span
                    className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full border-2 text-sm font-bold"
                    style={{
                      borderColor: '#BF00FF',
                      color: item.isComplete ? NEON_GREEN : NEON_PINK,
                      textShadow: item.isComplete
                        ? '0 0 14px rgba(57,255,20,0.95)'
                        : '0 0 14px rgba(255,82,255,0.95)',
                      boxShadow: item.isComplete
                        ? '0 0 20px rgba(57,255,20,0.6)'
                        : '0 0 20px rgba(255,82,255,0.6)',
                    }}
                    aria-hidden="true"
                  >
                    {item.isComplete ? '✔' : '✖'}
                  </span>
                  <div className="flex-1 space-y-1 text-xs">
                    <Link
                      href={item.href}
                      className="font-semibold uppercase tracking-wide underline-offset-4 hover:underline"
                      style={{ color: NEON_PURPLE, textShadow: '0 0 12px rgba(191,0,255,0.75)' }}
                    >
                      {item.title}
                    </Link>
                    <div className="font-semibold uppercase tracking-wide" style={{ color: NEON_GREEN }}>
                      {item.statusText}
                    </div>
                    {item.note ? (
                      <div className="text-[11px] uppercase tracking-wide text-brand-cyan/70">{item.note}</div>
                    ) : null}
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
