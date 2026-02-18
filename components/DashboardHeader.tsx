'use client';

import { useState } from 'react';
import Link from 'next/link';
import { DASHBOARD_FLOW_STEPS } from '@/lib/dashboard/flow';

const dashboardLinks = [
  // Primary flow first (single source of truth)
  ...DASHBOARD_FLOW_STEPS.map((s) => ({ href: s.href, label: s.label })),
  { href: '/dashboard/upgrades', label: 'Upgrades' },
  { href: '/dashboard/analysis', label: 'Analysis' },
  { href: '/dashboard/optimal', label: 'Optimal Energy' },
  { href: '/dashboard/entries', label: 'Entries' },
  { href: '/dashboard/referrals', label: 'Referrals' },
  { href: '/dashboard/profile', label: 'Profile' },
];

export default function DashboardHeader() {
  const [isOpen, setIsOpen] = useState(false);

  const toggleMenu = () => setIsOpen((prev) => !prev);
  const closeMenu = () => setIsOpen(false);

  return (
    <header className="border-b border-brand-blue/20 bg-brand-navy px-4 py-1 text-brand-blue shadow-lg">
      <div className="mx-auto flex max-w-6xl flex-col gap-3">
        <div className="flex items-center justify-between">
          <Link
            href="/dashboard"
            onClick={closeMenu}
            className="text-xl font-bold text-brand-blue transition-colors hover:text-brand-white"
          >
            Dashboard
          </Link>

          <nav className="hidden items-center space-x-6 text-sm md:flex">
            {dashboardLinks.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                className="text-brand-blue transition-colors hover:text-brand-white"
              >
                {label}
              </Link>
            ))}
          </nav>

          <button
            type="button"
            onClick={toggleMenu}
            className="flex items-center gap-2 rounded-md border border-brand-blue/30 px-3 py-2 text-sm font-semibold text-brand-blue transition hover:bg-brand-blue/10 focus:outline-none focus:ring-2 focus:ring-brand-blue/40 md:hidden"
            aria-expanded={isOpen}
            aria-controls="dashboard-mobile-nav"
          >
            <span>Dashboard Menu</span>
            <span className={`transition-transform ${isOpen ? 'rotate-180' : ''}`}>▾</span>
          </button>
        </div>

        {isOpen ? (
          <nav
            id="dashboard-mobile-nav"
            className="flex flex-col gap-2 rounded-lg border border-brand-blue/30 bg-brand-navy/95 p-4 text-sm text-brand-blue md:hidden"
          >
            {dashboardLinks.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                onClick={closeMenu}
                className="rounded-md px-2 py-2 transition hover:bg-brand-blue/10 hover:text-brand-white"
              >
                {label}
              </Link>
            ))}
          </nav>
        ) : null}
      </div>
    </header>
  );
}

