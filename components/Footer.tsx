'use client';

import Link from 'next/link';

export default function Footer() {
  return (
    <footer className="bg-brand-navy text-brand-blue py-8 px-4">
      <div className="max-w-6xl mx-auto">
        <div className="grid grid-cols-1 gap-8 md:grid-cols-4">
          <div className="col-span-1 md:col-span-2">
            <div className="mb-6 flex items-center">
              <a href="/" className="relative mr-4 h-16 w-32">
                <img
                  src="/IntelliWatt Logo TM.png"
                  alt="IntelliWatt™ Logo"
                  className="h-full w-full object-contain"
                />
              </a>
            </div>
            <p className="mb-6 max-w-md text-lg leading-relaxed text-brand-white">
              Stop overpaying for power with our AI-powered energy plan optimization.
              Smart algorithms find the perfect plan for your unique usage patterns.
            </p>
            <div className="flex space-x-4">
              <a
                href="https://www.facebook.com/IntelliWatt"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="IntelliWatt on Facebook"
                className="text-brand-white transition-colors hover:text-brand-blue"
              >
                <svg className="h-6 w-6" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M22.675 0H1.325C.594 0 0 .592 0 1.325v21.35C0 23.406.594 24 1.325 24H12.82v-9.294H9.692v-3.622h3.128V8.414c0-3.1 1.894-4.793 4.66-4.793 1.325 0 2.463.099 2.795.143v3.24h-1.917c-1.504 0-1.796.715-1.796 1.765v2.31h3.587l-.467 3.622h-3.12V24h6.116C23.406 24 24 23.406 24 22.675V1.325C24 .592 23.406 0 22.675 0z" />
                </svg>
              </a>
              <a
                href="https://twitter.com/IntelliWatt"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="IntelliWatt on X"
                className="text-brand-white transition-colors hover:text-brand-blue"
              >
                <svg className="h-6 w-6" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M17.5 3H21L14.2 10.6 22 21h-5.8l-4.6-6.7L6.2 21H0l8.1-9.84L1.1 3h5.95l4.22 6.11L17.5 3z" />
                </svg>
              </a>
              <a
                href="https://www.instagram.com/IntelliWatt"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="IntelliWatt on Instagram"
                className="text-brand-white transition-colors hover:text-brand-blue"
              >
                <svg className="h-6 w-6" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M7 2h10a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5V7a5 5 0 0 1 5-5zm0 2a3 3 0 0 0-3 3v10a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3V7a3 3 0 0 0-3-3H7zm5 2.5a4.5 4.5 0 1 1 0 9 4.5 4.5 0 0 1 0-9zm0 2a2.5 2.5 0 1 0 .001 5.001 2.5 2.5 0 0 0-.001-5.001zm6.75-.9a1.05 1.05 0 1 1-2.1 0 1.05 1.05 0 0 1 2.1 0z" />
                </svg>
              </a>
              <a
                href="https://www.youtube.com/@IntelliWatt"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="IntelliWatt on YouTube"
                className="text-brand-white transition-colors hover:text-brand-blue"
              >
                <svg className="h-6 w-6" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M23.498 6.186a3.003 3.003 0 0 0-2.11-2.12C19.691 3.5 12 3.5 12 3.5s-7.691 0-9.388.566a3.003 3.003 0 0 0-2.11 2.12A31.118 31.118 0 0 0 .5 12a31.118 31.118 0 0 0 .002 5.814 3.003 3.003 0 0 0 2.11 2.12C4.309 20.5 12 20.5 12 20.5s7.691 0 9.388-.566a3.003 3.003 0 0 0 2.11-2.12A31.118 31.118 0 0 0 23.5 12a31.118 31.118 0 0 0-.002-5.814zM9.75 15.5v-7l6 3.5-6 3.5z" />
                </svg>
              </a>
              <a
                href="https://www.tiktok.com/@IntelliWatt"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="IntelliWatt on TikTok"
                className="text-brand-white transition-colors hover:text-brand-blue"
              >
                <svg className="h-6 w-6" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M21.54 7.2a4.76 4.76 0 0 1-2.91-.99V15a6.03 6.03 0 1 1-6.91-5.91v3.11a2.49 2.49 0 1 0 1.79 2.39V2h3.12a4.74 4.74 0 0 0 4.91 4.2z" />
                </svg>
              </a>
            </div>
          </div>

          <div>
            <h4 className="mb-3 text-sm font-semibold text-brand-blue">Company</h4>
            <ul className="space-y-2 text-sm text-brand-blue/80">
              <li><a href="/how-it-works" className="transition-colors hover:text-brand-white">How It Works</a></li>
              <li><a href="/faq" className="transition-colors hover:text-brand-white">FAQ</a></li>
              <li><a href="/security" className="transition-colors hover:text-brand-white">Security</a></li>
              <li><a href="/privacy-policy" className="transition-colors hover:text-brand-white">Privacy Policy</a></li>
              <li><a href="/rules" className="transition-colors hover:text-brand-white">Rules</a></li>
              <li><Link href="/about" className="transition-colors hover:text-brand-white">About Us</Link></li>
            </ul>
          </div>

          <div>
            <h4 className="mb-3 text-sm font-semibold text-brand-blue">Support</h4>
            <ul className="space-y-2 text-sm text-brand-blue/80">
              <li>
                <a href="/join" className="transition-colors hover:text-brand-white">
                  Join
                </a>
              </li>
              <li>
                <a href="/login" className="transition-colors hover:text-brand-white">
                  User Dashboard
                </a>
              </li>
              <li>
                <a href="mailto:support@intelliwatt.com" className="transition-colors hover:text-brand-white">
                  support@intelliwatt.com
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-8 border-t border-brand-blue/20 pt-6 text-center text-sm text-brand-blue/60">
          <p>IntelliWatt™ | A service of Intellipath Solutions LLC | © 2025 HitTheJackWatt™</p>
        </div>
      </div>
    </footer>
  );
}
