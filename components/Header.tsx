'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import ClientEntriesCounter from './ClientEntriesCounter';
import DashboardHeader from './DashboardHeader';
import { usePathname } from 'next/navigation';

type NavLink = {
  href: string;
  label: string;
  external?: boolean;
};

const navLinks: NavLink[] = [
  { href: '/how-it-works', label: 'How It Works' },
  { href: '/benefits', label: 'Benefits' },
  { href: '/faq', label: 'FAQ' },
  { href: '/security', label: 'Security' },
  { href: '/privacy-policy', label: 'Privacy' },
  { href: '/rules', label: 'Rules' },
  { href: '/about', label: 'About Us' },
];

const AUTH_PATH = '/login';
const JOIN_PATH = '/join';
const DASHBOARD_PREFIX = '/dashboard';

export default function Header() {
  const [isOpen, setIsOpen] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const pathname = usePathname() || '';
  const isAdminPath = pathname.startsWith('/admin');

  useEffect(() => {
    let cancelled = false;
    const checkStatus = async () => {
      // Admin pages are token-gated and do not require (or guarantee) a user session.
      // Avoid spamming 401s from /api/user/status while browsing Admin Tools.
      if (isAdminPath) {
        if (!cancelled) {
          setIsAuthenticated(false);
          setAuthChecked(true);
        }
        return;
      }
      try {
        const response = await fetch('/api/user/status', { cache: 'no-store' });
        if (!cancelled) {
          setIsAuthenticated(response.ok);
        }
      } catch (error) {
        if (!cancelled) {
          setIsAuthenticated(false);
        }
      } finally {
        if (!cancelled) {
          setAuthChecked(true);
        }
      }
    };

    checkStatus();

    return () => {
      cancelled = true;
    };
  }, [isAdminPath]);

  const handleToggle = () => setIsOpen((prev) => !prev);
  const handleClose = () => setIsOpen(false);

  const handleLogout = async () => {
    if (isLoggingOut) return;
    setIsLoggingOut(true);
    try {
      await fetch('/api/user/logout', {
        method: 'POST',
      });
      setIsAuthenticated(false);
      if (typeof window !== 'undefined') {
        window.location.href = '/';
      }
    } catch (error) {
      console.error('Failed to log out', error);
      setIsLoggingOut(false);
    }
  };

  return (
    <>
    <header className="border-b border-brand-blue/20 bg-brand-navy px-4 py-2 text-brand-blue shadow-lg">
      <div className="mx-auto max-w-6xl px-0 sm:px-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <Link href="/" onClick={handleClose}>
              <div className="relative h-[8.48rem] w-[8.48rem]">
                <Image
                  src="/IntelliWatt Logo.png"
                  alt="IntelliWatt™ Logo"
                  fill
                  className="object-contain"
                  priority
                />
              </div>
            </Link>

            {!isAdminPath && (
            <div className="hidden items-center gap-4 border-l border-brand-blue/20 pl-3 sm:flex">
              <a
                href="https://www.hitthejackwatt.com"
                target="_blank"
                rel="noopener noreferrer"
                className="relative h-[4.068rem] w-[11.3904rem]"
              >
                <Image
                  src="/Hitthejackwatt-Logo.png"
                  alt="HitTheJackWatt™"
                  fill
                  className="object-contain"
                  priority
                />
              </a>
              <div className="flex flex-col items-center text-xs leading-tight">
                <div className="font-semibold" style={{ color: '#39FF14' }}>
                  Total Entries
                </div>
                <div className="mt-0.5">
                  <ClientEntriesCounter />
                </div>
              </div>
            </div>
            )}
          </div>

          <nav className="hidden items-center space-x-6 text-sm md:flex">
              {navLinks.map(({ href, label, external }) => (
              <Link
                key={href}
                href={href}
                  target={external ? '_blank' : undefined}
                  rel={external ? 'noopener noreferrer' : undefined}
                className="text-brand-blue transition-colors hover:text-brand-white"
              >
                {label}
              </Link>
            ))}
          </nav>

          <div className="hidden md:flex items-center gap-3">
            {authChecked && isAuthenticated ? (
              <button
                onClick={handleLogout}
                disabled={isLoggingOut}
                className="inline-flex items-center rounded-full border border-brand-blue/40 px-4 py-2 text-sm font-semibold text-brand-blue transition hover:border-brand-blue hover:text-brand-white disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isLoggingOut ? 'Logging out…' : 'Logout'}
              </button>
            ) : (
              <>
                <Link
                  href={JOIN_PATH}
                  className="inline-flex items-center rounded-full border border-brand-blue/40 px-4 py-2 text-sm font-semibold text-brand-blue transition hover:border-brand-blue hover:text-brand-white"
                >
                  Join
                </Link>
              <Link
                href={AUTH_PATH}
                className="inline-flex items-center rounded-full border border-brand-blue/40 px-4 py-2 text-sm font-semibold text-brand-blue transition hover:border-brand-blue hover:text-brand-white"
              >
                  User Dashboard
              </Link>
              </>
            )}
          </div>

          <button
            type="button"
            onClick={handleToggle}
            className="flex items-center gap-2 rounded-md border border-brand-blue/30 px-3 py-2 text-sm font-semibold text-brand-blue transition hover:bg-brand-blue/10 focus:outline-none focus:ring-2 focus:ring-brand-blue/40 md:hidden"
            aria-expanded={isOpen}
            aria-controls="mobile-nav"
          >
            <span>IntelliWatt Menu</span>
            <span className={`transition-transform ${isOpen ? 'rotate-180' : ''}`}>▾</span>
          </button>
        </div>

        {isOpen ? (
          <nav
            id="mobile-nav"
            className="flex flex-col gap-2 rounded-lg border border-brand-blue/30 bg-brand-navy/95 p-4 text-sm text-brand-blue md:hidden"
          >
            {navLinks.map(({ href, label, external }) => (
              <Link
                key={href}
                href={href}
                target={external ? '_blank' : undefined}
                rel={external ? 'noopener noreferrer' : undefined}
                onClick={handleClose}
                className="rounded-md px-2 py-2 transition hover:bg-brand-blue/10 hover:text-brand-white"
              >
                {label}
              </Link>
            ))}
            {authChecked && isAuthenticated ? (
              <button
                onClick={() => {
                  handleClose();
                  handleLogout();
                }}
                disabled={isLoggingOut}
                className="mt-2 rounded-md px-2 py-2 text-center font-semibold transition hover:bg-brand-blue/10 hover:text-brand-white disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isLoggingOut ? 'Logging out…' : 'Logout'}
              </button>
            ) : (
              <>
                <Link
                  href={JOIN_PATH}
                  onClick={handleClose}
                  className="mt-2 rounded-md px-2 py-2 text-center font-semibold transition hover:bg-brand-blue/10 hover:text-brand-white"
                >
                  Join
                </Link>
              <Link
                href={AUTH_PATH}
                onClick={handleClose}
                  className="rounded-md px-2 py-2 text-center font-semibold transition hover:bg-brand-blue/10 hover:text-brand-white"
              >
                  User Dashboard
              </Link>
              </>
            )}
          </nav>
        ) : null}
      </div>
    </header>

    {authChecked && isAuthenticated ? <DashboardHeader /> : null}
  </>
  );
}


