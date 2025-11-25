'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import ClientEntriesCounter from './ClientEntriesCounter';

const navLinks = [
  { href: '/how-it-works', label: 'How It Works' },
  { href: '/benefits', label: 'Benefits' },
  { href: '/faq', label: 'FAQ' },
  { href: '/security', label: 'Security' },
  { href: '/privacy-policy', label: 'Privacy' },
  { href: '/rules', label: 'Rules' },
];

const AUTH_PATH = '/join';

export default function Header() {
  const [isOpen, setIsOpen] = useState(false);

  const handleToggle = () => setIsOpen((prev) => !prev);
  const handleClose = () => setIsOpen(false);

  return (
    <header className="border-b border-brand-blue/20 bg-brand-navy px-4 py-2 text-brand-blue shadow-lg">
      <div className="mx-auto flex max-w-6xl flex-col gap-3">
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
          </div>

          <nav className="hidden items-center space-x-6 text-sm md:flex">
            {navLinks.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                className="text-brand-blue transition-colors hover:text-brand-white"
              >
                {label}
              </Link>
            ))}
          </nav>

          <div className="hidden md:flex items-center">
            <Link
              href={AUTH_PATH}
              className="inline-flex items-center rounded-full border border-brand-blue/40 px-4 py-2 text-sm font-semibold text-brand-blue transition hover:border-brand-blue hover:text-brand-white"
            >
              Join / Login
            </Link>
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
            {navLinks.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                onClick={handleClose}
                className="rounded-md px-2 py-2 transition hover:bg-brand-blue/10 hover:text-brand-white"
              >
                {label}
              </Link>
            ))}
            <Link
              href={AUTH_PATH}
              onClick={handleClose}
              className="mt-2 rounded-md px-2 py-2 text-center font-semibold transition hover:bg-brand-blue/10 hover:text-brand-white"
            >
              Join / Login
            </Link>
          </nav>
        ) : null}
      </div>
    </header>
  );
}

